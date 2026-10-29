import { api } from './api.js';
import { $, $$, esc, logo, fmt, cls, spark, toast } from './ui.js';

const ROUTES = [
  [/^\/?$/, 'home', () => import('./views/home.js')],
  [/^\/hotlist$/, 'hotlist', () => import('./views/hotlist.js')],
  [/^\/scanner$/, 'scanner', () => import('./views/scanner.js')],
  [/^\/plays$/, 'plays', () => import('./views/plays.js')],
  [/^\/t\/([^/]+)$/, 'ticker', () => import('./views/ticker.js')],
  [/^\/options(?:\/([^/]+))?$/, 'options', () => import('./views/options.js')],
  [/^\/chart(?:\/([^/]+))?$/, 'chart', () => import('./views/chart.js')],
  [/^\/lab(?:\/([^/]+))?$/, 'lab', () => import('./views/lab.js')],
  [/^\/earnings$/, 'earnings', () => import('./views/earnings.js')],
  [/^\/ideas$/, 'ideas', () => import('./views/ideas.js')],
  [/^\/builder$/, 'builder', () => import('./views/builder.js')],
  [/^\/positions$/, 'positions', () => import('./views/positions.js')],
  [/^\/journal$/, 'journal', () => import('./views/journal.js')],
  [/^\/playbook$/, 'playbook', () => import('./views/playbook.js')],
  [/^\/settings$/, 'settings', () => import('./views/settings.js')],
];

let cleanup = null;
let navSeq = 0;

export function go(hash) { location.hash = hash; }

async function route() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const match = ROUTES.map(([re, name, load]) => ({ m: path.match(re), name, load })).find(r => r.m);
  const seq = ++navSeq;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const app = $('#app');
  if (!match) { app.innerHTML = '<div class="empty">Page not found. <a href="#/">Go home</a></div>'; return; }
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === match.name || (match.name === 'ticker' && a.dataset.route === 'home')));
  // Each page renders into its own container. If you navigate away while a page is still loading,
  // that page keeps working on its detached container (harmless) instead of the new page's DOM,
  // its timers are stopped as soon as it finishes, and its errors are not shown over the new page.
  app.innerHTML = '';
  const view = document.createElement('div');
  app.appendChild(view);
  window.scrollTo(0, 0);
  try {
    const mod = await match.load();
    if (seq !== navSeq) return;
    const params = match.m.slice(1).map(p => (p ? decodeURIComponent(p).toUpperCase() : p));
    const done = (await mod.render(view, params, query)) || null;
    if (seq !== navSeq) { try { done?.(); } catch { /* ignore */ } return; }
    cleanup = done;
  } catch (e) {
    if (seq !== navSeq) return;
    console.error(e);
    view.innerHTML = `<div class="banner">⚠ ${esc(e.message)}</div>`;
  }
}

// ---------- header: status, indices, search ----------
async function refreshStatus() {
  try {
    const s = await api.get('status');
    const b = $('#provider-badge');
    const live = s.provider !== 'demo' && !s.sandbox;
    b.textContent = s.provider === 'schwab' ? 'SCHWAB LIVE'
      : s.provider === 'tradier' ? (s.lastError ? 'TRADIER ERROR' : s.sandbox ? 'TRADIER · 15-MIN DELAYED' : 'TRADIER LIVE')
      : s.provider === 'etrade' ? (s.sandbox ? 'E*TRADE SANDBOX' : 'E*TRADE LIVE')
      : s.etrade?.configured ? 'DEMO · CONNECT E*TRADE' : 'DEMO DATA';
    b.className = 'badge' + (live && !s.lastError ? ' live' : '');
    b.title = s.lastError || (live ? 'Real-time market data' : s.provider === 'tradier' ? 'Tradier sandbox: real market data, delayed 15 minutes'
      : s.sandbox ? 'E*TRADE sandbox returns sample data only' : 'Simulated data. Connect a data source in Settings.');
    if (s.provider === 'etrade' && s.sessionExpiresAt) b.title += ` · session ends ${new Date(s.sessionExpiresAt).toLocaleString()}`;
    if (live && s.refreshExpiresAt && s.refreshExpiresAt - Date.now() < 36 * 3600000) {
      b.textContent = 'RECONNECT SOON';
      b.className = 'badge';
      b.title = 'Schwab refresh token expires within 36h. Reconnect in Settings.';
    }
  } catch { /* ignore */ }
}

function sessionLabel() {
  const now = new Date();
  const fmtNY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', weekday: 'short', hour12: false });
  const parts = Object.fromEntries(fmtNY.formatToParts(now).map(p => [p.type, p.value]));
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const wk = !['Sat', 'Sun'].includes(parts.weekday);
  const s = !wk ? 'closed' : mins >= 570 && mins < 960 ? 'open' : mins >= 240 && mins < 570 ? 'pre' : mins >= 960 && mins < 1200 ? 'post' : 'closed';
  const el = $('#session');
  el.className = 'session ' + s;
  el.querySelector('span').textContent = { open: 'Market open', pre: 'Pre-market', post: 'After hours', closed: 'Market closed' }[s];
}

const sparkCache = {};
async function refreshIndices() {
  try {
    const list = await api.get('indices');
    const strip = $('#index-strip');
    strip.innerHTML = list.map(q => `
      <a class="index-chip" href="#/t/${encodeURIComponent(q.symbol)}">
        ${logo(q.symbol, 26)}<div><div class="nm">${esc(q.name)}</div><div class="px">${fmt.px(q.last)}</div></div>
        <span class="spark-slot" data-s="${esc(q.symbol)}">${sparkCache[q.symbol] || ''}</span>
        <div class="right"><div class="pct ${cls(q.changePct)}">${fmt.spct(q.changePct)}</div><div class="tiny ${cls(q.change)}">${fmt.schg(q.change)}</div></div>
      </a>`).join('');
  } catch { /* ignore */ }
}

async function refreshSparks() {
  try {
    const list = await api.get('indices');
    await Promise.all(list.map(async q => {
      const h = await api.get(`history/${encodeURIComponent(q.symbol)}?range=1D`).catch(() => []);
      sparkCache[q.symbol] = spark(h.map(c => c.c), { w: 70, h: 26, color: q.changePct >= 0 ? 'var(--up)' : 'var(--down)' });
      const slot = document.querySelector(`.spark-slot[data-s="${CSS.escape(q.symbol)}"]`);
      if (slot) slot.innerHTML = sparkCache[q.symbol];
    }));
  } catch { /* ignore */ }
}

function setupSearch() {
  const input = $('#search'), box = $('#search-results');
  let items = [], active = -1, t;
  const open = sym => { input.value = ''; box.hidden = true; input.blur(); go(`/t/${encodeURIComponent(sym)}`); };
  const draw = () => {
    box.innerHTML = items.map((r, i) => `<a href="#/t/${encodeURIComponent(r.symbol)}" class="${i === active ? 'active' : ''}" data-s="${esc(r.symbol)}">${logo(r.symbol, 22)}<b>${esc(r.symbol)}</b><span class="muted">${esc(r.name)}</span></a>`).join('');
    box.hidden = !items.length;
  };
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (!q) { items = []; draw(); return; }
    t = setTimeout(async () => {
      items = await api.get(`search?q=${encodeURIComponent(q)}`).catch(() => []);
      if (!items.find(i => i.symbol === q.toUpperCase()) && /^[A-Za-z.]{1,6}$/.test(q)) items.unshift({ symbol: q.toUpperCase(), name: 'Open ticker' });
      active = 0; draw();
    }, 160);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { const s = items[active]?.symbol || input.value.trim().toUpperCase(); if (s) open(s); }
    else if (e.key === 'Escape') { box.hidden = true; input.blur(); }
  });
  box.addEventListener('click', e => { const a = e.target.closest('a'); if (a) { e.preventDefault(); open(a.dataset.s); } });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) box.hidden = true; });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
  });
}

function setupTheme() {
  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', cur);
    try { localStorage.setItem('ot-theme', cur); } catch { /* ignore */ }
    route();
  });
}

async function setupAuth() {
  const me = await fetch('api/me').then(r => r.json()).catch(() => ({}));
  const btn = $('#logout');
  btn.hidden = !me.authEnabled;
  btn.addEventListener('click', async () => { await api.post('logout'); location.href = 'login.html'; });
}

// Logos: drop images that 404 so the letter avatar underneath shows (inline onerror is blocked by the CSP).
document.addEventListener('error', e => {
  const t = e.target;
  if (t?.tagName === 'IMG' && t.parentElement?.classList.contains('sym-logo')) t.remove();
}, true);

window.__otStarted = true; // tells the startup watchdog in theme.js that the app loaded
window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', e => toast(e.reason?.message || 'Request failed', true));

setupSearch();
setupTheme();
setupAuth();
sessionLabel();
refreshStatus();
refreshIndices().then(refreshSparks);
setInterval(sessionLabel, 30000);
setInterval(refreshStatus, 60000);
setInterval(() => { if (!document.hidden) refreshIndices(); }, 20000);
setInterval(() => { if (!document.hidden) refreshSparks(); }, 180000);
route();
