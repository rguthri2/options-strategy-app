import { api } from '../api.js';
import { esc, logo, fmt, cls, loading, errorBox, sortable, toast, prefs, handoff } from '../ui.js';

const TRADERS = ['All', 'Qullamaggie', 'Minervini', "O'Neil", 'Weinstein'];
const STATUSES = [['all', 'All'], ['breakout', 'Breakout / EP today'], ['zone', 'In buy zone'], ['setting', 'Setting up']];
const statusRank = s => (/breakout today|EP today/.test(s) ? 0 : /buy zone|holding/.test(s) ? 1 : /setting/.test(s) ? 2 : 3);
const gl = v => (v === 'pass' ? '<span class="up">✓</span>' : v === 'fail' ? '<span class="down">✕</span>' : '<span class="faint">·</span>');
const grade = c => (c ? `<span title="${esc((c.notes || []).join(' · '))}">${gl(c.C)} ${gl(c.A)}</span>` : '<span class="faint">—</span>');
const regimeCls = s => ({ uptrend: 'good', 'under pressure': 'warn', correction: 'bad' }[s] || 'info');

export async function render(root, _params, query = {}) {
  const st = { trader: prefs.get('sc-trader', 'All'), status: prefs.get('sc-status', 'all'), bears: false, q: '' };
  root.innerHTML = `
    <div class="page-h">
      <div style="flex:1"><h1>Daily Scanner</h1><div class="muted small">Qullamaggie · Minervini · O'Neil · Weinstein setups across the full optionable market, with each trader's own entry, stop and targets.</div></div>
      <span id="meta" class="muted small"></span>
      <button class="btn" id="brief" title="Send the pre-market brief to Telegram now">☀ Send brief</button>
      <button class="btn primary" id="post" title="Update bars, rescan everything, send the post-close report">↻ Full scan</button>
    </div>
    <div class="grid g2" style="margin-bottom:14px">
      <section class="card" id="regime">${loading()}</section>
      <section class="card"><div class="card-h"><h2>Armed triggers</h2><span class="muted small">Alerted when price clears the pivot on ≥ 1.3× volume pace</span></div><div id="triggers">${loading()}</div></section>
    </div>
    <div class="card" style="margin-bottom:14px"><div class="row">
      <div class="seg" id="trader">${TRADERS.map(t => `<button data-v="${esc(t)}" class="${t === st.trader ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>
      <div class="seg" id="status">${STATUSES.map(([k, l]) => `<button data-v="${k}" class="${k === st.status ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label class="check small"><input type="checkbox" id="bears"> Include Stage 4 breakdowns</label>
      <input id="q" type="text" placeholder="Filter symbol…" style="width:130px">
    </div></div>
    <section class="card" style="padding:0"><div class="table-wrap" style="max-height:calc(100vh - 260px)"><table class="t" id="tbl"><thead><tr>
      <th class="l" data-sort="symbol">Symbol</th><th class="l" data-sort="setupName">Setup</th><th class="l" data-sort="statusRank">Status</th><th data-sort="score">Score</th>
      <th data-sort="price">Price</th><th data-sort="pivot">Pivot</th><th data-sort="entry">Entry</th><th data-sort="stopPct">Stop</th><th data-sort="target1">2R / 3R</th>
      <th data-sort="adr" title="Average daily range %">ADR</th><th data-sort="rsRating">RS</th><th title="CANSLIM: C = quarterly EPS/sales growth >= 25%, A = 3-yr EPS growth >= 25% & ROE >= 17%">C / A</th><th data-sort="stage">Stage</th><th data-sort="mansfield" title="Mansfield relative strength vs SPY">RSm</th>
      <th data-sort="volRatio">Vol×</th><th data-sort="earningsDays">Earn</th><th class="l">Options</th><th></th>
    </tr></thead><tbody><tr><td colspan="18">${loading('Loading scan…')}</td></tr></tbody></table></div></section>
    <div id="detail"></div>`;

  const $ = s => root.querySelector(s);
  let data, flat = [], sorter;

  const filtered = () => flat.filter(r =>
    (st.trader === 'All' || r.trader === st.trader) &&
    (st.bears || r.bias === 'bull') &&
    (st.status === 'all' || (st.status === 'breakout' && r.statusRank === 0) || (st.status === 'zone' && r.statusRank === 1) || (st.status === 'setting' && r.statusRank === 2)) &&
    (!st.q || r.symbol.includes(st.q)));

  const draw = rows => {
    $('#tbl tbody').innerHTML = rows.length ? rows.slice(0, 400).map((r, k) => `
      <tr class="clickable" data-k="${esc(r.id)}">
        <td class="l"><div class="sym-cell">${logo(r.symbol)}<span class="sym">${esc(r.symbol)}</span><span class="muted">${esc(r.name || '')}</span></div></td>
        <td class="l"><span class="pill ${r.bias}">${esc(r.trader)}</span> <span class="small">${esc(r.setupName)}</span></td>
        <td class="l small">${r.statusRank === 0 ? `<b class="up">${esc(r.status)}</b>` : esc(r.status)}</td>
        <td><b>${r.score}</b></td>
        <td>${fmt.px(r.price)}<div class="tiny ${cls(r.changePct)}">${fmt.spct(r.changePct)}</div></td>
        <td>${fmt.px(r.pivot)}</td><td>${fmt.px(r.entry)}</td>
        <td class="down">${fmt.px(r.stop)}<div class="tiny">${fmt.n(r.stopPct, 1)}%</div></td>
        <td class="up">${fmt.px(r.target1)}<div class="tiny">${fmt.px(r.target2)}</div></td>
        <td>${fmt.n(r.adr, 1)}%</td><td>${r.rsRating}</td><td>${grade(r.canslim)}</td><td>${r.stage ?? '—'}</td>
        <td class="${cls(r.mansfield)}">${fmt.n(r.mansfield, 1)}</td><td class="${r.volRatio >= 1.5 ? 'up' : ''}">${fmt.n(r.volRatio, 1)}</td>
        <td>${r.earningsDays != null ? (r.earningsDays <= 14 ? `<span class="pill warn">${r.earningsDays}d</span>` : `${r.earningsDays}d`) : '—'}</td>
        <td class="l small">${esc(r.strategy)}</td>
        <td class="nowrap"><a class="btn sm" href="#/chart/${esc(r.symbol)}" data-stop>Chart</a> <a class="btn sm ghost" href="#/t/${esc(r.symbol)}" data-stop>Ideas</a></td>
      </tr>`).join('') + (rows.length > 400 ? `<tr><td colspan="18" class="muted small center">Showing the top 400 of ${rows.length}. Narrow the filters to see the rest.</td></tr>` : '')
      : '<tr><td colspan="18"><div class="empty">No setups match. Try another trader or status, or run a full scan.</div></td></tr>';
  };

  const showDetail = id => {
    const r = flat.find(x => x.id === id);
    if (!r) return;
    $('#detail').innerHTML = `<section class="card" style="margin-top:14px">
      <div class="card-h"><h2>${esc(r.symbol)}: ${esc(r.trader)} ${esc(r.setupName)}</h2><span class="pill ${r.bias}">${esc(r.status)}</span>
        <span class="spacer"></span><button class="btn sm primary" id="logTrade" title="Open the Trade Journal with this setup pre-filled">＋ Log trade</button></div>
      <div class="grid g2">
        <div class="kv"><div>Pivot / trigger</div><div>${fmt.px(r.pivot)}</div><div>Entry</div><div>${fmt.px(r.entry)}</div>
          <div>Stop</div><div class="down">${fmt.px(r.stop)} (${fmt.n(r.stopPct, 1)}%)</div><div>Targets 2R / 3R</div><div class="up">${fmt.px(r.target1)} / ${fmt.px(r.target2)}</div>
          <div>Weinstein stage</div><div>${esc(r.stageLabel || '—')}</div><div>Trend Template</div><div>${r.trendTemplate}/8</div>
          <div>CANSLIM C / A</div><div>${r.canslim ? `C ${esc(r.canslim.C)} · A ${esc(r.canslim.A)}` : 'n/a'}</div></div>${r.canslim?.notes?.length ? `<p class="help" style="grid-column:1/-1">${esc(r.canslim.notes.join(' · '))}</p>` : ''}
        <div><ul class="help" style="padding-left:18px;margin:0">${(r.notes || []).map(n => `<li>${esc(n)}</li>`).join('')}</ul>
          <p class="help"><b>Management (${esc(r.trader)}):</b> ${esc(r.manage || '')}</p>
          <p class="help"><b>Options:</b> ${esc(r.strategy)}. <a href="#/t/${esc(r.symbol)}">See scored structures</a> · <a href="#/options/${esc(r.symbol)}">Chain</a></p></div>
      </div></section>`;
    $('#detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('#logTrade').addEventListener('click', () => {
      const setup = { Qullamaggie: /pivot/i.test(r.setupName) ? 'Qullamaggie EP' : 'Qullamaggie breakout', Minervini: 'Minervini VCP', "O'Neil": "O'Neil base", Weinstein: 'Weinstein Stage 2' }[r.trader] || r.trader;
      handoff.set('journal-new', { symbol: r.symbol, direction: r.bias === 'bear' ? 'short' : 'long', setup, entry: r.entry, stop: r.stop, target: r.target1,
        strategy: r.strategy, notes: `${r.trader} ${r.setupName} · score ${r.score} · pivot ${fmt.px(r.pivot)} · RS ${r.rsRating}` });
      location.hash = '#/journal';
    });
  };

  const load = async () => {
    try {
      data = await api.get('scanner');
      const u = data.universe || {}, b = data.bars || {};
      $('#meta').textContent = `${u.scanned ?? '—'} stocks scanned · updated ${fmt.ago(data.updated)}${b.running ? ` · downloading history ${b.done}/${b.total}` : ''}${u.missingHistory ? ` · ${u.missingHistory} awaiting history` : ''}`;
      const g = data.regime;
      const [s1, s2, s3, s4] = data.stages || [0, 0, 0, 0];
      const tot = Math.max(1, s1 + s2 + s3 + s4);
      $('#regime').innerHTML = g ? `
        <div class="card-h"><h2>Market regime</h2><span class="pill ${regimeCls(g.state)}">${esc(g.label)}</span></div>
        <div class="kv"><div>SPY</div><div>${fmt.px(g.spy)} · ${esc(g.spyStage)}</div>
          <div>Distribution days (25 sessions)</div><div class="${g.distributionDays >= 5 ? 'down' : ''}">${g.distributionDays}</div>
          <div>Stocks above 50 / 200-day</div><div>${fmt.pct(g.breadthAbove50, 0)} / ${fmt.pct(g.breadthAbove200, 0)}</div></div>
        <div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin:10px 0 4px" title="Weinstein stage distribution">
          <div style="width:${(s1 / tot) * 100}%;background:var(--muted)"></div><div style="width:${(s2 / tot) * 100}%;background:var(--up)"></div>
          <div style="width:${(s3 / tot) * 100}%;background:var(--warn)"></div><div style="width:${(s4 / tot) * 100}%;background:var(--down)"></div></div>
        <div class="tiny muted">Stage 1 ${s1} · <span class="up">Stage 2 ${s2}</span> · <span style="color:var(--warn)">Stage 3 ${s3}</span> · <span class="down">Stage 4 ${s4}</span></div>
        <p class="help"><b>Exposure:</b> ${esc(g.exposure)}</p>` : '<div class="muted small">Regime appears after the first full scan.</div>';
      const fired = data.daily?.fired || {};
      const today = new Date().toISOString().slice(0, 10);
      const trig = data.daily?.triggers || [];
      $('#triggers').innerHTML = trig.length ? `<div class="table-wrap" style="max-height:230px"><table class="t"><tbody>${trig.map(t => {
        const hit = Object.keys(fired).some(k => k.endsWith(`|${t.symbol}`));
        return `<tr><td class="l"><b>${esc(t.symbol)}</b> <span class="muted small">${esc(t.trader)} ${esc(t.setup)}</span></td><td>pivot ${fmt.px(t.pivot)}</td><td class="down">${fmt.px(t.stop)}</td><td>${hit ? '<span class="pill good">fired</span>' : '<span class="pill info">armed</span>'}</td></tr>`;
      }).join('')}</tbody></table></div><div class="tiny muted" style="margin-top:6px">Armed by the post-close scan${data.daily?.lastPost ? ` (${esc(data.daily.lastPost)})` : ''}. Today ${esc(today)}.</div>`
        : '<div class="muted small">Triggers are armed by the 4:40 pm ET post-close scan (or ↻ Full scan).</div>';
      flat = data.rows.flatMap(r => r.setups.map((s, j) => ({
        id: `${r.symbol}|${j}`, ...r, ...s, setupName: s.name, statusRank: statusRank(s.status), earningsDays: r.earningsDays ?? null,
      })));
      if (sorter) sorter.update(filtered()); else sorter = sortable($('#tbl'), filtered(), draw, { key: 'score', dir: -1 });
    } catch (e) { $('#tbl tbody').innerHTML = `<tr><td colspan="18">${errorBox(e)}</td></tr>`; }
  };

  const seg = (id, key, pref) => $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st[key] = b.dataset.v; prefs.set(pref, st[key]);
    root.querySelectorAll(`${id} button`).forEach(x => x.classList.toggle('on', x === b));
    sorter?.update(filtered());
  });
  seg('#trader', 'trader', 'sc-trader'); seg('#status', 'status', 'sc-status');
  $('#bears').addEventListener('change', e => { st.bears = e.target.checked; sorter?.update(filtered()); });
  $('#q').addEventListener('input', e => { st.q = e.target.value.trim().toUpperCase(); sorter?.update(filtered()); });
  $('#tbl tbody').addEventListener('click', e => { if (e.target.closest('[data-stop]')) return; const tr = e.target.closest('tr[data-k]'); if (tr) showDetail(tr.dataset.k); });
  $('#post').addEventListener('click', async () => {
    if (!confirm('Run the full post-close routine now? It updates price history for every symbol (can take ~10 min), rescans, and sends the Telegram report.')) return;
    try { await api.post('scanner/post-close'); toast('Full scan started. This page refreshes as it progresses.'); } catch (e) { toast(e.message, true); }
  });
  $('#brief').addEventListener('click', async e => {
    e.target.disabled = true;
    try { await api.post('scanner/pre-market'); toast('Pre-market brief sent to Telegram'); } catch (err) { toast(err.message, true); }
    e.target.disabled = false;
  });

  await load();
  // Deep link from a Telegram alert: #/scanner?sym=CBZ&setup=minervini_vcp opens that play.
  if (query.sym) {
    const sym = String(query.sym).toUpperCase();
    const r = flat.find(x => x.symbol === sym && (!query.setup || x.key === query.setup)) || flat.find(x => x.symbol === sym);
    if (r) {
      Object.assign(st, { trader: 'All', status: 'all', q: sym, bears: st.bears || r.bias === 'bear' });
      root.querySelectorAll('#trader button, #status button').forEach(b => b.classList.toggle('on', b.dataset.v === 'All' || b.dataset.v === 'all'));
      $('#bears').checked = st.bears; $('#q').value = sym;
      sorter?.update(filtered());
      showDetail(r.id);
    } else {
      toast(`${sym} has no active setup in today's scan: showing its stock page`);
      location.replace(`#/t/${encodeURIComponent(sym)}`);
    }
  }
  const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
  return () => clearInterval(t);
}
