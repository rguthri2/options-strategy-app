// Options Lab: backtests option *structures* (credit/debit spreads, condors, CSPs, long options)
// with tastytrade-style management on daily bars. Historical option quotes are not available from
// free feeds, so prices are MODELED: Black-Scholes on an IV proxy = blended realized vol x premium,
// with a volatility skew, bid/ask slippage per leg and per-contract commissions.
import { price as bsPrice, greeks as bsGreeks } from './bs.js';
import { histVol, sma, percentRank } from './indicators.js';

export const OPTION_STRATEGIES = {
  short_put: { label: 'Cash-secured put', kind: 'credit', defaults: { dte: 45, delta: 0.3, takeProfit: 50, stopLoss: 200, exitDte: 21 } },
  put_credit_spread: { label: 'Bull put credit spread', kind: 'credit', defaults: { dte: 45, delta: 0.3, widthPct: 5, takeProfit: 50, stopLoss: 200, exitDte: 21 } },
  call_credit_spread: { label: 'Bear call credit spread', kind: 'credit', defaults: { dte: 45, delta: 0.3, widthPct: 5, takeProfit: 50, stopLoss: 200, exitDte: 21 } },
  iron_condor: { label: 'Iron condor', kind: 'credit', defaults: { dte: 45, delta: 0.16, widthPct: 5, takeProfit: 50, stopLoss: 200, exitDte: 21 } },
  long_call: { label: 'Long call (stock replacement)', kind: 'debit', defaults: { dte: 90, delta: 0.7, takeProfit: 100, stopLoss: 50, exitDte: 30 } },
  long_put: { label: 'Long put', kind: 'debit', defaults: { dte: 90, delta: 0.7, takeProfit: 100, stopLoss: 50, exitDte: 30 } },
  bull_call_spread: { label: 'Bull call debit spread', kind: 'debit', defaults: { dte: 45, delta: 0.3, widthPct: 5, takeProfit: 75, stopLoss: 50, exitDte: 14 } },
};

export const FILTERS = {
  always: 'Every opportunity', above50: 'Price above 50 SMA', below50: 'Price below 50 SMA',
  ivHigh: 'Vol rank ≥ 50 (sell rich premium)', ivLow: 'Vol rank ≤ 30 (buy cheap premium)',
};

const DAY_MS = 86400000;
const iso = t => new Date(t * 1000).toISOString().slice(0, 10);
const thirdFriday = (y, m) => { const d = new Date(Date.UTC(y, m, 1)); return new Date(Date.UTC(y, m, 1 + ((5 - d.getUTCDay() + 7) % 7) + 14)); };
const step = S => (S < 25 ? 0.5 : S < 100 ? 1 : S < 250 ? 2.5 : S < 600 ? 5 : 10);

// Monthly expiration closest to `dte` days after `date` (ms), expiring 16:00 ET ~ 20:00 UTC.
function pickExpiry(dateMs, dte) {
  const d = new Date(dateMs);
  let best = null;
  for (let k = 0; k < 16; k++) {
    const e = thirdFriday(d.getUTCFullYear() + Math.floor((d.getUTCMonth() + k) / 12), (d.getUTCMonth() + k) % 12);
    const days = (e.getTime() - dateMs) / DAY_MS;
    if (days < 7) continue;
    if (!best || Math.abs(days - dte) < Math.abs(best.days - dte)) best = { ms: e.getTime() + 20 * 3600000, days };
  }
  return best;
}

function surface(base, S, K, T) {
  const m = Math.log(K / S) / Math.max(base * Math.sqrt(Math.max(T, 1 / 365)), 0.02);
  return Math.max(base * 0.45, base * (1 - 0.075 * m + 0.022 * m * m));
}

function optPrice(type, S, K, T, base, r) { return T <= 0 ? Math.max(0, type === 'call' ? S - K : K - S) : bsPrice(type, S, K, T, surface(base, S, K, T), r); }

function strikeByDelta(type, S, T, base, r, target) {
  const st = step(S);
  let best = null;
  for (let K = Math.round((S * 0.4) / st) * st; K <= S * 1.8; K += st) {
    const d = Math.abs(bsGreeks(type, S, K, T, surface(base, S, K, T), r).delta);
    if (!best || Math.abs(d - target) < Math.abs(best.d - target)) best = { K: +K.toFixed(2), d };
  }
  return best.K;
}

function buildLegs(key, p, S, T, base, r) {
  const st = step(S), width = Math.max(st, Math.round((S * (p.widthPct ?? 5)) / 100 / st) * st);
  const put = strikeByDelta.bind(null, 'put', S, T, base, r), call = strikeByDelta.bind(null, 'call', S, T, base, r);
  switch (key) {
    case 'short_put': return [{ type: 'put', qty: -1, K: put(p.delta) }];
    case 'put_credit_spread': { const k = put(p.delta); return [{ type: 'put', qty: -1, K: k }, { type: 'put', qty: 1, K: k - width }]; }
    case 'call_credit_spread': { const k = call(p.delta); return [{ type: 'call', qty: -1, K: k }, { type: 'call', qty: 1, K: k + width }]; }
    case 'iron_condor': { const kp = put(p.delta), kc = call(p.delta); return [{ type: 'put', qty: 1, K: kp - width }, { type: 'put', qty: -1, K: kp }, { type: 'call', qty: -1, K: kc }, { type: 'call', qty: 1, K: kc + width }]; }
    case 'long_call': return [{ type: 'call', qty: 1, K: call(p.delta) }];
    case 'long_put': return [{ type: 'put', qty: 1, K: put(p.delta) }];
    case 'bull_call_spread': { const ks = call(p.delta); const kl = call(0.6); return [{ type: 'call', qty: 1, K: Math.min(kl, ks - st) }, { type: 'call', qty: -1, K: ks }]; }
    default: throw new Error(`Unknown option strategy ${key}`);
  }
}

// Worst-case loss per share at expiry across the payoff (defined risk) or the strike (short put).
function riskProfile(legs, cost) {
  const Ks = legs.map(l => l.K);
  const probe = [0.0001, ...Ks, Math.max(...Ks) * 3];
  const pay = S => legs.reduce((s, l) => s + l.qty * Math.max(0, l.type === 'call' ? S - l.K : l.K - S), 0) - cost;
  const vals = probe.map(pay);
  return { maxProfit: Math.max(...vals), maxLoss: -Math.min(...vals) };
}

export function runOptionBacktest(bars, key, params = {}) {
  const spec = OPTION_STRATEGIES[key];
  if (!spec) throw new Error(`Unknown option strategy ${key}`);
  const p = { widthPct: 5, filter: 'always', ivPremium: 1.1, slippagePct: 3, commission: 0.65, r: 0.04, cooldown: 1, ...spec.defaults, ...params };
  const c = bars.map(b => b.c);
  const hv20 = histVol(c, 20), hv60 = histVol(c, 60), s50 = sma(c, 50);
  const trades = [];
  let pos = null, lastExit = -Infinity;
  const slip = px => Math.max(0.01, (px * p.slippagePct) / 100);
  // IV base per day: real implied vol when supplied (e.g. VIX for SPY), else realized vol x premium.
  const ivSeries = Array.isArray(params.ivSeries) && params.ivSeries.length === bars.length ? params.ivSeries : null;
  const baseIv = i => (ivSeries && ivSeries[i] > 0.03 ? ivSeries[i] : Math.max(0.08, (0.5 * hv20[i] + 0.5 * hv60[i]) * p.ivPremium));

  for (let i = 61; i < bars.length; i++) {
    const S = c[i], ms = bars[i].t * 1000, base = baseIv(i);
    if (!Number.isFinite(base)) continue;
    if (pos) {
      const T = (pos.expMs - ms) / (365 * DAY_MS);
      const expired = T <= 0.5 / 365;
      // Closing prices: buy back shorts at model + slippage, sell longs at model - slippage; settle at intrinsic on expiry.
      const exitPx = pos.legs.map(l => { const m = optPrice(l.type, S, l.K, expired ? 0 : T, base, p.r); return expired ? m : l.qty < 0 ? m + slip(m) : Math.max(0, m - slip(m)); });
      const value = pos.legs.reduce((s, l, k) => s + l.qty * exitPx[k], 0);
      const pnl = value - pos.cost; // per share
      const ref = spec.kind === 'credit' ? -pos.cost : pos.cost; // credit received / debit paid
      // Profit target base: the credit (credit trades), the max profit (debit spreads), or the debit (long options).
      const tpBase = spec.kind === 'credit' ? Math.min(ref, pos.maxProfit) : pos.legs.length > 1 ? pos.maxProfit : ref;
      const dte = Math.round(T * 365);
      let reason = null;
      if (pnl >= (p.takeProfit / 100) * tpBase) reason = 'take profit';
      else if (pnl <= -(p.stopLoss / 100) * ref) reason = 'stop loss';
      else if (expired) reason = 'expiration';
      else if (p.exitDte > 0 && dte <= p.exitDte) reason = `${p.exitDte} DTE exit`;
      if (reason) {
        const legsN = pos.legs.length;
        const commissions = p.commission * legsN * (expired ? 1 : 2);
        const dollars = pnl * 100 - commissions;
        trades.push({
          entryT: pos.t, exitT: bars[i].t, days: Math.round((ms - pos.t * 1000) / DAY_MS), reason,
          legs: pos.legs.map(l => `${l.qty > 0 ? '+' : '−'}${l.K}${l.type === 'call' ? 'C' : 'P'}`).join(' '),
          expiry: iso(pos.expMs / 1000), entrySpot: +pos.spot.toFixed(2), exitSpot: +S.toFixed(2),
          entry: +(-pos.cost).toFixed(2), exit: +(-value).toFixed(2), pnl: +dollars.toFixed(2),
          maxLoss: +(pos.maxLoss * 100).toFixed(2), returnOnRisk: pos.maxLoss > 0 ? dollars / (pos.maxLoss * 100) : 0,
        });
        pos = null; lastExit = i;
      }
      continue;
    }
    if (i - lastExit < p.cooldown || i >= bars.length - 5) continue;
    const vr = percentRank(hv20.slice(Math.max(0, i - 252), i + 1), hv20[i]);
    const ok = { always: true, above50: S > s50[i], below50: S < s50[i], ivHigh: vr >= 50, ivLow: vr <= 30 }[p.filter] ?? true;
    if (!ok) continue;
    const exp = pickExpiry(ms, p.dte);
    if (!exp) continue;
    const T = (exp.ms - ms) / (365 * DAY_MS);
    let legs;
    try { legs = buildLegs(key, p, S, T, base, p.r); } catch { continue; }
    if (new Set(legs.map(l => `${l.type}${l.K}`)).size !== legs.length) continue; // degenerate strikes
    // Opening prices: sell at model - slippage, buy at model + slippage.
    const px = legs.map(l => { const m = optPrice(l.type, S, l.K, T, base, p.r); return l.qty < 0 ? Math.max(0, m - slip(m)) : m + slip(m); });
    const cost = legs.reduce((s, l, k) => s + l.qty * px[k], 0);
    if (spec.kind === 'credit' ? -cost < 0.05 : cost < 0.05) continue; // not worth trading
    const rp = riskProfile(legs, cost);
    pos = { t: bars[i].t, spot: S, expMs: exp.ms, legs, cost, maxLoss: rp.maxLoss, maxProfit: rp.maxProfit };
  }
  const { ivSeries: _omit, ...shownParams } = p;
  return { key, label: spec.label, kind: spec.kind, params: shownParams, ivSource: ivSeries ? 'implied (index volatility history)' : `realized vol × ${p.ivPremium}`, trades, open: pos ? { entryT: pos.t, legs: pos.legs, credit: -pos.cost } : null, stats: optionStats(trades, bars) };
}

export function optionStats(trades, bars) {
  const n = trades.length;
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = losses.reduce((s, t) => s + t.pnl, 0);
  let eq = 0, peak = 0, dd = 0;
  const equity = trades.map(t => { eq += t.pnl; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); return { t: t.exitT, v: +eq.toFixed(2) }; });
  const years = bars.length > 61 ? (bars[bars.length - 1].t - bars[61].t) / (365 * 86400) : 0;
  const avgRisk = n ? trades.reduce((s, t) => s + t.maxLoss, 0) / n : 0;
  return {
    trades: n, winRate: n ? wins.length / n : 0, totalPnl: gw + gl, avgPnl: n ? (gw + gl) / n : 0,
    avgWin: wins.length ? gw / wins.length : 0, avgLoss: losses.length ? gl / losses.length : 0,
    profitFactor: gl < 0 ? gw / -gl : wins.length ? Infinity : 0, maxDrawdown: dd, avgDays: n ? trades.reduce((s, t) => s + t.days, 0) / n : 0,
    avgReturnOnRisk: n ? trades.reduce((s, t) => s + t.returnOnRisk, 0) / n : 0, avgRisk,
    annualReturnOnRisk: years > 0 && avgRisk > 0 ? (gw + gl) / avgRisk / years : 0, years,
    reasons: trades.reduce((m, t) => ({ ...m, [t.reason]: (m[t.reason] || 0) + 1 }), {}), equity,
  };
}
