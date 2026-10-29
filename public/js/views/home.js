import { api } from '../api.js';
import { esc, logo, fmt, cls, scoreBar, biasPill, loading, errorBox, spark } from '../ui.js';
import { ideaCard, bindIdeaActions } from './ideas.js';
import { marketClock } from '../../shared/marketCalendar.js';

export async function render(root) {
  root.innerHTML = `
    <div class="page-h"><h1>Market overview</h1><span id="scan-meta" class="muted small"></span></div>
    <section class="mclock" id="mclock" aria-live="off"></section>
    <div id="banner"></div>
    <div class="grid main-side">
      <div class="stack">
        <div class="grid g2">
          <section class="card"><div class="card-h"><h2>🔥 Top bullish swings</h2><a href="#/hotlist?bias=bull" class="small">View all</a></div><div id="bull">${loading()}</div></section>
          <section class="card"><div class="card-h"><h2>🧊 Top bearish swings</h2><a href="#/hotlist?bias=bear" class="small">View all</a></div><div id="bear">${loading()}</div></section>
        </div>
        <section><div class="card-h"><h2>Best trade ideas right now</h2><a href="#/ideas" class="small">All ideas</a></div><div id="ideas" class="ideas-grid">${loading()}</div></section>
      </div>
      <aside class="stack">
        <section class="card"><div class="card-h"><h2>Position alerts</h2><a href="#/positions" class="small">Positions</a></div><div id="alerts">${loading()}</div></section>
        <section class="card"><div class="card-h"><h2>Watchlist</h2><a href="#/settings" class="small">Edit</a></div><div id="watch">${loading()}</div></section>
        <section class="card"><div class="card-h"><h2>Volatility regime</h2></div><div id="regime">${loading()}</div></section>
      </aside>
    </div>`;

  const clockEl = root.querySelector('#mclock');
  drawClock(clockEl);
  const ct = setInterval(() => drawClock(clockEl), 1000);

  const [status, cfg] = await Promise.all([api.get('status').catch(() => null), api.get('settings').catch(() => null)]);
  let banners = '';
  if (cfg && !cfg.account.configured) {
    banners += `<div class="banner">Set your <b>account size and risk per trade</b> in <a href="#/settings">Settings</a>. Contract sizing on every idea uses them (currently the $100k / 2% defaults).</div>`;
  }
  if (status?.provider === 'demo') {
    banners += `<div class="banner info">You're viewing <b>simulated demo data</b> (realistic Black-Scholes chains). Add your Schwab API keys and connect in <a href="#/settings">Settings</a> for real-time quotes, Greeks and open interest.</div>`;
  }
  root.querySelector('#banner').innerHTML = banners;

  const loadHot = async () => {
    try {
      const h = await api.get('hotlist');
      root.querySelector('#scan-meta').textContent = h.updated ? `Scanned ${h.rows.length} symbols · ${fmt.ago(h.updated)}` : 'First scan running…';
      const mini = rows => rows.length ? `<table class="t"><thead><tr><th class="l">Symbol</th><th>Price</th><th>Chg</th><th class="l">Setup</th><th>Score</th></tr></thead><tbody>
        ${rows.map(r => `<tr class="clickable" data-href="#/t/${esc(r.symbol)}"><td class="l"><span class="sym-inline">${logo(r.symbol, 22)}<span class="sym">${esc(r.symbol)}</span></span></td><td>${fmt.px(r.price)}</td>
        <td class="${cls(r.changePct)}">${fmt.spct(r.changePct)}</td><td class="l small">${esc(r.setup)}</td><td>${scoreBar(r.score, r.bias)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No qualifying setups</div>';
      root.querySelector('#bull').innerHTML = mini(h.rows.filter(r => r.bias === 'bull').slice(0, 8));
      root.querySelector('#bear').innerHTML = mini(h.rows.filter(r => r.bias === 'bear').slice(0, 8));
      const rich = h.rows.filter(r => r.ivRegime === 'rich').length, cheap = h.rows.filter(r => r.ivRegime === 'cheap').length;
      const bulls = h.rows.filter(r => r.bias === 'bull').length, bears = h.rows.filter(r => r.bias === 'bear').length;
      const breadth = h.rows.filter(r => r.price > r.sma50).length / Math.max(1, h.rows.length);
      root.querySelector('#regime').innerHTML = `<div class="kv">
        <div>Above 50-day SMA</div><div class="${breadth >= 0.5 ? 'up' : 'down'}">${fmt.pct(breadth, 0)}</div>
        <div>Bullish / bearish setups</div><div><span class="up">${bulls}</span> / <span class="down">${bears}</span></div>
        <div>Rich IV (sell premium)</div><div>${rich}</div>
        <div>Cheap IV (buy premium)</div><div>${cheap}</div></div>
        <p class="help">${breadth >= 0.6 ? 'Broad strength: favor bullish debit spreads and long calls on leaders; sell puts on pullbacks.' : breadth <= 0.4 ? 'Weak breadth: favor bearish spreads and defined-risk hedges; reduce long exposure.' : 'Mixed tape: be selective, lean on defined-risk and neutral premium selling.'}</p>`;
      root.querySelectorAll('tr[data-href]').forEach(tr => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
    } catch (e) { root.querySelector('#bull').innerHTML = errorBox(e); }
  };

  const loadIdeas = async () => {
    try {
      const { ideas } = await api.get('ideas');
      const el = root.querySelector('#ideas');
      el.innerHTML = ideas.length ? ideas.slice(0, 6).map(ideaCard).join('') : '<div class="card empty">Ideas appear after the first scan completes.</div>';
      bindIdeaActions(el, ideas);
    } catch (e) { root.querySelector('#ideas').innerHTML = errorBox(e); }
  };

  const loadSide = async () => {
    try {
      const [settings, positions] = await Promise.all([api.get('settings'), api.get('positions')]);
      const alerts = positions.filter(p => p.status === 'open').flatMap(p => p.alerts.map(a => ({ ...a, p })));
      root.querySelector('#alerts').innerHTML = alerts.length
        ? `<div class="alerts">${alerts.map(a => `<div><span class="pill ${a.level}">${esc(a.p.symbol)}</span> <span class="small">${esc(a.text)}</span></div>`).join('')}</div>`
        : `<div class="muted small">${positions.some(p => p.status === 'open') ? 'All positions within plan.' : 'No tracked positions yet. Track one from Trade Ideas or the Builder.'}</div>`;
      const q = await api.get(`quotes?symbols=${settings.watchlist.map(encodeURIComponent).join(',')}`);
      const hist = await Promise.all(settings.watchlist.map(s => api.get(`history/${encodeURIComponent(s)}?range=1M`).catch(() => [])));
      root.querySelector('#watch').innerHTML = `<table class="t"><tbody>${settings.watchlist.map((s, i) => {
        const x = q[s] || {};
        return `<tr class="clickable" data-href="#/t/${esc(s)}"><td class="l"><div class="sym-cell">${logo(s)}<span class="sym">${esc(s)}</span><span class="muted">${esc(x.name || '')}</span></div></td>
          <td>${spark(hist[i].map(c => c.c), { w: 64, h: 22 })}</td>
          <td><div>${fmt.px(x.last)}</div><div class="tiny ${cls(x.changePct)}">${fmt.spct(x.changePct)}</div></td></tr>`;
      }).join('')}</tbody></table>`;
      root.querySelectorAll('#watch tr[data-href]').forEach(tr => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
    } catch (e) { root.querySelector('#watch').innerHTML = errorBox(e); }
  };

  loadHot(); loadIdeas(); loadSide();
  const t = setInterval(() => { if (!document.hidden) { loadHot(); loadSide(); } }, 30000);
  return () => { clearInterval(t); clearInterval(ct); };
}

// ---------- oversized market clock: time to the open, or to the close during the session ----------
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const ETDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' });
const ETWHEN = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const pad = n => String(n).padStart(2, '0');
function countdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400);
  const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return d ? `<span class="mc-days">${d}d</span> ${hms}` : hms;
}
function drawClock(el) {
  if (!el) return;
  const now = Date.now(), c = marketClock(now);
  const open = c.state === 'open';
  const stateLabel = { open: 'Market open', pre: 'Pre-market', post: 'After hours', closed: c.holiday ? `Closed: ${c.holiday}` : 'Market closed' }[c.state];
  const target = open ? c.closeAt : c.nextOpen;
  const sub = open
    ? `Closes ${c.earlyClose ? '<b>early</b> at 1:00 PM' : 'at 4:00 PM'} ET today${c.earlyClose ? ` (${esc(c.earlyClose)})` : ''}`
    : `Opens ${esc(ETWHEN.format(target))} ET${c.nextOpenEarlyClose ? ' · early close at 1:00 PM that day' : ''}`;
  const pct = open ? Math.round(c.sessionProgress * 100) : null;
  // Compact status bar (Webull-sized): state · countdown · session progress · New York time.
  el.className = `mclock ${c.state}`;
  el.innerHTML = `
    <div class="mc-state"><i></i>${esc(stateLabel)}</div>
    <div class="mc-count"><span class="mc-label">${open ? 'Closes in' : 'Opens in'}</span><span class="mc-digits">${countdown(target - now)}</span></div>
    ${open ? `<div class="mc-prog" title="${pct}% of the session"><div class="mc-bar"><div style="width:${pct}%"></div></div><span>${pct}%</span></div>` : ''}
    <div class="mc-sub">${sub}</div>
    <div class="mc-now">${esc(ET.format(now))} ET <span>· ${esc(ETDAY.format(now))}</span></div>`;
}
