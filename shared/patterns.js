// Chart and candlestick pattern detection on daily bars. Each pattern returns drawable geometry
// (points / lines), a breakout level, a measured-move target, a status and a 0-100 confidence.
// Rules follow the classic definitions (Bulkowski, Edwards & Magee, O'Neil, Minervini) with
// ATR-scaled tolerances so they work across price levels and volatility regimes.
import { atr, sma } from './indicators.js';
import { swings } from './studies.js';

const pct = (a, b) => (a - b) / b;
const r2 = x => +x.toFixed(2);
const pt = (bars, i, price) => ({ t: bars[i].t, price: r2(price) });
const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));

function doubleTopBottom(bars, sw, a) {
  const out = [];
  const last = bars.length - 1, c = bars[last].c;
  for (const kind of ['top', 'bottom']) {
    const peaks = sw.filter(s => s.type === (kind === 'top' ? 'H' : 'L'));
    if (peaks.length < 2) continue;
    const p2 = peaks[peaks.length - 1], p1 = peaks[peaks.length - 2];
    if (last - p2.i > 40 || p2.i - p1.i < 8) continue;
    if (Math.abs(pct(p2.price, p1.price)) > 0.03) continue;
    // Neckline: extreme between the two peaks.
    let n = p1.i;
    for (let i = p1.i; i <= p2.i; i++) if (kind === 'top' ? bars[i].l < bars[n].l : bars[i].h > bars[n].h) n = i;
    const neck = kind === 'top' ? bars[n].l : bars[n].h;
    const depth = Math.abs(p1.price - neck);
    if (depth < Math.max(3 * a, p1.price * 0.05)) continue;
    const confirmed = kind === 'top' ? c < neck : c > neck;
    if (kind === 'top' ? c > Math.max(p1.price, p2.price) : c < Math.min(p1.price, p2.price)) continue; // invalidated
    const volLower = (bars[p2.i].v || 0) < (bars[p1.i].v || 0);
    out.push({
      key: `double_${kind}`, name: kind === 'top' ? 'Double Top' : 'Double Bottom', bias: kind === 'top' ? 'bear' : 'bull',
      status: confirmed ? 'confirmed' : 'forming',
      confidence: clamp(45 + (1 - Math.abs(pct(p2.price, p1.price)) / 0.03) * 15 + (volLower ? 10 : 0) + (confirmed ? 20 : 0)),
      points: [pt(bars, p1.i, p1.price), pt(bars, n, neck), pt(bars, p2.i, p2.price)],
      lines: [{ label: 'Neckline', from: pt(bars, p1.i, neck), to: pt(bars, last, neck) }],
      breakout: r2(neck), target: r2(kind === 'top' ? neck - depth : neck + depth), stop: r2(kind === 'top' ? Math.max(p1.price, p2.price) : Math.min(p1.price, p2.price)),
      startT: bars[p1.i].t, endT: bars[last].t,
    });
  }
  return out;
}

function headShoulders(bars, sw, a) {
  const out = [];
  const last = bars.length - 1, c = bars[last].c;
  for (const inverse of [false, true]) {
    const peaks = sw.filter(s => s.type === (inverse ? 'L' : 'H'));
    const troughs = sw.filter(s => s.type === (inverse ? 'H' : 'L'));
    if (peaks.length < 3) continue;
    const [ls, hd, rs] = peaks.slice(-3);
    if (last - rs.i > 30 || rs.i - ls.i > 150) continue;
    const higher = (x, y) => (inverse ? x < y : x > y);
    if (!(higher(hd.price, ls.price) && higher(hd.price, rs.price))) continue;
    if (Math.abs(pct(hd.price, Math.max(ls.price, rs.price))) < 0.03) continue;  // head must stand out
    if (Math.abs(pct(ls.price, rs.price)) > 0.06) continue;                      // shoulders roughly level
    const t1 = troughs.find(t => t.i > ls.i && t.i < hd.i), t2 = troughs.find(t => t.i > hd.i && t.i < rs.i);
    if (!t1 || !t2) continue;
    const neckAt = i => t1.price + ((t2.price - t1.price) * (i - t1.i)) / (t2.i - t1.i);
    const neckNow = neckAt(last);
    const height = Math.abs(hd.price - neckAt(hd.i));
    const confirmed = inverse ? c > neckNow : c < neckNow;
    if (inverse ? c < rs.price - a : c > rs.price + a) continue; // right shoulder broken the wrong way
    out.push({
      key: inverse ? 'inverse_head_shoulders' : 'head_shoulders', name: inverse ? 'Inverse Head & Shoulders' : 'Head & Shoulders',
      bias: inverse ? 'bull' : 'bear', status: confirmed ? 'confirmed' : 'forming',
      confidence: clamp(50 + (1 - Math.abs(pct(ls.price, rs.price)) / 0.06) * 15 + (confirmed ? 20 : 0)),
      points: [pt(bars, ls.i, ls.price), pt(bars, t1.i, t1.price), pt(bars, hd.i, hd.price), pt(bars, t2.i, t2.price), pt(bars, rs.i, rs.price)],
      lines: [{ label: 'Neckline', from: pt(bars, t1.i, t1.price), to: pt(bars, last, neckNow) }],
      breakout: r2(neckNow), target: r2(inverse ? neckNow + height : neckNow - height), stop: r2(rs.price),
      startT: bars[ls.i].t, endT: bars[last].t,
    });
  }
  return out;
}

// Least-squares line through pivot points (x = bar index).
function fit(points) {
  const n = points.length, mx = points.reduce((s, p) => s + p.i, 0) / n, my = points.reduce((s, p) => s + p.price, 0) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.i - mx) * (p.price - my); den += (p.i - mx) ** 2; }
  const slope = den ? num / den : 0;
  return { slope, at: i => my + slope * (i - mx) };
}

function trianglesWedges(bars, sw, a) {
  const last = bars.length - 1, c = bars[last].c;
  const start = last - 70;
  const highs = sw.filter(s => s.type === 'H' && s.i >= start), lows = sw.filter(s => s.type === 'L' && s.i >= start);
  if (highs.length < 2 || lows.length < 2) return [];
  const H = fit(highs), L = fit(lows);
  const i0 = Math.min(highs[0].i, lows[0].i);
  const w0 = H.at(i0) - L.at(i0), w1 = H.at(last) - L.at(last);
  if (!(w0 > 0 && w1 > 0) || w1 > w0 * 0.8) return []; // must converge
  const flat = s => Math.abs(s / c) < 0.0006; // < 0.06% of price per bar
  const up = s => s / c >= 0.0006, down = s => s / c <= -0.0006;
  let key, name, bias;
  if (flat(H.slope) && up(L.slope)) { key = 'ascending_triangle'; name = 'Ascending Triangle'; bias = 'bull'; }
  else if (down(H.slope) && flat(L.slope)) { key = 'descending_triangle'; name = 'Descending Triangle'; bias = 'bear'; }
  else if (down(H.slope) && up(L.slope)) { key = 'symmetrical_triangle'; name = 'Symmetrical Triangle'; bias = bars[i0].c < c ? 'bull' : 'bear'; }
  else if (up(H.slope) && up(L.slope) && L.slope > H.slope) { key = 'rising_wedge'; name = 'Rising Wedge'; bias = 'bear'; }
  else if (down(H.slope) && down(L.slope) && H.slope < L.slope) { key = 'falling_wedge'; name = 'Falling Wedge'; bias = 'bull'; }
  else return [];
  const upper = H.at(last), lower = L.at(last);
  const brokeUp = c > upper + 0.2 * a, brokeDown = c < lower - 0.2 * a;
  const confirmed = bias === 'bull' ? brokeUp : brokeDown;
  if ((bias === 'bull' && brokeDown) || (bias === 'bear' && brokeUp)) return []; // failed pattern
  const touches = highs.length + lows.length;
  return [{
    key, name, bias, status: confirmed ? 'confirmed' : 'forming',
    confidence: clamp(40 + Math.min(touches, 6) * 6 + (confirmed ? 20 : 0) + (1 - w1 / w0) * 10),
    points: [...highs, ...lows].sort((x, y) => x.i - y.i).map(p => pt(bars, p.i, p.price)),
    lines: [
      { label: 'Upper', from: pt(bars, i0, H.at(i0)), to: pt(bars, last, upper) },
      { label: 'Lower', from: pt(bars, i0, L.at(i0)), to: pt(bars, last, lower) },
    ],
    breakout: r2(bias === 'bull' ? upper : lower), target: r2(bias === 'bull' ? upper + w0 : lower - w0), stop: r2(bias === 'bull' ? lower : upper),
    startT: bars[i0].t, endT: bars[last].t,
  }];
}

function flags(bars, a) {
  const last = bars.length - 1;
  for (let cons = 5; cons <= 20; cons++) {
    const b = last - cons; // pole end
    for (let len = 3; len <= 15; len++) {
      const s = b - len;
      if (s < 0) break;
      const move = bars[b].c - bars[s].c;
      if (Math.abs(move) < Math.max(3 * a, bars[s].c * 0.06)) continue;
      const bull = move > 0;
      const seg = bars.slice(b, last + 1);
      const hi = Math.max(...seg.map(x => x.h)), lo = Math.min(...seg.map(x => x.l));
      if (hi - lo > Math.abs(move) * 0.5) continue;                                    // tight consolidation
      const retr = bull ? (bars[b].c - lo) / move : (hi - bars[b].c) / -move;
      if (retr > 0.5) continue;
      const first = seg.slice(0, Math.ceil(seg.length / 2)), second = seg.slice(Math.ceil(seg.length / 2));
      const rng = x => Math.max(...x.map(y => y.h)) - Math.min(...x.map(y => y.l));
      const pennant = second.length && rng(second) < rng(first) * 0.7;
      const level = bull ? hi : lo;
      const confirmed = bull ? bars[last].c > level - 0.05 * a && bars[last].c >= Math.max(...seg.slice(0, -1).map(x => x.h)) : bars[last].c <= Math.min(...seg.slice(0, -1).map(x => x.l));
      return [{
        key: `${bull ? 'bull' : 'bear'}_${pennant ? 'pennant' : 'flag'}`, name: `${bull ? 'Bull' : 'Bear'} ${pennant ? 'Pennant' : 'Flag'}`,
        bias: bull ? 'bull' : 'bear', status: confirmed ? 'confirmed' : 'forming',
        confidence: clamp(50 + (0.5 - retr) * 30 + (confirmed ? 15 : 0) + ((bars[last].v || 0) < (bars[b].v || 1) ? 5 : 0)),
        points: [pt(bars, s, bars[s].c), pt(bars, b, bars[b].c), pt(bars, last, bars[last].c)],
        lines: [{ label: 'Pole', from: pt(bars, s, bars[s].c), to: pt(bars, b, bars[b].c) }, { label: 'Flag top', from: pt(bars, b, hi), to: pt(bars, last, hi) }, { label: 'Flag bottom', from: pt(bars, b, lo), to: pt(bars, last, lo) }],
        breakout: r2(level), target: r2(bull ? hi + Math.abs(move) : lo - Math.abs(move)), stop: r2(bull ? lo : hi),
        startT: bars[s].t, endT: bars[last].t,
      }];
    }
  }
  return [];
}

function cupHandle(bars, a) {
  const last = bars.length - 1;
  if (bars.length < 80) return [];
  const win0 = Math.max(0, last - 160), win1 = last - 35;
  let lip = win0;
  for (let i = win0; i <= win1; i++) if (bars[i].h > bars[lip].h) lip = i;
  let bottom = lip;
  for (let i = lip; i <= last; i++) if (bars[i].l < bars[bottom].l) bottom = i;
  const depth = (bars[lip].h - bars[bottom].l) / bars[lip].h;
  if (depth < 0.12 || depth > 0.35) return [];
  let right = bottom;
  for (let i = bottom; i <= last; i++) if (bars[i].h > bars[right].h) right = i;
  if (bars[right].h < bars[lip].h * 0.95 || bars[right].h > bars[lip].h * 1.05) return [];
  const cupLen = right - lip;
  if (cupLen < 30 || (bottom - lip) / cupLen < 0.25 || (bottom - lip) / cupLen > 0.75) return []; // U shape, not V
  const handle = bars.slice(right, last + 1);
  if (handle.length > 25) return [];
  const hLow = Math.min(...handle.map(b => b.l));
  const hDepth = (bars[right].h - hLow) / bars[right].h;
  const mid = (bars[lip].h + bars[bottom].l) / 2;
  if (hDepth > 0.12 || hLow < mid) return [];
  const pivot = bars[right].h;
  const confirmed = bars[last].c > pivot;
  return [{
    key: 'cup_handle', name: 'Cup & Handle', bias: 'bull', status: confirmed ? 'confirmed' : handle.length >= 3 ? 'forming' : 'cup only',
    confidence: clamp(55 + (0.12 - hDepth) * 100 + (confirmed ? 15 : 0) + (handle.length >= 5 ? 5 : 0)),
    points: [pt(bars, lip, bars[lip].h), pt(bars, bottom, bars[bottom].l), pt(bars, right, bars[right].h), pt(bars, last, bars[last].c)],
    lines: [{ label: 'Pivot', from: pt(bars, lip, pivot), to: pt(bars, last, pivot) }],
    breakout: r2(pivot), target: r2(pivot + (bars[lip].h - bars[bottom].l)), stop: r2(hLow),
    startT: bars[lip].t, endT: bars[last].t,
  }];
}

// Minervini VCP: successive pullbacks in an uptrend that shrink (e.g. 25% -> 12% -> 6%) on drying volume.
function vcp(bars, sw) {
  const last = bars.length - 1;
  const c = bars.map(b => b.c), s50 = sma(c, 50);
  if (!(c[last] > s50[last])) return [];
  const recent = sw.filter(s => s.i > last - 130);
  const legs = [];
  for (let k = 0; k < recent.length - 1; k++) {
    if (recent[k].type === 'H' && recent[k + 1].type === 'L') legs.push({ hi: recent[k], lo: recent[k + 1], depth: (recent[k].price - recent[k + 1].price) / recent[k].price });
  }
  if (legs.length < 2) return [];
  const tail = legs.slice(-4);
  let n = 1;
  for (let k = tail.length - 1; k > 0; k--) { if (tail[k].depth <= tail[k - 1].depth * 0.8) n++; else break; }
  const lastLeg = tail[tail.length - 1];
  if (n < 2 || lastLeg.depth > 0.12) return [];
  const v50 = bars.slice(-50).reduce((s, b) => s + (b.v || 0), 0) / 50;
  const v10 = bars.slice(-10).reduce((s, b) => s + (b.v || 0), 0) / 10;
  const dryUp = v10 < v50 * 0.85;
  const pivot = lastLeg.hi.price;
  const confirmed = c[last] > pivot;
  const used = tail.slice(-n);
  return [{
    key: 'vcp', name: `VCP (${n} contractions)`, bias: 'bull', status: confirmed ? 'confirmed' : 'forming',
    confidence: clamp(45 + n * 10 + (dryUp ? 12 : 0) + (confirmed ? 15 : 0) + (lastLeg.depth < 0.06 ? 8 : 0)),
    points: used.flatMap(l => [pt(bars, l.hi.i, l.hi.price), pt(bars, l.lo.i, l.lo.price)]),
    lines: [{ label: 'Pivot', from: pt(bars, used[0].hi.i, pivot), to: pt(bars, last, pivot) }],
    breakout: r2(pivot), target: r2(pivot * (1 + used[0].depth)), stop: r2(lastLeg.lo.price),
    detail: used.map(l => `${(l.depth * 100).toFixed(1)}%`).join(' → ') + (dryUp ? ' · volume drying up' : ''),
    startT: bars[used[0].hi.i].t, endT: bars[last].t,
  }];
}

// Candlestick patterns on the last 1-3 bars, with trend context.
export function candlesticks(bars) {
  const n = bars.length, out = [];
  if (n < 25) return out;
  const c = bars.map(b => b.c), s20 = sma(c, 20);
  const [x, y, z] = [bars[n - 3], bars[n - 2], bars[n - 1]];
  const body = b => Math.abs(b.c - b.o), range = b => b.h - b.l || 1e-9;
  const upWick = b => b.h - Math.max(b.o, b.c), dnWick = b => Math.min(b.o, b.c) - b.l;
  const downtrend = c[n - 2] < s20[n - 2], uptrend = c[n - 2] > s20[n - 2];
  const add = (key, name, bias, conf) => out.push({ key, name, bias, status: 'last bar', confidence: conf, t: z.t, price: r2(bias === 'bull' ? z.l : z.h) });
  if (y.c < y.o && z.c > z.o && z.c >= y.o && z.o <= y.c && body(z) > body(y)) add('bullish_engulfing', 'Bullish Engulfing', 'bull', downtrend ? 70 : 55);
  if (y.c > y.o && z.c < z.o && z.o >= y.c && z.c <= y.o && body(z) > body(y)) add('bearish_engulfing', 'Bearish Engulfing', 'bear', uptrend ? 70 : 55);
  if (dnWick(z) >= 2 * body(z) && upWick(z) <= body(z) * 0.5 && body(z) / range(z) < 0.4) add(downtrend ? 'hammer' : 'hanging_man', downtrend ? 'Hammer' : 'Hanging Man', downtrend ? 'bull' : 'bear', downtrend ? 65 : 50);
  if (upWick(z) >= 2 * body(z) && dnWick(z) <= body(z) * 0.5 && body(z) / range(z) < 0.4) add(uptrend ? 'shooting_star' : 'inverted_hammer', uptrend ? 'Shooting Star' : 'Inverted Hammer', uptrend ? 'bear' : 'bull', uptrend ? 65 : 50);
  if (body(z) / range(z) < 0.1) add('doji', 'Doji', 'neutral', 45);
  if (x.c < x.o && body(y) < body(x) * 0.4 && z.c > z.o && z.c > (x.o + x.c) / 2 && downtrend) add('morning_star', 'Morning Star', 'bull', 72);
  if (x.c > x.o && body(y) < body(x) * 0.4 && z.c < z.o && z.c < (x.o + x.c) / 2 && uptrend) add('evening_star', 'Evening Star', 'bear', 72);
  if (z.h < y.h && z.l > y.l) add('inside_bar', 'Inside Bar', 'neutral', 50);
  return out;
}

export function detectPatterns(bars) {
  if (!bars || bars.length < 60) return { chart: [], candles: [] };
  const atrs = atr(bars, 14), a = atrs[atrs.length - 1];
  const sw = swings(bars, 4);
  const chart = [
    ...doubleTopBottom(bars, sw, a), ...headShoulders(bars, sw, a), ...trianglesWedges(bars, sw, a),
    ...flags(bars, a), ...cupHandle(bars, a), ...vcp(bars, sw),
  ].map(p => ({ ...p, confidence: Math.round(p.confidence) })).sort((x, y) => y.confidence - x.confidence);
  return { chart, candles: candlesticks(bars) };
}
