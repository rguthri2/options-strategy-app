import { api } from '../api.js';
import { esc, logo, fmt, loading, errorBox, biasPill, sortable, toast } from '../ui.js';

const sideCls = s => (s === 'sell' ? 'bad' : s === 'buy' ? 'good' : 'info');

export async function render(root) {
  root.innerHTML = `
    <div class="page-h">
      <div style="flex:1"><h1>Earnings IV crush</h1><div class="muted small">The move the options market is pricing into each report vs. how far the stock actually moved on past reports.</div></div>
      <span id="meta" class="muted small"></span>
      <button class="btn" id="refresh">↻ Rescan</button>
    </div>
    <div class="card" style="margin-bottom:14px"><div class="help">
      <b>Implied move</b> = front-expiration ATM straddle ÷ price. <b>Ratio</b> = implied ÷ average historical move.
      Above ~1.25 the market is overpaying for the event, so <span class="pill bad">sell premium</span> with defined risk and close after the report to capture the IV crush.
      Below ~0.8 the stock tends to move more than priced, so <span class="pill good">buy premium</span>.
      <b>Term premium</b> = front IV ÷ next-month IV; that excess is what collapses after the report.
    </div></div>
    <section class="card" style="padding:0"><div class="table-wrap" style="max-height:calc(100vh - 300px)">
      <table class="t" id="tbl"><thead><tr>
        <th class="l" data-sort="symbol">Symbol</th><th data-sort="days">Reports</th><th data-sort="spot">Price</th>
        <th data-sort="impliedMove">Implied move</th><th data-sort="avgAbs">Avg past move</th><th data-sort="maxAbs">Max past</th>
        <th data-sort="exceeded" title="Share of past reports that moved more than today's implied move">Beat implied</th>
        <th data-sort="ratio">Ratio</th><th data-sort="termPremium">Term prem.</th><th data-sort="ivCrushPts" title="Front IV minus next-month IV, in vol points">Crush est.</th>
        <th class="l">Verdict</th><th class="l">Chart bias</th><th></th>
      </tr></thead><tbody><tr><td colspan="13">${loading('Scanning upcoming reports… (first run can take a minute on live data)')}</td></tr></tbody></table>
    </div></section>
    <div id="detail"></div>`;

  const $ = s => root.querySelector(s);
  let sorter, rows = [];

  const draw = list => {
    $('#tbl tbody').innerHTML = list.length ? list.map(r => `
      <tr class="clickable" data-s="${esc(r.symbol)}">
        <td class="l"><div class="sym-cell">${logo(r.symbol)}<span class="sym">${esc(r.symbol)}</span><span class="muted">${esc(r.name || '')}</span></div></td>
        <td><div>${esc(r.earnings.date)}</div><div class="tiny muted">${r.days}d · ${esc(r.earnings.hour || 'n/a')}</div></td>
        <td>${fmt.px(r.spot)}</td>
        <td><b>±${fmt.pct(r.impliedMove, 1)}</b><div class="tiny muted">±${fmt.px(r.straddle)} · ${esc(r.frontExp)}</div></td>
        <td>${fmt.pct(r.avgAbs, 1)}<div class="tiny muted">n=${r.history.count}${r.history.source.startsWith('estimated') ? '*' : ''}</div></td>
        <td>${fmt.pct(r.maxAbs, 1)}</td>
        <td>${fmt.pct(r.exceeded, 0)}</td>
        <td class="${r.ratio >= 1.15 ? 'down' : r.ratio <= 0.9 ? 'up' : ''}"><b>${fmt.n(r.ratio, 2)}</b></td>
        <td>${fmt.n(r.termPremium, 2)}</td>
        <td>${Number.isFinite(r.ivCrushPts) ? `−${fmt.n(Math.max(0, r.ivCrushPts), 1)}` : '—'}</td>
        <td class="l"><span class="pill ${sideCls(r.side)}">${esc(r.call)}</span></td>
        <td class="l">${r.bias ? biasPill(r.bias) : '<span class="faint">—</span>'}</td>
        <td class="nowrap"><a class="btn sm" href="#/options/${esc(r.symbol)}?exp=${esc(r.frontExp)}" data-stop>Chain</a></td>
      </tr>`).join('') : '<tr><td colspan="13"><div class="empty">No universe symbols report in the next 30 days (or no earnings calendar is configured; see Settings).</div></td></tr>';
  };

  const showDetail = sym => {
    const r = rows.find(x => x.symbol === sym);
    if (!r) return;
    const w = 520, h = 140, pad = 28, moves = r.history.moves;
    const max = Math.max(r.impliedMove, ...moves.map(m => Math.abs(m.move)), 0.01) * 1.15;
    const bw = (w - pad * 2) / Math.max(moves.length, 1);
    const Y = v => h / 2 - (v / max) * (h / 2 - 10);
    $('#detail').innerHTML = `<section class="card" style="margin-top:14px">
      <div class="card-h"><h2>${esc(r.symbol)}: past earnings reactions</h2><span class="muted small">${esc(r.history.source)}</span></div>
      <div class="grid g2">
        <div><svg viewBox="0 0 ${w} ${h}" width="100%" class="bars">
          <rect x="${pad}" y="${Y(r.impliedMove)}" width="${w - pad * 2}" height="${Y(-r.impliedMove) - Y(r.impliedMove)}" fill="var(--warn)" opacity=".12"/>
          <line class="zero" x1="${pad}" x2="${w - pad}" y1="${h / 2}" y2="${h / 2}"/>
          <text x="${w - pad}" y="${Y(r.impliedMove) - 3}" text-anchor="end" fill="var(--warn)">implied ±${(r.impliedMove * 100).toFixed(1)}%</text>
          ${moves.map((m, i) => `<rect x="${pad + i * bw + 3}" y="${Math.min(Y(m.move), h / 2)}" width="${Math.max(2, bw - 6)}" height="${Math.abs(Y(m.move) - h / 2)}" fill="${m.move >= 0 ? 'var(--up)' : 'var(--down)'}"><title>${esc(m.date)}: ${(m.move * 100).toFixed(1)}%</title></rect>`).join('')}
        </svg></div>
        <div class="kv">
          <div>Verdict</div><div><span class="pill ${sideCls(r.side)}">${esc(r.call)}</span></div>
          <div>Implied / average move</div><div>±${fmt.pct(r.impliedMove, 1)} / ${fmt.pct(r.history.avgAbs, 1)}</div>
          <div>Median / max past move</div><div>${fmt.pct(r.history.medianAbs, 1)} / ${fmt.pct(r.history.maxAbs, 1)}</div>
          <div>Front / next-month IV</div><div>${fmt.iv(r.frontIv)} / ${fmt.iv(r.backIv)}</div>
        </div>
      </div>
      <p class="help"><b>Play:</b> ${esc(r.play)}</p>
      ${r.history.source.startsWith('estimated') ? '<p class="help">* Report dates estimated from the largest opening gap in each quarter. Add a Finnhub key in Settings for exact dates.</p>' : ''}
    </section>`;
    $('#detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const load = async (refresh = false) => {
    try {
      const d = await api.get(`earnings-scan${refresh ? '?refresh=1' : ''}`);
      rows = d.rows.map(r => ({ ...r, days: r.earnings.days, avgAbs: r.history.avgAbs, maxAbs: r.history.maxAbs, exceeded: r.history.pctExceededImplied }));
      $('#meta').textContent = `${rows.length} reports · calendar: ${d.source || 'n/a'} · ${new Date(d.t).toLocaleTimeString()}`;
      if (sorter) sorter.update(rows); else sorter = sortable($('#tbl'), rows, draw, { key: 'days', dir: 1 });
    } catch (e) { $('#tbl tbody').innerHTML = `<tr><td colspan="13">${errorBox(e)}</td></tr>`; }
  };

  $('#tbl tbody').addEventListener('click', e => {
    if (e.target.closest('[data-stop]')) return;
    const tr = e.target.closest('tr[data-s]'); if (tr) showDetail(tr.dataset.s);
  });
  $('#refresh').addEventListener('click', async e => {
    e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span> Scanning…';
    try { await load(true); toast('Earnings rescanned'); } catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = '↻ Rescan';
  });
  await load();
}
