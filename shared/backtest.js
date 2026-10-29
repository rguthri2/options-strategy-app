// Daily-bar strategy backtester (stock/underlying level; results are in R multiples so they map
// onto any position size or option structure you use to express the trade).
// Conventions (conservative): signal on the close, enter next open; if stop and target are both
// inside one bar the stop is assumed hit first; gaps through the stop fill at the open.
import { sma, ema, rsi, atr, bollinger, keltner } from './indicators.js';

export const STRATEGIES = {
  ema21_pullback: { label: '21 EMA pullback (trend)', side: 'long', desc: 'Uptrend (close > 50 > 200 SMA); low tags the 21 EMA and closes back above it with RSI 40-65.', defaults: { stopAtr: 2, targetR: 2, maxBars: 20 } },
  breakout20: { label: '20-day breakout on volume', side: 'long', desc: 'Close above the prior 20-day high on ≥1.5× average volume, above the 50 SMA.', defaults: { stopAtr: 2, targetR: 3, maxBars: 25 } },
  squeeze_fire: { label: 'TTM squeeze fire (long)', side: 'long', desc: 'Bollinger Bands exit the Keltner Channels after ≥5 squeeze days with price above the 21 EMA.', defaults: { stopAtr: 2, targetR: 2, maxBars: 20 } },
  rsi2_reversion: { label: 'RSI(2) mean reversion', side: 'long', desc: 'Connors-style: above the 200 SMA and RSI(2) < 10; exit on a close above the 5 SMA.', defaults: { stopAtr: 3, targetR: 0, maxBars: 10 } },
  golden_cross: { label: '50/200 golden cross', side: 'long', desc: 'Enter when the 50 SMA crosses above the 200 SMA; exit on the death cross.', defaults: { stopAtr: 4, targetR: 0, maxBars: 400 } },
  breakdown20: { label: '20-day breakdown (short)', side: 'short', desc: 'Close below the prior 20-day low on ≥1.5× volume in a downtrend (50 < 200 SMA).', defaults: { stopAtr: 2, targetR: 2, maxBars: 20 } },
};

function prep(bars) {
  const c = bars.map(b => b.c), v = bars.map(b => b.v || 0);
  const bb = bollinger(c, 20, 2), kc = keltner(bars, 20, 1.5);
  return {
    c, s5: sma(c, 5), s20: sma(c, 20), s50: sma(c, 50), s200: sma(c, 200), e21: ema(c, 21),
    r14: rsi(c, 14), r2: rsi(c, 2), a: atr(bars, 14), v50: sma(v, 50), v,
    sq: c.map((_, i) => bb.upper[i] < kc.upper[i] && bb.lower[i] > kc.lower[i]),
  };
}

const hi20 = (bars, i) => Math.max(...bars.slice(i - 20, i).map(b => b.h));
const lo20 = (bars, i) => Math.min(...bars.slice(i - 20, i).map(b => b.l));

// Entry signal at the close of bar i.
function signal(key, bars, x, i) {
  const b = bars[i];
  switch (key) {
    case 'ema21_pullback':
      return b.c > x.s50[i] && x.s50[i] > x.s200[i] && b.l <= x.e21[i] * 1.003 && b.c > x.e21[i] && x.r14[i] >= 40 && x.r14[i] <= 65;
    case 'breakout20':
      return b.c > hi20(bars, i) && x.v[i] > 1.5 * x.v50[i - 1] && b.c > x.s50[i];
    case 'squeeze_fire': {
      let run = 0;
      for (let j = i - 1; j >= 0 && x.sq[j]; j--) run++;
      return !x.sq[i] && run >= 5 && b.c > x.e21[i] && b.c > x.s20[i];
    }
    case 'rsi2_reversion':
      return b.c > x.s200[i] && x.r2[i] < 10;
    case 'golden_cross':
      return x.s50[i - 1] <= x.s200[i - 1] && x.s50[i] > x.s200[i];
    case 'breakdown20':
      return b.c < lo20(bars, i) && x.v[i] > 1.5 * x.v50[i - 1] && x.s50[i] < x.s200[i];
    default: return false;
  }
}

// Strategy-specific discretionary exit evaluated on the close.
function exitRule(key, bars, x, i) {
  if (key === 'rsi2_reversion') return bars[i].c > x.s5[i];
  if (key === 'golden_cross') return x.s50[i] < x.s200[i];
  if (key === 'ema21_pullback') return bars[i].c < x.s50[i];
  return false;
}

export function runBacktest(bars, key, params = {}) {
  const spec = STRATEGIES[key];
  if (!spec) throw new Error(`Unknown strategy ${key}`);
  const p = { ...spec.defaults, ...params };
  const short = spec.side === 'short';
  const x = prep(bars);
  const trades = [];
  let pos = null;
  const warm = 201;
  for (let i = warm; i < bars.length; i++) {
    const b = bars[i];
    if (pos) {
      pos.bars++;
      let exit = null, reason = '';
      const hitStop = short ? b.h >= pos.stop : b.l <= pos.stop;
      const hitTarget = pos.target != null && (short ? b.l <= pos.target : b.h >= pos.target);
      if (hitStop) {
        const gap = short ? b.o > pos.stop : b.o < pos.stop;
        exit = gap ? b.o : pos.stop; reason = gap ? 'stop (gap)' : 'stop';
      } else if (hitTarget) {
        const gap = short ? b.o < pos.target : b.o > pos.target;
        exit = gap ? b.o : pos.target; reason = 'target';
      } else if (exitRule(key, bars, x, i)) { exit = b.c; reason = 'exit rule'; }
      else if (pos.bars >= p.maxBars) { exit = b.c; reason = 'time stop'; }
      if (exit != null) {
        const risk = Math.abs(pos.entry - pos.stop0);
        const r = ((short ? pos.entry - exit : exit - pos.entry) / risk);
        trades.push({ entryT: pos.t, entry: +pos.entry.toFixed(2), exitT: b.t, exit: +exit.toFixed(2), r: +r.toFixed(2), bars: pos.bars, reason, stop: +pos.stop0.toFixed(2), target: pos.target != null ? +pos.target.toFixed(2) : null });
        pos = null;
      }
      continue;
    }
    if (i < bars.length - 1 && Number.isFinite(x.a[i]) && signal(key, bars, x, i)) {
      const entry = bars[i + 1].o;
      const risk = p.stopAtr * x.a[i];
      if (!(risk > 0)) continue;
      const stop = short ? entry + risk : entry - risk;
      const target = p.targetR > 0 ? (short ? entry - p.targetR * risk : entry + p.targetR * risk) : null;
      // The next iteration is the entry bar itself, so a stop hit on the entry day is counted.
      pos = { t: bars[i + 1].t, entry, stop, stop0: stop, target, bars: 0 };
    }
  }
  return { key, label: spec.label, side: spec.side, params: p, trades, open: pos ? { entryT: pos.t, entry: +pos.entry.toFixed(2), stop: +pos.stop.toFixed(2), target: pos.target != null ? +pos.target.toFixed(2) : null } : null, stats: stats(trades, bars) };
}

export function stats(trades, bars) {
  const n = trades.length;
  const wins = trades.filter(t => t.r > 0), losses = trades.filter(t => t.r <= 0);
  const sumW = wins.reduce((s, t) => s + t.r, 0), sumL = losses.reduce((s, t) => s + t.r, 0);
  let eq = 0, peak = 0, maxDD = 0;
  const equity = trades.map(t => { eq += t.r; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak); return { t: t.exitT, r: +eq.toFixed(2) }; });
  const first = bars[Math.min(201, bars.length - 1)], last = bars[bars.length - 1];
  return {
    trades: n, wins: wins.length, winRate: n ? wins.length / n : 0,
    avgR: n ? (sumW + sumL) / n : 0, avgWinR: wins.length ? sumW / wins.length : 0, avgLossR: losses.length ? sumL / losses.length : 0,
    profitFactor: sumL < 0 ? sumW / -sumL : wins.length ? Infinity : 0, totalR: sumW + sumL, maxDrawdownR: maxDD,
    avgBars: n ? trades.reduce((s, t) => s + t.bars, 0) / n : 0,
    best: n ? Math.max(...trades.map(t => t.r)) : 0, worst: n ? Math.min(...trades.map(t => t.r)) : 0,
    buyHoldPct: first && last ? last.c / first.c - 1 : 0, fromT: first?.t, toT: last?.t, equity,
  };
}
