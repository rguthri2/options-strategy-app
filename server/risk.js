// Portfolio risk: net Greeks, beta-weighted delta (SPY-equivalent shares) and a scenario grid that
// reprices every leg with Black-Scholes for SPY moves x IV shifts (each symbol moves beta x SPY).
import { netGreeks, pnlAt } from '../shared/strategy.js';
import { market } from './providers/index.js';
import { evaluatePositions } from './positions.js';
import { getSettings } from './settings.js';
import { config } from './config.js';

const MOVES = [-0.1, -0.05, -0.03, -0.01, 0, 0.01, 0.03, 0.05, 0.1];
const IV_SHIFTS = [-0.1, 0, 0.1];
const betaCache = new Map();

// OLS beta of daily log returns vs SPY over the last year (clamped to a sane range).
async function betaOf(symbol, spyBars) {
  if (symbol === 'SPY' || symbol === '$SPX') return 1;
  const hit = betaCache.get(symbol);
  if (hit && Date.now() - hit.t < 6 * 3600000) return hit.b;
  let b = 1;
  try {
    const bars = await market.daily(symbol);
    const spy = new Map(spyBars.map(x => [x.t, x.c]));
    const pairs = [];
    for (let i = Math.max(1, bars.length - 252); i < bars.length; i++) {
      const s0 = spy.get(bars[i - 1].t), s1 = spy.get(bars[i].t);
      if (s0 && s1) pairs.push([Math.log(bars[i].c / bars[i - 1].c), Math.log(s1 / s0)]);
    }
    if (pairs.length > 60) {
      const mx = pairs.reduce((s, p) => s + p[1], 0) / pairs.length, my = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
      let cov = 0, v = 0;
      for (const [y, x] of pairs) { cov += (x - mx) * (y - my); v += (x - mx) ** 2; }
      if (v > 0) b = Math.min(4, Math.max(-2, cov / v));
    }
  } catch { /* default beta 1 */ }
  betaCache.set(symbol, { b, t: Date.now() });
  return b;
}

export async function portfolioRisk() {
  const all = await evaluatePositions();
  const open = all.filter(p => p.status === 'open' && Number.isFinite(p.spot));
  const settings = getSettings();
  const spyBars = await market.daily('SPY').catch(() => []);
  const spy = spyBars.at(-1)?.c || NaN;
  const r = config.riskFreeRate;
  const now = Date.now();

  const rows = [];
  for (const p of open) {
    // Current IV per leg (from live quotes when available) drives Greeks and repricing.
    const legs = p.legs.map(l => ({ ...l, iv: l.iv || 0.3 }));
    const b = await betaOf(p.symbol, spyBars);
    const g = netGreeks(legs, p.spot, now, r);
    const base = pnlAt(legs, p.spot, now, r);
    const grid = IV_SHIFTS.map(dv => MOVES.map(m => pnlAt(legs, p.spot * (1 + b * m), now, r, dv) - base));
    const week = MOVES.map(m => pnlAt(legs, p.spot * (1 + b * m), now + 7 * 86400000, r) - base);
    rows.push({
      id: p.id, symbol: p.symbol, label: p.label, description: p.description, spot: p.spot, beta: +b.toFixed(2),
      delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega,
      dollarDelta: g.delta * p.spot, spyDelta: Number.isFinite(spy) ? (g.delta * p.spot * b) / spy : NaN,
      pnl: p.pnl, grid, week,
    });
  }
  const sum = k => rows.reduce((s, x) => s + (Number.isFinite(x[k]) ? x[k] : 0), 0);
  const addGrid = key => (key === 'week'
    ? MOVES.map((_, j) => rows.reduce((s, x) => s + x.week[j], 0))
    : IV_SHIFTS.map((_, i) => MOVES.map((__, j) => rows.reduce((s, x) => s + x.grid[i][j], 0))));
  const bySymbol = {};
  for (const x of rows) bySymbol[x.symbol] = (bySymbol[x.symbol] || 0) + Math.abs(x.dollarDelta);
  const acct = settings.account.size;
  return {
    spy, moves: MOVES, ivShifts: IV_SHIFTS, account: acct,
    totals: {
      delta: sum('delta'), dollarDelta: sum('dollarDelta'), spyDelta: sum('spyDelta'), gamma: sum('gamma'),
      theta: sum('theta'), vega: sum('vega'), pnl: sum('pnl'), positions: rows.length,
      spyDeltaPctOfAccount: Number.isFinite(spy) ? (sum('spyDelta') * spy) / acct : NaN,
      thetaPctOfAccountPerDay: sum('theta') / acct,
    },
    grid: addGrid('grid'), week: addGrid('week'),
    concentration: Object.entries(bySymbol).map(([symbol, v]) => ({ symbol, dollarDelta: v, pctOfAccount: v / acct })).sort((a, b) => b.dollarDelta - a.dollarDelta),
    positions: rows.map(({ grid, week, ...rest }) => ({ ...rest, down5: grid[1][MOVES.indexOf(-0.05)], up5: grid[1][MOVES.indexOf(0.05)] })),
  };
}
