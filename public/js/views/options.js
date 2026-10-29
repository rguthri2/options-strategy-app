import { api } from '../api.js';
import { esc, fmt, cls, loading, errorBox, toast, handoff, prefs } from '../ui.js';
import { strikeBars } from '../charts.js';
import { price as bsPrice } from '../../shared/bs.js';
import { yearsToExpiry } from '../../shared/time.js';
import { expectedMove, maxPain, totals, skew25, oiWalls } from '../../shared/analytics.js';
import { netCost, fmtStrike, describeLegs, fmtExp as fmtExpShort } from '../../shared/strategy.js';

const COLS = {
  quote: [['bid', 'Bid'], ['ask', 'Ask'], ['mark', 'Mark'], ['last', 'Last'], ['volume', 'Vol'], ['oi', 'OI']],
  greeks: [['mark', 'Mark'], ['iv', 'IV'], ['delta', 'Delta'], ['gamma', 'Gamma'], ['theta', 'Θ/day'], ['vega', 'Vega']],
  full: [['bid', 'Bid'], ['ask', 'Ask'], ['mark', 'Mark'], ['volume', 'Vol'], ['oi', 'OI'], ['iv', 'IV'], ['delta', 'Δ'], ['gamma', 'Γ'], ['theta', 'Θ/day'], ['vega', 'V']],
};

// One chain cell. `base` carries the ITM shading class; data-t identifies the call/put side.
function cell(c, key, maxOi, t, base) {
  const td = (content, extra = '', attrs = '') => `<td data-t="${t}" class="${base} ${extra}" ${attrs}>${content}</td>`;
  if (!c) return td('—', 'faint');
  const v = c[key];
  switch (key) {
    case 'bid': return td(fmt.opt(v), 'q bidc', 'data-side="sell" title="Sell at bid"');
    case 'ask': return td(fmt.opt(v), 'q askc', 'data-side="buy" title="Buy at ask"');
    case 'mark': case 'last': return td(fmt.opt(v));
    case 'volume': return td(fmt.int(v), c.oi && v > c.oi * 1.5 && v > 200 ? 'unusual' : '', c.oi ? `title="Vol/OI ${(v / c.oi).toFixed(2)}"` : '');
    case 'oi': return td(fmt.int(v), v >= maxOi * 0.7 ? 'hot-oi' : '');
    case 'iv': {
      // Model IV (live mid, implied forward, American where relevant); vendor (ORATS) value as cross-check.
      const vend = c.vendor?.iv;
      const tip = Number.isFinite(vend) ? `title="Model ${fmt.iv(v)} (${c.model || 'model'}${c.ivSource === 'vendor' ? ', vendor fallback' : ''}) · ORATS ${fmt.iv(vend)} · diff ${((v - vend) * 100).toFixed(2)} pts"` : '';
      return td(fmt.iv(v), Number.isFinite(vend) && Math.abs(v - vend) > 0.03 ? 'faint' : '', tip);
    }
    case 'delta': return td(fmt.greek(v, 2));
    case 'gamma': return td(fmt.greek(v, 4));
    case 'theta': case 'vega': return td(fmt.greek(v, 3));
    default: return td(fmt.n(v, 2));
  }
}

export async function render(root, [symArg], query) {
  const symbol = symArg || prefs.get('opt-sym', 'SPY');
  if (!symArg) { location.replace(`#/options/${encodeURIComponent(symbol)}`); return; }

  const st = {
    exps: [], exp: query.exp || null, chain: null, cols: prefs.get('opt-cols', 'full'), range: prefs.get('opt-range', 12),
    what: { S: null, days: 0, iv: 0 }, barMode: 'oi', ticket: handoff.get('ticket')?.symbol === symbol ? handoff.get('ticket').legs : [],
  };

  root.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="row" style="align-items:flex-start">
        <div style="flex:1" id="qhead">${loading()}</div>
        <form id="symf" class="row"><input id="symi" type="text" value="${esc(symbol)}" style="width:110px;text-transform:uppercase"><button class="btn">Load</button></form>
        <a class="btn" href="#/t/${esc(symbol)}">Chart</a>
      </div>
      <div class="exp-pills" id="exps" style="margin-top:12px"></div>
    </div>
    <div class="stats-strip" id="stats" style="margin-bottom:14px"></div>
    <div class="card" style="margin-bottom:14px">
      <div class="whatif">
        <label><span>What-if stock price: <b id="wS">—</b> <span id="wSp" class="muted"></span></span><input id="rS" type="range" min="-25" max="25" step="0.5" value="0"></label>
        <label><span>What-if date (time decay): <b id="wD">0</b> days <span id="wDd" class="muted"></span></span><input id="rD" type="range" min="0" max="30" step="1" value="0"></label>
        <label><span>IV change: <b id="wV">+0</b> pts</span><input id="rV" type="range" min="-30" max="30" step="1" value="0"></label>
        <div class="row"><input id="nS" type="number" step="0.01" placeholder="Price" style="width:110px"><button class="btn sm" id="wReset">Reset</button></div>
      </div>
      <hr class="sep">
      <div class="row">
        <div class="seg" id="cols">${Object.keys(COLS).map(k => `<button data-v="${k}" class="${st.cols === k ? 'on' : ''}">${k === 'quote' ? 'Quotes' : k === 'greeks' ? 'Greeks' : 'Full'}</button>`).join('')}</div>
        <div class="seg" id="range">${[[6, '±6'], [12, '±12'], [20, '±20'], [999, 'All']].map(([v, l]) => `<button data-v="${v}" class="${st.range == v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="spacer"></span>
        <span class="muted small">Click <span class="down">bid</span> to sell / <span class="up">ask</span> to buy → builds a ticket</span>
        <span id="upd" class="muted small"></span>
      </div>
    </div>
    <div class="chain-wrap" id="chainwrap">${loading('Loading option chain…')}</div>
    <div class="grid g2" style="margin-top:14px">
      <section class="card"><div class="card-h"><h2>Open interest by strike</h2><div class="seg" id="bm"><button data-v="oi" class="on">OI</button><button data-v="volume">Volume</button></div></div><div id="bars"></div></section>
      <section class="card"><div class="card-h"><h2>Unusual activity</h2><span class="muted small">Volume ≥ 1.5× open interest</span></div><div id="unusual"></div></section>
    </div>
    <div id="tray"></div>`;

  const $ = s => root.querySelector(s);

  const drawHead = q => {
    $('#qhead').innerHTML = `<div class="muted small">${esc(q.name || symbol)} · Options</div>
      <div class="quote-head"><span class="px">${esc(symbol)} ${fmt.px(q.last)}</span><span class="chg ${cls(q.change)}">${fmt.schg(q.change)} (${fmt.spct(q.changePct)})</span>
      <span class="muted small">Bid ${fmt.px(q.bid)} · Ask ${fmt.px(q.ask)} · Vol ${fmt.big(q.volume)}</span></div>`;
  };

  const drawExps = () => {
    const er = st.earnings;
    const spansEr = d => er && (er.date < d || (er.date === d && er.hour === 'bmo'));
    $('#exps').innerHTML = st.exps.map(e => `<button class="exp-pill ${e.date === st.exp ? 'on' : ''} ${e.type === 'M' ? 'm' : ''}" data-d="${esc(e.date)}"
      ${spansEr(e.date) ? `title="Includes earnings on ${esc(er.date)}"` : ''}>
      ${esc(fmtExpShort(e.date))}<small>${e.dte}d · ${e.type === 'M' ? 'Monthly' : e.type === 'Q' ? 'Quarterly' : 'Weekly'}${spansEr(e.date) ? ' · <span style="color:var(--warn)">ER</span>' : ''}</small></button>`).join('');
    $('#exps').querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  };

  const scenario = () => {
    const spot = st.chain.spot;
    const S = st.what.S ?? spot;
    const active = Math.abs(S - spot) > 1e-9 || st.what.days > 0 || st.what.iv !== 0;
    return { S, active, atMs: Date.now() + st.what.days * 86400000 };
  };

  const theoFor = (c, sc) => {
    const T = Math.max(0, yearsToExpiry(c.expiry, sc.atMs));
    return bsPrice(c.type, sc.S, c.strike, T, Math.max(0.01, (c.iv || 0.3) + st.what.iv / 100), c.r ?? st.chain.rate, c.q || 0);
  };

  const drawStats = () => {
    const e = st.chain.expiration, spot = st.chain.spot;
    const T = yearsToExpiry(e.date);
    const em = expectedMove(e.rows, spot, T);
    const tot = totals(e.rows);
    const mp = maxPain(e.rows);
    const walls = oiWalls(e.rows, 2);
    const sk = skew25(e.rows);
    const stat = (l, v, s = '') => `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    $('#stats').innerHTML = [
      stat('Spot', fmt.px(spot), `${e.dte} DTE · ${esc(e.date)}`),
      stat('Earnings', st.earnings ? `${st.earnings.days}d` : '—', st.earnings ? `${esc(st.earnings.date)} ${esc(st.earnings.hour || '')}${st.earnings.date <= e.date ? ' · <span style="color:var(--warn)">before exp</span>' : ''}` : 'none scheduled'),
      stat('ATM IV', fmt.iv(em.iv), `Skew 25Δ ${Number.isFinite(sk) ? (sk >= 0 ? '+' : '') + (sk * 100).toFixed(1) + ' pts' : '—'}`),
      stat('Expected move', `±${fmt.px(em.straddle)}`, `${fmt.pct(em.straddle / spot, 1)} · straddle`),
      stat('1σ range', `${fmt.px(spot - em.sd1, 0)}–${fmt.px(spot + em.sd1, 0)}`, `IV-implied ±${fmt.px(em.sd1)}`),
      stat('Max pain', fmt.px(mp, mp >= 100 ? 0 : 2), `${fmt.spct(mp / spot - 1, 1)} from spot`),
      stat('Put/Call OI', fmt.n(tot.pcrOI, 2), `C ${fmt.big(tot.callOI)} · P ${fmt.big(tot.putOI)}`),
      stat('Put/Call Vol', fmt.n(tot.pcrVol, 2), `C ${fmt.big(tot.callVol)} · P ${fmt.big(tot.putVol)}`),
      stat('OI walls', `<span class="up">${walls.calls.map(fmtStrike).join(', ')}</span>`, `<span class="down">Puts ${walls.puts.map(fmtStrike).join(', ')}</span>`),
      Number.isFinite(e.forward) ? stat('Pricing model', `r ${(e.rate * 100).toFixed(2)}%`,
        `carry ${(e.carry * 100).toFixed(2)}% · fwd ${fmt.px(e.forward)}${st.chain.valuationTime && Date.now() - st.chain.valuationTime > 3600000 ? ' · as of close' : ''}`) : '',
    ].join('');
  };

  const drawChain = () => {
    const e = st.chain.expiration, spot = st.chain.spot;
    const sc = scenario();
    const cols = COLS[st.cols];
    const atmIdx = e.rows.reduce((b, r, i) => (Math.abs(r.strike - spot) < Math.abs(e.rows[b].strike - spot) ? i : b), 0);
    const rows = e.rows.slice(Math.max(0, atmIdx - st.range), atmIdx + st.range + 1);
    const maxOi = Math.max(...rows.flatMap(r => [r.call?.oi || 0, r.put?.oi || 0]));
    const extra = sc.active ? [['theo', 'What-if price'], ['dv', 'P/L']] : [];
    const callCols = [...cols, ...extra].slice().reverse();
    const putCols = [...cols, ...extra];
    const extraCell = (c, key, base) => {
      if (!c) return `<td class="${base}">—</td>`;
      const th = theoFor(c, sc);
      if (key === 'theo') return `<td class="${base} theo">${fmt.opt(th)}</td>`;
      const d = (th - (c.mark || 0)) * 100; // per contract
      return `<td class="${base} ${cls(d)}" title="Per contract vs mark ${fmt.opt(c.mark)}">${d >= 0 ? '+' : '−'}${fmt.usd(Math.abs(d))}</td>`;
    };
    const side = (c, list, t, base) => list.map(([k]) => (k === 'theo' || k === 'dv' ? extraCell(c, k, base) : cell(c, k, maxOi, t, base))).join('');
    let spotDrawn = false;
    const body = rows.map(r => {
      let pre = '';
      if (!spotDrawn && r.strike >= spot) {
        spotDrawn = true;
        pre = `<tr class="spot-row"><td colspan="${callCols.length * 2 + 1}"><div class="spot-line"><span>${esc(symbol)} ${fmt.px(spot)}${sc.active ? ` → what-if ${fmt.px(sc.S)}` : ''}</span></div></td></tr>`;
      }
      const citm = r.strike < spot ? 'itm' : '', pitm = r.strike > spot ? 'itm' : '';
      return `${pre}<tr data-k="${r.strike}">${side(r.call, callCols, 'call', citm)}<td class="strike">${fmtStrike(r.strike)}</td>${side(r.put, putCols, 'put', pitm)}</tr>`;
    }).join('');
    const scroll = $('#chainwrap').scrollTop;
    $('#chainwrap').innerHTML = `<table class="chain"><thead>
      <tr><th colspan="${callCols.length}">CALLS</th><th class="exp-head">${esc(fmtExpShort(e.date))}<small>${e.dte} DTE</small></th><th colspan="${putCols.length}">PUTS</th></tr>
      <tr>${callCols.map(([, l]) => `<th>${l}</th>`).join('')}<th style="text-align:center">Strike</th>${putCols.map(([, l]) => `<th>${l}</th>`).join('')}</tr>
      </thead><tbody>${body}</tbody></table>`;
    if (st.firstDraw !== false) {
      st.firstDraw = false;
      const sr = $('#chainwrap .spot-row');
      if (sr) $('#chainwrap').scrollTop = sr.offsetTop - $('#chainwrap').clientHeight / 2;
    } else $('#chainwrap').scrollTop = scroll;
  };

  const drawBars = () => {
    const e = st.chain.expiration;
    const atmIdx = e.rows.reduce((b, r, i) => (Math.abs(r.strike - st.chain.spot) < Math.abs(e.rows[b].strike - st.chain.spot) ? i : b), 0);
    const rows = e.rows.slice(Math.max(0, atmIdx - 20), atmIdx + 21);
    strikeBars($('#bars'), rows, { spot: st.chain.spot, maxPain: maxPain(e.rows), mode: st.barMode });
    const un = e.rows.flatMap(r => [r.call, r.put]).filter(c => c && c.volume >= 200 && c.volume >= 1.5 * (c.oi || 0))
      .map(c => ({ ...c, prem: c.volume * (c.mark || 0) * 100 })).sort((a, b) => b.prem - a.prem).slice(0, 12);
    $('#unusual').innerHTML = un.length ? `<table class="t"><thead><tr><th class="l">Contract</th><th>Vol</th><th>OI</th><th>Vol/OI</th><th>Mark</th><th>Premium</th><th>Δ</th></tr></thead><tbody>
      ${un.map(c => `<tr><td class="l"><b class="${c.type === 'call' ? 'up' : 'down'}">${fmtStrike(c.strike)} ${c.type === 'call' ? 'Call' : 'Put'}</b></td><td>${fmt.int(c.volume)}</td><td>${fmt.int(c.oi)}</td>
        <td class="unusual">${c.oi ? (c.volume / c.oi).toFixed(1) + '×' : 'new'}</td><td>${fmt.opt(c.mark)}</td><td>${fmt.usd(c.prem)}</td><td>${fmt.greek(c.delta, 2)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="muted small">No unusual volume in this expiration.</div>';
  };

  const drawWhat = () => {
    const spot = st.chain.spot, sc = scenario();
    $('#wS').textContent = fmt.px(sc.S);
    $('#wSp').textContent = sc.S !== spot ? `(${fmt.spct(sc.S / spot - 1, 1)})` : '';
    $('#wD').textContent = st.what.days;
    const left = st.chain.expiration.dte - st.what.days;
    $('#wDd').textContent = `${st.what.days ? `→ ${new Date(sc.atMs).toLocaleDateString()}` : '(today)'} · ${left} day${left === 1 ? '' : 's'} left on the ${fmtExpShort(st.chain.expiration.date)} options`;
    $('#wV').textContent = (st.what.iv >= 0 ? '+' : '') + st.what.iv;
    $('#rD').max = Math.max(0, st.chain.expiration.dte);
  };

  const drawTray = () => {
    if (!st.ticket.length) { $('#tray').innerHTML = ''; return; }
    const cost = netCost(st.ticket);
    $('#tray').innerHTML = `<div class="tray"><div class="row"><b>Ticket · ${esc(symbol)}</b><span class="spacer"></span>
      <span class="${cost < 0 ? 'up' : ''}">${cost < 0 ? 'Net credit' : 'Net debit'} ${fmt.usd(Math.abs(cost), 2)}</span></div>
      <div class="legs">${st.ticket.map((l, i) => `<div class="leg"><button class="btn sm ghost" data-q="${i}" data-d="-1">−</button><b class="${l.qty > 0 ? 'up' : 'down'}" style="width:26px;text-align:center">${l.qty > 0 ? '+' : ''}${l.qty}</b>
        <button class="btn sm ghost" data-q="${i}" data-d="1">+</button><span class="mono">${esc(describeLegs([l]).replace(/^[+-]?\d+ /, ''))}</span><span class="muted">@ ${fmt.opt(l.price)}</span>
        <span class="spacer"></span><button class="btn sm ghost danger" data-x="${i}">✕</button></div>`).join('')}</div>
      <div class="row"><button class="btn primary sm" id="tAnalyze">Analyze in Builder</button><button class="btn sm ghost" id="tClear">Clear</button></div></div>`;
    handoff.set('ticket', { symbol, legs: st.ticket });
  };

  const loadChain = async () => {
    try {
      const [ch, q] = await Promise.all([
        api.get(`chain/${encodeURIComponent(symbol)}?expiry=${st.exp}&strikes=200`),
        api.get(`quotes?symbols=${encodeURIComponent(symbol)}`),
      ]);
      if (!ch.expiration) throw new Error('No contracts for this expiration');
      st.chain = ch;
      if (q[symbol]) drawHead(q[symbol]);
      drawStats(); drawChain(); drawBars(); drawWhat();
      $('#upd').textContent = `Updated ${new Date(ch.time).toLocaleTimeString()}`;
    } catch (e) { $('#chainwrap').innerHTML = errorBox(e); }
  };

  // The symbol box must work even when this symbol fails to load (bind it before loading).
  $('#symf').addEventListener('submit', e => { e.preventDefault(); const s = $('#symi').value.trim().toUpperCase(); if (s) location.hash = `#/options/${encodeURIComponent(s)}`; });

  // ----- init -----
  try {
    [st.exps, { earnings: st.earnings }] = await Promise.all([
      api.get(`expirations/${encodeURIComponent(symbol)}`),
      api.get(`earnings/${encodeURIComponent(symbol)}`).catch(() => ({ earnings: null })),
    ]);
    if (!st.exps.length) throw new Error(`No listed options for ${symbol}`);
    prefs.set('opt-sym', symbol); // valid: remember it for next time
    if (!st.exps.find(e => e.date === st.exp)) st.exp = (st.exps.find(e => e.type === 'M' && e.dte >= 14) || st.exps.find(e => e.dte >= 7) || st.exps[0]).date;
    drawExps();
    await loadChain();
    drawTray();
  } catch (e) {
    $('#qhead').innerHTML = errorBox(e); $('#chainwrap').innerHTML = '';
    $('#symi').focus(); $('#symi').select();
    return;
  }

  // ----- events -----
  $('#exps').addEventListener('click', e => {
    const b = e.target.closest('.exp-pill'); if (!b) return;
    st.exp = b.dataset.d; st.firstDraw = true; st.what.days = 0; $('#rD').value = 0;
    history.replaceState(null, '', `#/options/${encodeURIComponent(symbol)}?exp=${st.exp}`);
    drawExps(); $('#chainwrap').innerHTML = loading(); loadChain();
  });
  $('#cols').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.cols = b.dataset.v; prefs.set('opt-cols', st.cols);
    root.querySelectorAll('#cols button').forEach(x => x.classList.toggle('on', x === b)); drawChain();
  });
  $('#range').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.range = Number(b.dataset.v); prefs.set('opt-range', st.range); st.firstDraw = true;
    root.querySelectorAll('#range button').forEach(x => x.classList.toggle('on', x === b)); drawChain();
  });
  $('#bm').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.barMode = b.dataset.v; root.querySelectorAll('#bm button').forEach(x => x.classList.toggle('on', x === b)); drawBars();
  });
  const onWhat = () => { drawWhat(); drawChain(); };
  $('#rS').addEventListener('input', e => { st.what.S = st.chain.spot * (1 + Number(e.target.value) / 100); $('#nS').value = st.what.S.toFixed(2); onWhat(); });
  $('#nS').addEventListener('change', e => { const v = Number(e.target.value); st.what.S = v > 0 ? v : null; $('#rS').value = v > 0 ? ((v / st.chain.spot - 1) * 100).toFixed(1) : 0; onWhat(); });
  $('#rD').addEventListener('input', e => { st.what.days = Number(e.target.value); onWhat(); });
  $('#rV').addEventListener('input', e => { st.what.iv = Number(e.target.value); onWhat(); });
  $('#wReset').addEventListener('click', () => { st.what = { S: null, days: 0, iv: 0 }; $('#rS').value = 0; $('#rD').value = 0; $('#rV').value = 0; $('#nS').value = ''; onWhat(); });

  $('#chainwrap').addEventListener('click', e => {
    const td = e.target.closest('td.q'); if (!td) return;
    const strike = Number(td.closest('tr').dataset.k), type = td.dataset.t;
    const c = st.chain.expiration.rows.find(r => r.strike === strike)?.[type];
    if (!c) return;
    const buy = td.dataset.side === 'buy';
    const existing = st.ticket.find(l => l.occ === c.occ);
    if (existing) existing.qty += buy ? 1 : -1;
    else st.ticket.push({ type, qty: buy ? 1 : -1, strike, expiry: c.expiry, price: buy ? c.ask : c.bid, iv: c.iv, occ: c.occ });
    st.ticket = st.ticket.filter(l => l.qty !== 0);
    drawTray();
  });
  $('#tray').addEventListener('click', e => {
    const q = e.target.closest('[data-q]'), x = e.target.closest('[data-x]');
    if (q) { st.ticket[q.dataset.q].qty += Number(q.dataset.d); st.ticket = st.ticket.filter(l => l.qty !== 0); drawTray(); }
    else if (x) { st.ticket.splice(Number(x.dataset.x), 1); drawTray(); }
    else if (e.target.id === 'tClear') { st.ticket = []; handoff.set('ticket', null); drawTray(); }
    else if (e.target.id === 'tAnalyze') { handoff.set('builder', { symbol, legs: st.ticket, label: 'Custom' }); location.hash = '#/builder'; }
  });

  const t = setInterval(() => { if (!document.hidden) loadChain(); }, 15000);
  return () => clearInterval(t);
}
