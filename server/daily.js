// Daily scanner workflow (US/Eastern, weekdays):
//   16:40  post-close: refresh universe (weekly) + all daily bars, full scan, report, arm triggers
//   09:00  pre-market brief: regime + top setups with levels and a concrete option structure
//   09:35-16:00 every 5 min: intraday triggers when an armed setup clears its pivot on volume pace
import { readJson, writeJson } from './store.js';
import { market } from './providers/index.js';
import { refreshHotlist, hotlistState } from './scanner.js';
import { refreshIdeas, ideasForSymbol } from './strategies.js';
import { buildAutoUniverse, scanSymbols } from './universeAuto.js';
import { updateAllBars } from './bars.js';
import { sendTelegram, sendTelegramDocument, telegramStatus, playLink } from './notify.js';
import { logPlays, listPlays, playsCsv } from './playsLog.js';
import { config } from './config.js';
import { runLow } from './priority.js';
import { refreshFundamentals } from './fundamentals.js';
import { nyClock, nyDateStr, marketSession } from '../shared/time.js';
import { isTradingDay } from '../shared/marketCalendar.js';

const STATE = 'daily-state.json';
let st = readJson(STATE, { lastPost: '', lastPre: '', triggers: [], fired: {}, postReport: null, preReport: null });
const save = () => writeJson(STATE, st);
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const px = v => (Number.isFinite(v) ? v.toFixed(2) : '—');
const link = path => (config.publicUrl ? ` <a href="${config.publicUrl}/#${path}">open</a>` : '');
// Trading days only: no reports on weekends or NYSE holidays.
const isWeekday = () => isTradingDay(nyDateStr());

export const dailyState = () => ({ lastPost: st.lastPost, lastPre: st.lastPre, triggers: st.triggers, postReport: st.postReport, preReport: st.preReport, fired: st.fired });

async function send(text) {
  if (!telegramStatus().ready) return;
  // Telegram caps messages at 4096 chars: split on line boundaries.
  const chunks = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if ((cur + line).length > 3800) { chunks.push(cur); cur = ''; }
    cur += line + '\n';
  }
  if (cur.trim()) chunks.push(cur);
  for (const c of chunks) await sendTelegram(c).catch(e => console.error('[daily] telegram', e.message));
}

// Best live setup per symbol (bullish breakouts/EPs/stage-2), ranked.
function bestSetups(rows, statuses) {
  const out = [];
  for (const r of rows) {
    for (const s of r.traderSetups || []) {
      if (s.bias !== 'bull' || !statuses.some(x => s.status.startsWith(x))) continue;
      out.push({ row: r, s });
      break;
    }
  }
  return out.sort((a, b) => b.s.score - a.s.score);
}

function regimeLine(reg) {
  if (!reg) return 'Market regime: n/a';
  const icon = { uptrend: '🟢', 'under pressure': '🟡', correction: '🔴' }[reg.state] || '⚪';
  return `${icon} <b>${esc(reg.label)}</b>: SPY ${px(reg.spy)} (${esc(reg.spyStage)}), ${reg.distributionDays} distribution days, ${(reg.breadthAbove50 * 100).toFixed(0)}% of stocks above the 50-day.\n<i>${esc(reg.exposure)}</i>`;
}

const playOf = ({ row, s }, extra = {}) => ({
  symbol: row.symbol, name: row.name, trader: s.trader, setup: s.name, setupKey: s.key, status: s.status, score: s.score, price: row.price,
  pivot: s.pivot, entry: s.entry, stop: s.stop, target1: s.target1, target2: s.target2, rs: row.rsRating, stage: row.stage,
  ivRegime: row.ivRegime, strategy: row.strategy, earnings: row.earnings?.date, ...extra,
});

function setupLine({ row, s }) {
  const er = row.earningsDays != null && row.earningsDays <= 14 ? ` ⚠️ earnings ${row.earningsDays}d` : '';
  return `• <b>${esc(row.symbol)}</b> ${esc(s.trader)} ${esc(s.name)} [${esc(s.status)}] score ${s.score}\n   pivot ${px(s.pivot)} · entry ${px(s.entry)} · stop ${px(s.stop)} (${s.stopPct}%) · 2R ${px(s.target1)} · RS ${row.rsRating}${er}\n   options: ${esc(row.strategy)} (IV ${row.ivRegime || 'n/a'})${playLink(row.symbol, s.key)}`;
}

export function postClose(force = false) {
  const today = nyDateStr();
  if (!force && st.lastPost === today) return Promise.resolve(st.postReport);
  return runLow(async () => {
    st.lastPost = today; save();
    await buildAutoUniverse().catch(e => console.error('[daily] universe', e.message));
    await updateAllBars(scanSymbols());
    let h = await refreshHotlist();
    // CANSLIM fundamentals for the leaders (RS >= 80) and every O'Neil candidate, then rescore.
    const cands = h.rows.filter(r => r.rsRating >= 80 || (r.traderSetups || []).some(s => s.trader === "O'Neil")).map(r => r.symbol);
    const fp = await refreshFundamentals(cands).catch(() => null);
    if (fp?.total) h = await refreshHotlist();
    await refreshIdeas().catch(() => {});
    const breakouts = bestSetups(h.rows, ['breakout today', 'EP today']).slice(0, 8);
    const watch = bestSetups(h.rows, ['setting up', 'in buy zone']).slice(0, 25);
    // Arm tomorrow's intraday triggers from the best names still below/at their pivot.
    st.triggers = watch.map(({ row, s }) => ({ symbol: row.symbol, trader: s.trader, setup: s.name, setupKey: s.key, pivot: s.pivot, stop: s.stop, target1: s.target1, avgVolume: row.avgVolume, score: s.score, strategy: row.strategy }));
    st.fired = {};
    const text = [
      `<b>📊 Post-close scan · ${today}</b> (${h.rows.length} stocks)`,
      regimeLine(h.regime), '',
      `<b>Breakouts / EPs today</b>`, ...(breakouts.length ? breakouts.map(setupLine) : ['• none']), '',
      `<b>Setting up for tomorrow</b> (triggers armed)`, ...(watch.slice(0, 10).map(setupLine)), link('/scanner'),
    ].join('\n');
    st.postReport = { at: Date.now(), breakouts: breakouts.map(x => x.row.symbol), watch: watch.map(x => x.row.symbol) };
    save();
    logPlays('post-close', [...breakouts, ...watch.slice(0, 10)].map(x => playOf(x)));
    await send(text);
    await sendPlaysCsv(today).catch(e => console.error('[daily] plays csv', e.message));
    return st.postReport;
  });
}

// Best concrete option structure for a bullish setup (liquid only), described in one line.
async function optionLine(symbol) {
  try {
    const ideas = (await ideasForSymbol(symbol)).filter(i => i.bias === 'bull' && i.liquidityOk);
    const i = ideas[0];
    if (!i) return 'no liquid bullish structure';
    const pop = Number.isFinite(i.pop) ? `, POP ${(i.pop * 100).toFixed(0)}%` : '';
    const rr = i.rr != null ? `, R:R ${i.rr.toFixed(2)}` : '';
    return `${i.label}: ${i.description} (${i.cost < 0 ? `credit $${(-i.cost).toFixed(0)}` : `debit $${i.cost.toFixed(0)}`}${rr}${pop})`;
  } catch { return 'chain unavailable'; }
}

export function preMarket(force = false) {
  const today = nyDateStr();
  if (!force && st.lastPre === today) return Promise.resolve(st.preReport);
  return runLow(async () => {
    st.lastPre = today; save();
    const h = hotlistState();
    const top = bestSetups(h.rows, ['setting up', 'in buy zone', 'breakout today', 'EP']).slice(0, 10);
    const quotes = await market.quotes(top.map(x => x.row.symbol)).catch(() => ({}));
    const lines = [];
    for (const [k, x] of top.entries()) {
      const q = quotes[x.row.symbol];
      const pre = q?.last ? ` · last ${px(q.last)} (${q.last >= x.s.pivot ? 'above' : 'below'} pivot)` : '';
      lines.push(setupLine(x) + pre);
      if (k < 5) lines.push(`   ▶ ${esc(await optionLine(x.row.symbol))}`);
    }
    const text = [`<b>☀️ Pre-market brief · ${today}</b>`, regimeLine(h.regime), '', '<b>Top setups today</b>', ...(lines.length ? lines : ['• none']), link('/scanner')].join('\n');
    logPlays('pre-market', top.map(x => playOf(x, { price: quotes[x.row.symbol]?.last ?? x.row.price })));
    st.preReport = { at: Date.now(), symbols: top.map(x => x.row.symbol) };
    save();
    await send(text);
    return st.preReport;
  });
}

// Attach the day's plays (every alert type) as a CSV to Telegram, for your records.
export async function sendPlaysCsv(date = nyDateStr()) {
  if (!telegramStatus().ready) return false;
  const list = listPlays({ from: date, to: date });
  if (!list.length) return false;
  await sendTelegramDocument(`plays-${date}.csv`, playsCsv(list), `📎 <b>Plays log · ${date}</b>: ${list.length} plays (all alerts today). Full history: Plays Log page.`);
  return true;
}

// Fraction of the regular session elapsed (for volume pace).
function sessionFraction() {
  const { h, m } = nyClock();
  return Math.min(1, Math.max(0.02, (h * 60 + m - 570) / 390));
}

export async function intradayTriggers() {
  if (marketSession() !== 'open' || !st.triggers.length) return [];
  const today = nyDateStr();
  const quotes = await runLow(() => market.quotes(st.triggers.map(t => t.symbol))).catch(() => ({}));
  const fired = [];
  const frac = sessionFraction();
  for (const t of st.triggers) {
    const q = quotes[t.symbol];
    if (!q || !Number.isFinite(q.last) || st.fired[`${today}|${t.symbol}`]) continue;
    const pace = t.avgVolume ? (q.volume || 0) / (t.avgVolume * frac) : NaN;
    if (q.last >= t.pivot * 1.001 && pace >= 1.3) {
      st.fired[`${today}|${t.symbol}`] = Date.now();
      fired.push({ ...t, last: q.last, pace });
    }
  }
  if (fired.length) {
    save();
    logPlays('trigger', fired.map(f => ({ symbol: f.symbol, trader: f.trader, setup: f.setup, setupKey: f.setupKey, status: 'cleared pivot', score: f.score,
      price: f.last, pivot: f.pivot, entry: f.last, stop: f.stop, target1: f.target1, strategy: f.strategy, note: `${f.pace.toFixed(1)}x volume pace` })));
    await send(fired.map(f => `🚀 <b>${esc(f.symbol)}</b> cleared its ${esc(f.trader)} ${esc(f.setup)} pivot ${px(f.pivot)}: now ${px(f.last)} on ${f.pace.toFixed(1)}× volume pace\n   stop ${px(f.stop)} · 2R ${px(f.target1)} · ${esc(f.strategy)}${playLink(f.symbol, f.setupKey)}`).join('\n'));
  }
  return fired;
}

// Minute ticker driving the schedule (weekdays, New York time).
export function startDailySchedule() {
  setInterval(() => {
    if (!isWeekday()) return;
    const { h, m } = nyClock();
    const mins = h * 60 + m;
    if (mins >= 16 * 60 + 40 && mins < 20 * 60 && st.lastPost !== nyDateStr()) postClose().catch(e => console.error('[daily] post-close', e.message));
    if (mins >= 9 * 60 && mins < 9 * 60 + 25 && st.lastPre !== nyDateStr()) preMarket().catch(e => console.error('[daily] pre-market', e.message));
    if (mins >= 9 * 60 + 35 && mins < 16 * 60 && m % 5 === 0) intradayTriggers().catch(e => console.error('[daily] triggers', e.message));
  }, 60000).unref();
}
