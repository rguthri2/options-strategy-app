// Formatting + small DOM helpers shared by every view.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ok = v => typeof v === 'number' && Number.isFinite(v);
export const fmt = {
  px: (v, d) => (ok(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d ?? (Math.abs(v) >= 1000 ? 2 : 2), maximumFractionDigits: d ?? 2 }) : '—'),
  opt: v => (ok(v) ? v.toFixed(2) : '—'),
  pct: (v, d = 2) => (ok(v) ? `${(v * 100).toFixed(d)}%` : '—'),
  spct: (v, d = 2) => (ok(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '—'),
  schg: (v, d = 2) => (ok(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(d)}` : '—'),
  int: v => (ok(v) ? Math.round(v).toLocaleString('en-US') : '—'),
  big: v => {
    if (!ok(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  },
  usd: (v, d = 0) => {
    if (v === Infinity) return 'Unlimited';
    if (v === -Infinity) return '−Unlimited';
    return ok(v) ? `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}` : '—';
  },
  greek: (v, d = 3) => (ok(v) ? v.toFixed(d) : '—'),
  iv: v => (ok(v) ? `${(v * 100).toFixed(1)}%` : '—'),
  n: (v, d = 1) => (ok(v) ? v.toFixed(d) : '—'),
  ago: t => {
    if (!t) return 'never';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  },
};

// Round company logo (served by /api/logo). Until it loads, or when there is none, a colored
// letter avatar shows instead (main.js removes images that fail to load).
export function logo(sym, size = 24) {
  const s = String(sym || '').toUpperCase();
  const letter = s.replace(/^\$/, '').charAt(0) || '?';
  const hue = [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const img = /^[A-Z][A-Z0-9.]{0,9}$/.test(s) ? `<img src="api/logo/${encodeURIComponent(s)}?v=2" alt="" loading="lazy" decoding="async">` : '';
  return `<span class="sym-logo" style="--s:${size}px;--h:${hue}" data-l="${esc(letter)}" aria-hidden="true">${img}</span>`;
}

export const cls = v => (ok(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : '');

export function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, isErr ? 6000 : 3000);
}

export function scoreBar(score, bias = '') {
  return `<span class="score ${esc(bias)}"><span class="bar"><i style="width:${Math.max(0, Math.min(100, score))}%"></i></span><b>${Math.round(score)}</b></span>`;
}

export const biasPill = b => `<span class="pill ${esc(b)}">${b === 'bull' ? 'Bullish' : b === 'bear' ? 'Bearish' : 'Neutral'}</span>`;

export function ring(score) {
  const c = score >= 75 ? 'var(--up)' : score >= 55 ? 'var(--accent)' : score >= 40 ? 'var(--warn)' : 'var(--down)';
  return `<div class="ring" style="--p:${score};--c:${c}"><span>${Math.round(score)}</span></div>`;
}

// Sparkline SVG from numbers.
export function spark(values, { w = 90, h = 28, color } = {}) {
  const v = values.filter(ok);
  if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
  const col = color || (v[v.length - 1] >= v[0] ? 'var(--up)' : 'var(--down)');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${col}" stroke-width="1.6" points="${pts}"/></svg>`;
}

// Click-to-sort for tables rendered from data. `render(rows)` redraws the body.
export function sortable(table, rows, render, initial) {
  let key = initial?.key, dir = initial?.dir ?? -1;
  const apply = () => {
    const sorted = key ? [...rows].sort((a, b) => {
      const x = a[key], y = b[key];
      if (typeof x === 'string' || typeof y === 'string') return dir * String(x ?? '').localeCompare(String(y ?? ''));
      return dir * ((ok(x) ? x : -Infinity) - (ok(y) ? y : -Infinity));
    }) : rows;
    $$('th[data-sort]', table).forEach(th => {
      th.classList.toggle('sorted', th.dataset.sort === key);
      th.classList.toggle('asc', th.dataset.sort === key && dir === 1);
    });
    render(sorted);
  };
  $$('th[data-sort]', table).forEach(th => th.addEventListener('click', () => {
    if (key === th.dataset.sort) dir = -dir; else { key = th.dataset.sort; dir = -1; }
    apply();
  }));
  apply();
  return { update: r => { rows = r; apply(); } };
}

export const loading = (text = 'Loading…') => `<div class="empty"><span class="spin"></span> ${esc(text)}</div>`;

export function errorBox(e) {
  return `<div class="banner">⚠ ${esc(e.message || e)}</div>`;
}

// Session-scoped handoff between views (e.g. Ideas -> Builder).
export const handoff = {
  set(k, v) { try { sessionStorage.setItem('ot-' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  get(k) { try { return JSON.parse(sessionStorage.getItem('ot-' + k)); } catch { return null; } },
};

export const prefs = {
  get(k, d) { try { const v = localStorage.getItem('ot-p-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ot-p-' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
