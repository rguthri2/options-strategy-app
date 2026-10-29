// Earnings IV-crush scanner: for names reporting soon, compare the move the options market is
// pricing (front ATM straddle / spot) with the stock's actual historical earnings moves, plus the
// front-vs-back IV term premium that collapses after the report.
import { market } from './providers/index.js';
import { nextEarnings, pastEarnings, earningsSource } from './earnings.js';
import { hotlistState } from './scanner.js';
import { getSettings } from './settings.js';
import { scanSymbols } from './universeAuto.js';
import { atmIV, atmRow } from '../shared/analytics.js';
import { nyDateStr } from '../shared/time.js';

const iso = t => new Date(t * 1000).toISOString().slice(0, 10);

// Close-to-close move across the report: BMO/during-market => prior close -> report-day close;
// AMC => report-day close -> next close. Unknown timing => the larger of the two.
export function reactionMove(bars, date, hour) {
  const i = bars.findIndex(b => iso(b.t) >= date);
  if (i < 1 || iso(bars[i].t) !== date) return null;
  const bmo = bars[i].c / bars[i - 1].c - 1;
  const amc = i + 1 < bars.length ? bars[i + 1].c / bars[i].c - 1 : null;
  if (hour === 'bmo' || hour === 'dmh') return bmo;
  if (hour === 'amc') return amc;
  return amc == null || Math.abs(bmo) >= Math.abs(amc) ? bmo : amc;
}

// Without report dates: the largest opening gap in each ~quarter is almost always the report.
export function estimatedMoves(bars) {
  const out = [];
  for (let end = bars.length - 1; end - 63 >= 1 && out.length < 12; end -= 63) {
    let best = null;
    for (let i = end - 62; i <= end; i++) {
      const gap = Math.abs(bars[i].o / bars[i - 1].c - 1);
      if (!best || gap > best.gap) best = { i, gap };
    }
    if (best && best.gap > 0.015) out.push({ date: iso(bars[best.i].t), move: bars[best.i].c / bars[best.i - 1].c - 1 });
  }
  return out.reverse();
}

function verdict(ratio, term) {
  if (!Number.isFinite(ratio)) return { call: 'Insufficient history', side: 'none', play: '—' };
  if (ratio >= 1.25 && term >= 1.1) return { call: 'Sell premium', side: 'sell', play: 'Implied move exceeds history: defined-risk iron condor or iron fly outside the expected move; close the morning after the report to capture the IV crush.' };
  if (ratio >= 1.15) return { call: 'Lean sell', side: 'sell', play: 'Slightly rich: wide iron condor or a credit spread in the direction of trend.' };
  if (ratio <= 0.8) return { call: 'Buy premium', side: 'buy', play: 'Stock historically moves more than priced: long straddle/strangle held through the report (size small; crush hits if the move disappoints).' };
  if (ratio <= 0.9) return { call: 'Lean buy', side: 'buy', play: 'Slightly cheap: debit spread in the trend direction or a long strangle.' };
  return { call: 'No vol edge', side: 'none', play: 'Priced fairly: trade the chart setup with defined risk, or stand aside through the event.' };
}

async function analyze(symbol, er, row) {
  const [exps, bars, quote] = await Promise.all([market.expirations(symbol), market.dailyLong(symbol), market.quote(symbol)]);
  const spot = quote.last;
  // Front = first expiration that still includes the report (AMC on expiry day is after the close).
  const front = exps.find(e => e.date > er.date || (e.date === er.date && er.hour === 'bmo'));
  const back = front && exps.find(e => e.dte >= front.dte + 21);
  if (!front) return null;
  const [fc, bc] = await Promise.all([
    market.chain(symbol, { fromDate: front.date, toDate: front.date, strikeCount: 16 }),
    back ? market.chain(symbol, { fromDate: back.date, toDate: back.date, strikeCount: 16 }).catch(() => null) : null,
  ]);
  const fe = fc.expirations[0];
  const atm = fe && atmRow(fe.rows, spot);
  const straddle = atm ? (atm.call?.mark || 0) + (atm.put?.mark || 0) : NaN;
  const implied = straddle / spot;
  const frontIv = fe ? atmIV(fe.rows, spot) : NaN;
  const backIv = bc?.expirations[0] ? atmIV(bc.expirations[0].rows, spot) : NaN;

  let moves = [], source = 'estimated';
  const past = await pastEarnings(symbol).catch(() => null);
  if (past?.length) {
    moves = past.map(p => ({ date: p.date, move: reactionMove(bars, p.date, p.hour) })).filter(m => Number.isFinite(m.move));
    source = 'reported dates';
  }
  if (moves.length < 3) { moves = estimatedMoves(bars); source = 'estimated (largest quarterly gap)'; }
  moves = moves.slice(-12);
  const abs = moves.map(m => Math.abs(m.move)).sort((a, b) => a - b);
  const avg = abs.length ? abs.reduce((a, b) => a + b, 0) / abs.length : NaN;
  const median = abs.length ? abs[Math.floor(abs.length / 2)] : NaN;
  const exceeded = abs.length ? abs.filter(x => x > implied).length / abs.length : NaN;
  const ratio = implied / avg;
  const term = frontIv / backIv;
  return {
    symbol, name: quote.name, spot, earnings: er, bias: row?.bias || null, setup: row?.setup || null,
    frontExp: front.date, frontDte: front.dte, backExp: back?.date || null,
    straddle, impliedMove: implied, frontIv, backIv, termPremium: term,
    history: { source, count: moves.length, avgAbs: avg, medianAbs: median, maxAbs: abs.at(-1) ?? NaN, pctExceededImplied: exceeded, moves },
    ratio, ...verdict(ratio, term),
    // Rough post-event IV: front IV collapses toward the back-month level.
    ivCrushPts: Number.isFinite(frontIv) && Number.isFinite(backIv) ? (frontIv - backIv) * 100 : NaN,
  };
}

let cache = { t: 0, rows: [], errors: [] }, running = null;

export function earningsScan(force = false) {
  if (!force && Date.now() - cache.t < 30 * 60000 && cache.rows.length) return Promise.resolve(cache);
  running ??= (async () => {
    const s = getSettings();
    const syms = [...new Set([...scanSymbols(), ...s.universe, ...s.watchlist])];
    // Soonest reports first; among same-day reporters prefer the most liquid (deepest option markets).
    const vol = new Map(hotlistState().rows.map(r => [r.symbol, r.avgVolume || 0]));
    const upcoming = syms.map(sym => ({ sym, er: nextEarnings(sym) })).filter(x => x.er && x.er.days >= 0 && x.er.days <= 30)
      .sort((a, b) => a.er.days - b.er.days || (vol.get(b.sym) || 0) - (vol.get(a.sym) || 0)).slice(0, 40);
    const hot = new Map(hotlistState().rows.map(r => [r.symbol, r]));
    const rows = [], errors = [];
    for (const { sym, er } of upcoming) {
      try { const r = await analyze(sym, er, hot.get(sym)); if (r) rows.push(r); } catch (e) { errors.push(`${sym}: ${e.message}`); }
    }
    cache = { t: Date.now(), asOf: nyDateStr(), source: earningsSource(), rows, errors };
    return cache;
  })().finally(() => { running = null; });
  return running;
}
