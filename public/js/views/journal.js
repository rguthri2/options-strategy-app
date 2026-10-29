import { api } from '../api.js';
import { esc, logo, fmt, cls, loading, errorBox, toast, sortable, handoff, prefs } from '../ui.js';
import { journalStats, describeInstrument } from '../../shared/journal.js';

const SETUPS = ['Qullamaggie breakout', 'Qullamaggie EP', 'Minervini VCP', "O'Neil base", 'Weinstein Stage 2', '21 EMA pullback', 'Earnings play', 'Mean reversion', 'Other'];
const PERIODS = [['all', 'All'], ['ytd', 'YTD'], ['90', '90d'], ['30', '30d'], ['mtd', 'MTD']];
const pad = n => String(n).padStart(2, '0');
const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const day = d => (d ? String(d).slice(0, 10) : '—');
const money = (v, d = 0) => `<span class="${cls(v)}">${fmt.usd(v, d)}</span>`;
const rTxt = v => (Number.isFinite(v) ? `<span class="${cls(v)}">${v >= 0 ? '+' : ''}${v.toFixed(2)}R</span>` : '—');

function periodStart(p) {
  const d = new Date();
  if (p === 'ytd') return `${d.getFullYear()}-01-01`;
  if (p === 'mtd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  if (p === '90' || p === '30') { d.setDate(d.getDate() - Number(p)); return d.toISOString().slice(0, 10); }
  return '';
}

function equitySvg(curve) {
  if (curve.length < 2) return '<div class="muted small">The equity curve appears after two closed trades.</div>';
  const W = 640, H = 170, P = 6, v = [0, ...curve.map(c => c.cum)];
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const x = i => P + (i / (v.length - 1)) * (W - 2 * P), y = val => H - P - ((val - lo) / span) * (H - 2 * P);
  const pts = v.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
  const col = v.at(-1) >= 0 ? 'var(--up)' : 'var(--down)';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="Cumulative realized P/L">
    <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--border-2)" stroke-dasharray="4 4"/>
    <polyline fill="none" stroke="${col}" stroke-width="2" points="${pts}"/></svg>
    <div class="row small muted"><span>${esc(curve[0].date)}</span><span class="spacer"></span><span>${esc(curve.at(-1).date)} · ${fmt.usd(v.at(-1))}</span></div>`;
}

function monthBars(months) {
  if (!months.length) return '<div class="muted small">No closed trades in this period.</div>';
  const max = Math.max(...months.map(m => Math.abs(m.net)), 1);
  return `<div class="jr-months">${months.map(m => `<div class="jr-m" title="${esc(m.key)}: ${fmt.usd(m.net)} · ${m.n} trades · ${fmt.pct(m.winRate, 0)} win">
    <div class="jr-bar-wrap"><div class="jr-bar ${m.net >= 0 ? 'pos' : 'neg'}" style="height:${Math.max(2, (Math.abs(m.net) / max) * 100)}%"></div></div>
    <span class="tiny">${esc(m.key.slice(2))}</span></div>`).join('')}</div>`;
}

const groupTable = (rows, label) => rows.length ? `<table class="t"><thead><tr><th class="l">${label}</th><th>Trades</th><th>Win %</th><th>Avg R</th><th>Net P/L</th></tr></thead><tbody>
  ${rows.map(g => `<tr><td class="l">${esc(g.key)}</td><td>${g.n}</td><td>${fmt.pct(g.winRate, 0)}</td><td>${rTxt(g.avgR)}</td><td>${money(g.net)}</td></tr>`).join('')}</tbody></table>`
  : '<div class="muted small">No closed trades yet.</div>';

export async function render(root) {
  const st = { period: prefs.get('jr-period', 'all'), status: prefs.get('jr-status', 'all'), asset: 'all', setup: '', account: prefs.get('jr-account', ''), q: '', data: null, sel: null, form: null };
  const accounts = () => st.data?.accounts || [];
  const acctOptions = (sel, blank = 'No account') => `<option value="">${blank}</option>${accounts().map(a => `<option value="${esc(a.id)}" ${a.id === sel ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}`;

  root.innerHTML = `
    <div class="page-h">
      <div style="flex:1"><h1>Trade Journal</h1><div class="muted small">Every stock and option trade you place in your broker: fills, P/L, R-multiples and statistics. Nothing here places orders.</div></div>
      <button class="btn" id="acctBtn">🏦 Accounts</button>
      <a class="btn" id="exp" href="api/journal/export.csv" download>⭳ Export CSV</a>
      <button class="btn primary" id="new">+ New trade</button>
    </div>
    <div id="accounts"></div>
    <div id="form"></div>
    <div class="card" style="margin-bottom:14px"><div class="row">
      <div class="seg" id="period">${PERIODS.map(([k, l]) => `<button data-v="${k}" class="${k === st.period ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="seg" id="status">${[['all', 'All'], ['open', 'Open'], ['closed', 'Closed']].map(([k, l]) => `<button data-v="${k}" class="${k === st.status ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="seg" id="asset">${[['all', 'All'], ['stock', 'Stocks'], ['option', 'Options']].map(([k, l]) => `<button data-v="${k}" class="${k === st.asset ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="acctf"><option value="">All accounts</option></select>
      <select id="setupf"><option value="">All setups</option></select>
      <input id="q" type="text" placeholder="Filter symbol…" style="width:130px">
    </div></div>
    <div class="stats-strip" id="stats" style="margin-bottom:14px">${loading()}</div>
    <div class="grid g2" style="margin-bottom:14px">
      <section class="card"><div class="card-h"><h2>Equity curve</h2><span class="muted small">Cumulative realized P/L, closed trades</span></div><div id="curve"></div></section>
      <section class="card"><div class="card-h"><h2>Monthly P/L</h2><span class="muted small">By exit month</span></div><div id="months"></div></section>
    </div>
    <section class="card" style="padding:0;margin-bottom:14px"><div class="table-wrap" style="max-height:calc(100vh - 220px)"><table class="t" id="tbl"><thead><tr>
      <th class="l" data-sort="symbol">Trade</th><th class="l" data-sort="setup">Setup</th><th class="l" data-sort="status">Status</th>
      <th data-sort="entryDate">Entry date</th><th data-sort="exitDate">Exit date</th><th data-sort="days">Days</th>
      <th data-sort="entrySize">Entry size</th><th data-sort="avgEntry">Avg entry</th><th data-sort="exitSize">Exit size</th><th data-sort="avgExit">Avg exit</th>
      <th data-sort="pnl">P/L</th><th data-sort="pnlPct">P/L %</th><th data-sort="r">R</th><th data-sort="grade">Grade</th>
    </tr></thead><tbody><tr><td colspan="14">${loading()}</td></tr></tbody></table></div></section>
    <div id="detail"></div>
    <div class="grid g3" style="margin-top:14px">
      <section class="card"><div class="card-h"><h2>By setup</h2></div><div id="bysetup"></div></section>
      <section class="card"><div class="card-h"><h2>By account</h2></div><div id="byaccount"></div></section>
      <section class="card"><div class="card-h"><h2>By asset &amp; direction</h2></div><div id="byasset"></div></section>
    </div>
    <datalist id="jrBrokers">${['Charles Schwab', 'Tradier', 'E*TRADE', 'Webull', 'Fidelity', 'Interactive Brokers', 'Robinhood', 'tastytrade', 'TradeStation', 'Vanguard', 'Merrill Edge', 'Firstrade', 'Public', 'Other'].map(b => `<option value="${esc(b)}">`).join('')}</datalist>`;
  const $ = s => root.querySelector(s);
  let sorter;

  const filtered = () => {
    const from = periodStart(st.period);
    return (st.data?.trades || []).filter(t =>
      (st.status === 'all' || t.status === st.status) && (st.asset === 'all' || t.assetType === st.asset) &&
      (!st.setup || t.setup === st.setup) && (!st.account || (st.account === 'none' ? !t.accountId : t.accountId === st.account)) && (!st.q || t.symbol.includes(st.q)) &&
      // Period: closed trades by exit date, open trades always shown.
      (!from || t.status !== 'closed' || day(t.exitDate) >= from));
  };

  const drawRows = rows => {
    $('#tbl tbody').innerHTML = rows.length ? rows.map(t => `<tr class="clickable ${st.sel === t.id ? 'sel' : ''}" data-id="${esc(t.id)}">
      <td class="l"><div class="sym-cell">${logo(t.symbol)}<span class="sym">${esc(t.symbol)}</span><span class="muted">${esc(t.assetType === 'option' ? t.instrument.replace(t.symbol + ' ', '') : 'Shares')} · ${t.direction === 'short' ? 'Short' : 'Long'}</span></div></td>
      <td class="l small">${esc(t.setup || '—')}${t.account ? `<div class="tiny muted">${esc(t.account)}</div>` : ''}</td>
      <td class="l">${t.status === 'open' ? '<span class="pill info">Open</span>' : t.status === 'closed' ? '<span class="pill">Closed</span>' : '<span class="pill warn">Planned</span>'}</td>
      <td>${day(t.entryDate)}</td><td>${day(t.exitDate)}</td><td>${t.days ?? '—'}</td>
      <td>${fmt.int(t.entrySize)}</td><td>${fmt.px(t.avgEntry)}</td>
      <td>${fmt.int(t.exitSize)}${t.openSize ? `<div class="tiny muted">${fmt.int(t.openSize)} open</div>` : ''}</td><td>${fmt.px(t.avgExit)}</td>
      <td><b>${money(t.pnl)}</b>${t.status === 'open' && Number.isFinite(t.unrealized) ? `<div class="tiny muted">${fmt.usd(t.realized)} real. · ${fmt.usd(t.unrealized)} unreal.</div>` : ''}</td>
      <td class="${cls(t.pnlPct)}">${fmt.spct(t.pnlPct, 1)}</td><td>${rTxt(t.r)}</td><td>${esc(t.grade || '—')}</td></tr>`).join('')
      : '<tr><td colspan="14"><div class="empty">No trades match. Click <b>+ New trade</b> to log one.</div></td></tr>';
  };

  const drawStats = rows => {
    const s = journalStats(rows);
    const stat = (l, v, sub = '', c = '') => `<div class="stat"><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="s">${sub}</div></div>`;
    $('#stats').innerHTML = [
      stat('Net P/L', fmt.usd(s.net), `${s.trades} closed · fees ${fmt.usd(s.fees)}`, cls(s.net)),
      stat('Win rate', fmt.pct(s.winRate, 0), `${s.wins}W · ${s.losses}L${s.breakeven ? ` · ${s.breakeven} BE` : ''}`),
      stat('Profit factor', s.profitFactor === Infinity ? '∞' : fmt.n(s.profitFactor, 2), 'Gross profit ÷ gross loss'),
      stat('Expectancy', fmt.usd(s.expectancy), `per trade · ${Number.isFinite(s.avgR) ? (s.avgR >= 0 ? '+' : '') + s.avgR.toFixed(2) + 'R avg' : 'set stops for R'}`, cls(s.expectancy)),
      stat('Avg win / loss', `${fmt.usd(s.avgWin)} / ${fmt.usd(s.avgLoss)}`, `Payoff ${fmt.n(s.payoff, 2)}`),
      stat('Largest', `${fmt.usd(s.largestWin)} / ${fmt.usd(s.largestLoss)}`, 'Best / worst trade'),
      stat('Max drawdown', fmt.usd(-s.maxDrawdown), `Streaks: ${s.maxConsecWins}W / ${s.maxConsecLosses}L`, s.maxDrawdown ? 'down' : ''),
      stat('Avg hold', `${fmt.n(s.avgHoldWin, 1)}d / ${fmt.n(s.avgHoldLoss, 1)}d`, 'Winners / losers'),
      stat('Open', `${s.open.count} · ${fmt.usd(s.open.unrealized)}`, `Exposure ${fmt.usd(s.open.exposure)} · risk to stops ${fmt.usd(s.open.risk)}`, cls(s.open.unrealized)),
    ].join('');
    $('#curve').innerHTML = equitySvg(s.curve);
    $('#months').innerHTML = monthBars(s.byMonth);
    $('#bysetup').innerHTML = groupTable(s.bySetup, 'Setup');
    $('#byasset').innerHTML = groupTable(s.byAsset, 'Asset');
    $('#byaccount').innerHTML = groupTable(s.byAccount, 'Account');
  };

  const redraw = () => {
    const rows = filtered().map(t => ({ ...t, pnl: t.realized + (t.unrealized || 0) }));
    drawStats(rows);
    if (!sorter) sorter = sortable($('#tbl'), rows, drawRows, { key: 'entryDate', dir: -1 });
    else sorter.update(rows);
    drawDetail();
  };

  const load = async () => {
    try {
      st.data = await api.get('journal');
      const setups = [...new Set([...SETUPS, ...st.data.trades.map(t => t.setup).filter(Boolean)])];
      $('#setupf').innerHTML = `<option value="">All setups</option>${setups.map(s => `<option ${s === st.setup ? 'selected' : ''}>${esc(s)}</option>`).join('')}`;
      if (st.account && st.account !== 'none' && !accounts().some(a => a.id === st.account)) st.account = '';
      $('#acctf').innerHTML = `<option value="">All accounts</option>${accounts().map(a => `<option value="${esc(a.id)}" ${a.id === st.account ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
        <option value="none" ${st.account === 'none' ? 'selected' : ''}>No account</option>`;
      setExport();
      if ($('#accounts').innerHTML) drawAccounts();
      redraw();
    } catch (e) { $('#tbl tbody').innerHTML = `<tr><td colspan="14">${errorBox(e)}</td></tr>`; $('#stats').innerHTML = ''; }
  };

  const setExport = () => { $('#exp').href = `api/journal/export.csv${st.account ? `?account=${encodeURIComponent(st.account)}` : ''}`; };

  // ---------- Brokerage accounts ----------
  const drawAccounts = () => {
    const used = id => (st.data?.trades || []).filter(t => t.accountId === id).length;
    $('#accounts').innerHTML = `<section class="card" style="margin-bottom:14px"><div class="card-h"><h2>Brokerage accounts</h2>
        <span class="muted small">Tag each trade with the account it was placed in. The last 4 digits are enough to identify an account.</span>
        <span class="spacer"></span><button class="btn sm ghost" id="acClose">✕</button></div>
      ${accounts().length ? `<table class="t" style="margin-bottom:12px"><thead><tr><th class="l">Brokerage</th><th class="l">Nickname</th><th class="l">Account #</th><th>Trades</th><th></th></tr></thead><tbody>
        ${accounts().map(a => `<tr><td class="l"><b>${esc(a.broker)}</b></td><td class="l">${esc(a.nickname || '—')}</td><td class="l mono">${esc(a.masked || '—')}</td><td>${used(a.id)}</td>
          <td class="nowrap">${a.syncable ? `<button class="btn sm primary" data-async="${esc(a.id)}" title="Read your Tradier fills and preview what would be imported">⟳ Sync</button> ` : ''}<button class="btn sm ghost" data-aren="${esc(a.id)}">Rename</button> <button class="btn sm ghost danger" data-adel="${esc(a.id)}">✕</button>
            ${a.lastSync ? `<div class="tiny muted">synced ${esc(new Date(a.lastSync).toLocaleString())}</div>` : ''}</td></tr>`).join('')}</tbody></table>
        <div id="syncBox"></div>`
        : '<p class="muted small">No accounts yet. Add each brokerage account you trade in.</p>'}
      <div class="row">
        <label class="field">Brokerage<input id="acBroker" type="text" list="jrBrokers" placeholder="e.g. Charles Schwab" style="width:180px"></label>
        <label class="field">Account # (last 4)<input id="acNum" type="text" maxlength="24" placeholder="1234" style="width:110px" autocomplete="off"></label>
        <label class="field">Nickname<input id="acNick" type="text" maxlength="40" placeholder="e.g. Roth IRA, Margin" style="width:160px"></label>
        <button class="btn primary" id="acAdd" style="align-self:flex-end">Add account</button>
      </div></section>`;
    const c = $('#accounts');
    c.querySelector('#acClose').addEventListener('click', () => { $('#accounts').innerHTML = ''; });
    c.querySelector('#acAdd').addEventListener('click', async () => {
      const v = s => c.querySelector(s).value.trim();
      try { await api.post('journal/accounts', { broker: v('#acBroker'), number: v('#acNum'), nickname: v('#acNick') }); toast('Account added'); await load(); drawAccounts(); }
      catch (e) { toast(e.message, true); }
    });
    c.querySelectorAll('[data-adel]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remove this account?')) return;
      try { await api.del(`journal/accounts/${encodeURIComponent(b.dataset.adel)}`); await load(); drawAccounts(); } catch (e) { toast(e.message, true); }
    }));
    c.querySelectorAll('[data-async]').forEach(b => b.addEventListener('click', () => drawSync(b.dataset.async)));
    c.querySelectorAll('[data-aren]').forEach(b => b.addEventListener('click', async () => {
      const a = accounts().find(x => x.id === b.dataset.aren);
      const nick = prompt(`Nickname for ${a.broker} ${a.masked}`, a.nickname || '');
      if (nick === null) return;
      try { await api.put(`journal/accounts/${encodeURIComponent(a.id)}`, { nickname: nick }); await load(); drawAccounts(); } catch (e) { toast(e.message, true); }
    }));
  };

  // ---------- Tradier sync: preview, then import (read-only on Tradier) ----------
  const drawSync = id => {
    const a = accounts().find(x => x.id === id);
    const box = $('#syncBox');
    if (!a || !box) return;
    const yearAgo = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); };
    box.innerHTML = `<div class="card" style="background:var(--panel-2);margin:0 0 12px">
      <div class="row"><b>Sync ${esc(a.label)}</b><span class="muted small">Reads your Tradier fills (read-only: nothing is sent to Tradier). History updates nightly; today's fills come from today's orders.</span></div>
      <div class="row" style="margin-top:8px"><label class="field">Import fills since<input id="syncSince" type="date" value="${esc(a.syncSince || yearAgo())}"></label>
        <button class="btn primary" id="syncPrev" style="align-self:flex-end">Preview</button></div>
      <div id="syncOut" style="margin-top:10px"></div></div>`;
    const out = box.querySelector('#syncOut');
    const fillTxt = f => `${esc(f.date.replace('T', ' '))} ${f.side === 'buy' ? '<span class="up">Buy</span>' : '<span class="down">Sell</span>'} ${fmt.int(f.qty)} @ ${fmt.px(f.price)}${f.fees ? ` · fees ${fmt.usd(f.fees, 2)}` : ''}`;
    const show = r => {
      const c = r.counts;
      out.innerHTML = `<div class="small" style="margin-bottom:8px">Tradier account <b>${esc(r.tradierAccount)}</b> · ${r.fetched.history} history events, ${r.fetched.orders} orders today ·
          <b>${c.newTrades}</b> new trade${c.newTrades === 1 ? '' : 's'}, <b>${c.fills}</b> fill${c.fills === 1 ? '' : 's'}${r.feeUpdates ? `, ${r.feeUpdates} commission update${r.feeUpdates === 1 ? '' : 's'}` : ''} · ${c.alreadyInJournal} already in the journal</div>
        ${r.preview.length ? `<table class="t"><thead><tr><th class="l">Action</th><th class="l">Instrument</th><th class="l">Fills</th></tr></thead><tbody>
          ${r.preview.map(p => `<tr><td class="l">${esc(p.action)}${p.direction ? ` · ${esc(p.direction)}` : ''}</td><td class="l"><b>${esc(p.instrument)}</b></td><td class="l small">${p.fills.map(fillTxt).join('<br>')}</td></tr>`).join('')}</tbody></table>`
          : `<div class="muted small">${r.applied ? 'Imported.' : 'Nothing new to import: the journal is up to date.'}</div>`}
        ${r.review.length ? `<div class="banner" style="margin-top:10px"><b>Needs review (not imported):</b><ul style="margin:6px 0 0;padding-left:18px">${r.review.map(x => `<li>${esc(x.reason)}: <span class="mono small">${esc(x.detail)}</span></li>`).join('')}</ul></div>` : ''}
        ${!r.applied && (c.fills || r.feeUpdates) ? `<div class="row" style="margin-top:10px"><button class="btn primary" id="syncApply">Import ${c.fills} fill${c.fills === 1 ? '' : 's'}</button><span class="muted small">Check the list first: sides, sizes and prices should match your Tradier statements.</span></div>` : ''}`;
      out.querySelector('#syncApply')?.addEventListener('click', async e => {
        e.target.disabled = true; e.target.textContent = 'Importing…';
        try { const done = await api.post(`journal/accounts/${encodeURIComponent(id)}/sync`, { apply: true, since: box.querySelector('#syncSince').value }); toast(`Imported ${done.counts.fills} fill${done.counts.fills === 1 ? '' : 's'}`); await load(); drawAccounts(); }
        catch (err) { toast(err.message, true); e.target.disabled = false; }
      });
    };
    box.querySelector('#syncPrev').addEventListener('click', async e => {
      e.target.disabled = true; out.innerHTML = loading('Reading Tradier…');
      try { show(await api.post(`journal/accounts/${encodeURIComponent(id)}/sync`, { apply: false, since: box.querySelector('#syncSince').value })); }
      catch (err) { out.innerHTML = errorBox(err); }
      e.target.disabled = false;
    });
  };

  // ---------- New trade form ----------
  const drawForm = pre => {
    st.form = { assetType: pre?.assetType || 'stock', direction: pre?.direction || 'long' };
    const o = st.form.assetType === 'option';
    $('#form').innerHTML = `<section class="card" style="margin-bottom:14px"><div class="card-h"><h2>New trade</h2><span class="muted small">Log the opening fill. Add scale-ins and exits later from the trade's detail panel.</span></div>
      <div class="row" style="margin-bottom:10px">
        <div class="seg" id="fAsset"><button data-v="stock" class="${!o ? 'on' : ''}">Stock</button><button data-v="option" class="${o ? 'on' : ''}">Option</button></div>
        <div class="seg" id="fDir"><button data-v="long" class="${st.form.direction === 'long' ? 'on' : ''}">Long (buy to open)</button><button data-v="short" class="${st.form.direction === 'short' ? 'on' : ''}">Short (sell to open)</button></div>
      </div>
      <div class="jr-form">
        <label class="field">Account<select id="fAcct">${acctOptions(prefs.get('jr-last-account', ''))}</select></label>
        <label class="field">Symbol<input id="fSym" type="text" value="${esc(pre?.symbol || '')}" style="text-transform:uppercase" required></label>
        <span class="jr-opt" ${o ? '' : 'hidden'}><label class="field">Type<select id="fType"><option value="call">Call</option><option value="put">Put</option></select></label></span>
        <span class="jr-opt" ${o ? '' : 'hidden'}><label class="field">Expiration<input id="fExp" type="date"></label></span>
        <span class="jr-opt" ${o ? '' : 'hidden'}><label class="field">Strike<input id="fK" type="number" step="0.5" min="0"></label></span>
        <span class="jr-opt" ${o ? '' : 'hidden'}><label class="field">2nd strike (spread)<input id="fK2" type="number" step="0.5" min="0" placeholder="optional"></label></span>
        <label class="field">Date &amp; time<input id="fDate" type="datetime-local" value="${nowLocal()}"></label>
        <label class="field"><span id="fQtyL">${o ? 'Contracts' : 'Shares'}</span><input id="fQty" type="number" min="1" step="1"></label>
        <label class="field"><span id="fPxL">${o ? 'Price (premium per share)' : 'Price'}</span><input id="fPx" type="number" min="0" step="0.01" value="${pre?.entry ?? ''}"></label>
        <label class="field">Fees<input id="fFees" type="number" min="0" step="0.01" value="0"></label>
        <label class="field">Setup<input id="fSetup" type="text" list="jrSetups" value="${esc(pre?.setup || '')}"></label>
        <label class="field">Strategy<input id="fStrat" type="text" value="${esc(pre?.strategy || '')}" placeholder="e.g. Bull call spread"></label>
        <label class="field"><span id="fStopL">${o ? 'Stop (premium)' : 'Stop'}</span><input id="fStop" type="number" min="0" step="0.01" value="${pre?.stop ?? ''}"></label>
        <label class="field">Target<input id="fTgt" type="number" min="0" step="0.01" value="${pre?.target ?? ''}"></label>
        <label class="field">Risk $ (optional)<input id="fRisk" type="number" min="0" step="1" placeholder="auto from stop"></label>
        <label class="field" style="grid-column:1/-1">Tags<input id="fTags" type="text" placeholder="comma separated, e.g. A+ setup, earnings, half size" value="${esc(pre?.tags || '')}"></label>
        <label class="field" style="grid-column:1/-1">Notes / thesis<textarea id="fNotes" style="min-height:60px;font-family:inherit;font-size:13px">${esc(pre?.notes || '')}</textarea></label>
      </div>
      <datalist id="jrSetups">${SETUPS.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="fSave">Save trade</button><button class="btn ghost" id="fCancel">Cancel</button>
        <span class="muted small" id="fRiskHint"></span></div></section>`;
    const f = $('#form');
    const toggleOpt = () => {
      const opt = st.form.assetType === 'option';
      f.querySelectorAll('.jr-opt').forEach(x => { x.hidden = !opt; });
      f.querySelector('#fQtyL').textContent = opt ? 'Contracts' : 'Shares';
      f.querySelector('#fPxL').textContent = opt ? 'Price (premium per share)' : 'Price';
      f.querySelector('#fStopL').textContent = opt ? 'Stop (premium)' : 'Stop';
    };
    const hint = () => {
      const px = Number(f.querySelector('#fPx').value), stop = Number(f.querySelector('#fStop').value), q = Number(f.querySelector('#fQty').value);
      const mult = st.form.assetType === 'option' ? 100 : 1, per = st.form.direction === 'short' ? stop - px : px - stop;
      f.querySelector('#fRiskHint').textContent = px > 0 && stop > 0 && q > 0 && per > 0 ? `Risk to stop: ${fmt.usd(per * q * mult)} (${fmt.pct(per / px, 1)})` : '';
    };
    f.querySelector('#fAsset').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.form.assetType = b.dataset.v; f.querySelectorAll('#fAsset button').forEach(x => x.classList.toggle('on', x === b)); toggleOpt(); hint(); });
    f.querySelector('#fDir').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.form.direction = b.dataset.v; f.querySelectorAll('#fDir button').forEach(x => x.classList.toggle('on', x === b)); hint(); });
    ['#fPx', '#fStop', '#fQty'].forEach(s => f.querySelector(s).addEventListener('input', hint));
    f.querySelector('#fCancel').addEventListener('click', () => { $('#form').innerHTML = ''; });
    f.querySelector('#fSave').addEventListener('click', async () => {
      const v = s => f.querySelector(s).value.trim();
      const opt = st.form.assetType === 'option';
      const body = {
        symbol: v('#fSym').toUpperCase(), assetType: st.form.assetType, direction: st.form.direction,
        ...(opt ? { optionType: v('#fType'), expiry: v('#fExp'), strike: v('#fK'), strike2: v('#fK2') } : {}),
        accountId: v('#fAcct'), setup: v('#fSetup'), strategy: v('#fStrat'), stop: v('#fStop'), target: v('#fTgt'), riskAmount: v('#fRisk'), tags: v('#fTags'), notes: v('#fNotes'),
        fills: [{ date: v('#fDate'), side: st.form.direction === 'short' ? 'sell' : 'buy', qty: v('#fQty'), price: v('#fPx'), fees: v('#fFees') || 0 }],
      };
      try {
        const t = await api.post('journal', body);
        prefs.set('jr-last-account', body.accountId);
        toast(`Logged ${describeInstrument(t)}`);
        $('#form').innerHTML = ''; st.sel = t.id; await load();
      } catch (e) { toast(e.message, true); }
    });
    f.scrollIntoView({ block: 'nearest' });
  };

  // ---------- Detail panel: fills, scale in/out, review ----------
  const drawDetail = () => {
    const t = st.data?.trades.find(x => x.id === st.sel);
    if (!t) { $('#detail').innerHTML = ''; return; }
    const closeSide = t.direction === 'short' ? 'buy' : 'sell', openSide = t.direction === 'short' ? 'sell' : 'buy';
    const sideLbl = s => (s === openSide ? (t.direction === 'short' ? 'Sell to open' : 'Buy') : (t.direction === 'short' ? 'Buy to close' : 'Sell'));
    const fills = [...t.fills].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    $('#detail').innerHTML = `<section class="card"><div class="card-h"><h2>${esc(t.instrument)} · ${t.direction === 'short' ? 'Short' : 'Long'}</h2>
        <span class="spacer"></span><a class="btn sm" href="#/t/${encodeURIComponent(t.symbol)}">Stock page</a> <a class="btn sm" href="#/chart/${encodeURIComponent(t.symbol)}">Chart</a> <button class="btn sm ghost" id="dClose">✕</button></div>
      <div class="stats-strip" style="margin-bottom:12px">
        <div class="stat"><div class="l">Status</div><div class="v">${esc(t.status)}</div><div class="s">${t.openSize ? `${fmt.int(t.openSize)} open @ ${fmt.px(t.avgCost)} avg` : `${t.days ?? 0} days held`}</div></div>
        <div class="stat"><div class="l">Realized</div><div class="v ${cls(t.realized)}">${fmt.usd(t.realized, 2)}</div><div class="s">fees ${fmt.usd(t.fees, 2)}</div></div>
        <div class="stat"><div class="l">Unrealized</div><div class="v ${cls(t.unrealized)}">${fmt.usd(t.unrealized, 2)}</div><div class="s">${Number.isFinite(t.mark) ? `mark ${fmt.px(t.mark)}` : t.openSize ? 'no live quote' : '—'}</div></div>
        <div class="stat"><div class="l">R multiple</div><div class="v">${rTxt(t.r)}</div><div class="s">risk ${fmt.usd(t.risk)}</div></div>
        <div class="stat"><div class="l">Plan</div><div class="v small">Stop ${fmt.px(t.stop)} · Target ${fmt.px(t.target)}</div><div class="s">${Number.isFinite(t.openRisk) && t.openSize ? `open risk ${fmt.usd(t.openRisk)}` : ''}</div></div>
      </div>
      <div class="grid g2">
        <div>
          <h3 class="small muted" style="margin:0 0 6px">FILLS</h3>
          <table class="t"><thead><tr><th class="l">Date</th><th class="l">Action</th><th>Qty</th><th>Price</th><th>Fees</th><th></th></tr></thead><tbody>
            ${fills.map(f => `<tr><td class="l">${esc(f.date.replace('T', ' '))}</td><td class="l"><span class="${f.side === openSide ? 'up' : 'down'}">${sideLbl(f.side)}</span></td>
              <td>${fmt.int(f.qty)}</td><td>${fmt.px(f.price)}</td><td>${fmt.usd(f.fees, 2)}</td><td><button class="btn sm ghost danger" data-fdel="${esc(f.id)}" title="Delete fill">✕</button></td></tr>`).join('')}
          </tbody></table>
          <div class="jr-fill" style="margin-top:10px">
            <select id="aSide"><option value="${closeSide}" ${t.openSize ? 'selected' : ''}>${sideLbl(closeSide)}</option><option value="${openSide}" ${t.openSize ? '' : 'selected'}>${sideLbl(openSide)} (add)</option></select>
            <input id="aDate" type="datetime-local" value="${nowLocal()}">
            <input id="aQty" type="number" min="1" step="1" placeholder="Qty" value="${t.openSize || ''}">
            <input id="aPx" type="number" min="0" step="0.01" placeholder="Price" value="${Number.isFinite(t.mark) ? t.mark.toFixed(2) : ''}">
            <input id="aFees" type="number" min="0" step="0.01" placeholder="Fees" value="0">
            <button class="btn primary sm" id="aAdd">Add fill</button>
          </div>
          <div class="muted tiny" style="margin-top:4px">Scale out: enter part of the open size. Close everything: leave the full open size.</div>
        </div>
        <div class="jr-review">
          <h3 class="small muted" style="margin:0 0 6px">PLAN &amp; REVIEW</h3>
          <div class="jr-form">
            <label class="field">Account<select id="rAcct">${acctOptions(t.accountId || '')}</select></label>
            <label class="field">Setup<input id="rSetup" type="text" list="jrSetups2" value="${esc(t.setup || '')}"></label>
            <label class="field">Strategy<input id="rStrat" type="text" value="${esc(t.strategy || '')}"></label>
            <label class="field">Stop<input id="rStop" type="number" min="0" step="0.01" value="${t.stop ?? ''}"></label>
            <label class="field">Target<input id="rTgt" type="number" min="0" step="0.01" value="${t.target ?? ''}"></label>
            <label class="field">Risk $<input id="rRisk" type="number" min="0" step="1" value="${t.riskAmount ?? ''}" placeholder="auto"></label>
            <label class="field">Grade<select id="rGrade">${['', 'A', 'B', 'C', 'D', 'F'].map(g => `<option ${g === (t.grade || '') ? 'selected' : ''} value="${g}">${g || '—'}</option>`).join('')}</select></label>
            <label class="field">Followed plan?<select id="rPlan"><option value="">—</option><option value="yes" ${t.followedPlan === true ? 'selected' : ''}>Yes</option><option value="no" ${t.followedPlan === false ? 'selected' : ''}>No</option></select></label>
            <label class="field" style="grid-column:1/-1">Tags<input id="rTags" type="text" value="${esc((t.tags || []).join(', '))}"></label>
            <label class="field" style="grid-column:1/-1">Notes<textarea id="rNotes" style="min-height:60px;font-family:inherit;font-size:13px">${esc(t.notes || '')}</textarea></label>
            <label class="field" style="grid-column:1/-1">Lessons / mistakes<textarea id="rLessons" style="min-height:50px;font-family:inherit;font-size:13px">${esc(t.lessons || '')}</textarea></label>
          </div>
          <datalist id="jrSetups2">${SETUPS.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
          <div class="row" style="margin-top:10px"><button class="btn primary sm" id="rSave">Save review</button><span class="spacer"></span><button class="btn sm ghost danger" id="rDel">Delete trade</button></div>
        </div>
      </div></section>`;
    const d = $('#detail');
    d.querySelector('#dClose').addEventListener('click', () => { st.sel = null; drawDetail(); });
    d.querySelector('#aAdd').addEventListener('click', async () => {
      const v = s => d.querySelector(s).value;
      try {
        await api.post(`journal/${encodeURIComponent(t.id)}/fills`, { side: v('#aSide'), date: v('#aDate'), qty: v('#aQty'), price: v('#aPx'), fees: v('#aFees') || 0 });
        toast('Fill added'); await load();
      } catch (e) { toast(e.message, true); }
    });
    d.querySelectorAll('[data-fdel]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this fill?')) return;
      try { await api.del(`journal/${encodeURIComponent(t.id)}/fills/${encodeURIComponent(b.dataset.fdel)}`); await load(); } catch (e) { toast(e.message, true); }
    }));
    d.querySelector('#rSave').addEventListener('click', async () => {
      const v = s => d.querySelector(s).value.trim();
      const plan = v('#rPlan');
      try {
        await api.put(`journal/${encodeURIComponent(t.id)}`, { accountId: v('#rAcct'), setup: v('#rSetup'), strategy: v('#rStrat'), stop: v('#rStop'), target: v('#rTgt'), riskAmount: v('#rRisk'),
          grade: v('#rGrade'), followedPlan: plan === 'yes' ? true : plan === 'no' ? false : null, tags: v('#rTags'), notes: v('#rNotes'), lessons: v('#rLessons') });
        toast('Saved'); await load();
      } catch (e) { toast(e.message, true); }
    });
    d.querySelector('#rDel').addEventListener('click', async () => {
      if (!confirm(`Delete the ${t.instrument} trade and all its fills?`)) return;
      try { await api.del(`journal/${encodeURIComponent(t.id)}`); st.sel = null; await load(); } catch (e) { toast(e.message, true); }
    });
  };

  // ---------- Events ----------
  const seg = (id, key, pref) => $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st[key] = b.dataset.v; if (pref) prefs.set(pref, st[key]);
    root.querySelectorAll(`${id} button`).forEach(x => x.classList.toggle('on', x === b)); redraw();
  });
  seg('#period', 'period', 'jr-period'); seg('#status', 'status', 'jr-status'); seg('#asset', 'asset');
  $('#setupf').addEventListener('change', e => { st.setup = e.target.value; redraw(); });
  $('#acctf').addEventListener('change', e => { st.account = e.target.value; prefs.set('jr-account', st.account); setExport(); redraw(); });
  $('#acctBtn').addEventListener('click', () => { if ($('#accounts').innerHTML) $('#accounts').innerHTML = ''; else drawAccounts(); });
  $('#q').addEventListener('input', e => { st.q = e.target.value.trim().toUpperCase(); redraw(); });
  $('#new').addEventListener('click', () => drawForm());
  $('#tbl').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    st.sel = st.sel === tr.dataset.id ? null : tr.dataset.id;
    root.querySelectorAll('#tbl tr[data-id]').forEach(x => x.classList.toggle('sel', x.dataset.id === st.sel));
    drawDetail();
    if (st.sel) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  await load();
  // Pre-filled from the Daily Scanner ("Log trade").
  const pre = handoff.get('journal-new');
  if (pre) { handoff.set('journal-new', null); drawForm(pre); }
}
