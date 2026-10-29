// Daily price history from Tiingo (free key), stored per symbol under data/history/ and updated
// incrementally. Used by providers without a history endpoint (E*TRADE).
// Free tier: ~50 distinct symbols per hour and ~250 calls per day, so the worker paces itself;
// the first full load of a ~75-symbol universe therefore takes about two hours.
import { config } from './config.js';
import { readJson, writeJson } from './store.js';
import { nyDateStr, nyClock, addDays } from '../shared/time.js';

const PROXY = { $SPX: 'SPY', $COMPX: 'QQQ', $DJI: 'DIA', $RUT: 'IWM' };
const file = sym => `history/${sym.replace(/[^A-Z0-9$.-]/gi, '_')}.json`;
const HOURLY_SYMBOLS = 45, DAILY_CALLS = 240;

export const historyConfigured = () => Boolean(config.tiingoKey);

let usage = readJson('history-usage.json', { day: '', calls: 0, hour: [] });
const queue = [];
let working = false, lastError = null, pausedUntil = 0;

// Latest session whose close should be in the stored history.
function expectedAsOf(now = new Date()) {
  let d = nyDateStr(now);
  const { h, dow } = nyClock(now);
  const isWk = x => { const w = new Date(x + 'T12:00:00Z').getUTCDay(); return w > 0 && w < 6; };
  if (!(isWk(d) && dow > 0 && dow < 6 && h >= 18)) d = addDays(d, -1); // Tiingo EOD lands ~17:30 ET
  while (!isWk(d)) d = addDays(d, -1);
  return d;
}

function budgetOk(sym) {
  const today = nyDateStr();
  if (usage.day !== today) usage = { day: today, calls: 0, hour: [] };
  const cutoff = Date.now() - 3600000;
  usage.hour = usage.hour.filter(h => h.t > cutoff);
  const distinct = new Set(usage.hour.map(h => h.s));
  return usage.calls < DAILY_CALLS && (distinct.has(sym) || distinct.size < HOURLY_SYMBOLS);
}

async function fetchTiingo(sym) {
  const ticker = (PROXY[sym] || sym).replace(/\./g, '-').toLowerCase();
  const stored = readJson(file(sym), null);
  const start = stored?.bars?.length ? new Date((stored.bars.at(-1).t - 7 * 86400) * 1000).toISOString().slice(0, 10) : addDays(nyDateStr(), -5 * 365);
  const u = new URL(`https://api.tiingo.com/tiingo/daily/${ticker}/prices`);
  u.searchParams.set('startDate', start);
  u.searchParams.set('token', config.tiingoKey);
  usage.calls++; usage.hour.push({ t: Date.now(), s: sym });
  writeJson('history-usage.json', usage);
  const res = await fetch(u, { headers: { 'Content-Type': 'application/json' } });
  if (res.status === 429) { pausedUntil = Date.now() + 3600000; throw new Error('Tiingo rate limit reached; resuming in 1 hour'); }
  if (!res.ok) throw new Error(`Tiingo ${res.status} for ${sym}: ${(await res.text()).slice(0, 120)}`);
  const rows = await res.json();
  const fresh = rows.map(r => ({
    t: Date.parse(r.date.slice(0, 10) + 'T00:00:00Z') / 1000,
    o: r.adjOpen, h: r.adjHigh, l: r.adjLow, c: r.adjClose, v: r.adjVolume,
  }));
  // A split or dividend re-adjusts all history: refetch everything when the overlap disagrees.
  const overlap = stored?.bars?.find(b => b.t === fresh[0]?.t);
  const needsFull = overlap && Math.abs(overlap.c / fresh[0].c - 1) > 0.001;
  const merged = new Map((needsFull ? [] : stored?.bars || []).map(b => [b.t, b]));
  for (const b of fresh) merged.set(b.t, b);
  const bars = [...merged.values()].sort((a, b) => a.t - b.t);
  writeJson(file(sym), { asOf: expectedAsOf(), bars, needsFull });
  if (needsFull) enqueue(sym);
}

async function work() {
  if (working) return;
  working = true;
  while (queue.length) {
    if (Date.now() < pausedUntil) break;
    const i = queue.findIndex(budgetOk);
    if (i < 0) break; // out of budget: the next scan re-enqueues
    const [sym] = queue.splice(i, 1);
    try { await fetchTiingo(sym); lastError = null; } catch (e) { lastError = e.message; console.error('[history]', e.message); }
    await new Promise(r => setTimeout(r, 1200));
  }
  working = false;
}

function enqueue(sym) {
  if (!queue.includes(sym)) queue.push(sym);
  work();
}

// Returns stored bars (stale is fine: the live session is patched in from quotes) and queues updates.
export async function dailyBars(sym) {
  if (!historyConfigured()) throw Object.assign(new Error('Price history needs TIINGO_API_KEY in .env (free at tiingo.com)'), { status: 503 });
  const stored = readJson(file(sym), null);
  if (!stored || stored.asOf < expectedAsOf() || stored.needsFull) enqueue(sym);
  if (!stored?.bars?.length) throw Object.assign(new Error(`History for ${sym} is loading (Tiingo free tier paces ~45 symbols/hour)`), { status: 503 });
  return stored.bars;
}

export function historyStatus() {
  return { configured: historyConfigured(), queued: queue.length, callsToday: usage.day === nyDateStr() ? usage.calls : 0, lastError, paused: Date.now() < pausedUntil };
}
