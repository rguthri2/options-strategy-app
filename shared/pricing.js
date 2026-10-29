// Chain-level pricing model used for every live chain:
//  1) Implied forward per expiration from put-call parity on near-the-money two-sided markets
//     (captures dividends, borrow and rate effects: the same approach professional vol desks use).
//  2) Implied volatility from the live mid under that forward, with American (Barone-Adesi-Whaley)
//     pricing where early exercise matters (in/near-the-money puts; in-the-money calls with carry).
//  3) Greeks recomputed from those inputs (analytic for European, numeric for American), so they
//     reflect the current quote rather than an hourly vendor snapshot. Vendor values are kept as a
//     cross-check.
import { impliedVol, greeks, americanPrice, impliedVolAmerican, greeksNumeric } from './bs.js';
import { expiryMs, valuationTime } from './time.js';

const YEAR = 365 * 24 * 3600 * 1000;
const mid = c => (c && c.bid > 0 && c.ask > 0 ? (c.bid + c.ask) / 2 : NaN);
const spreadOk = c => { const m = mid(c); return m > 0 && (c.ask - c.bid) / m < 0.3; };

// Returns { F, q, n } where q is the continuous carry (dividend/borrow) implied by the forward.
export function impliedCarry(rows, S, T, r) {
  const DF = Math.exp(-r * T);
  const pairs = rows.filter(row => spreadOk(row.call) && spreadOk(row.put))
    .sort((a, b) => Math.abs(a.strike - S) - Math.abs(b.strike - S)).slice(0, 6);
  const Fs = pairs.map(row => row.strike + (mid(row.call) - mid(row.put)) / DF).filter(f => f > 0).sort((a, b) => a - b);
  if (!Fs.length || !(T > 0)) return { F: S * Math.exp(r * T), q: 0, n: 0 };
  const F = Fs[Math.floor(Fs.length / 2)];
  // Clamp to a sane band (large negative = hard-to-borrow; > 15% = bad quotes).
  const q = Math.max(-0.2, Math.min(0.15, r - Math.log(F / S) / T));
  return { F: S * Math.exp((r - q) * T), q, n: Fs.length };
}

function americanMatters(c, S, q) {
  if (c.type === 'put') return c.strike > S * 0.97;
  return q > 0.002 && c.strike < S * 1.03;
}

export function enrichExpiration(e, S, r, now = valuationTime()) {
  const T = Math.max((expiryMs(e.date) - now) / YEAR, 0.5 / 365);
  const { F, q, n } = impliedCarry(e.rows, S, T, r);
  for (const row of e.rows) {
    for (const c of [row.call, row.put]) {
      if (!c) continue;
      c.vendor = { iv: c.iv, delta: c.delta, gamma: c.gamma, theta: c.theta, vega: c.vega };
      const px = Number.isFinite(mid(c)) ? mid(c) : c.mark || c.last;
      const amer = americanMatters(c, S, q);
      let iv = amer ? impliedVolAmerican(c.type, px, S, c.strike, T, r, q) : impliedVol(c.type, px, S, c.strike, T, r, q);
      let src = 'model';
      if (!(iv > 0.005 && iv < 6)) { iv = c.vendor.iv; src = 'vendor'; } // e.g. deep ITM with no time value
      if (iv > 0) {
        const g = amer ? greeksNumeric(americanPrice, c.type, S, c.strike, T, iv, r, q) : greeks(c.type, S, c.strike, T, iv, r, q);
        Object.assign(c, { iv, delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega, rho: g.rho });
      }
      Object.assign(c, { r, q, model: amer ? 'american' : 'european', ivSource: src, spreadPct: px > 0 ? (c.ask - c.bid) / px : NaN });
    }
  }
  Object.assign(e, { forward: F, carry: q, rate: r, parityPairs: n });
  return e;
}
