// Option-chain analytics for a single expiration (rows: [{strike, call, put}]).
import { pickByDelta } from './strategy.js';

export function atmRow(rows, spot) {
  let best = null, bestD = Infinity;
  for (const r of rows) {
    const d = Math.abs(r.strike - spot);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

// ATM implied vol: average of call/put IV at the strike nearest spot.
export function atmIV(rows, spot) {
  const r = atmRow(rows, spot);
  if (!r) return NaN;
  const ivs = [r.call?.iv, r.put?.iv].filter(v => v > 0);
  return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : NaN;
}

// Expected move from the ATM straddle (market's priced 1-sigma move is ~ straddle * 1.25; we
// report the straddle itself, the common trader convention) plus the IV-derived 1 SD move.
export function expectedMove(rows, spot, T) {
  const r = atmRow(rows, spot);
  const straddle = r ? (r.call?.mark || 0) + (r.put?.mark || 0) : NaN;
  const iv = atmIV(rows, spot);
  return { straddle, sd1: spot * iv * Math.sqrt(T), iv };
}

// Strike at which option holders' total intrinsic value at expiry is smallest.
export function maxPain(rows) {
  let best = null, bestPain = Infinity;
  for (const cand of rows) {
    const S = cand.strike;
    let pain = 0;
    for (const r of rows) {
      if (r.call?.oi) pain += Math.max(0, S - r.strike) * r.call.oi;
      if (r.put?.oi) pain += Math.max(0, r.strike - S) * r.put.oi;
    }
    if (pain < bestPain) { bestPain = pain; best = S; }
  }
  return best;
}

export function totals(rows) {
  const t = { callOI: 0, putOI: 0, callVol: 0, putVol: 0 };
  for (const r of rows) {
    t.callOI += r.call?.oi || 0; t.putOI += r.put?.oi || 0;
    t.callVol += r.call?.volume || 0; t.putVol += r.put?.volume || 0;
  }
  t.pcrOI = t.callOI ? t.putOI / t.callOI : NaN;
  t.pcrVol = t.callVol ? t.putVol / t.callVol : NaN;
  return t;
}

// 25-delta risk reversal skew: put IV minus call IV (positive = downside fear priced in).
export function skew25(rows) {
  const p = pickByDelta(rows, 'put', 0.25), c = pickByDelta(rows, 'call', 0.25);
  return p && c ? p.iv - c.iv : NaN;
}

// Dealer gamma exposure by strike (assumes dealers long calls / short puts to customers' opposite;
// the standard simplified "GEX" convention: call OI positive, put OI negative).
export function gammaExposure(rows, spot) {
  return rows.map(r => ({
    strike: r.strike,
    gex: ((r.call?.gamma || 0) * (r.call?.oi || 0) - (r.put?.gamma || 0) * (r.put?.oi || 0)) * 100 * spot * spot * 0.01,
  }));
}

// Strikes with the largest open interest (support/resistance magnets).
export function oiWalls(rows, n = 3) {
  const calls = [...rows].filter(r => r.call).sort((a, b) => (b.call.oi || 0) - (a.call.oi || 0)).slice(0, n).map(r => r.strike);
  const puts = [...rows].filter(r => r.put).sort((a, b) => (b.put.oi || 0) - (a.put.oi || 0)).slice(0, n).map(r => r.strike);
  return { calls, puts };
}

// Unusual activity: volume well above open interest on liquid contracts.
export function unusualActivity(expirations, { minVolume = 500, ratio = 1.5 } = {}) {
  const out = [];
  for (const e of expirations) {
    for (const r of e.rows) {
      for (const side of ['call', 'put']) {
        const c = r[side];
        if (!c || c.volume < minVolume) continue;
        const vr = c.oi ? c.volume / c.oi : Infinity;
        if (vr >= ratio) out.push({ ...c, volOi: vr, premium: c.volume * (c.mark || c.last || 0) * 100 });
      }
    }
  }
  return out.sort((a, b) => b.premium - a.premium);
}
