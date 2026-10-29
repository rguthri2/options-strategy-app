// Multi-leg strategy math: P/L curves, breakevens, probability of profit, expected value,
// net Greeks and capital requirement. Used by the scanner (server) and builder (browser).
//
// Leg shape: { type: 'call'|'put'|'stock', qty: signed (+long / -short), strike, expiry: 'YYYY-MM-DD',
//              price: entry price per share, iv: decimal, occ?: contract symbol }
// Option qty is contracts (x100), stock qty is shares.

import { price as bsPrice, greeks as bsGreeks, intrinsic, normCdf } from './bs.js';
import { expiryMs } from './time.js';

const MS_YEAR = 365 * 24 * 3600 * 1000;
export const MULT = 100;

const mult = leg => (leg.type === 'stock' ? 1 : MULT);

export function legValue(leg, S, atMs, r = 0.04) {
  if (leg.type === 'stock') return S;
  const T = (expiryMs(leg.expiry) - atMs) / MS_YEAR;
  if (T <= 0) return intrinsic(leg.type, S, leg.strike);
  return bsPrice(leg.type, S, leg.strike, T, leg.iv || 0.3, leg.r ?? r, leg.q || 0);
}

// Net debit (+) or credit (-) in dollars.
export function netCost(legs) {
  return legs.reduce((s, l) => s + l.qty * mult(l) * l.price, 0);
}

export function pnlAt(legs, S, atMs, r = 0.04, ivShift = 0) {
  let v = 0;
  for (const l of legs) {
    const leg = ivShift ? { ...l, iv: Math.max(0.01, (l.iv || 0.3) + ivShift) } : l;
    v += l.qty * mult(l) * legValue(leg, S, atMs, r);
  }
  return v - netCost(legs);
}

export function firstExpiryMs(legs) {
  const opts = legs.filter(l => l.type !== 'stock');
  if (!opts.length) return Date.now() + 30 * 86400000;
  return Math.min(...opts.map(l => expiryMs(l.expiry)));
}

export function netGreeks(legs, S, atMs = Date.now(), r = 0.04) {
  const g = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of legs) {
    if (l.type === 'stock') { g.delta += l.qty; continue; }
    const T = (expiryMs(l.expiry) - atMs) / MS_YEAR;
    const x = bsGreeks(l.type, S, l.strike, Math.max(T, 0), l.iv || 0.3, l.r ?? r, l.q || 0);
    const m = l.qty * MULT;
    g.delta += x.delta * m; g.gamma += x.gamma * m; g.theta += x.theta * m; g.vega += x.vega * m;
  }
  return g;
}

// Full analysis at the horizon (default: first option expiry).
// sigma drives the price distribution for POP/EV (pass IV for market-implied odds, HV for "realized" odds).
export function analyze(legs, { spot, sigma, r = 0.04, now = Date.now(), horizonMs, drift = 0 } = {}) {
  const hMs = horizonMs ?? firstExpiryMs(legs);
  const T = Math.max((hMs - now) / MS_YEAR, 1 / 365);
  const sd = sigma * Math.sqrt(T);
  const cost = netCost(legs);

  // Log-space grid for integration over the lognormal distribution.
  const N = 801, span = 6;
  const mu = (drift - 0.5 * sigma * sigma) * T;
  let pop = 0, ev = 0, maxP = -Infinity, maxL = Infinity;
  const dx = (2 * span * sd) / (N - 1);
  for (let i = 0; i < N; i++) {
    const z = -span + (2 * span * i) / (N - 1);
    const x = mu + z * sd;
    const S = spot * Math.exp(x);
    const pnl = pnlAt(legs, S, hMs, r);
    const dens = Math.exp(-0.5 * z * z) / (Math.sqrt(2 * Math.PI) * sd);
    if (pnl > 0.005) pop += dens * dx;
    ev += pnl * dens * dx;
  }

  // Extremes: scan a wide grid of prices including every strike and the tails.
  const strikes = legs.filter(l => l.strike).map(l => l.strike);
  const pts = new Set([0.0001, spot * 0.01, spot * 25, ...strikes]);
  for (let i = 0; i <= 400; i++) pts.add(spot * Math.exp(-4 * sd + (8 * sd * i) / 400));
  const sorted = [...pts].filter(s => s > 0).sort((a, b) => a - b);
  let prev = null;
  const bes = [];
  for (const S of sorted) {
    const pnl = pnlAt(legs, S, hMs, r);
    if (pnl > maxP) maxP = pnl;
    if (pnl < maxL) maxL = pnl;
    if (prev && Math.sign(prev.pnl) !== Math.sign(pnl) && prev.pnl !== 0) {
      bes.push(bisect(S0 => pnlAt(legs, S0, hMs, r), prev.S, S));
    }
    prev = { S, pnl };
  }
  // Unbounded right tail detection (e.g. long call gains / naked call losses).
  const farA = pnlAt(legs, spot * 25, hMs, r), farB = pnlAt(legs, spot * 50, hMs, r);
  const slope = farB - farA;
  const unlimitedProfit = slope > 1;
  const unlimitedLoss = slope < -1;

  // Exact POP: the breakevens split the price axis into intervals of constant sign, so POP is the
  // lognormal probability mass of the profitable intervals (no grid discretization error).
  const cdf = x => (x <= 0 ? 0 : x === Infinity ? 1 : normCdf((Math.log(x / spot) - mu) / sd));
  const edges = [0, ...bes, Infinity];
  let popExact = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const a0 = edges[i], b0 = edges[i + 1];
    const mid = b0 === Infinity ? Math.max(a0 * 2, spot * 30) : a0 === 0 ? b0 / 2 : (a0 + b0) / 2;
    if (pnlAt(legs, mid, hMs, r) > 0.005) popExact += cdf(b0) - cdf(a0);
  }
  if (Number.isFinite(popExact)) pop = popExact;

  return {
    cost,
    maxProfit: unlimitedProfit ? Infinity : maxP,
    maxLoss: unlimitedLoss ? -Infinity : maxL,
    breakevens: bes.filter(b => b > spot * 0.02 && b < spot * 20),
    pop,
    ev,
    horizonMs: hMs,
    capital: capitalRequired(legs, spot, maxL, unlimitedLoss),
    greeks: netGreeks(legs, spot, now, r),
  };
}

function bisect(f, a, b) {
  let fa = f(a);
  for (let i = 0; i < 50; i++) {
    const m = (a + b) / 2, fm = f(m);
    if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

// Buying power estimate: defined risk => max loss; naked shorts => Reg-T style approximation.
export function capitalRequired(legs, spot, maxLoss, unlimitedLoss) {
  const stock = legs.filter(l => l.type === 'stock').reduce((s, l) => s + Math.max(0, l.qty) * l.price, 0);
  if (!unlimitedLoss && Number.isFinite(maxLoss)) return Math.max(Math.abs(Math.min(0, maxLoss)), stock);
  let req = stock;
  for (const l of legs) {
    if (l.type === 'stock' || l.qty >= 0) continue;
    const otm = l.type === 'call' ? Math.max(0, l.strike - spot) : Math.max(0, spot - l.strike);
    // Reg-T naked option minimum: 20% of underlying - OTM amount + premium, floored at
    // 10% of the underlying (calls) or 10% of the strike (puts), plus premium.
    const floor = l.type === 'call' ? 0.1 * spot : 0.1 * l.strike;
    const perShare = Math.max(0.2 * spot - otm + l.price, floor + l.price);
    req += perShare * MULT * -l.qty;
  }
  return req;
}

// P/L curve points for charting: [{S, expiry, now}] at horizon and at a chosen date.
export function curve(legs, { lo, hi, n = 160, r = 0.04, horizonMs, atMs, ivShift = 0 }) {
  const hMs = horizonMs ?? firstExpiryMs(legs);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const S = lo + ((hi - lo) * i) / n;
    out.push({ S, exp: pnlAt(legs, S, hMs, r), t: atMs != null ? pnlAt(legs, S, atMs, r, ivShift) : null });
  }
  return out;
}

// ----- Chain helpers (normalized chain rows: {strike, call, put}) -----

export function pickByDelta(rows, type, target) {
  let best = null, bestD = Infinity;
  for (const r of rows) {
    const c = r[type];
    if (!c || !Number.isFinite(c.delta) || !(c.bid > 0 || c.mark > 0)) continue;
    const d = Math.abs(Math.abs(c.delta) - target);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

export function contractAt(rows, type, strike) {
  return rows.find(r => Math.abs(r.strike - strike) < 1e-6)?.[type] || null;
}

// Nearest listed strike at distance `width` beyond `strike` in `dir` (+1 up / -1 down).
export function strikeBeyond(rows, type, strike, width, dir) {
  const target = strike + dir * width;
  let best = null, bestD = Infinity;
  for (const r of rows) {
    if (!r[type]) continue;
    if (dir > 0 ? r.strike <= strike : r.strike >= strike) continue;
    const d = Math.abs(r.strike - target);
    if (d < bestD) { bestD = d; best = r[type]; }
  }
  return best;
}

export function legFrom(contract, qty, side = qty > 0 ? 'buy' : 'sell') {
  // Enter at the natural price: buys at ask, sells at bid (mark if one side is missing).
  const px = side === 'buy' ? (contract.ask || contract.mark) : (contract.bid || contract.mark);
  return {
    type: contract.type, qty, strike: contract.strike, expiry: contract.expiry,
    price: round2(px), iv: contract.iv, occ: contract.occ, delta: contract.delta,
    ...(Number.isFinite(contract.q) ? { q: contract.q } : {}), ...(Number.isFinite(contract.r) ? { r: contract.r } : {}),
  };
}

export function midLeg(contract, qty) {
  return { ...legFrom(contract, qty), price: round2(contract.mark ?? (contract.bid + contract.ask) / 2) };
}

export const round2 = x => Math.round(x * 100) / 100;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtExp(d) {
  const [y, m, dd] = d.split('-');
  return `${MON[Number(m) - 1]} ${Number(dd)} '${y.slice(2)}`;
}

export function describeLegs(legs) {
  return legs.map(l => {
    if (l.type === 'stock') return `${l.qty > 0 ? '+' : ''}${l.qty} sh`;
    return `${l.qty > 0 ? '+' : ''}${l.qty} ${fmtExp(l.expiry)} ${fmtStrike(l.strike)}${l.type === 'call' ? 'C' : 'P'}`;
  }).join(' / ');
}

// OCC-style contract id, e.g. "AAPL  261016C00150000" (root padded to 6).
export function occSymbol(sym, expiry, type, strike) {
  return `${sym.padEnd(6)}${expiry.slice(2).replace(/-/g, '')}${type === 'call' ? 'C' : 'P'}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}

export function parseOcc(occ) {
  const m = String(occ).match(/^(.{1,6}?)\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  return { symbol: m[1].trim(), expiry: `20${m[2]}-${m[3]}-${m[4]}`, type: m[5] === 'C' ? 'call' : 'put', strike: Number(m[6]) / 1000 };
}

export const fmtStrike = k => (Number.isInteger(k) ? String(k) : k.toFixed(2).replace(/0$/, ''));
