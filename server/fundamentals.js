// CANSLIM fundamentals ("C" and "A") from Finnhub's Basic Financials (/stock/metric?metric=all).
// Defensive parsing: use Finnhub's precomputed growth fields when present, otherwise compute growth
// from the raw quarterly/annual series in the same response. Every value records its source.
// Cached 7 days per symbol (fundamentals change quarterly); fetched only for real candidates.
import { config } from './config.js';
import { readJson, writeJson } from './store.js';

const FILE = s => `fundamentals/${s.replace(/[^A-Z0-9.-]/gi, '_')}.json`;
const TTL = 7 * 86400000;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const pick = (obj, names) => { for (const n of names) if (Number.isFinite(num(obj?.[n]))) return { v: num(obj[n]), key: n }; return null; };

// Growth between two values; a move from a loss to a profit is a "turnaround" (no meaningful %).
function growth(cur, prev) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return { pct: NaN };
  if (prev <= 0) return cur > 0 ? { pct: NaN, turnaround: true } : { pct: NaN };
  return { pct: ((cur - prev) / Math.abs(prev)) * 100 };
}

// Series point ~1 year before `period` (quarterly YoY), tolerant of fiscal-calendar drift.
function yearAgo(series, period) {
  const t = Date.parse(period);
  return series.find(p => Math.abs(Date.parse(p.period) - (t - 365 * 864e5)) < 50 * 864e5);
}

export function parseFundamentals(json) {
  const m = json?.metric || {};
  const q = json?.series?.quarterly || {}, a = json?.series?.annual || {};
  const sortDesc = s => (Array.isArray(s) ? [...s].filter(p => p?.period && Number.isFinite(num(p.v))).sort((x, y) => y.period.localeCompare(x.period)) : []);
  const qEps = sortDesc(q.eps), aEps = sortDesc(a.eps), qSales = sortDesc(q.salesPerShare || q.revenuePerShare);
  const out = { sources: {} };

  // C: latest quarterly EPS vs the same quarter a year earlier (+ the prior quarter's, for acceleration).
  const fEps = pick(m, ['epsGrowthQuarterlyYoy']);
  if (qEps.length >= 5) {
    const g0 = growth(qEps[0].v, yearAgo(qEps, qEps[0].period)?.v);
    const g1 = growth(qEps[1].v, yearAgo(qEps, qEps[1].period)?.v);
    out.epsQYoY = fEps ? fEps.v : g0.pct; out.sources.epsQYoY = fEps ? `finnhub:${fEps.key}` : 'computed:quarterly eps';
    out.epsQYoYPrev = g1.pct; out.turnaround = g0.turnaround || false; out.latestQuarter = qEps[0].period;
    // Acceleration compares two growth rates computed the same way (both from the series).
    if (Number.isFinite(g0.pct) && Number.isFinite(g1.pct)) out.accelerating = g0.pct > g1.pct;
  } else if (fEps) { out.epsQYoY = fEps.v; out.sources.epsQYoY = `finnhub:${fEps.key}`; }

  const fSales = pick(m, ['revenueGrowthQuarterlyYoy']);
  if (fSales) { out.salesQYoY = fSales.v; out.sources.salesQYoY = `finnhub:${fSales.key}`; }
  else if (qSales.length >= 5) { out.salesQYoY = growth(qSales[0].v, yearAgo(qSales, qSales[0].period)?.v).pct; out.sources.salesQYoY = 'computed:quarterly sales/share'; }

  // A: 3-year annual EPS growth (CAGR) and return on equity.
  const f3y = pick(m, ['epsGrowth3Y']);
  if (f3y) { out.eps3Y = f3y.v; out.sources.eps3Y = `finnhub:${f3y.key}`; }
  else if (aEps.length >= 4 && aEps[3].v > 0 && aEps[0].v > 0) { out.eps3Y = ((aEps[0].v / aEps[3].v) ** (1 / 3) - 1) * 100; out.sources.eps3Y = 'computed:annual eps CAGR'; }
  if (aEps.length >= 3) out.epsUpYears = aEps.slice(0, 3).every((p, i, arr) => i === arr.length - 1 || p.v > arr[i + 1].v);
  const roe = pick(m, ['roeTTM', 'roeRfy', 'roe5Y', 'roe']);
  if (roe) { out.roe = roe.v; out.sources.roe = `finnhub:${roe.key}`; }
  return out;
}

// O'Neil's thresholds. Each letter: 'pass' | 'fail' | 'n/a'.
export function canslimGrade(f) {
  if (!f) return { C: 'n/a', A: 'n/a', points: 0, notes: ['No fundamentals'] };
  const notes = [];
  let C = 'n/a', A = 'n/a', points = 0;
  if (Number.isFinite(f.epsQYoY)) {
    C = f.epsQYoY >= 25 ? 'pass' : 'fail';
    const accel = f.accelerating === true;
    notes.push(`Qtr EPS ${f.epsQYoY >= 0 ? '+' : ''}${f.epsQYoY.toFixed(0)}% YoY${accel ? ' (accelerating)' : ''}`);
    if (C === 'pass') points += accel ? 12 : 8; else points -= 8;
    if (Number.isFinite(f.salesQYoY)) {
      notes.push(`sales ${f.salesQYoY >= 0 ? '+' : ''}${f.salesQYoY.toFixed(0)}%`);
      if (f.salesQYoY >= 25) points += 4; else if (f.salesQYoY < 0) { points -= 4; if (C === 'pass') C = 'fail'; }
    }
  } else if (f.turnaround) { notes.push('Qtr EPS: loss → profit (turnaround)'); }
  if (Number.isFinite(f.eps3Y) || Number.isFinite(f.roe)) {
    const g = Number.isFinite(f.eps3Y) ? f.eps3Y >= 25 : null;
    const r = Number.isFinite(f.roe) ? f.roe >= 17 : null;
    // "A" is first about 3 years of earnings growth: unknown growth => n/a even with a high ROE.
    A = g === false || r === false ? 'fail' : g === true ? 'pass' : 'n/a';
    if (Number.isFinite(f.eps3Y)) notes.push(`3-yr EPS growth ${f.eps3Y.toFixed(0)}%/yr`);
    if (Number.isFinite(f.roe)) notes.push(`ROE ${f.roe.toFixed(0)}%`);
    points += A === 'pass' ? 8 : A === 'fail' ? -6 : 0;
  }
  return { C, A, points, notes };
}

export const fundamentalsConfigured = () => Boolean(config.finnhubKey);
const mem = new Map();

export function storedFundamentals(sym) {
  if (mem.has(sym)) return mem.get(sym);
  const s = readJson(FILE(sym), null);
  if (s) mem.set(sym, s);
  return s;
}

let progress = { running: false, done: 0, total: 0, errors: 0, lastError: null };
export const fundamentalsProgress = () => progress;

// Fetch stale fundamentals for the given symbols (free tier: <= 60 calls/min, so ~1.1s apart).
export async function refreshFundamentals(symbols) {
  if (!fundamentalsConfigured() || progress.running) return progress;
  const todo = symbols.filter(s => !(Date.now() - (storedFundamentals(s)?.t || 0) < TTL));
  progress = { running: true, done: 0, total: todo.length, errors: 0, lastError: null };
  for (const sym of todo) {
    try {
      const u = new URL('https://finnhub.io/api/v1/stock/metric');
      u.searchParams.set('symbol', sym); u.searchParams.set('metric', 'all'); u.searchParams.set('token', config.finnhubKey);
      const res = await fetch(u);
      if (res.status === 429) { await new Promise(r => setTimeout(r, 30000)); todo.push(sym); continue; }
      if (!res.ok) throw new Error(`Finnhub ${res.status}`);
      const rec = { t: Date.now(), f: parseFundamentals(await res.json()) };
      mem.set(sym, rec); writeJson(FILE(sym), rec);
    } catch (e) { progress.errors++; progress.lastError = `${sym}: ${e.message}`; }
    progress.done++;
    await new Promise(r => setTimeout(r, 1100));
  }
  progress = { ...progress, running: false };
  if (todo.length) console.log(`[fundamentals] ${todo.length} symbols (${progress.errors} errors)`);
  return progress;
}
