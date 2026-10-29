import { api } from '../api.js';
import { esc, logo, fmt, cls, scoreBar, biasPill, loading, errorBox, sortable, toast, prefs } from '../ui.js';

export async function render(root, _p, query) {
  const state = { bias: query.bias || prefs.get('hl-bias', 'all'), setup: '', min: prefs.get('hl-min', 0), iv: 'all', q: '' };
  root.innerHTML = `
    <div class="page-h">
      <div style="flex:1"><h1>Swing Hot List</h1><div class="muted small">Ranked on trend template, relative strength, setup quality, volume and IV regime. <a href="#/playbook">Methodology</a></div></div>
      <span id="meta" class="muted small"></span>
      <button id="refresh" class="btn">↻ Rescan</button>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="row">
        <div class="seg" id="bias">${['all', 'bull', 'bear', 'neutral'].map(b => `<button data-v="${b}" class="${state.bias === b ? 'on' : ''}">${b === 'all' ? 'All' : b[0].toUpperCase() + b.slice(1)}</button>`).join('')}</div>
        <div class="seg" id="iv">${['all', 'cheap', 'fair', 'rich'].map(b => `<button data-v="${b}" class="${state.iv === b ? 'on' : ''}">${b === 'all' ? 'Any IV' : b === 'cheap' ? 'Cheap IV' : b === 'rich' ? 'Rich IV' : 'Fair IV'}</button>`).join('')}</div>
        <select id="setup"><option value="">All setups</option></select>
        <label class="row small muted">Min score <input id="min" type="range" min="0" max="90" step="5" value="${state.min}"><b id="minv">${state.min}</b></label>
        <input id="q" type="text" placeholder="Filter symbol…" style="width:140px">
      </div>
    </div>
    <div class="card" style="padding:0"><div class="table-wrap" style="max-height:calc(100vh - 290px)">
      <table class="t" id="tbl"><thead><tr>
        <th class="l" data-sort="symbol">Symbol</th><th data-sort="price">Price</th><th data-sort="changePct">Chg</th><th data-sort="score">Score</th>
        <th class="l" data-sort="bias">Bias</th><th class="l" data-sort="setup">Setup</th><th data-sort="trendTemplate" title="Minervini trend template criteria passed">Trend</th>
        <th data-sort="rsRating" title="IBD-style relative strength rating 1-99">RS</th><th data-sort="rsi">RSI</th><th data-sort="adx">ADX</th>
        <th data-sort="volRatio" title="Today's volume vs 50-day average">Vol×</th><th data-sort="atrPct">ATR%</th><th data-sort="iv">IV</th>
        <th data-sort="ivr" title="IV Rank (estimated from realized vol until 30 days of IV history exist)">IVR</th><th data-sort="ivHv">IV/HV</th>
        <th data-sort="earningsDays" title="Days until next earnings report">Earn</th>
        <th class="l">Suggested strategy</th><th title="Stop / 2R target">Stop · Target</th><th></th>
      </tr></thead><tbody><tr><td colspan="19">${loading('Scanning universe…')}</td></tr></tbody></table>
    </div></div>`;

  const tbody = root.querySelector('#tbl tbody');
  let all = [], sorter;

  const filtered = () => all.filter(r =>
    (state.bias === 'all' || r.bias === state.bias) && (!state.setup || r.setups.includes(state.setup)) &&
    r.score >= state.min && (state.iv === 'all' || r.ivRegime === state.iv) && (!state.q || r.symbol.includes(state.q)));

  const draw = rows => {
    const shown = rows.slice(0, 400);
    tbody.innerHTML = rows.length ? shown.map(r => `
      <tr class="clickable" data-s="${esc(r.symbol)}">
        <td class="l"><div class="sym-cell">${logo(r.symbol)}<span class="sym">${esc(r.symbol)}</span><span class="muted">${esc(r.name)}</span></div></td>
        <td>${fmt.px(r.price)}</td><td class="${cls(r.changePct)}">${fmt.spct(r.changePct)}</td>
        <td>${scoreBar(r.score, r.bias)}</td><td class="l">${biasPill(r.bias)}</td>
        <td class="l">${esc(r.setup)}${r.squeezeOn ? ' <span class="pill warn" title="Bollinger inside Keltner">SQZ</span>' : ''}</td>
        <td title="${esc(r.trendChecks.map(c => (c.pass ? '✓ ' : '✕ ') + c.label).join('\n'))}">${r.trendTemplate}/8</td>
        <td>${r.rsRating}</td><td>${fmt.n(r.rsi, 0)}</td><td>${fmt.n(r.adx, 0)}</td>
        <td class="${r.volRatio >= 1.5 ? 'up' : ''}">${fmt.n(r.volRatio, 2)}</td><td>${fmt.pct(r.atrPct, 1)}</td>
        <td>${fmt.iv(r.iv)}</td><td title="${r.ivSource === 'history' ? 'True IV Rank' : 'Estimated from realized vol'}">${fmt.n(r.ivr, 0)}${r.ivSource === 'hv-proxy' ? '<span class="faint">*</span>' : ''}</td>
        <td class="${r.ivHv >= 1.25 ? 'down' : r.ivHv < 0.95 ? 'up' : ''}">${fmt.n(r.ivHv, 2)}</td>
        <td title="${r.earnings ? esc(`${r.earnings.date} ${r.earnings.hour || ''}`) : 'No report scheduled / no data'}">${r.earnings ? (r.earnings.days <= 14 ? `<span class="pill warn">${r.earnings.days}d</span>` : `${r.earnings.days}d`) : '<span class="faint">—</span>'}</td>
        <td class="l small">${esc(r.strategy)}</td>
        <td class="small">${fmt.px(r.plan.stop)} · ${fmt.px(r.plan.target1)}</td>
        <td><a class="btn sm" href="#/options/${esc(r.symbol)}" data-stop>Chain</a></td>
      </tr>`).join('') + (rows.length > 400 ? `<tr><td colspan="19" class="muted small center">Showing the top 400 of ${rows.length}. Filter or sort to see others.</td></tr>` : '') : '<tr><td colspan="19"><div class="empty">No symbols match these filters.</div></td></tr>';
  };

  const load = async () => {
    try {
      const h = await api.get('hotlist');
      all = h.rows;
      root.querySelector('#meta').textContent = h.updated ? `${h.rows.length} symbols · ${h.provider} · updated ${fmt.ago(h.updated)}` : 'First scan running…';
      const setups = [...new Set(all.flatMap(r => r.setups))].sort();
      const sel = root.querySelector('#setup');
      sel.innerHTML = '<option value="">All setups</option>' + setups.map(s => `<option ${s === state.setup ? 'selected' : ''}>${esc(s)}</option>`).join('');
      if (sorter) sorter.update(filtered());
      else sorter = sortable(root.querySelector('#tbl'), filtered(), draw, { key: 'score', dir: -1 });
    } catch (e) { tbody.innerHTML = `<tr><td colspan="19">${errorBox(e)}</td></tr>`; }
  };

  const update = () => sorter?.update(filtered());
  root.querySelector('#bias').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.bias = b.dataset.v; prefs.set('hl-bias', state.bias);
    root.querySelectorAll('#bias button').forEach(x => x.classList.toggle('on', x === b)); update();
  });
  root.querySelector('#iv').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.iv = b.dataset.v; root.querySelectorAll('#iv button').forEach(x => x.classList.toggle('on', x === b)); update();
  });
  root.querySelector('#setup').addEventListener('change', e => { state.setup = e.target.value; update(); });
  root.querySelector('#min').addEventListener('input', e => { state.min = Number(e.target.value); root.querySelector('#minv').textContent = state.min; prefs.set('hl-min', state.min); update(); });
  root.querySelector('#q').addEventListener('input', e => { state.q = e.target.value.trim().toUpperCase(); update(); });
  tbody.addEventListener('click', e => {
    if (e.target.closest('[data-stop]')) return;
    const tr = e.target.closest('tr[data-s]'); if (tr) location.hash = `#/t/${tr.dataset.s}`;
  });
  root.querySelector('#refresh').addEventListener('click', async e => {
    e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span> Scanning…';
    try { await api.post('hotlist/refresh'); await load(); toast('Hot list rescanned'); } catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = '↻ Rescan';
  });

  await load();
  const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
  return () => clearInterval(t);
}
