import { api } from '../api.js';
import { esc, fmt, cls, loading, errorBox, prefs } from '../ui.js';

const FIELDS = [
  ['dte', 'Target DTE', 1], ['delta', 'Short Δ (long Δ for long options)', 0.01], ['widthPct', 'Wing width % of price', 0.5],
  ['takeProfit', 'Take profit %', 5], ['stopLoss', 'Stop loss %', 10], ['exitDte', 'Exit at DTE (0 = hold)', 1],
];

function equityChart(points) {
  if (points.length < 2) return '';
  const W = 640, H = 170, m = 34;
  const vals = [0, ...points.map(p => p.v)], lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const X = i => m + (i / (points.length - 1)) * (W - m - 8), Y = v => 8 + (1 - (v - lo) / span) * (H - 24);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const end = points[points.length - 1].v;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="bars">
    <line class="zero" x1="${m}" x2="${W - 8}" y1="${Y(0)}" y2="${Y(0)}"/>
    <text x="${m - 4}" y="${Y(hi) + 4}" text-anchor="end">${fmt.usd(hi)}</text><text x="${m - 4}" y="${Y(lo) + 4}" text-anchor="end">${fmt.usd(lo)}</text>
    <path d="${line}" fill="none" stroke="${end >= 0 ? 'var(--up)' : 'var(--down)'}" stroke-width="2"/>
  </svg>`;
}

export async function render(root, [symArg]) {
  const symbol = symArg || prefs.get('lab-sym', 'SPY');
  prefs.set('lab-sym', symbol);
  if (!symArg) { location.replace(`#/lab/${encodeURIComponent(symbol)}`); return; }

  root.innerHTML = `
    <div class="page-h"><div style="flex:1"><h1>Options Lab</h1><div class="muted small">Backtest option <b>structures</b> with management rules on up to 5 years of history.</div></div></div>
    <div class="banner info" id="ivnote">Prices are <b>modeled</b> with Black-Scholes, since free feeds have no historical option quotes. SPY uses real <b>VIX</b> history as its implied volatility; other symbols use realized volatility × a premium. Every trade pays bid/ask slippage and $0.65/contract commissions. Use it to compare structures and rules, not to predict exact P/L.</div>
    <div class="grid" style="grid-template-columns:340px minmax(0,1fr)" id="labgrid">
      <section class="card">
        <form id="f" class="stack" style="gap:10px">
          <label class="field">Symbol<input type="text" id="sym" value="${esc(symbol)}" style="text-transform:uppercase"></label>
          <label class="field">Strategy<select id="strat"></select></label>
          <label class="field">Entry filter<select id="filter"></select></label>
          <div class="grid g2" id="params" style="gap:10px"></div>
          <label class="field">IV premium over realized (non-SPY)<input type="number" id="ivPremium" step="0.05" value="1.1"></label>
          <button class="btn primary" id="run">Run backtest</button>
        </form>
      </section>
      <div class="stack" id="out"><div class="card empty">Pick a strategy and run it.</div></div>
    </div>`;

  const $ = s => root.querySelector(s);
  let meta;
  try { meta = await api.get('option-strategies'); } catch (e) { $('#out').innerHTML = errorBox(e); return; }
  $('#strat').innerHTML = Object.entries(meta.strategies).map(([k, s]) => `<option value="${esc(k)}">${esc(s.label)} (${esc(s.kind)})</option>`).join('');
  $('#filter').innerHTML = Object.entries(meta.filters).map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('');
  $('#strat').value = prefs.get('lab-strat', 'put_credit_spread');

  const fillDefaults = () => {
    const d = meta.strategies[$('#strat').value]?.defaults || {};
    $('#params').innerHTML = FIELDS.filter(([k]) => k !== 'widthPct' || d.widthPct != null)
      .map(([k, l, st]) => `<label class="field">${l}<input type="number" data-k="${k}" step="${st}" value="${d[k] ?? ''}"></label>`).join('');
  };
  $('#strat').addEventListener('change', () => { prefs.set('lab-strat', $('#strat').value); fillDefaults(); });
  fillDefaults();

  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const s = $('#sym').value.trim().toUpperCase();
    if (s !== symbol) { location.hash = `#/lab/${encodeURIComponent(s)}`; return; }
    const q = new URLSearchParams({ strategy: $('#strat').value, filter: $('#filter').value, ivPremium: $('#ivPremium').value });
    root.querySelectorAll('#params input').forEach(i => { if (i.value !== '') q.set(i.dataset.k, i.value); });
    $('#out').innerHTML = `<div class="card">${loading('Simulating trades…')}</div>`;
    $('#run').disabled = true;
    try {
      const r = await api.get(`optbacktest/${encodeURIComponent(symbol)}?${q}`);
      const s2 = r.stats;
      const stat = (l, v, c = '', sub = '') => `<div class="stat"><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="s">${sub}</div></div>`;
      $('#out').innerHTML = `
        <div class="stats-strip">
          ${stat('Trades', s2.trades, '', `${fmt.n(s2.years, 1)} years`)}
          ${stat('Win rate', fmt.pct(s2.winRate, 0))}
          ${stat('Total P/L', fmt.usd(s2.totalPnl), cls(s2.totalPnl), 'per 1-lot')}
          ${stat('Avg trade', fmt.usd(s2.avgPnl), cls(s2.avgPnl), `win ${fmt.usd(s2.avgWin)} / loss ${fmt.usd(s2.avgLoss)}`)}
          ${stat('Profit factor', Number.isFinite(s2.profitFactor) ? fmt.n(s2.profitFactor, 2) : '∞')}
          ${stat('Max drawdown', fmt.usd(s2.maxDrawdown), 'down')}
          ${stat('Return on risk', fmt.pct(s2.annualReturnOnRisk, 0) + '/yr', cls(s2.annualReturnOnRisk), `avg risk ${fmt.usd(s2.avgRisk)}`)}
        </div>
        <section class="card"><div class="card-h"><h2>${esc(r.label)} on ${esc(symbol)}: equity (1-lot)</h2><span class="muted small">IV: ${esc(r.ivSource)} · avg hold ${fmt.n(s2.avgDays, 0)}d</span></div>
          ${equityChart(s2.equity)}
          <div class="row small" style="margin-top:6px">${Object.entries(s2.reasons).map(([k, v]) => `<span class="pill info">${esc(k)}: ${v}</span>`).join(' ')}</div>
          ${s2.trades < 30 ? '<p class="help">⚠ Fewer than 30 trades. Results are not statistically reliable.</p>' : ''}
        </section>
        <section class="card" style="padding:0"><div class="table-wrap" style="max-height:420px"><table class="t"><thead><tr>
          <th class="l">Entered</th><th class="l">Legs</th><th>Exp.</th><th>Spot in→out</th><th>Open</th><th>Close</th><th>P/L</th><th>Days</th><th class="l">Exit</th></tr></thead><tbody>
          ${r.trades.slice().reverse().map(t => `<tr><td class="l">${new Date(t.entryT * 1000).toISOString().slice(0, 10)}</td><td class="l mono small">${esc(t.legs)}</td><td>${esc(t.expiry)}</td>
            <td>${fmt.px(t.entrySpot)} → ${fmt.px(t.exitSpot)}</td><td>${r.kind === 'credit' ? `${fmt.opt(t.entry)} cr` : fmt.opt(-t.entry)}</td><td>${fmt.opt(Math.abs(t.exit))}</td>
            <td class="${cls(t.pnl)}"><b>${fmt.usd(t.pnl)}</b></td><td>${t.days}</td><td class="l small">${esc(t.reason)}</td></tr>`).join('')}
        </tbody></table></div></section>`;
    } catch (err) { $('#out').innerHTML = errorBox(err); }
    $('#run').disabled = false;
  });
}
