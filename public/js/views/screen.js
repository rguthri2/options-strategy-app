import { api } from '../api.js';
import { esc, logo, fmt, cls, loading, errorBox, prefs } from '../ui.js';

const PRESETS = {
  trend: { label: 'Trend', tags: ['uptrend'], help: 'Price above a rising 50-day, 50-day above 200-day. Trade with the trend: bull call spreads, put credit spreads, long calls on pullbacks.', sort: 'adx' },
  downtrend: { label: 'Downtrend', tags: ['downtrend'], help: 'Price below a falling 50-day, 50-day below 200-day. Bear put spreads, call credit spreads, long puts on bounces.', sort: 'adx' },
  breakout: { label: 'Breakout', tags: ['breakout', 'new-high'], help: 'Closing above the 20-day high on 1.3x+ volume, or at 52-week highs. Buy the retest of the breakout level; stop under it.', sort: 'volRatio' },
  breakdown: { label: 'Breakdown', tags: ['breakdown'], help: 'Closing below the 20-day low on heavy volume. Short setups: puts or bear spreads.', sort: 'volRatio' },
  reversal: { label: 'Reversal', tags: ['reversal-up', 'reversal-down', 'oversold', 'overbought'], help: 'Extreme RSI with a rejection candle (hammer / shooting star). Counter-trend: small size, tight stops, defined-risk spreads.', sort: 'rsi' },
  pullback: { label: 'Pullback', tags: ['pullback'], help: 'Uptrend names resting near the 20/50-day average. Classic buy-the-dip entries.', sort: 'rsi' },
  gaps: { label: 'Gaps', tags: ['gap-up', 'gap-down'], help: 'Opened outside yesterday\'s range and has not filled. Gaps with volume tend to run; gaps without it tend to fill.', sort: 'gapPct' },
  gapfill: { label: 'Gap fills', tags: ['gap-fill-up', 'gap-fill-down'], help: 'Gapped today and already traded back to the prior close. A filled gap shows the move failed; fade or wait.', sort: 'gapPct' },
  all: { label: 'All', tags: [], help: 'Every symbol in the scan universe.', sort: 'volRatio' },
};

const COLS = [
  ['symbol', 'Symbol'], ['price', 'Price'], ['chg1', 'Chg %'], ['chg5', '5d %'], ['chg20', '20d %'], ['volRatio', 'Rel vol'],
  ['gapPct', 'Gap %'], ['rsi', 'RSI'], ['adx', 'ADX'], ['vs50', 'vs 50d %'], ['from52High', 'From 52w hi %'], ['atrPct', 'ATR %'],
];

export async function render(root) {
  const st = { preset: prefs.get('screen-preset', 'trend'), sort: null, dir: -1, minPrice: 5, maxPrice: '', minVol: 0, minRsi: '', maxRsi: '', q: '' };
  root.innerHTML = `
    <div class="card-h"><h2>Stock screener</h2><span class="muted small" id="updated"></span></div>
    <div class="ranges" id="presets" style="flex-wrap:wrap;margin-bottom:8px">${Object.entries(PRESETS).map(([k, p]) => `<button data-p="${k}" class="${k === st.preset ? 'on' : ''}">${p.label}</button>`).join('')}</div>
    <p class="help" id="phelp"></p>
    <section class="card"><div class="row" style="flex-wrap:wrap;gap:10px" id="filters">
      <label class="small">Min price <input type="number" data-f="minPrice" value="${st.minPrice}" style="width:70px"></label>
      <label class="small">Max price <input type="number" data-f="maxPrice" style="width:70px"></label>
      <label class="small">Min rel vol <input type="number" step="0.1" data-f="minVol" value="0" style="width:60px"></label>
      <label class="small">RSI from <input type="number" data-f="minRsi" style="width:55px"></label>
      <label class="small">to <input type="number" data-f="maxRsi" style="width:55px"></label>
      <label class="small">Symbol <input type="search" data-f="q" placeholder="filter" style="width:90px"></label>
    </div></section>
    <section class="card" style="overflow-x:auto;margin-top:10px"><div id="tbl">${loading('Scanning universe…')}</div></section>`;
  const $ = s => root.querySelector(s);

  let rows = [];
  const draw = () => {
    const p = PRESETS[st.preset];
    $('#phelp').textContent = p.help;
    const num = v => (v === '' ? null : Number(v));
    const [minP, maxP, minR, maxR] = [num(st.minPrice), num(st.maxPrice), num(st.minRsi), num(st.maxRsi)];
    let list = rows.filter(r => (!p.tags.length || r.tags.some(t => p.tags.includes(t)))
      && (minP == null || r.price >= minP) && (maxP == null || r.price <= maxP) && r.volRatio >= (Number(st.minVol) || 0)
      && (minR == null || r.rsi >= minR) && (maxR == null || r.rsi <= maxR) && (!st.q || r.symbol.includes(st.q.toUpperCase())));
    const key = st.sort || p.sort;
    list = list.sort((a, b) => (key === 'symbol' ? a.symbol.localeCompare(b.symbol) * -st.dir : ((Math.abs(b[key] ?? 0) - Math.abs(a[key] ?? 0)) * (st.dir === -1 ? 1 : -1))));
    $('#tbl').innerHTML = list.length ? `<table class="tbl"><thead><tr>${COLS.map(([k, l]) => `<th data-k="${k}" style="cursor:pointer">${l}${k === key ? (st.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}<th>Signals</th></tr></thead>
      <tbody>${list.slice(0, 150).map(r => `<tr>
        <td><div class="sym-inline">${logo(r.symbol, 20)}<a class="sym" href="#/t/${esc(r.symbol)}">${esc(r.symbol)}</a></div></td>
        <td>${fmt.px(r.price)}</td><td class="${cls(r.chg1)}">${fmt.spct(r.chg1 / 100)}</td><td class="${cls(r.chg5)}">${r.chg5}%</td><td class="${cls(r.chg20)}">${r.chg20}%</td>
        <td>${r.volRatio}×</td><td class="${cls(r.gapPct)}">${r.gapPct}%${r.gapDir !== 'none' ? (r.gapFilled ? ' ✓' : '') : ''}</td>
        <td>${r.rsi}</td><td>${r.adx}</td><td class="${cls(r.vs50)}">${r.vs50 ?? '—'}</td><td>${r.from52High}</td><td>${r.atrPct}</td>
        <td class="small">${r.tags.map(t => `<span class="pill neutral" style="margin:1px">${esc(t)}</span>`).join('')}</td></tr>`).join('')}</tbody></table>
      <div class="muted small" style="margin-top:6px">${list.length} matches${list.length > 150 ? ' (top 150 shown)' : ''}. Click a symbol for chart, technical analysis and option strategies.</div>`
      : '<div class="empty">No symbols match these filters.</div>';
  };

  try {
    const d = await api.get('screen');
    rows = d.rows;
    $('#updated').textContent = `${rows.length} symbols · updated ${new Date(d.updated).toLocaleTimeString()}`;
    draw();
  } catch (e) { $('#tbl').innerHTML = errorBox(e); return; }

  $('#presets').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.preset = b.dataset.p; st.sort = null; st.dir = -1; prefs.set('screen-preset', st.preset);
    root.querySelectorAll('#presets button').forEach(x => x.classList.toggle('on', x === b));
    draw();
  });
  $('#filters').addEventListener('input', e => { if (e.target.dataset.f) { st[e.target.dataset.f] = e.target.value; draw(); } });
  $('#tbl').addEventListener('click', e => {
    const th = e.target.closest('th[data-k]'); if (!th) return;
    st.dir = st.sort === th.dataset.k ? -st.dir : -1; st.sort = th.dataset.k; draw();
  });
}
