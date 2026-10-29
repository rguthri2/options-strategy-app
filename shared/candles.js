// Candlestick pattern engine: 23 classic patterns, detected on every bar with context (prior trend,
// support/resistance location, volume), a concrete trade plan (entry trigger, stop, targets), the
// pattern's outcome on later bars, and its historical edge on the symbol being viewed.
// Pure functions over bars [{ t, o, h, l, c, v }] so the server, chart and tests share one implementation.
import { sma, ema, atr } from './indicators.js';

const r2 = x => Math.round(x * 100) / 100;

// ---------- the pattern library (definitions + how to trade them) ----------
// kind: reversal | continuation | indecision. bias: bull | bear | neutral (neutral = trade the breakout either way).
export const CANDLE_PATTERNS = {
  hammer: { name: 'Hammer', bars: 1, bias: 'bull', kind: 'reversal', base: 60,
    def: 'Small body near the top of the range with a lower shadow at least twice the body and little or no upper shadow, after a decline.',
    psych: 'Sellers pushed price well down during the session, but buyers absorbed it and closed near the high: selling pressure is being rejected.',
    entry: 'Buy when the next candle trades above the hammer\'s high.', stop: 'Below the hammer\'s low (the end of its shadow).',
    exit: 'Not an exit signal for longs. For shorts it is a warning to tighten the stop above the hammer\'s high.',
    best: 'At support or a rising moving average, on above-average volume, after at least several down candles.' },
  hanging_man: { name: 'Hanging Man', bars: 1, bias: 'bear', kind: 'reversal', base: 50,
    def: 'Same shape as a hammer (long lower shadow, small body near the high) but appearing after an advance.',
    psych: 'A sharp intraday sell-off inside an uptrend shows that supply is appearing, even though buyers recovered by the close.',
    entry: 'Short (or buy puts) only when a later candle closes below the hanging man\'s body; it needs confirmation more than most.', stop: 'Above the hanging man\'s high.',
    exit: 'If you are long: tighten the stop to below its low; exit if the next candle closes below its body.',
    best: 'At resistance after an extended run, especially with heavy volume.' },
  inverted_hammer: { name: 'Inverted Hammer', bars: 1, bias: 'bull', kind: 'reversal', base: 50,
    def: 'Small body near the low of the range with an upper shadow at least twice the body, after a decline.',
    psych: 'Buyers tested higher prices for the first time in the decline; sellers pushed back, but their control is weakening.',
    entry: 'Buy above the inverted hammer\'s high, ideally after a bullish confirmation candle.', stop: 'Below its low.',
    exit: 'For shorts: cover or tighten above its high.', best: 'At support after a sustained decline.' },
  shooting_star: { name: 'Shooting Star', bars: 1, bias: 'bear', kind: 'reversal', base: 60,
    def: 'Small body near the low of the range with an upper shadow at least twice the body, after an advance.',
    psych: 'Buyers drove price up but sellers rejected the high and closed it near the low: buying is being exhausted.',
    entry: 'Short (or buy puts / sell a bear call spread) when the next candle trades below the star\'s low.', stop: 'Above the shooting star\'s high.',
    exit: 'If you are long: take partial profits or move the stop to below the star\'s low.', best: 'At resistance or a prior high, on high volume.' },
  doji: { name: 'Doji', bars: 1, bias: 'neutral', kind: 'indecision', base: 40,
    def: 'Open and close are virtually equal (body under 10% of the range), with shadows on both sides.',
    psych: 'Neither buyers nor sellers won the session. After a strong trend it signals that momentum is stalling.',
    entry: 'Trade the break: buy above the doji\'s high or short below its low, whichever comes first.', stop: 'The opposite end of the doji.',
    exit: 'After a long run, a doji is a cue to tighten stops in the direction of the trend.', best: 'After an extended move or at a key level; mid-range dojis mean little.' },
  dragonfly_doji: { name: 'Dragonfly Doji', bars: 1, bias: 'bull', kind: 'reversal', base: 55,
    def: 'A doji whose open, high and close are at the top of the range, with a long lower shadow, after a decline.',
    psych: 'Sellers controlled most of the session but buyers took it all back by the close.',
    entry: 'Buy above its high.', stop: 'Below its low.', exit: 'For shorts: cover or tighten above its high.', best: 'At support after a decline.' },
  gravestone_doji: { name: 'Gravestone Doji', bars: 1, bias: 'bear', kind: 'reversal', base: 55,
    def: 'A doji whose open, low and close are at the bottom of the range, with a long upper shadow, after an advance.',
    psych: 'Buyers controlled most of the session but sellers erased every gain by the close.',
    entry: 'Short below its low.', stop: 'Above its high.', exit: 'If long: tighten the stop to below its low.', best: 'At resistance after an advance.' },
  spinning_top: { name: 'Spinning Top', bars: 1, bias: 'neutral', kind: 'indecision', base: 35,
    def: 'Small body (10–30% of the range) with upper and lower shadows each longer than the body.',
    psych: 'Both sides were active but neither won: the prevailing move is losing conviction.',
    entry: 'Trade the break of its high or low.', stop: 'The opposite end of the candle.', exit: 'In a trend, a cue to tighten stops.', best: 'After a strong run or at a key level.' },
  bullish_marubozu: { name: 'Bullish Marubozu', bars: 1, bias: 'bull', kind: 'continuation', base: 55,
    def: 'A long white (up) candle with little or no shadow: it opens at the low and closes at the high.',
    psych: 'Buyers were in control from the first trade to the last.',
    entry: 'Buy above its high, or on a pullback that holds its midpoint.', stop: 'Below the candle\'s midpoint (50% of the body).',
    exit: 'For shorts: an exit signal.', best: 'Breaking out of a base or above resistance on heavy volume.' },
  bearish_marubozu: { name: 'Bearish Marubozu', bars: 1, bias: 'bear', kind: 'continuation', base: 55,
    def: 'A long black (down) candle with little or no shadow: it opens at the high and closes at the low.',
    psych: 'Sellers were in control from the first trade to the last.',
    entry: 'Short below its low, or on a bounce that fails at its midpoint.', stop: 'Above the candle\'s midpoint.',
    exit: 'If long: exit or reduce, especially if it breaks support.', best: 'Breaking down from a range or below support on heavy volume.' },
  bullish_engulfing: { name: 'Bullish Engulfing', bars: 2, bias: 'bull', kind: 'reversal', base: 65,
    def: 'After a decline, a down candle followed by an up candle whose body completely covers (engulfs) the prior body.',
    psych: 'Buyers overwhelmed the prior session\'s selling in one day: a sharp shift in control.',
    entry: 'Buy above the engulfing candle\'s high.', stop: 'Below the low of the two-candle pattern.',
    exit: 'For shorts: cover.', best: 'At support, on higher volume than the prior candle; bigger engulfing bodies are stronger.' },
  bearish_engulfing: { name: 'Bearish Engulfing', bars: 2, bias: 'bear', kind: 'reversal', base: 65,
    def: 'After an advance, an up candle followed by a down candle whose body completely covers the prior body.',
    psych: 'Sellers overwhelmed the prior session\'s buying: a sharp shift in control.',
    entry: 'Short below the engulfing candle\'s low.', stop: 'Above the pattern\'s high.',
    exit: 'If long: one of the most reliable exit warnings, especially at resistance. Exit or tighten to its low.', best: 'At resistance, on higher volume.' },
  piercing_line: { name: 'Piercing Line', bars: 2, bias: 'bull', kind: 'reversal', base: 58,
    def: 'After a decline, a long down candle followed by an up candle that opens at or below the prior close and closes above the midpoint of the prior body (but not above its open).',
    psych: 'Buyers recovered more than half of the previous day\'s losses.',
    entry: 'Buy above the second candle\'s high.', stop: 'Below the pattern\'s low.', exit: 'For shorts: cover or tighten.', best: 'At support; the deeper the penetration, the stronger.' },
  dark_cloud_cover: { name: 'Dark Cloud Cover', bars: 2, bias: 'bear', kind: 'reversal', base: 58,
    def: 'After an advance, a long up candle followed by a down candle that opens at or above the prior close and closes below the midpoint of the prior body.',
    psych: 'Sellers erased more than half of the previous day\'s gains.',
    entry: 'Short below the second candle\'s low.', stop: 'Above the pattern\'s high.', exit: 'If long: tighten the stop or take partial profits.', best: 'At resistance.' },
  bullish_harami: { name: 'Bullish Harami', bars: 2, bias: 'bull', kind: 'reversal', base: 50,
    def: 'After a decline, a long down candle followed by a small candle whose body sits entirely inside the prior body ("harami" = pregnant).',
    psych: 'The selling stalled: the range contracted sharply inside the prior bearish session.',
    entry: 'Buy above the first (large) candle\'s high, or more aggressively above the small candle\'s high.', stop: 'Below the pattern\'s low.',
    exit: 'For shorts: a warning to tighten.', best: 'At support; a doji as the second candle (harami cross) is stronger.' },
  bearish_harami: { name: 'Bearish Harami', bars: 2, bias: 'bear', kind: 'reversal', base: 50,
    def: 'After an advance, a long up candle followed by a small candle whose body sits entirely inside the prior body.',
    psych: 'The buying stalled: momentum is fading.',
    entry: 'Short below the pattern\'s low.', stop: 'Above the pattern\'s high.', exit: 'If long: tighten the stop to the pattern low.', best: 'At resistance after an extended advance.' },
  tweezer_bottom: { name: 'Tweezer Bottom', bars: 2, bias: 'bull', kind: 'reversal', base: 52,
    def: 'After a decline, two candles with (nearly) identical lows, the first down and the second up.',
    psych: 'The same price was defended twice: a short-term floor.',
    entry: 'Buy above the second candle\'s high.', stop: 'Just below the shared low.', exit: 'For shorts: cover.', best: 'When the shared low is also a prior support level.' },
  tweezer_top: { name: 'Tweezer Top', bars: 2, bias: 'bear', kind: 'reversal', base: 52,
    def: 'After an advance, two candles with (nearly) identical highs, the first up and the second down.',
    psych: 'The same price was rejected twice: a short-term ceiling.',
    entry: 'Short below the second candle\'s low.', stop: 'Just above the shared high.', exit: 'If long: take profits or tighten.', best: 'When the shared high is also a prior resistance level.' },
  inside_bar: { name: 'Inside Bar', bars: 2, bias: 'neutral', kind: 'indecision', base: 45,
    def: 'A candle whose entire range (high and low) sits inside the previous candle\'s range.',
    psych: 'Volatility contracted: the market is pausing before its next move.',
    entry: 'Buy above the mother (first) candle\'s high or short below its low, whichever breaks first. In a trend, favour the trend\'s direction.', stop: 'The opposite end of the mother candle (or of the inside bar, for a tighter stop).',
    exit: 'A break against your position is an exit signal.', best: 'In a trend, near a moving average or after a pullback (classic trend-continuation entry).' },
  morning_star: { name: 'Morning Star', bars: 3, bias: 'bull', kind: 'reversal', base: 70,
    def: 'After a decline: a long down candle, then a small-bodied candle (the "star") at the low, then a long up candle closing above the midpoint of the first.',
    psych: 'Selling, then indecision, then decisive buying: a three-step change of control.',
    entry: 'Buy above the third candle\'s high.', stop: 'Below the star\'s low.', exit: 'For shorts: cover.', best: 'At support with rising volume on the third candle.' },
  evening_star: { name: 'Evening Star', bars: 3, bias: 'bear', kind: 'reversal', base: 70,
    def: 'After an advance: a long up candle, then a small-bodied star at the high, then a long down candle closing below the midpoint of the first.',
    psych: 'Buying, then indecision, then decisive selling.',
    entry: 'Short below the third candle\'s low.', stop: 'Above the star\'s high.', exit: 'If long: a strong exit signal.', best: 'At resistance with rising volume on the third candle.' },
  three_white_soldiers: { name: 'Three White Soldiers', bars: 3, bias: 'bull', kind: 'continuation', base: 62,
    def: 'Three consecutive long up candles, each opening within the prior body and closing at a new high near its own high.',
    psych: 'Steady, sustained buying on three straight sessions.',
    entry: 'Buy above the third candle\'s high, or on the first shallow pullback.', stop: 'Below the second candle\'s low.',
    exit: 'For shorts: exit.', best: 'Out of a base or after a decline; less useful when already extended.' },
  three_black_crows: { name: 'Three Black Crows', bars: 3, bias: 'bear', kind: 'continuation', base: 62,
    def: 'Three consecutive long down candles, each opening within the prior body and closing at a new low near its own low.',
    psych: 'Steady, sustained selling on three straight sessions.',
    entry: 'Short below the third candle\'s low, or on the first weak bounce.', stop: 'Above the second candle\'s high.',
    exit: 'If long: exit.', best: 'After an advance or out of a top.' },
};

// ---------- detection ----------
function context(bars) {
  const c = bars.map(b => b.c);
  return { s20: sma(c, 20), atr: atr(bars, 14), vavg: sma(bars.map(b => b.v || 0), 20) };
}

// Trend before the pattern starts (at index s): price vs its 20-bar average and vs 10 bars earlier.
function trendBefore(bars, ctx, s) {
  const k = s - 1;
  if (k < 11 || !Number.isFinite(ctx.s20[k])) return 'none';
  const down = bars[k].c < ctx.s20[k] && bars[k].c < bars[k - 10].c;
  const up = bars[k].c > ctx.s20[k] && bars[k].c > bars[k - 10].c;
  return up ? 'up' : down ? 'down' : 'none';
}

// All patterns ending at bar i.
export function patternsAt(bars, i, ctx = context(bars)) {
  if (i < 12) return [];
  const B = k => bars[k];
  const body = b => Math.abs(b.c - b.o), range = b => Math.max(b.h - b.l, 1e-9);
  const up = b => b.h - Math.max(b.o, b.c), dn = b => Math.min(b.o, b.c) - b.l;
  const bull = b => b.c > b.o, bear = b => b.c < b.o;
  const avgBody = bars.slice(Math.max(0, i - 10), i).reduce((s, b) => s + body(b), 0) / Math.min(10, i) || 1e-9;
  const long = b => body(b) >= avgBody * 1.1;
  const a = Number.isFinite(ctx.atr[i]) ? ctx.atr[i] : range(B(i));
  const z = B(i), y = B(i - 1), x = B(i - 2);
  const t1 = trendBefore(bars, ctx, i), t2 = trendBefore(bars, ctx, i - 1), t3 = trendBefore(bars, ctx, i - 2);
  const out = [];
  const add = (key, start) => out.push({ key, start, end: i });

  // Single candles
  const smallBody = body(z) / range(z);
  const hammerShape = dn(z) >= 2 * body(z) && up(z) <= range(z) * 0.25 && smallBody <= 0.35;
  const starShape = up(z) >= 2 * body(z) && dn(z) <= range(z) * 0.25 && smallBody <= 0.35;
  const isDoji = smallBody <= 0.1 && range(z) > a * 0.3;
  if (isDoji && up(z) <= range(z) * 0.1 && dn(z) >= range(z) * 0.6 && t1 === 'down') add('dragonfly_doji', i);
  else if (isDoji && dn(z) <= range(z) * 0.1 && up(z) >= range(z) * 0.6 && t1 === 'up') add('gravestone_doji', i);
  else if (isDoji) add('doji', i);
  else {
    if (hammerShape && t1 === 'down') add('hammer', i);
    if (hammerShape && t1 === 'up') add('hanging_man', i);
    if (starShape && t1 === 'down') add('inverted_hammer', i);
    if (starShape && t1 === 'up') add('shooting_star', i);
    if (!hammerShape && !starShape && smallBody > 0.1 && smallBody <= 0.3 && up(z) > body(z) && dn(z) > body(z)) add('spinning_top', i);
  }
  if (body(z) >= range(z) * 0.9 && body(z) >= avgBody * 1.3) add(bull(z) ? 'bullish_marubozu' : 'bearish_marubozu', i);

  // Two candles
  if (bear(y) && bull(z) && z.c >= y.o && z.o <= y.c && body(z) > body(y) && t2 === 'down') add('bullish_engulfing', i - 1);
  if (bull(y) && bear(z) && z.o >= y.c && z.c <= y.o && body(z) > body(y) && t2 === 'up') add('bearish_engulfing', i - 1);
  if (bear(y) && long(y) && bull(z) && z.o <= y.c && z.c > (y.o + y.c) / 2 && z.c < y.o && t2 === 'down') add('piercing_line', i - 1);
  if (bull(y) && long(y) && bear(z) && z.o >= y.c && z.c < (y.o + y.c) / 2 && z.c > y.o && t2 === 'up') add('dark_cloud_cover', i - 1);
  const insideBody = Math.max(z.o, z.c) <= Math.max(y.o, y.c) && Math.min(z.o, z.c) >= Math.min(y.o, y.c) && body(z) <= body(y) * 0.5;
  if (bear(y) && long(y) && insideBody && t2 === 'down') add('bullish_harami', i - 1);
  if (bull(y) && long(y) && insideBody && t2 === 'up') add('bearish_harami', i - 1);
  const tol = Math.max(a * 0.1, z.c * 0.0015);
  if (bear(y) && bull(z) && Math.abs(y.l - z.l) <= tol && t2 === 'down') add('tweezer_bottom', i - 1);
  if (bull(y) && bear(z) && Math.abs(y.h - z.h) <= tol && t2 === 'up') add('tweezer_top', i - 1);
  if (z.h < y.h && z.l > y.l) add('inside_bar', i - 1);

  // Three candles
  const star = body(y) <= body(x) * 0.35;
  if (bear(x) && long(x) && star && Math.max(y.o, y.c) <= x.c + a * 0.25 && bull(z) && z.c > (x.o + x.c) / 2 && t3 === 'down') add('morning_star', i - 2);
  if (bull(x) && long(x) && star && Math.min(y.o, y.c) >= x.c - a * 0.25 && bear(z) && z.c < (x.o + x.c) / 2 && t3 === 'up') add('evening_star', i - 2);
  const soldier = (p, q) => bull(q) && q.c > p.c && q.o >= Math.min(p.o, p.c) && q.o <= Math.max(p.o, p.c) && body(q) >= avgBody * 0.8 && up(q) <= body(q) * 0.35;
  if (bull(x) && body(x) >= avgBody * 0.8 && soldier(x, y) && soldier(y, z)) add('three_white_soldiers', i - 2);
  const crow = (p, q) => bear(q) && q.c < p.c && q.o >= Math.min(p.o, p.c) && q.o <= Math.max(p.o, p.c) && body(q) >= avgBody * 0.8 && dn(q) <= body(q) * 0.35;
  if (bear(x) && body(x) >= avgBody * 0.8 && crow(x, y) && crow(y, z)) add('three_black_crows', i - 2);
  return out;
}

// ---------- context, plan, outcome ----------
function enrich(bars, ctx, p) {
  const def = CANDLE_PATTERNS[p.key];
  const span = bars.slice(p.start, p.end + 1);
  const hi = Math.max(...span.map(b => b.h)), lo = Math.min(...span.map(b => b.l));
  const i = p.end, a = Number.isFinite(ctx.atr[i]) ? ctx.atr[i] : hi - lo;
  const prior = bars.slice(Math.max(0, p.start - 20), p.start);
  const atSupport = prior.length >= 5 && lo <= Math.min(...prior.map(b => b.l)) + a;
  const atResistance = prior.length >= 5 && hi >= Math.max(...prior.map(b => b.h)) - a;
  const vol = ctx.vavg[i] ? (bars[i].v || 0) / ctx.vavg[i] : NaN;
  const trend = trendBefore(bars, ctx, p.start);

  // Trade plan: break of the pattern's extreme, stop at the other side (0.1 ATR beyond), 2R and 3R targets.
  const pad = a * 0.1;
  const plan = (dir) => {
    let trigger = dir === 'long' ? hi + a * 0.02 : lo - a * 0.02;
    let stop = dir === 'long' ? lo - pad : hi + pad;
    const last = bars[i];
    if (p.key === 'bullish_marubozu' && dir === 'long') stop = (last.o + last.c) / 2;
    if (p.key === 'bearish_marubozu' && dir === 'short') stop = (last.o + last.c) / 2;
    if (p.key === 'three_white_soldiers') stop = bars[i - 1].l - pad;
    if (p.key === 'three_black_crows') stop = bars[i - 1].h + pad;
    const risk = Math.abs(trigger - stop);
    const sgn = dir === 'long' ? 1 : -1;
    return { dir, trigger: r2(trigger), stop: r2(stop), target1: r2(trigger + sgn * 2 * risk), target2: r2(trigger + sgn * 3 * risk), riskPct: +((risk / trigger) * 100).toFixed(2) };
  };
  const plans = def.bias === 'bull' ? [plan('long')] : def.bias === 'bear' ? [plan('short')] : [plan('long'), plan('short')];

  // Quality: the pattern's base reliability plus confirming context.
  const favLoc = (def.bias === 'bull' && atSupport) || (def.bias === 'bear' && atResistance);
  const score = Math.max(5, Math.min(95, def.base + (favLoc ? 12 : 0) + (vol >= 1.3 ? 8 : vol >= 1.1 ? 4 : 0)
    + (def.kind === 'reversal' && ((def.bias === 'bull' && atResistance) || (def.bias === 'bear' && atSupport)) ? -10 : 0)));
  return {
    ...p, name: def.name, bias: def.bias, kind: def.kind, t: bars[i].t, startT: bars[p.start].t, high: r2(hi), low: r2(lo),
    trend, atSupport, atResistance, volRatio: Number.isFinite(vol) ? +vol.toFixed(2) : null, score, plans,
  };
}

// What happened after the pattern: trigger within 3 bars, then stop (-1R), 2R target or 15-bar time exit.
// If a bar touches both stop and target, the stop is assumed first (conservative).
export function outcome(bars, p, { waitBars = 3, maxHold = 15 } = {}) {
  const n = bars.length;
  let plan = null, entryI = -1, entry = NaN;
  for (let k = p.end + 1; k <= Math.min(n - 1, p.end + waitBars) && !plan; k++) {
    const b = bars[k];
    for (const pl of p.plans) {
      const hit = pl.dir === 'long' ? b.h >= pl.trigger : b.l <= pl.trigger;
      const killed = pl.dir === 'long' ? b.l <= pl.stop : b.h >= pl.stop;
      if (hit) { plan = pl; entryI = k; entry = pl.dir === 'long' ? Math.max(pl.trigger, b.o) : Math.min(pl.trigger, b.o); break; }
      if (killed && p.plans.length === 1) return { status: 'failed', note: 'Hit the stop level before triggering' };
    }
  }
  if (!plan) return p.end + waitBars >= n - 1 ? { status: 'waiting', note: `Waiting for a break ${p.plans.map(pl => `${pl.dir === 'long' ? 'above' : 'below'} ${pl.trigger}`).join(' or ')}` } : { status: 'expired', note: `No trigger within ${waitBars} bars` };
  const long = plan.dir === 'long', risk = Math.abs(entry - plan.stop) || 1e-9;
  const target = entry + (long ? 2 : -2) * risk;
  for (let k = entryI; k < Math.min(n, entryI + maxHold); k++) {
    const b = bars[k];
    const stopHit = long ? b.l <= plan.stop : b.h >= plan.stop;
    const tgtHit = long ? b.h >= target : b.l <= target;
    if (stopHit) return { status: 'stopped', dir: plan.dir, entry: r2(entry), r: -1, bars: k - entryI + 1 };
    if (tgtHit && k > entryI) return { status: 'target', dir: plan.dir, entry: r2(entry), r: 2, bars: k - entryI + 1 };
  }
  const lastK = Math.min(n, entryI + maxHold) - 1, close = bars[lastK].c;
  const r = +(((close - entry) / risk) * (long ? 1 : -1)).toFixed(2);
  return lastK === n - 1 && lastK - entryI + 1 < maxHold
    ? { status: 'open', dir: plan.dir, entry: r2(entry), r, bars: lastK - entryI + 1 }
    : { status: 'time exit', dir: plan.dir, entry: r2(entry), r, bars: maxHold };
}

// Every pattern on every bar (with plan + outcome), oldest first.
export function scanCandles(bars) {
  if (!bars || bars.length < 30) return [];
  const ctx = context(bars), out = [];
  for (let i = 12; i < bars.length; i++) for (const p of patternsAt(bars, i, ctx)) { const e = enrich(bars, ctx, p); out.push({ ...e, outcome: outcome(bars, e) }); }
  return out;
}

// Historical edge per pattern on these bars: how often it triggered, win rate and average R of the plan above.
export function candleEdge(all) {
  const by = {};
  for (const p of all) {
    const s = (by[p.key] ||= { key: p.key, name: p.name, bias: p.bias, count: 0, triggered: 0, wins: 0, sumR: 0, closed: 0 });
    s.count++;
    const o = p.outcome;
    if (o.r !== undefined) { s.triggered++; if (o.status !== 'open') { s.closed++; s.sumR += o.r; if (o.r > 0) s.wins++; } }
  }
  return Object.values(by).map(s => ({ ...s, triggerRate: s.count ? s.triggered / s.count : null, winRate: s.closed ? s.wins / s.closed : null, avgR: s.closed ? +(s.sumR / s.closed).toFixed(2) : null }))
    .sort((a, b) => b.count - a.count);
}

// Plain-language technical read from the last few candles + trend + location.
export function candleRead(bars, all = scanCandles(bars), lookback = 5) {
  const n = bars.length;
  if (n < 30) return { bias: 'neutral', score: 0, summary: 'Not enough bars for a candle read.', recent: [] };
  const recent = all.filter(p => p.end >= n - lookback);
  let score = 0;
  for (const p of recent) {
    const w = (p.score / 100) * (1 - (n - 1 - p.end) * 0.15) * (p.kind === 'indecision' ? 0.3 : 1);
    const o = p.outcome;
    const dir = p.bias === 'bull' ? 1 : p.bias === 'bear' ? -1 : o.dir === 'long' ? 1 : o.dir === 'short' ? -1 : 0;
    const confirmed = o.status === 'target' || o.status === 'open' || (o.r !== undefined && o.r > 0) ? 1.3 : o.status === 'stopped' || o.status === 'failed' ? -0.6 : 1;
    score += dir * w * confirmed;
  }
  const ctx = context(bars), trend = trendBefore(bars, ctx, n);
  const bias = score > 0.35 ? 'bullish' : score < -0.35 ? 'bearish' : 'neutral';
  const parts = [];
  parts.push(trend === 'up' ? 'Price is in a short-term uptrend (above its 20-bar average and higher than 10 bars ago).'
    : trend === 'down' ? 'Price is in a short-term downtrend (below its 20-bar average and lower than 10 bars ago).'
      : 'There is no clear short-term trend.');
  if (!recent.length) parts.push(`No candlestick patterns in the last ${lookback} bars; the candles are not giving a signal right now.`);
  for (const p of recent.slice(-4).reverse()) {
    const where = p.atSupport ? ' at support' : p.atResistance ? ' at resistance' : '';
    const vol = p.volRatio >= 1.3 ? ' on heavy volume' : '';
    parts.push(`${p.name}${where}${vol} ${n - 1 - p.end === 0 ? 'on the last bar' : `${n - 1 - p.end} bar${n - 1 - p.end > 1 ? 's' : ''} ago`}: ${STATUS_TEXT[p.outcome.status] || p.outcome.status}.`);
  }
  parts.push(bias === 'bullish' ? 'Net read: bullish. Favour long entries on a break of the latest pattern high, with the stop under the pattern.'
    : bias === 'bearish' ? 'Net read: bearish. Longs should tighten stops; short or put entries trigger below the latest pattern low.'
      : 'Net read: neutral. Wait for a decisive candle or a break of the recent range.');
  return { bias, score: +score.toFixed(2), trend, summary: parts.join(' '), recent };
}

export const STATUS_TEXT = {
  waiting: 'waiting for the entry trigger', expired: 'never triggered (expired)', failed: 'failed (hit the stop level first)',
  stopped: 'triggered and stopped out (−1R)', target: 'triggered and reached the 2R target', open: 'triggered, trade still open', 'time exit': 'triggered, closed after 15 bars',
};

// Trend state for the multi-timeframe table.
export function trendState(bars) {
  const c = bars.map(b => b.c), n = c.length;
  if (n < 55) return { state: 'n/a' };
  const e21 = ema(c, 21), s50 = sma(c, 50);
  const last = c[n - 1], slope = e21[n - 1] - e21[n - 6];
  const state = last > e21[n - 1] && e21[n - 1] > s50[n - 1] && slope > 0 ? 'up'
    : last < e21[n - 1] && e21[n - 1] < s50[n - 1] && slope < 0 ? 'down' : 'mixed';
  return { state, last, ma21: e21[n - 1], ma50: s50[n - 1], slope };
}
