// Auto-drawn chart studies from daily bars [{t, o, h, l, c, v}] (t = epoch seconds).
// Everything here is deterministic geometry/statistics; the AI copilot reads these results as
// facts and adds judgment on top.
import { atr, anchoredVwap, sma } from './indicators.js';

// Swing highs/lows: a bar whose high (low) is the extreme of the k bars on each side.
// Consecutive swings of the same type are collapsed to the most extreme one.
export function swings(bars, k = 5) {
  const out = [];
  for (let i = k; i < bars.length - k; i++) {
    let isH = true, isL = true;
    // Ties: the earlier bar wins (left side strict, right side non-strict), so equal highs such as
    // a flat top still produce exactly one swing instead of cancelling each other out.
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (j < i ? bars[j].h >= bars[i].h : bars[j].h > bars[i].h) isH = false;
      if (j < i ? bars[j].l <= bars[i].l : bars[j].l < bars[i].l) isL = false;
    }
    if (isH) out.push({ i, t: bars[i].t, price: bars[i].h, type: 'H' });
    if (isL) out.push({ i, t: bars[i].t, price: bars[i].l, type: 'L' });
  }
  const alt = [];
  for (const s of out) {
    const prev = alt[alt.length - 1];
    if (prev && prev.type === s.type) {
      if ((s.type === 'H' && s.price > prev.price) || (s.type === 'L' && s.price < prev.price)) alt[alt.length - 1] = s;
    } else alt.push(s);
  }
  return alt;
}

// Horizontal support/resistance: clusters of swing prices within ~0.6 ATR, ranked by touches and recency.
export function supportResistance(bars, sw, a, max = 8) {
  const last = bars.length - 1, price = bars[last].c;
  const tol = Math.max(a * 0.6, price * 0.006);
  const clusters = [];
  for (const s of [...sw].sort((x, y) => x.price - y.price)) {
    const c = clusters.find(cl => Math.abs(cl.price - s.price) <= tol);
    if (c) {
      c.members.push(s);
      c.price = c.members.reduce((acc, m) => acc + m.price, 0) / c.members.length;
    } else clusters.push({ price: s.price, members: [s] });
  }
  return clusters
    .map(c => {
      const lastTouch = Math.max(...c.members.map(m => m.i));
      const touches = c.members.length;
      const recency = 1 - (last - lastTouch) / Math.max(1, last);
      return {
        price: +c.price.toFixed(2), touches, lastTouchT: bars[lastTouch].t,
        kind: c.price <= price ? 'support' : 'resistance',
        strength: Math.round(Math.min(100, touches * 22 + recency * 35)),
      };
    })
    .filter(l => l.touches >= 2 || Math.abs(l.price - price) < 4 * a)
    .sort((x, y) => y.strength - x.strength)
    .slice(0, max)
    .sort((x, y) => y.price - x.price);
}

const lineAt = (p1, p2, i) => p1.price + ((p2.price - p1.price) * (i - p1.i)) / (p2.i - p1.i);

// Trendlines through pairs of recent swing lows (support) / highs (resistance), scored by touches and
// penalized for closes through the line. Returns the best of each, projected to the last bar.
export function trendlines(bars, sw, a) {
  const last = bars.length - 1;
  const best = kind => {
    const pts = sw.filter(s => s.type === (kind === 'support' ? 'L' : 'H')).slice(-6);
    let top = null;
    for (let x = 0; x < pts.length; x++) for (let y = x + 1; y < pts.length; y++) {
      const p1 = pts[x], p2 = pts[y];
      if (p2.i - p1.i < 8) continue;
      const slope = (p2.price - p1.price) / (p2.i - p1.i);
      if (kind === 'support' && slope <= 0) continue;      // rising support
      if (kind === 'resistance' && slope >= 0) continue;   // falling resistance
      let violations = 0, touches = 0;
      for (let i = p1.i; i <= last; i++) {
        const v = lineAt(p1, p2, i);
        if (kind === 'support' ? bars[i].c < v - 0.3 * a : bars[i].c > v + 0.3 * a) violations++;
        if (Math.abs((kind === 'support' ? bars[i].l : bars[i].h) - v) <= 0.25 * a) touches++;
      }
      if (violations > 2) continue;
      const score = touches * 10 - violations * 15 + (p2.i / last) * 20;
      if (!top || score > top.score) {
        top = {
          kind, score, touches, violations,
          p1: { t: p1.t, price: +p1.price.toFixed(2) },
          p2: { t: p2.t, price: +p2.price.toFixed(2) },
          end: { t: bars[last].t, price: +lineAt(p1, p2, last).toFixed(2) },
          slopePctPerDay: +((slope / bars[last].c) * 100).toFixed(3),
        };
      }
    }
    return top;
  };
  return [best('support'), best('resistance')].filter(Boolean);
}

// Fibonacci retracements/extensions of the dominant swing in the lookback window.
export function fibonacci(bars, lookback = 120) {
  const start = Math.max(0, bars.length - lookback);
  let hi = start, lo = start;
  for (let i = start; i < bars.length; i++) {
    if (bars[i].h > bars[hi].h) hi = i;
    if (bars[i].l < bars[lo].l) lo = i;
  }
  const up = lo < hi; // rally from low to high => retracements measured down from the high
  const H = bars[hi].h, L = bars[lo].l, range = H - L;
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
  return {
    direction: up ? 'up' : 'down',
    from: { t: bars[up ? lo : hi].t, price: +(up ? L : H).toFixed(2) },
    to: { t: bars[up ? hi : lo].t, price: +(up ? H : L).toFixed(2) },
    levels: ratios.map(r => ({ ratio: r, price: +(up ? H - range * r : L + range * r).toFixed(2) })),
  };
}

// Supply/demand zones: the base candle before an impulsive move (>= 2.2 ATR in 3 bars), kept only
// while price has not closed through it since.
export function supplyDemandZones(bars, atrs, lookback = 180, max = 3) {
  const last = bars.length - 1, price = bars[last].c;
  const zones = [];
  for (let i = Math.max(1, bars.length - lookback); i < last - 3; i++) {
    const a = atrs[i];
    if (!(a > 0)) continue;
    const b = bars[i];
    if (b.h - b.l > 1.1 * a) continue; // base candles are small
    const fwd = bars[i + 3].c - b.c;
    if (Math.abs(fwd) < 2.2 * a) continue;
    const demand = fwd > 0;
    const top = demand ? Math.max(b.o, b.c) : b.h, bottom = demand ? b.l : Math.min(b.o, b.c);
    let fresh = true;
    for (let j = i + 4; j <= last; j++) if (demand ? bars[j].c < bottom : bars[j].c > top) { fresh = false; break; }
    if (fresh && top > bottom) zones.push({ kind: demand ? 'demand' : 'supply', top: +top.toFixed(2), bottom: +bottom.toFixed(2), t: b.t, strength: Math.round(Math.min(100, (Math.abs(fwd) / a) * 20)) });
  }
  const pick = kind => zones.filter(z => z.kind === kind)
    .sort((x, y) => Math.abs((x.top + x.bottom) / 2 - price) - Math.abs((y.top + y.bottom) / 2 - price)).slice(0, max);
  return [...pick('demand'), ...pick('supply')];
}

// One call for everything the chart and copilot need.
export function autoStudies(bars) {
  if (!bars || bars.length < 60) return null;
  const atrs = atr(bars, 14);
  const a = atrs[atrs.length - 1];
  const sw = swings(bars, bars.length > 300 ? 6 : 5);
  const last = bars.length - 1;
  const win = Math.min(120, bars.length);
  let loI = last - win + 1, hiI = loI;
  for (let i = last - win + 1; i <= last; i++) { if (bars[i].l < bars[loI].l) loI = i; if (bars[i].h > bars[hiI].h) hiI = i; }
  const avFromLow = anchoredVwap(bars, loI), avFromHigh = anchoredVwap(bars, hiI);
  const s50 = sma(bars.map(b => b.c), 50);
  return {
    price: bars[last].c, atr: a, asOf: bars[last].t,
    swings: sw.slice(-20).map(s => ({ t: s.t, price: +s.price.toFixed(2), type: s.type })),
    levels: supportResistance(bars, sw, a),
    trendlines: trendlines(bars, sw, a),
    fib: fibonacci(bars, 120),
    avwap: [
      { label: 'AVWAP from swing low', anchorT: bars[loI].t, value: +avFromLow[last].toFixed(2), series: avFromLow.slice(loI).map((v, k) => ({ t: bars[loI + k].t, v })) },
      { label: 'AVWAP from swing high', anchorT: bars[hiI].t, value: +avFromHigh[last].toFixed(2), series: avFromHigh.slice(hiI).map((v, k) => ({ t: bars[hiI + k].t, v })) },
    ],
    zones: supplyDemandZones(bars, atrs),
    trend: bars[last].c > s50[last] ? (s50[last] > s50[last - 10] ? 'up' : 'sideways-up') : (s50[last] < s50[last - 10] ? 'down' : 'sideways-down'),
  };
}
