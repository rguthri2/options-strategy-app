import { api } from '../api.js';
import { esc, logo, fmt, cls, loading, errorBox, toast, handoff } from '../ui.js';

export async function render(root) {
  root.innerHTML = `
    <div class="page-h"><div style="flex:1"><h1>Positions</h1><div class="muted small">Tracked trades with live marks and rule-based management alerts (50% profit, 21 DTE, 2× credit stop, tested strikes).</div></div>
      <span id="upd" class="muted small"></span></div>
    <div class="stats-strip" id="summary" style="margin-bottom:14px"></div>
    <section class="card" style="margin-bottom:16px" id="riskcard">
      <div class="card-h"><h2>Portfolio risk</h2><span class="muted small">Black-Scholes repricing of every leg · each symbol moves β × SPY</span></div>
      <div id="risk">${loading()}</div>
    </section>
    <section class="card" style="padding:0;margin-bottom:16px"><div class="table-wrap"><table class="t" id="open"><thead><tr>
      <th class="l">Symbol</th><th class="l">Strategy</th><th class="l">Legs</th><th>Spot</th><th>DTE</th><th>Entry</th><th>Value</th><th>P/L</th><th>P/L %</th><th class="l">Alerts</th><th></th>
    </tr></thead><tbody><tr><td colspan="11">${loading()}</td></tr></tbody></table></div></section>
    <section class="card"><div class="card-h"><h2>Closed</h2></div><div id="closed"></div></section>`;

  const $ = s => root.querySelector(s);
  let list = [];

  const load = async () => {
    try {
      list = await api.get('positions');
      const open = list.filter(p => p.status === 'open'), closed = list.filter(p => p.status === 'closed');
      const unreal = open.reduce((s, p) => s + (p.pnl || 0), 0);
      const real = closed.reduce((s, p) => s + (p.closePnl || 0), 0);
      const wins = closed.filter(p => p.closePnl > 0).length;
      const theta = open.reduce((s, p) => s + p.legs.reduce((t, l) => t + (l.theta || 0) * l.qty * (l.type === 'stock' ? 0 : 100), 0), 0);
      const stat = (l, v, c = '') => `<div class="stat"><div class="l">${l}</div><div class="v ${c}">${v}</div></div>`;
      $('#summary').innerHTML = [
        stat('Open positions', open.length), stat('Unrealized P/L', fmt.usd(unreal), cls(unreal)),
        stat('Net theta / day', fmt.usd(theta, 2), cls(theta)), stat('Realized P/L', fmt.usd(real), cls(real)),
        stat('Win rate', closed.length ? fmt.pct(wins / closed.length, 0) : '—'), stat('Alerts', open.reduce((s, p) => s + p.alerts.length, 0)),
      ].join('');
      $('#open tbody').innerHTML = open.length ? open.map(p => `<tr data-id="${esc(p.id)}">
        <td class="l"><span class="sym-inline">${logo(p.symbol, 22)}<a class="sym" href="#/t/${esc(p.symbol)}">${esc(p.symbol)}</a></span></td><td class="l">${esc(p.label)}</td>
        <td class="l mono small" style="white-space:normal;max-width:320px">${esc(p.description)}</td>
        <td>${fmt.px(p.spot)}</td><td>${p.dte ?? '—'}</td>
        <td>${p.cost < 0 ? `<span class="up">${fmt.usd(-p.cost)} cr</span>` : fmt.usd(p.cost)}</td><td>${fmt.usd(p.value)}</td>
        <td class="${cls(p.pnl)}"><b>${fmt.usd(p.pnl)}</b></td><td class="${cls(p.pnlPct)}">${fmt.spct(p.pnlPct, 0)}</td>
        <td class="l"><div class="alerts">${p.alerts.map(a => `<span class="pill ${a.level}">${esc(a.text)}</span>`).join('') || '<span class="muted small">On plan</span>'}</div></td>
        <td class="nowrap"><button class="btn sm" data-a="analyze">Analyze</button> <button class="btn sm" data-a="close">Close</button> <button class="btn sm ghost danger" data-a="del">✕</button></td>
      </tr>`).join('') : '<tr><td colspan="11"><div class="empty">No open positions. Track one from <a href="#/ideas">Trade Ideas</a> or the <a href="#/builder">Builder</a>.</div></td></tr>';
      $('#closed').innerHTML = closed.length ? `<table class="t"><thead><tr><th class="l">Symbol</th><th class="l">Strategy</th><th class="l">Legs</th><th>Opened</th><th>Closed</th><th>P/L</th><th></th></tr></thead><tbody>
        ${closed.map(p => `<tr data-id="${esc(p.id)}"><td class="l sym">${esc(p.symbol)}</td><td class="l">${esc(p.label)}</td><td class="l mono small">${esc(p.description)}</td>
        <td>${new Date(p.openedAt).toLocaleDateString()}</td><td>${new Date(p.closedAt).toLocaleDateString()}</td><td class="${cls(p.closePnl)}">${fmt.usd(p.closePnl)}</td>
        <td><button class="btn sm ghost danger" data-a="del">✕</button></td></tr>`).join('')}</tbody></table>` : '<div class="muted small">No closed trades yet.</div>';
      $('#upd').textContent = `Updated ${new Date().toLocaleTimeString()}`;
      loadRisk(open.length);
    } catch (e) { $('#open tbody').innerHTML = `<tr><td colspan="11">${errorBox(e)}</td></tr>`; }
  };

  const heat = (v, max) => {
    const a = Math.min(0.55, (Math.abs(v) / (max || 1)) * 0.55 + 0.04);
    return `background:${v >= 0 ? `rgba(52,199,123,${a})` : `rgba(255,107,107,${a})`}`;
  };
  async function loadRisk(openCount) {
    const el = $('#risk');
    if (!openCount) { el.innerHTML = '<div class="muted small">Track positions to see net Greeks and scenario P/L.</div>'; return; }
    try {
      const r = await api.get('risk');
      const t = r.totals;
      const all = [...r.grid.flat(), ...r.week].map(Math.abs);
      const max = Math.max(...all, 1);
      const stat = (l, v, s = '', c = '') => `<div class="stat"><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`;
      const moveHdr = r.moves.map(m => `<th>${m > 0 ? '+' : ''}${(m * 100).toFixed(0)}%</th>`).join('');
      const row = (label, vals) => `<tr><td class="l"><b>${label}</b></td>${vals.map(v => `<td style="${heat(v, max)}">${fmt.usd(v)}</td>`).join('')}</tr>`;
      el.innerHTML = `
        <div class="stats-strip" style="margin-bottom:12px">
          ${stat('Net delta', `${fmt.n(t.delta, 0)} sh`, `${fmt.usd(t.dollarDelta)} notional`, cls(t.delta))}
          ${stat('β-weighted', `${fmt.n(t.spyDelta, 1)} SPY`, `${fmt.pct(t.spyDeltaPctOfAccount, 1)} of account`, cls(t.spyDelta))}
          ${stat('Theta / day', fmt.usd(t.theta, 2), `${fmt.pct(t.thetaPctOfAccountPerDay, 3)} of account`, cls(t.theta))}
          ${stat('Vega / IV pt', fmt.usd(t.vega, 2), 'P/L per 1 vol point', cls(t.vega))}
          ${stat('Gamma', fmt.n(t.gamma, 2), 'Δ change per $1')}
        </div>
        <div class="table-wrap"><table class="t"><thead><tr><th class="l">SPY move →</th>${moveHdr}</tr></thead><tbody>
          ${row('IV −10 pts', r.grid[0])}${row('IV unchanged', r.grid[1])}${row('IV +10 pts', r.grid[2])}${row('In 7 days', r.week)}
        </tbody></table></div>
        <div class="row small" style="margin-top:10px;gap:18px">
          <span class="muted">Largest exposures:</span>
          ${r.concentration.slice(0, 6).map(c => `<span><b>${esc(c.symbol)}</b> ${fmt.usd(c.dollarDelta)} <span class="${c.pctOfAccount > 0.25 ? 'down' : 'muted'}">(${fmt.pct(c.pctOfAccount, 0)})</span></span>`).join('')}
        </div>
        <div class="table-wrap" style="margin-top:10px"><table class="t"><thead><tr><th class="l">Position</th><th>β</th><th>Δ sh</th><th>SPY Δ</th><th>Θ/day</th><th>Vega</th><th>SPY −5%</th><th>SPY +5%</th></tr></thead><tbody>
          ${r.positions.map(p => `<tr><td class="l"><b>${esc(p.symbol)}</b> <span class="muted small">${esc(p.label)}</span></td><td>${fmt.n(p.beta, 2)}</td><td class="${cls(p.delta)}">${fmt.n(p.delta, 0)}</td>
            <td>${fmt.n(p.spyDelta, 1)}</td><td class="${cls(p.theta)}">${fmt.usd(p.theta, 2)}</td><td>${fmt.usd(p.vega, 2)}</td>
            <td class="${cls(p.down5)}">${fmt.usd(p.down5)}</td><td class="${cls(p.up5)}">${fmt.usd(p.up5)}</td></tr>`).join('')}
        </tbody></table></div>`;
    } catch (e) { el.innerHTML = errorBox(e); }
  }

  root.addEventListener('click', async e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const p = list.find(x => x.id === b.closest('tr').dataset.id); if (!p) return;
    if (b.dataset.a === 'analyze') {
      handoff.set('builder', { symbol: p.symbol, legs: p.legs.map(l => ({ ...l, price: l.price })), label: p.label, key: p.key });
      location.hash = '#/builder';
    } else if (b.dataset.a === 'close') {
      const v = prompt(`Realized P/L in dollars for ${p.symbol} ${p.label}:`, p.pnl != null ? p.pnl.toFixed(2) : '');
      if (v === null) return;
      await api.put(`positions/${p.id}`, { status: 'closed', closePnl: Number(v) || 0 });
      toast('Position closed'); load();
    } else if (b.dataset.a === 'del') {
      if (!confirm(`Remove ${p.symbol} ${p.label} from tracking?`)) return;
      await api.del(`positions/${p.id}`); load();
    }
  });

  await load();
  const t = setInterval(() => { if (!document.hidden) load(); }, 20000);
  return () => clearInterval(t);
}
