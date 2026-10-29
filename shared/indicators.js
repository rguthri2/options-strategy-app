// Technical indicators over daily candles [{t, o, h, l, c, v}]. Each returns an array aligned to input.

export function sma(values, n) {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values, n) {
  const out = new Array(values.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === n - 1) prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
    else if (i >= n) prev = values[i] * k + prev * (1 - k);
    out[i] = i >= n - 1 ? prev : NaN;
  }
  return out;
}

// Wilder's RSI.
export function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(NaN);
  let g = 0, l = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    if (i <= n) {
      g += up; l += dn;
      if (i === n) { g /= n; l /= n; out[i] = 100 - 100 / (1 + g / (l || 1e-12)); }
    } else {
      g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;
      out[i] = 100 - 100 / (1 + g / (l || 1e-12));
    }
  }
  return out;
}

export function trueRange(c) {
  return c.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c))));
}

export function wilder(values, n) {
  const out = new Array(values.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === n - 1) prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
    else if (i >= n) prev = (prev * (n - 1) + values[i]) / n;
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}

export function atr(c, n = 14) {
  return wilder(trueRange(c), n);
}

export function adx(c, n = 14) {
  const plusDM = [0], minusDM = [0];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].h - c[i - 1].h, dn = c[i - 1].l - c[i].l;
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
  }
  const tr = wilder(trueRange(c), n), p = wilder(plusDM, n), m = wilder(minusDM, n);
  const dx = c.map((_, i) => {
    const pdi = (100 * p[i]) / tr[i], mdi = (100 * m[i]) / tr[i];
    return (100 * Math.abs(pdi - mdi)) / (pdi + mdi || 1e-12);
  });
  const firstValid = dx.findIndex(Number.isFinite);
  const adxArr = new Array(c.length).fill(NaN);
  if (firstValid < 0) return { adx: adxArr, pdi: [], mdi: [] };
  const sm = wilder(dx.slice(firstValid), n);
  sm.forEach((v, i) => { adxArr[i + firstValid] = v; });
  return {
    adx: adxArr,
    pdi: c.map((_, i) => (100 * p[i]) / tr[i]),
    mdi: c.map((_, i) => (100 * m[i]) / tr[i]),
  };
}

export function bollinger(closes, n = 20, k = 2) {
  const mid = sma(closes, n);
  const upper = [], lower = [], width = [];
  for (let i = 0; i < closes.length; i++) {
    if (!Number.isFinite(mid[i])) { upper.push(NaN); lower.push(NaN); width.push(NaN); continue; }
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n);
    upper.push(mid[i] + k * sd); lower.push(mid[i] - k * sd); width.push((2 * k * sd) / mid[i]);
  }
  return { mid, upper, lower, width };
}

// Keltner channels (EMA +/- mult * ATR), used for the TTM-style squeeze.
export function keltner(c, n = 20, mult = 1.5) {
  const mid = ema(c.map(x => x.c), n), a = atr(c, n);
  return { mid, upper: mid.map((m, i) => m + mult * a[i]), lower: mid.map((m, i) => m - mult * a[i]) };
}

// Annualized close-to-close historical volatility.
export function histVol(closes, n = 20) {
  const out = new Array(closes.length).fill(NaN);
  const rets = closes.map((c, i) => (i ? Math.log(c / closes[i - 1]) : 0));
  for (let i = n; i < closes.length; i++) {
    const w = rets.slice(i - n + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / n;
    const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
    out[i] = Math.sqrt(v * 252);
  }
  return out;
}

// MACD (fast EMA - slow EMA), signal EMA, histogram.
export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const f = ema(closes, fast), s = ema(closes, slow);
  const line = closes.map((_, i) => f[i] - s[i]);
  const first = line.findIndex(Number.isFinite);
  const sig = new Array(closes.length).fill(NaN);
  if (first >= 0) ema(line.slice(first), signal).forEach((v, i) => { sig[first + i] = v; });
  return { macd: line, signal: sig, hist: line.map((v, i) => v - sig[i]) };
}

// Slow stochastic %K (smoothed) and %D.
export function stochastic(c, n = 14, smoothK = 3, smoothD = 3) {
  const raw = c.map((_, i) => {
    if (i < n - 1) return NaN;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hi = Math.max(hi, c[j].h); lo = Math.min(lo, c[j].l); }
    return hi > lo ? (100 * (c[i].c - lo)) / (hi - lo) : 50;
  });
  const smooth = (arr, k) => {
    const out = new Array(arr.length).fill(NaN);
    for (let i = 0; i < arr.length; i++) {
      const w = arr.slice(Math.max(0, i - k + 1), i + 1);
      if (w.length === k && w.every(Number.isFinite)) out[i] = w.reduce((a, b) => a + b, 0) / k;
    }
    return out;
  };
  const k = smooth(raw, smoothK);
  return { k, d: smooth(k, smoothD) };
}

// Volume-weighted average price anchored at bar index `from` (typical price).
export function anchoredVwap(c, from) {
  const out = new Array(c.length).fill(NaN);
  let pv = 0, vol = 0;
  for (let i = Math.max(0, from); i < c.length; i++) {
    const tp = (c[i].h + c[i].l + c[i].c) / 3;
    pv += tp * (c[i].v || 0); vol += c[i].v || 0;
    out[i] = vol > 0 ? pv / vol : tp;
  }
  return out;
}

export function percentRank(arr, value) {
  const v = arr.filter(Number.isFinite);
  if (!v.length) return NaN;
  return (100 * v.filter(x => x < value).length) / v.length;
}

export const last = a => a[a.length - 1];
export const pctChange = (a, b) => (b ? (a - b) / b : NaN);
