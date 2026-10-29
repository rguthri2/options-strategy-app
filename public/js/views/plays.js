// Plays Log: every play sent to Telegram, filterable, downloadable as CSV, and one click to add to the watchlist.
import { api } from '../api.js';
import { esc, logo, fmt, loading, errorBox, toast, prefs } from '../ui.js';

const PERIODS = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['all', 'All']];
const TYPE_PILL = { 'post-close': 'info', 'pre-market': 'warn', 'a-plus': 'good', trigger: 'bull' };
const TYPE_SHORT = { 'post-close': 'Post-close', 'pre-market': 'Pre-market', 'a-plus': 'A+ alert', trigger: '🚀 Trigger' };

function nyToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); }
function daysAgo(n) { const d = new Date(nyToday() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); }

export async function render(root) {
  const st = { period: prefs.get('pl-period', '7'), type: '', q: '', plays: [], sel: new Set() };
  root.innerHTML = `
    <div class="page-h">
      <div style="flex:1"><h1>Plays Log</h1><div class="muted small">Every play the app sent to Telegram: post-close report, pre-market brief, A+ alerts and intraday triggers. Download it as CSV or add plays to your watchlist.</div></div>
      <button class="btn" id="tg" title="Send today's plays to Telegram as a CSV file">📎 Send today's CSV to Telegram</button>
      <a class="btn primary" id="dl" download>⭳ Download CSV</a>
    </div>
    <div class="card" style="margin-bottom:14px"><div class="row">
      <div class="seg" id="period">${PERIODS.map(([k, l]) => `<button data-v="${k}" class="${k === st.period ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="seg" id="type"><button data-v="" class="on">All alerts</button>${Object.entries(TYPE_SHORT).map(([k, l]) => `<button data-v="${k}">${l}</button>`).join('')}</div>
      <input id="q" type="text" placeholder="Filter symbol…" style="width:130px">
      <span class="spacer"></span><span id="meta" class="muted small"></span>
    </div></div>
    <div class="card pl-actions" id="actions" hidden><div class="row">
      <b id="selCount"></b><button class="btn primary sm" id="addWl">＋ Add to my watchlist</button><button class="btn sm ghost" id="clearSel">Clear selection</button>
      <span class="muted small">Adds each selected symbol once. Your watchlist appears in Chart Studio and on Home.</span>
    </div></div>
    <section class="card" style="padding:0"><div class="table-wrap" style="max-height:calc(100vh - 260px)"><table class="t" id="tbl"><thead><tr>
      <th><input type="checkbox" id="all" title="Select all shown"></th><th class="l">When (ET)</th><th class="l">Alert</th><th class="l">Symbol</th><th class="l">Setup</th><th class="l">Status</th>
      <th>Entry</th><th>Stop</th><th>2R</th><th>Score</th><th>RS</th><th class="l">Options</th><th></th>
    </tr></thead><tbody><tr><td colspan="13">${loading()}</td></tr></tbody></table></div></section>`;
  const $ = s => root.querySelector(s);

  const range = () => (st.period === 'all' ? {} : st.period === 'today' ? { from: nyToday(), to: nyToday() } : { from: daysAgo(Number(st.period)) });
  const qs = () => new URLSearchParams(Object.entries({ ...range(), type: st.type }).filter(([, v]) => v)).toString();
  const shown = () => st.plays.filter(p => !st.q || p.symbol.includes(st.q));

  const draw = () => {
    const rows = shown();
    const syms = new Set(rows.map(p => p.symbol));
    $('#meta').textContent = `${rows.length} play${rows.length === 1 ? '' : 's'} · ${syms.size} symbol${syms.size === 1 ? '' : 's'}`;
    $('#dl').href = `api/plays/export.csv?${qs()}`;
    $('#tbl tbody').innerHTML = rows.length ? rows.map((p, i) => {
      const id = `${p.at}|${p.symbol}|${p.type}|${i}`;
      return `<tr><td><input type="checkbox" data-sym="${esc(p.symbol)}" data-id="${esc(id)}" ${st.sel.has(id) ? 'checked' : ''}></td>
        <td class="l nowrap">${esc(p.date)} <span class="muted small">${esc(new Date(p.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }))}</span></td>
        <td class="l"><span class="pill ${TYPE_PILL[p.type] || ''}">${esc(TYPE_SHORT[p.type] || p.type)}</span></td>
        <td class="l"><div class="sym-cell">${logo(p.symbol)}<span class="sym">${esc(p.symbol)}</span><span class="muted">${esc(p.name || '')}</span></div></td>
        <td class="l small">${esc([p.trader, p.setup].filter(Boolean).join(' · '))}</td>
        <td class="l small">${esc(p.status)}${p.note ? `<div class="tiny muted">${esc(p.note)}</div>` : ''}</td>
        <td>${fmt.px(p.entry)}</td><td class="down">${fmt.px(p.stop)}${p.stopPct != null ? `<div class="tiny">${p.stopPct}%</div>` : ''}</td>
        <td class="up">${fmt.px(p.target1)}</td><td>${p.score ?? '—'}</td><td>${p.rs ?? '—'}</td>
        <td class="l small">${esc(p.strategy || '')}${p.ivRegime ? `<div class="tiny muted">IV ${esc(p.ivRegime)}</div>` : ''}</td>
        <td class="nowrap"><a class="btn sm" href="${p.setupKey ? `#/scanner?sym=${encodeURIComponent(p.symbol)}&setup=${encodeURIComponent(p.setupKey)}` : `#/t/${encodeURIComponent(p.symbol)}`}">Open</a></td></tr>`;
    }).join('') : `<tr><td colspan="13"><div class="empty">No plays in this period yet. They're logged automatically each time the app sends an alert to Telegram.</div></td></tr>`;
    syncSel();
  };
  const syncSel = () => {
    const syms = new Set([...root.querySelectorAll('#tbl tbody input:checked')].map(c => c.dataset.sym));
    $('#actions').hidden = !syms.size;
    $('#selCount').textContent = `${syms.size} symbol${syms.size === 1 ? '' : 's'} selected`;
    const boxes = [...root.querySelectorAll('#tbl tbody input[type=checkbox]')];
    $('#all').checked = boxes.length > 0 && boxes.every(b => b.checked);
  };
  const load = async () => {
    try { st.plays = (await api.get(`plays?${qs()}`)).plays; st.sel.clear(); draw(); }
    catch (e) { $('#tbl tbody').innerHTML = `<tr><td colspan="13">${errorBox(e)}</td></tr>`; }
  };

  const seg = (id, key, pref) => $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st[key] = b.dataset.v; if (pref) prefs.set(pref, st[key]);
    root.querySelectorAll(`${id} button`).forEach(x => x.classList.toggle('on', x === b)); load();
  });
  seg('#period', 'period', 'pl-period'); seg('#type', 'type');
  $('#q').addEventListener('input', e => { st.q = e.target.value.trim().toUpperCase(); draw(); });
  $('#tbl').addEventListener('change', e => {
    const c = e.target.closest('input[type=checkbox]'); if (!c) return;
    if (c.id === 'all') root.querySelectorAll('#tbl tbody input[type=checkbox]').forEach(b => { b.checked = c.checked; c.checked ? st.sel.add(b.dataset.id) : st.sel.delete(b.dataset.id); });
    else c.checked ? st.sel.add(c.dataset.id) : st.sel.delete(c.dataset.id);
    syncSel();
  });
  $('#clearSel').addEventListener('click', () => { st.sel.clear(); root.querySelectorAll('#tbl tbody input:checked').forEach(b => { b.checked = false; }); syncSel(); });
  $('#addWl').addEventListener('click', async e => {
    const symbols = [...new Set([...root.querySelectorAll('#tbl tbody input:checked')].map(c => c.dataset.sym))];
    e.target.disabled = true;
    try {
      const r = await api.post('plays/watchlist', { symbols });
      toast(r.added.length ? `Added ${r.added.join(', ')} to your watchlist (${r.watchlist.length}/50)` : 'Those symbols are already on your watchlist');
    } catch (err) { toast(err.message, true); }
    e.target.disabled = false;
  });
  $('#tg').addEventListener('click', async e => {
    e.target.disabled = true;
    try { const r = await api.post('plays/send-csv'); toast(r.sent ? "Today's plays CSV sent to Telegram" : 'Nothing to send: no plays today, or Telegram is not set up'); }
    catch (err) { toast(err.message, true); }
    e.target.disabled = false;
  });
  await load();
}
