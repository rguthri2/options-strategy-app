// Plain-language technical analysis verdict for one symbol, plus gap/reversal helpers for the screener.
import { sma, ema, rsi, adx, macd, atr, bollinger } from './indicators.js';
import { autoStudies } from './studies.js';
import { detectPatterns } from './patterns.js';

const last = a => a[a.length - 1];
const r2 = v => Math.round(v * 100) / 100;

// Each signal votes -1..+1 with a weight; the verdict is the weighted sum.
export function taVerdict(bars) {
  if (!bars || bars.length < 60) return null;
  const c = bars.map(b => b.c), n = c.length - 1, price = c[n];
  const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), e21 = ema(c, 21);
  const r = rsi(c, 14), m = macd(c), ax = adx(bars, 14), a = atr(bars, 14), bb = bollinger(c, 20, 2);
  const signals = [];
  const add = (name, vote, weight, text) => signals.push({ name, vote, weight, text });

  const t50 = s50[n] > s50[n - 10], t200 = Number.isFinite(s200[n]);
  add('Trend', price > s50[n] && t50 ? 1 : price < s50[n] && !t50 ? -1 : 0, 3,
    price > s50[n] ? `Price is above the 50-day average (${r2(s50[n])})${t50 ? ' and it is rising' : ' but it is flattening'}.`
      : `Price is below the 50-day average (${r2(s50[n])})${t50 ? ' though it is still rising' : ' and it is falling'}.`);
  if (t200) add('Long-term', price > s200[n] ? 1 : -1, 2, `Price is ${price > s200[n] ? 'above' : 'below'} the 200-day average (${r2(s200[n])}).`);
  add('Short-term', price > e21[n] ? 1 : -1, 1, `Price is ${price > e21[n] ? 'above' : 'below'} the 21-day EMA (${r2(e21[n])}).`);

  const rv = r[n];
  add('RSI', rv > 70 ? -0.5 : rv < 30 ? 0.5 : rv > 55 ? 0.5 : rv < 45 ? -0.5 : 0, 1.5,
    `RSI is ${rv.toFixed(0)}: ${rv > 70 ? 'overbought, a pullback is more likely' : rv < 30 ? 'oversold, a bounce is more likely' : rv > 55 ? 'positive momentum' : rv < 45 ? 'weak momentum' : 'neutral'}.`);

  const h = m.hist[n], hp = m.hist[n - 1];
  add('MACD', h > 0 ? (h > hp ? 1 : 0.4) : (h < hp ? -1 : -0.4), 2,
    `MACD histogram is ${h > 0 ? 'positive' : 'negative'} and ${h > hp ? 'rising' : 'falling'}${m.macd[n] > m.signal[n] && m.macd[n - 1] <= m.signal[n - 1] ? ' (fresh bullish cross)' : m.macd[n] < m.signal[n] && m.macd[n - 1] >= m.signal[n - 1] ? ' (fresh bearish cross)' : ''}.`);

  const adxV = ax.adx[n], dir = ax.pdi[n] > ax.mdi[n] ? 1 : -1;
  add('ADX', adxV > 25 ? dir : 0, 2,
    adxV > 25 ? `ADX ${adxV.toFixed(0)}: a strong ${dir > 0 ? 'up' : 'down'}trend is in force.` : `ADX ${adxV.toFixed(0)}: no strong trend, expect range-bound action.`);

  const pb = (price - bb.lower[n]) / ((bb.upper[n] - bb.lower[n]) || 1);
  add('Bollinger', pb > 1 ? -0.3 : pb < 0 ? 0.3 : 0, 0.5, `Price sits ${pb > 1 ? 'above the upper band (stretched)' : pb < 0 ? 'below the lower band (stretched)' : `${Math.round(pb * 100)}% of the way up the 20-day band`}.`);

  const score = signals.reduce((s, x) => s + x.vote * x.weight, 0) / signals.reduce((s, x) => s + x.weight, 0);
  const bias = score > 0.25 ? 'bull' : score < -0.25 ? 'bear' : 'neutral';
  const strength = Math.round(Math.min(100, Math.abs(score) * 100 * 1.4));

  const st = autoStudies(bars);
  const sup = (st?.levels || []).filter(l => l.kind === 'support').sort((x, y) => y.price - x.price)[0] || null;
  const res = (st?.levels || []).filter(l => l.kind === 'resistance').sort((x, y) => x.price - y.price)[0] || null;
  const pats = detectPatterns(bars);
  const patterns = [...pats.chart.slice(0, 3), ...pats.candles].map(p => ({ name: p.name, bias: p.bias, status: p.status, confidence: p.confidence }));

  const word = bias === 'bull' ? 'bullish' : bias === 'bear' ? 'bearish' : 'neutral';
  const summary = `${word[0].toUpperCase() + word.slice(1)} (${strength}% conviction). ` +
    (bias === 'bull' ? 'Buyers are in control; favour long calls, bull call spreads or put credit spreads.'
      : bias === 'bear' ? 'Sellers are in control; favour long puts, bear put spreads or call credit spreads.'
        : 'Signals conflict; favour range strategies such as iron condors, or wait for a breakout.') +
    (sup ? ` Nearest support ${sup.price}.` : '') + (res ? ` Nearest resistance ${res.price}.` : '');

  return {
    bias, score: r2(score), strength, summary, signals, patterns,
    price, atr: r2(last(a)), trend: st?.trend || null,
    support: sup, resistance: res, levels: st?.levels || [],
    metrics: { rsi: r2(rv), adx: r2(adxV), macdHist: r2(h), sma50: r2(s50[n]), sma200: t200 ? r2(s200[n]) : null },
  };
}

// Most recent opening gap (today vs yesterday) and whether it has been filled intraday.
export function gapInfo(bars) {
  if (!bars || bars.length < 3) return null;
  const t = last(bars), y = bars[bars.length - 2];
  const gap = t.o - y.c, pct = gap / y.c;
  if (Math.abs(pct) < 0.003) return { pct: r2(pct * 100), dir: 'none', filled: true };
  const up = gap > 0;
  const filled = up ? t.l <= y.c : t.h >= y.c;
  return { pct: r2(pct * 100), dir: up ? 'up' : 'down', filled, fillTarget: r2(y.c), partial: !filled && (up ? t.c < t.o : t.c > t.o) };
}

// Screener row: every metric the presets filter on, computed from daily bars.
export function screenRow(symbol, bars) {
  if (!bars || bars.length < 60) return null;
  const c = bars.map(b => b.c), v = bars.map(b => b.v || 0), n = c.length - 1, price = c[n];
  const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), r = rsi(c, 14), a = atr(bars, 14), ax = adx(bars, 14);
  const hi = k => Math.max(...bars.slice(Math.max(0, n - k), n).map(b => b.h));
  const lo = k => Math.min(...bars.slice(Math.max(0, n - k), n).map(b => b.l));
  const avgV = v.slice(n - 50, n).reduce((s, x) => s + x, 0) / 50 || 1;
  const hi52 = Math.max(...bars.slice(-252).map(b => b.h)), lo52 = Math.min(...bars.slice(-252).map(b => b.l));
  const chg = k => (price / c[n - k] - 1) * 100;
  const gap = gapInfo(bars);
  const body = Math.abs(bars[n].c - bars[n].o), rng = bars[n].h - bars[n].l || 1e-9;
  const dn = Math.min(bars[n].o, bars[n].c) - bars[n].l;
  const row = {
    symbol, price: r2(price), chg1: r2(chg(1)), chg5: r2(chg(5)), chg20: r2(chg(20)),
    volRatio: r2(v[n] / avgV), avgVol: Math.round(avgV), atrPct: r2((a[n] / price) * 100),
    rsi: r2(r[n]), adx: r2(ax.adx[n]),
    vs50: Number.isFinite(s50[n]) ? r2((price / s50[n] - 1) * 100) : null,
    vs200: Number.isFinite(s200[n]) ? r2((price / s200[n] - 1) * 100) : null,
    from52High: r2((price / hi52 - 1) * 100), from52Low: r2((price / lo52 - 1) * 100),
    gapPct: gap?.pct ?? 0, gapDir: gap?.dir ?? 'none', gapFilled: gap?.filled ?? true,
  };
  const upTrend = price > s50[n] && s50[n] > s200[n] && s50[n] > s50[n - 10];
  const downTrend = price < s50[n] && s50[n] < s200[n] && s50[n] < s50[n - 10];
  const tags = [];
  if (upTrend) tags.push('uptrend');
  if (downTrend) tags.push('downtrend');
  if (price > hi(20) && v[n] > 1.3 * avgV) tags.push('breakout');
  if (price < lo(20) && v[n] > 1.3 * avgV) tags.push('breakdown');
  if (price >= hi52 * 0.98) tags.push('new-high');
  if (r[n] < 32 && dn > 1.5 * body && bars[n].c > bars[n].o) tags.push('reversal-up');
  else if (r[n] < 30) tags.push('oversold');
  if (r[n] > 70 && (bars[n].h - Math.max(bars[n].o, bars[n].c)) > 1.5 * body) tags.push('reversal-down');
  else if (r[n] > 72) tags.push('overbought');
  if (gap?.dir === 'up' && !gap.filled) tags.push('gap-up');
  if (gap?.dir === 'down' && !gap.filled) tags.push('gap-down');
  if (gap?.dir === 'up' && gap.filled) tags.push('gap-fill-up');
  if (gap?.dir === 'down' && gap.filled) tags.push('gap-fill-down');
  if (r[n] > 50 && r[n] < 65 && price > s50[n] && price < s20[n] * 1.01 && upTrend) tags.push('pullback');
  row.tags = tags;
  return row;
}
