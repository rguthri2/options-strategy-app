// Price charts (TradingView Lightweight Charts) and SVG charts (payoff, OI by strike).
import { fmt, esc } from './ui.js';
import { nyOffsetHours } from '../shared/time.js';

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function waitForLib() {
  return new Promise(resolve => {
    if (window.LightweightCharts) return resolve(window.LightweightCharts);
    const t = setInterval(() => { if (window.LightweightCharts) { clearInterval(t); resolve(window.LightweightCharts); } }, 30);
  });
}

function smaLine(candles, n) {
  const out = [];
  let sum = 0;
  candles.forEach((c, i) => {
    sum += c.c;
    if (i >= n) sum -= candles[i - n].c;
    if (i >= n - 1) out.push({ time: c.time, value: sum / n });
  });
  return out;
}

// candles: [{t, o, h, l, c, v}] ; intraday => area chart in New York time.
export async function priceChart(el, candles, { intraday = false, smas = [20, 50, 200], prevClose, levels = [] } = {}) {
  const LW = await waitForLib();
  el.innerHTML = '';
  const up = css('--up'), down = css('--down'), text = css('--muted'), grid = css('--border'), accent = css('--accent');
  const chart = LW.createChart(el, {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: text, fontFamily: css('--font') },
    grid: { vertLines: { color: 'transparent' }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: grid },
    timeScale: { borderColor: grid, timeVisible: intraday, secondsVisible: false },
    crosshair: { mode: 1 },
  });
  const data = candles.map(c => ({
    ...c,
    time: intraday ? Math.round(c.t + nyOffsetHours(new Date(c.t * 1000)) * 3600) : new Date(c.t * 1000).toISOString().slice(0, 10),
  }));
  const first = data[0]?.c, last = data.length ? data[data.length - 1].c : undefined;
  const rising = (prevClose ?? first) <= last;
  let main;
  if (intraday) {
    const col = rising ? up : down;
    main = chart.addSeries(LW.AreaSeries, { lineColor: col, topColor: col + '55', bottomColor: col + '00', lineWidth: 2, priceLineVisible: false });
    main.setData(data.map(d => ({ time: d.time, value: d.c })));
    if (prevClose) main.createPriceLine({ price: prevClose, color: text, lineStyle: 2, lineWidth: 1, title: 'Prev close', axisLabelVisible: true });
  } else {
    main = chart.addSeries(LW.CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
    main.setData(data.map(d => ({ time: d.time, open: d.o, high: d.h, low: d.l, close: d.c })));
    const colors = { 20: accent, 21: accent, 50: css('--warn'), 200: css('--neutral') };
    for (const n of smas) {
      if (data.length < n + 2) continue;
      const s = chart.addSeries(LW.LineSeries, { color: colors[n] || text, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(smaLine(data, n));
    }
  }
  for (const lv of levels) {
    if (Number.isFinite(lv.price)) main.createPriceLine({ price: lv.price, color: lv.color || accent, lineStyle: 2, lineWidth: 1, title: lv.title, axisLabelVisible: true });
  }
  const vol = chart.addSeries(LW.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  vol.setData(data.map(d => ({ time: d.time, value: d.v, color: (d.c >= d.o ? up : down) + '66' })));
  chart.timeScale().fitContent();
  return chart;
}

// ---------- payoff diagram ----------
// points: [{S, exp, t}] ; opts: {spot, breakevens, sd1: [lo,hi], sd2, tLabel}
export function payoffChart(el, points, { spot, breakevens = [], sd1, sd2, tLabel = 'Today' } = {}) {
  const W = Math.max(320, el.clientWidth || 700), H = 340, m = { l: 64, r: 16, t: 14, b: 30 };
  const xs = points.map(p => p.S);
  const ys = points.flatMap(p => [p.exp, p.t]).filter(Number.isFinite);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys, 0), y1 = Math.max(...ys, 0);
  const pad = (y1 - y0) * 0.08 || 50; y0 -= pad; y1 += pad;
  const X = s => m.l + ((s - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = v => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const line = key => points.filter(p => Number.isFinite(p[key])).map((p, i) => `${i ? 'L' : 'M'}${X(p.S).toFixed(1)},${Y(p[key]).toFixed(1)}`).join('');
  const zeroY = Y(0);
  const area = `M${X(points[0].S)},${zeroY}` + points.map(p => `L${X(p.S).toFixed(1)},${Y(p.exp).toFixed(1)}`).join('') + `L${X(points[points.length - 1].S)},${zeroY}Z`;
  const ticksY = niceTicks(y0, y1, 6), ticksX = niceTicks(x0, x1, 8);
  const band = (r, op) => (r ? `<rect x="${X(Math.max(r[0], x0))}" y="${m.t}" width="${Math.max(0, X(Math.min(r[1], x1)) - X(Math.max(r[0], x0)))}" height="${H - m.t - m.b}" fill="var(--accent)" opacity="${op}"/>` : '');
  el.innerHTML = `<svg class="payoff" width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs>
      <clipPath id="pclip-up"><rect x="0" y="0" width="${W}" height="${zeroY}"/></clipPath>
      <clipPath id="pclip-dn"><rect x="0" y="${zeroY}" width="${W}" height="${H}"/></clipPath>
    </defs>
    ${band(sd2, 0.04)}${band(sd1, 0.07)}
    ${ticksY.map(v => `<line class="grid-l" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${fmt.usd(v)}</text>`).join('')}
    ${ticksX.map(v => `<text x="${X(v)}" y="${H - 10}" text-anchor="middle">${fmt.px(v, v >= 100 ? 0 : 2)}</text>`).join('')}
    <path d="${area}" fill="var(--up)" opacity=".16" clip-path="url(#pclip-up)"/>
    <path d="${area}" fill="var(--down)" opacity=".16" clip-path="url(#pclip-dn)"/>
    <line class="zero" x1="${m.l}" x2="${W - m.r}" y1="${zeroY}" y2="${zeroY}"/>
    <path d="${line('t')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="6 4"/>
    <path d="${line('exp')}" fill="none" stroke="var(--text)" stroke-width="2.2"/>
    ${spot ? `<line x1="${X(spot)}" x2="${X(spot)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--accent)" stroke-width="1.2"/><text x="${X(spot) + 4}" y="${m.t + 12}" fill="var(--accent)">Spot ${fmt.px(spot)}</text>` : ''}
    ${breakevens.filter(b => b > x0 && b < x1).map(b => `<circle cx="${X(b)}" cy="${zeroY}" r="4" fill="var(--warn)"/><text x="${X(b)}" y="${zeroY - 8}" text-anchor="middle" fill="var(--warn)">BE ${fmt.px(b)}</text>`).join('')}
    <g class="hover" visibility="hidden"><line class="hl" y1="${m.t}" y2="${H - m.b}" stroke="var(--muted)" stroke-dasharray="3 3"/>
      <rect class="hb" width="170" height="54" rx="6" fill="var(--panel-3)" stroke="var(--border-2)"/><text class="ht1" fill="var(--text)"/><text class="ht2"/><text class="ht3"/></g>
    <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>
  </svg>`;
  const svg = el.querySelector('svg');
  const g = svg.querySelector('.hover');
  svg.querySelector('.hit').addEventListener('mousemove', ev => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const S = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    const p = points.reduce((a, b) => (Math.abs(b.S - S) < Math.abs(a.S - S) ? b : a));
    const hx = X(p.S);
    g.setAttribute('visibility', 'visible');
    g.querySelector('.hl').setAttribute('x1', hx); g.querySelector('.hl').setAttribute('x2', hx);
    const bx = hx + 180 > W ? hx - 178 : hx + 8;
    g.querySelector('.hb').setAttribute('x', bx); g.querySelector('.hb').setAttribute('y', m.t + 4);
    const t1 = g.querySelector('.ht1'), t2 = g.querySelector('.ht2'), t3 = g.querySelector('.ht3');
    [t1, t2, t3].forEach((t, i) => { t.setAttribute('x', bx + 10); t.setAttribute('y', m.t + 21 + i * 15); });
    t1.textContent = `Price ${fmt.px(p.S)} (${fmt.spct(p.S / spot - 1, 1)})`;
    t2.textContent = `At expiry: ${fmt.usd(p.exp)}`;
    t2.setAttribute('fill', p.exp >= 0 ? 'var(--up)' : 'var(--down)');
    t3.textContent = Number.isFinite(p.t) ? `${tLabel}: ${fmt.usd(p.t)}` : '';
    t3.setAttribute('fill', 'var(--accent)');
  });
  svg.querySelector('.hit').addEventListener('mouseleave', () => g.setAttribute('visibility', 'hidden'));
}

// ---------- OI / volume by strike (calls up, puts down) ----------
export function strikeBars(el, rows, { spot, maxPain, mode = 'oi' } = {}) {
  const W = Math.max(320, el.clientWidth || 700), H = 240, m = { l: 48, r: 10, t: 12, b: 26 };
  const key = mode === 'oi' ? 'oi' : 'volume';
  const vals = rows.map(r => [r.call?.[key] || 0, r.put?.[key] || 0]);
  const max = Math.max(1, ...vals.flat());
  const n = rows.length;
  const bw = (W - m.l - m.r) / Math.max(n, 1);
  const mid = m.t + (H - m.t - m.b) / 2;
  const half = (H - m.t - m.b) / 2;
  const X = i => m.l + i * bw;
  const xOf = s => { const i = rows.findIndex(r => r.strike >= s); return i < 0 ? X(n) : X(i) + bw / 2; };
  const labelEvery = Math.ceil(n / 12);
  el.innerHTML = `<svg class="bars" width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <line class="zero" x1="${m.l}" x2="${W - m.r}" y1="${mid}" y2="${mid}"/>
    <text x="${m.l - 6}" y="${m.t + 10}" text-anchor="end">${fmt.big(max)}</text>
    <text x="${m.l - 6}" y="${mid - 4}" text-anchor="end" fill="var(--up)">Calls</text>
    <text x="${m.l - 6}" y="${mid + 14}" text-anchor="end" fill="var(--down)">Puts</text>
    ${rows.map((r, i) => {
      const hc = (vals[i][0] / max) * half, hp = (vals[i][1] / max) * half;
      return `<rect x="${X(i) + 1}" y="${mid - hc}" width="${Math.max(1, bw - 2)}" height="${hc}" fill="var(--up)" opacity=".75"><title>${r.strike} C ${key}: ${fmt.int(vals[i][0])}</title></rect>
        <rect x="${X(i) + 1}" y="${mid}" width="${Math.max(1, bw - 2)}" height="${hp}" fill="var(--down)" opacity=".75"><title>${r.strike} P ${key}: ${fmt.int(vals[i][1])}</title></rect>
        ${i % labelEvery === 0 ? `<text x="${X(i) + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(r.strike)}</text>` : ''}`;
    }).join('')}
    ${spot ? `<line x1="${xOf(spot)}" x2="${xOf(spot)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--accent)" stroke-width="1.5"/><text x="${xOf(spot) + 4}" y="${m.t + 10}" fill="var(--accent)">Spot</text>` : ''}
    ${maxPain ? `<line x1="${xOf(maxPain)}" x2="${xOf(maxPain)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--warn)" stroke-dasharray="4 3"/><text x="${xOf(maxPain) + 4}" y="${m.t + 24}" fill="var(--warn)">Max pain</text>` : ''}
  </svg>`;
}

export function niceTicks(lo, hi, count) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= step0) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toFixed(10));
  return out;
}
