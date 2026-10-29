// TradingView-style drawing tools on an SVG layer over a Lightweight Charts pane.
// Anchors are stored as { t: epoch seconds (UTC bar time), p: price }, so drawings stay put across
// zoom, scroll and interval changes. Tools: trend line, ray, horizontal line, Fibonacci, rectangle, text.
const NS = 'http://www.w3.org/2000/svg';
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const DRAW_COLORS = ['#2962ff', '#f23645', '#089981', '#ff9800', '#9c27b0', '#787b86'];
const NEED = { trend: 2, ray: 2, fib: 2, rect: 2, hline: 1, text: 1 };

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const uid = () => Math.random().toString(36).slice(2, 10);

export class DrawingLayer {
  // opts: { host, chart, series(), timeToLogical(t), logicalToTime(l), barAt(logical) -> bar|null, onChange(list), onSelect(d|null) }
  constructor(opts) {
    Object.assign(this, opts);
    this.list = []; this.tool = 'cursor'; this.draft = null; this.sel = null; this.drag = null;
    this.svg = el('svg', { class: 'tv-draw' });
    this.host.appendChild(this.svg);
    this.svg.addEventListener('pointerdown', e => this.down(e));
    this.svg.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', this._up = e => this.up(e));
    window.addEventListener('keydown', this._key = e => this.key(e));
    const ts = this.chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(this._redraw = () => this.redraw());
    this.chart.subscribeCrosshairMove(this._redraw);
    this.ro = new ResizeObserver(this._redraw); this.ro.observe(this.host);
  }

  destroy() {
    try { this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this._redraw); this.chart.unsubscribeCrosshairMove(this._redraw); } catch { /* chart gone */ }
    this.ro.disconnect(); window.removeEventListener('pointerup', this._up); window.removeEventListener('keydown', this._key);
    this.svg.remove();
  }

  set(list) { this.list = list.map(d => ({ ...d })); this.sel = null; this.redraw(); }
  setTool(tool) { this.tool = tool; this.draft = null; this.svg.classList.toggle('drawing', tool !== 'cursor'); this.redraw(); }
  changed() { this.onChange?.(this.list); }
  select(d) { this.sel = d; this.onSelect?.(d); this.redraw(); }
  removeSelected() { if (!this.sel) return; this.list = this.list.filter(d => d !== this.sel); this.select(null); this.changed(); }
  setColor(c) { if (this.sel) { this.sel.color = c; this.redraw(); this.changed(); } }
  clear() { this.list = []; this.select(null); this.changed(); }

  // ---------- coordinates ----------
  xy(pt) {
    const x = this.chart.timeScale().logicalToCoordinate(this.timeToLogical(pt.t));
    const y = this.series().priceToCoordinate(pt.p);
    return x == null || y == null ? null : { x, y };
  }
  pointAt(e, magnet = true) {
    const r = this.svg.getBoundingClientRect(), x = e.clientX - r.left;
    let y = e.clientY - r.top;
    const logical = this.chart.timeScale().coordinateToLogical(x);
    if (logical == null) return null;
    let p = this.series().coordinateToPrice(y);
    // Magnet: snap to the nearest open/high/low/close within 10px, like TradingView's weak magnet.
    const bar = magnet ? this.barAt(Math.round(logical)) : null;
    if (bar) {
      let best = null;
      for (const v of [bar.o, bar.h, bar.l, bar.c]) {
        const vy = this.series().priceToCoordinate(v);
        if (vy != null && Math.abs(vy - y) < 10 && (!best || Math.abs(vy - y) < best.d)) best = { v, d: Math.abs(vy - y) };
      }
      if (best) { p = best.v; y = this.series().priceToCoordinate(p); }
    }
    if (p == null) return null;
    return { t: Math.round(this.logicalToTime(bar ? Math.round(logical) : logical)), p };
  }

  // ---------- pointer ----------
  down(e) {
    if (this.tool === 'cursor') return;
    e.preventDefault();
    const pt = this.pointAt(e);
    if (!pt) return;
    if (!this.draft) {
      this.draft = { id: uid(), type: this.tool, color: DRAW_COLORS[0], points: [pt] };
      if (NEED[this.tool] === 1) return this.finish();
      this.draft.points.push({ ...pt });
    } else {
      this.draft.points[1] = pt;
      this.finish();
    }
    this.redraw();
  }
  finish() {
    const d = this.draft;
    this.draft = null;
    if (d.type === 'text') {
      const text = prompt('Text', '');
      if (!text) { this.setTool('cursor'); this.onToolDone?.(); return; }
      d.text = text.slice(0, 120);
    }
    if (NEED[d.type] === 2 && d.points[0].t === d.points[1].t && d.points[0].p === d.points[1].p) return this.redraw();
    this.list.push(d);
    this.setTool('cursor'); this.onToolDone?.();
    this.select(d); this.changed();
  }
  move(e) {
    if (this.drag) {
      const pt = this.pointAt(e, !e.altKey);
      if (!pt) return;
      const d = this.drag.d;
      if (this.drag.handle >= 0) d.points[this.drag.handle] = pt;
      else {
        // Move the whole drawing by the time/price offset from where the drag started.
        const dt = pt.t - this.drag.start.t, dp = pt.p - this.drag.start.p;
        d.points = this.drag.orig.map(q => ({ t: q.t + dt, p: q.p + dp }));
      }
      this.redraw();
      return;
    }
    if (this.draft) { const pt = this.pointAt(e); if (pt) { this.draft.points[1] = pt; this.redraw(); } }
  }
  up() { if (this.drag) { this.drag = null; this.changed(); } }
  key(e) {
    if (e.target.closest?.('input, textarea, select')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.removeSelected(); }
    if (e.key === 'Escape') { if (this.draft || this.tool !== 'cursor') { this.setTool('cursor'); this.onToolDone?.(); } else this.select(null); }
  }
  startDrag(e, d, handle) {
    e.stopPropagation(); e.preventDefault();
    if (this.tool !== 'cursor') return;
    if (this.sel !== d) this.select(d);
    const pt = this.pointAt(e, false);
    if (pt) this.drag = { d, handle, start: pt, orig: d.points.map(p => ({ ...p })) };
  }

  // ---------- render ----------
  redraw() {
    const svg = this.svg;
    while (svg.firstChild) svg.firstChild.remove();
    const W = this.chart.timeScale().width();
    const H = this.chart.panes?.()[0]?.getHeight?.() ?? svg.clientHeight;
    svg.setAttribute('width', svg.clientWidth); svg.setAttribute('height', svg.clientHeight);
    const defs = el('defs', {}, svg), clip = el('clipPath', { id: 'tvclip' }, defs);
    el('rect', { x: 0, y: 0, width: W, height: H }, clip);
    const g = el('g', { 'clip-path': 'url(#tvclip)' }, svg);
    for (const d of [...this.list, ...(this.draft ? [this.draft] : [])]) this.draw(g, d, W, H);
  }

  draw(g, d, W, H) {
    const a = this.xy(d.points[0]), b = d.points[1] ? this.xy(d.points[1]) : null;
    if (!a || (NEED[d.type] === 2 && !b)) return;
    const c = d.color, selected = d === this.sel;
    const grp = el('g', { class: 'tv-shape' }, g);
    const hit = (shape) => { shape.addEventListener('pointerdown', e => this.startDrag(e, d, -1)); return shape; };
    const line = (x1, y1, x2, y2, extra = {}) => {
      el('line', { x1, y1, x2, y2, stroke: c, 'stroke-width': selected ? 2 : 1.6, ...extra }, grp);
      hit(el('line', { x1, y1, x2, y2, class: 'tv-hit' }, grp));
    };
    const label = (x, y, text, anchor = 'start') => {
      const t = el('text', { x, y, fill: c, 'font-size': 11, 'text-anchor': anchor, 'dominant-baseline': 'middle', class: 'tv-label' }, grp);
      t.textContent = text;
    };
    const fmtP = p => (Math.abs(p) >= 1000 ? p.toFixed(1) : p.toFixed(2));
    switch (d.type) {
      case 'trend': line(a.x, a.y, b.x, b.y); break;
      case 'ray': {
        const dx = b.x - a.x, dy = b.y - a.y;
        const k = dx === 0 ? 0 : ((dx > 0 ? W : 0) - a.x) / dx;
        line(a.x, a.y, dx === 0 ? b.x : a.x + dx * Math.max(1, k), dx === 0 ? b.y : a.y + dy * Math.max(1, k));
        break;
      }
      case 'hline': line(0, a.y, W, a.y); label(W - 4, a.y - 8, fmtP(d.points[0].p), 'end'); break;
      case 'rect': {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        hit(el('rect', { x, y, width: w, height: h, fill: c, 'fill-opacity': 0.12, stroke: c, 'stroke-width': selected ? 2 : 1.2 }, grp));
        break;
      }
      case 'fib': {
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
        const p1 = d.points[0].p, p2 = d.points[1].p;
        for (const lv of FIB) {
          const price = p2 + (p1 - p2) * lv, y = this.series().priceToCoordinate(price);
          if (y == null) continue;
          line(x1, y, x2, y, { 'stroke-opacity': lv === 0 || lv === 1 ? 1 : 0.75 });
          label(x2 + 4, y, `${lv} (${fmtP(price)})`);
        }
        el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: c, 'stroke-width': 1, 'stroke-dasharray': '4 4' }, grp);
        break;
      }
      case 'text': {
        const t = el('text', { x: a.x, y: a.y, fill: c, 'font-size': 13, 'font-weight': 600, 'dominant-baseline': 'middle', class: 'tv-text' }, grp);
        t.textContent = d.text || '';
        hit(t);
        break;
      }
    }
    if (selected) {
      for (const [i, pt] of (d.type === 'hline' || d.type === 'text' ? [a] : [a, b]).entries()) {
        const h = el('circle', { cx: pt.x, cy: pt.y, r: 5, fill: 'var(--panel)', stroke: c, 'stroke-width': 2, class: 'tv-handle' }, grp);
        h.addEventListener('pointerdown', e => this.startDrag(e, d, i));
      }
    }
  }
}
