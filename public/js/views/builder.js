import { api } from '../api.js';
import { esc, fmt, cls, loading, errorBox, toast, handoff, prefs } from '../ui.js';
import { payoffChart } from '../charts.js';
import { analyze, curve, pnlAt, firstExpiryMs, pickByDelta, describeLegs, fmtExp, fmtStrike } from '../../shared/strategy.js';
import { yearsToExpiry } from '../../shared/time.js';

const TEMPLATES = {
  longCall: 'Long Call', longPut: 'Long Put', bullCall: 'Bull Call Spread', bearPut: 'Bear Put Spread',
  bullPut: 'Bull Put Credit', bearCall: 'Bear Call Credit', ironCondor: 'Iron Condor', ironFly: 'Iron Butterfly',
  straddle: 'Long Straddle', strangle: 'Short Strangle', csp: 'Cash-Secured Put', coveredCall: 'Covered Call',
  calendar: 'Call Calendar', pmcc: "Poor Man's CC",
};

export async function render(root) {
  const incoming = handoff.get('builder');
  const st = {
    symbol: incoming?.symbol || prefs.get('b-sym', 'SPY'), label: incoming?.label || 'Custom', key: incoming?.key || 'custom',
    legs: incoming?.legs?.map(l => ({ ...l })) || [], spot: null, rate: 0.04, exps: [], chains: {}, exp: null,
    days: 0, ivShift: 0, pricing: prefs.get('b-pricing', 'mid'), settings: null,
  };
  handoff.set('builder', null);

  root.innerHTML = `
    <div class="page-h">
      <div style="flex:1"><h1>Strategy Builder</h1><div class="muted small">Model any multi-leg position: P/L at expiry and before, probability of profit, Greeks and sizing.</div></div>
      <form id="symf" class="row"><input id="symi" type="text" value="${esc(st.symbol)}" style="width:110px;text-transform:uppercase"><button class="btn">Load</button></form>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="row"><b id="spot" class="num"></b><span class="spacer"></span>
        <label class="row small muted">Template expiration <select id="texp"></select></label>
        <div class="seg" id="pricing"><button data-v="mid" class="${st.pricing === 'mid' ? 'on' : ''}">Mid</button><button data-v="natural" class="${st.pricing === 'natural' ? 'on' : ''}">Natural</button></div>
      </div>
      <div class="chips" id="tpl" style="margin-top:10px">${Object.entries(TEMPLATES).map(([k, v]) => `<button class="chip" data-k="${k}">${v}</button>`).join('')}</div>
    </div>
    <div class="grid main-side">
      <div class="stack">
        <section class="card"><div class="card-h"><h2 id="title">Legs</h2><button class="btn sm" id="add">+ Add leg</button><button class="btn sm ghost" id="clear">Clear</button></div><div id="legs"></div></section>
        <section class="card">
          <div class="card-h"><h2>Profit / loss</h2><div class="legend"><span><i style="background:var(--text)"></i>At expiry</span><span><i style="background:var(--accent)"></i><span id="tlabel">Today</span></span><span><i style="background:var(--accent);opacity:.3;height:8px"></i>±1σ / 2σ</span></div></div>
          <div class="row" style="margin-bottom:8px">
            <label class="row small muted" style="flex:1">Date <input id="days" type="range" min="0" max="30" value="0" style="flex:1"><b id="daysv"></b></label>
            <label class="row small muted" style="flex:1">IV <input id="iv" type="range" min="-30" max="30" value="0" style="flex:1"><b id="ivv">+0</b></label>
          </div>
          <div id="chart"></div>
        </section>
        <section class="card"><div class="card-h"><h2>P/L matrix</h2><span class="muted small">Price × date (current IV${' '}+ shift)</span></div><div id="matrix" class="table-wrap"></div></section>
      </div>
      <aside class="stack">
        <section class="card"><div class="card-h"><h2>Analysis</h2></div><div id="stats"></div></section>
        <section class="card"><div class="card-h"><h2>Position Greeks</h2></div><div id="greeks"></div></section>
        <section class="card"><div class="row"><button class="btn primary" id="track">Track position</button><a class="btn" id="chainlink">Open chain</a></div>
          <p class="help">Tracking logs the trade at the leg prices shown so the Positions page can alert you on profit targets, 21 DTE and stops. Orders are placed in your broker.</p></section>
      </aside>
    </div>`;

  const $ = s => root.querySelector(s);

  async function chainFor(exp) {
    if (!st.chains[exp]) st.chains[exp] = await api.get(`chain/${encodeURIComponent(st.symbol)}?expiry=${exp}&strikes=120`);
    return st.chains[exp];
  }
  const legPrice = (c, qty) => (st.pricing === 'natural' ? (qty > 0 ? c.ask : c.bid) : c.mark);

  async function loadSymbol() {
    st.chains = {};
    st.exps = await api.get(`expirations/${encodeURIComponent(st.symbol)}`);
    prefs.set('b-sym', st.symbol); // remember only symbols that loaded
    const [q, er] = await Promise.all([
      api.get(`quotes?symbols=${encodeURIComponent(st.symbol)}`),
      api.get(`earnings/${encodeURIComponent(st.symbol)}`).catch(() => ({})),
    ]);
    st.earnings = er.earnings || null;
    st.spot = q[st.symbol]?.last;
    st.exp = (st.exps.find(e => e.dte >= 30 && e.type === 'M') || st.exps.find(e => e.dte >= 21) || st.exps[0])?.date;
    $('#texp').innerHTML = st.exps.map(e => `<option value="${esc(e.date)}" ${e.date === st.exp ? 'selected' : ''}>${fmtExp(e.date)} · ${e.dte}d${e.type === 'M' ? ' · M' : ''}</option>`).join('');
    $('#spot').innerHTML = `${esc(st.symbol)} <span>${fmt.px(st.spot)}</span> <span class="small ${cls(q[st.symbol]?.changePct)}">${fmt.spct(q[st.symbol]?.changePct)}</span>`;
    $('#chainlink').href = `#/options/${encodeURIComponent(st.symbol)}`;
    if (st.exp) st.rate = (await chainFor(st.exp)).rate || 0.04;
  }

  function nearestWidth(rows) {
    const steps = rows.map((r, i) => (i ? r.strike - rows[i - 1].strike : Infinity)).filter(x => x > 0);
    const min = Math.min(...steps);
    const target = st.spot * 0.03;
    return [1, 2, 2.5, 5, 10, 15, 20, 25, 50, 100].filter(w => w >= min - 1e-9).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  }
  const at = (rows, type, strike) => rows.reduce((a, r) => (r[type] && (!a || Math.abs(r.strike - strike) < Math.abs(a.strike - strike)) ? r[type] : a), null);
  const mk = (c, qty) => ({ type: c.type, qty, strike: c.strike, expiry: c.expiry, price: legPrice(c, qty), iv: c.iv, occ: c.occ });

  async function applyTemplate(k) {
    const ch = await chainFor(st.exp);
    const rows = ch.expiration.rows, S = ch.spot;
    const w = nearestWidth(rows);
    const d = (type, delta) => pickByDelta(rows, type, delta);
    const atmC = at(rows, 'call', S), atmP = at(rows, 'put', S);
    let legs = [];
    switch (k) {
      case 'longCall': legs = [mk(d('call', 0.7), 1)]; break;
      case 'longPut': legs = [mk(d('put', 0.7), 1)]; break;
      case 'bullCall': legs = [mk(d('call', 0.6), 1), mk(d('call', 0.3), -1)]; break;
      case 'bearPut': legs = [mk(d('put', 0.6), 1), mk(d('put', 0.3), -1)]; break;
      case 'bullPut': { const s = d('put', 0.3); legs = [mk(s, -1), mk(at(rows, 'put', s.strike - w), 1)]; break; }
      case 'bearCall': { const s = d('call', 0.3); legs = [mk(s, -1), mk(at(rows, 'call', s.strike + w), 1)]; break; }
      case 'ironCondor': { const sp = d('put', 0.16), sc = d('call', 0.16); legs = [mk(at(rows, 'put', sp.strike - w), 1), mk(sp, -1), mk(sc, -1), mk(at(rows, 'call', sc.strike + w), 1)]; break; }
      case 'ironFly': legs = [mk(at(rows, 'put', atmP.strike - 2 * w), 1), mk(atmP, -1), mk(atmC, -1), mk(at(rows, 'call', atmC.strike + 2 * w), 1)]; break;
      case 'straddle': legs = [mk(atmC, 1), mk(atmP, 1)]; break;
      case 'strangle': legs = [mk(d('call', 0.16), -1), mk(d('put', 0.16), -1)]; break;
      case 'csp': legs = [mk(d('put', 0.3), -1)]; break;
      case 'coveredCall': legs = [{ type: 'stock', qty: 100, price: +S.toFixed(2) }, mk(d('call', 0.3), -1)]; break;
      case 'calendar': {
        const back = st.exps.find(e => e.dte >= (st.exps.find(x => x.date === st.exp)?.dte || 0) + 25);
        if (!back) return toast('No later expiration for a calendar', true);
        const bch = await chainFor(back.date);
        legs = [mk(atmC, -1), mk(at(bch.expiration.rows, 'call', atmC.strike), 1)]; break;
      }
      case 'pmcc': {
        const far = [...st.exps].reverse().find(e => e.dte >= 270) || st.exps[st.exps.length - 1];
        const fch = await chainFor(far.date);
        const long = pickByDelta(fch.expiration.rows, 'call', 0.8);
        const short = rows.map(r => r.call).filter(c => c && c.strike >= long.strike + long.mark)
          .reduce((a, c) => (!a || Math.abs(c.delta - 0.3) < Math.abs(a.delta - 0.3) ? c : a), null) || d('call', 0.3);
        legs = [mk(long, 1), mk(short, -1)]; break;
      }
    }
    if (legs.some(l => !l || (l.type !== 'stock' && !l.occ))) return toast('Could not build that template from this chain', true);
    st.legs = legs; st.label = TEMPLATES[k]; st.key = k; st.days = 0;
    draw();
  }

  function drawLegs() {
    const expOpts = sel => st.exps.map(e => `<option value="${esc(e.date)}" ${e.date === sel ? 'selected' : ''}>${fmtExp(e.date)} (${e.dte}d)</option>`).join('');
    $('#title').textContent = `${st.label} · ${st.symbol}`;
    $('#legs').innerHTML = st.legs.length ? `<div class="table-wrap"><table class="t"><thead><tr><th class="l">Side</th><th>Qty</th><th class="l">Type</th><th class="l">Expiration</th><th>Strike</th><th>Price</th><th>IV</th><th></th></tr></thead><tbody>
      ${st.legs.map((l, i) => `<tr data-i="${i}">
        <td class="l"><button class="btn sm ${l.qty > 0 ? '' : 'danger'}" data-a="side">${l.qty > 0 ? 'Buy' : 'Sell'}</button></td>
        <td><input type="number" min="1" step="1" value="${Math.abs(l.qty)}" data-a="qty" style="width:70px"></td>
        <td class="l"><select data-a="type">${['call', 'put', 'stock'].map(t => `<option ${t === l.type ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td class="l">${l.type === 'stock' ? '—' : `<select data-a="exp">${expOpts(l.expiry)}</select>`}</td>
        <td>${l.type === 'stock' ? '—' : `<select data-a="strike"><option>${fmtStrike(l.strike)}</option></select>`}</td>
        <td><input type="number" step="0.01" value="${l.price}" data-a="price" style="width:90px"></td>
        <td>${l.type === 'stock' ? '—' : fmt.iv(l.iv)}</td>
        <td><button class="btn sm ghost danger" data-a="del">✕</button></td></tr>`).join('')}</tbody></table></div>
      <div class="row small" style="margin-top:8px"><span class="mono muted">${esc(describeLegs(st.legs))}</span></div>`
      : '<div class="empty">Pick a template above, click bid/ask in the Options Chain, or add a leg.</div>';
    // Fill strike dropdowns lazily from the leg's chain.
    st.legs.forEach(async (l, i) => {
      if (l.type === 'stock') return;
      const ch = await chainFor(l.expiry).catch(() => null);
      const sel = $(`#legs tr[data-i="${i}"] select[data-a="strike"]`);
      if (!ch || !sel) return;
      sel.innerHTML = ch.expiration.rows.filter(r => r[l.type]).map(r => `<option value="${r.strike}" ${Math.abs(r.strike - l.strike) < 1e-6 ? 'selected' : ''}>${fmtStrike(r.strike)}</option>`).join('');
    });
  }

  function drawAnalysis() {
    const legs = st.legs;
    if (!legs.length || !st.spot) { $('#chart').innerHTML = $('#stats').innerHTML = $('#greeks').innerHTML = $('#matrix').innerHTML = '<div class="muted small">No legs yet.</div>'; return; }
    const hMs = firstExpiryMs(legs);
    const daysMax = Math.max(0, Math.floor((hMs - Date.now()) / 86400000));
    $('#days').max = daysMax;
    if (st.days > daysMax) st.days = daysMax;
    const atMs = Date.now() + st.days * 86400000;
    const optLegs = legs.filter(l => l.type !== 'stock');
    const sigma = optLegs.length ? optLegs.reduce((s, l) => s + (l.iv || 0.3), 0) / optLegs.length : 0.3;
    const a = analyze(legs, { spot: st.spot, sigma, r: st.rate });
    const T = Math.max((hMs - Date.now()) / (365 * 86400000), 1 / 365);
    const sd = st.spot * sigma * Math.sqrt(T);
    const strikes = optLegs.map(l => l.strike);
    const lo = Math.max(0.01, Math.min(st.spot - 2.6 * sd, ...strikes.map(k => k * 0.95)));
    const hi = Math.max(st.spot + 2.6 * sd, ...strikes.map(k => k * 1.05));
    const pts = curve(legs, { lo, hi, n: 220, r: st.rate, horizonMs: hMs, atMs, ivShift: st.ivShift / 100 });
    $('#daysv').textContent = st.days ? `${new Date(atMs).toLocaleDateString()} (T+${st.days})` : 'Today';
    $('#tlabel').textContent = st.days ? `T+${st.days}` : 'Today';
    payoffChart($('#chart'), pts, {
      spot: st.spot, breakevens: a.breakevens, sd1: [st.spot - sd, st.spot + sd], sd2: [st.spot - 2 * sd, st.spot + 2 * sd],
      tLabel: st.days ? `T+${st.days}` : 'Today',
    });

    const credit = a.cost < 0;
    const rr = Number.isFinite(a.maxProfit) && a.maxLoss < 0 ? a.maxProfit / -a.maxLoss : null;
    const acct = st.settings?.account;
    let size = '—';
    if (acct) {
      const risk = (acct.size * acct.riskPerTradePct) / 100, alloc = (acct.size * acct.maxAllocationPct) / 100;
      const n = Math.floor(Math.min(Number.isFinite(a.maxLoss) && a.maxLoss < 0 ? risk / -a.maxLoss : Infinity, a.capital > 0 ? alloc / a.capital : Infinity));
      size = Number.isFinite(n) ? `${Math.max(0, n)}× <span class="muted small">(${acct.riskPerTradePct}% risk of ${fmt.usd(acct.size)})</span>` : '—';
    }
    const exps = [...new Set(optLegs.map(l => l.expiry))];
    const er = st.earnings;
    const erHit = er && exps.some(d => er.date < d || (er.date === d && er.hour === 'bmo'));
    $('#stats').innerHTML = `${erHit ? `<div class="banner">⚠ Earnings ${esc(er.date)}${er.hour ? ' ' + esc(er.hour) : ''} (${er.days}d) falls inside this trade. Expect a gap and an IV crush after the report.</div>` : ''}<div class="kv">
      <div>${credit ? 'Net credit' : 'Net debit'}</div><div class="${credit ? 'up' : ''}">${fmt.usd(Math.abs(a.cost), 2)}</div>
      <div>Max profit</div><div class="up">${fmt.usd(a.maxProfit)}</div>
      <div>Max loss</div><div class="down">${fmt.usd(a.maxLoss)}</div>
      <div>Reward : risk</div><div>${rr != null ? rr.toFixed(2) : '—'}</div>
      <div>Breakeven${a.breakevens.length > 1 ? 's' : ''}</div><div>${a.breakevens.map(b => fmt.px(b)).join(' / ') || '—'}</div>
      <div title="Lognormal probability of any profit at the first expiration, using leg IV">Probability of profit</div><div><b>${fmt.pct(a.pop, 1)}</b></div>
      <div>Expected value (IV)</div><div class="${cls(a.ev)}">${fmt.usd(a.ev)}</div>
      <div>Capital / buying power</div><div>${fmt.usd(a.capital)}</div>
      <div>Suggested size</div><div>${size}</div>
      <div>Expiration${exps.length > 1 ? 's' : ''}</div><div>${exps.map(e => `${fmtExp(e)} (${Math.round(yearsToExpiry(e) * 365)}d)`).join(', ') || '—'}</div></div>
      ${credit ? `<p class="help">Plan: take profit at ${st.settings?.rules?.profitTakePct ?? 50}% (${fmt.usd((-a.cost * (st.settings?.rules?.profitTakePct ?? 50)) / 100)}), manage at ${st.settings?.rules?.manageDte ?? 21} DTE, stop at 2× credit (${fmt.usd(2 * a.cost)}).</p>`
      : Number.isFinite(a.maxProfit) ? `<p class="help">Plan: take profit at 50–75% of max (${fmt.usd(a.maxProfit * 0.5)}–${fmt.usd(a.maxProfit * 0.75)}); stop at 50% of debit (${fmt.usd(-a.cost / 2)}).</p>` : ''}`;
    const g = a.greeks;
    $('#greeks').innerHTML = `<div class="kv">
      <div>Delta (share-equivalent)</div><div class="${cls(g.delta)}">${fmt.n(g.delta, 1)}</div>
      <div>Gamma</div><div>${fmt.n(g.gamma, 3)}</div>
      <div>Theta ($/day)</div><div class="${cls(g.theta)}">${fmt.usd(g.theta, 2)}</div>
      <div>Vega ($ per IV pt)</div><div class="${cls(g.vega)}">${fmt.usd(g.vega, 2)}</div>
      <div>$ per 1% move</div><div>${fmt.usd(g.delta * st.spot * 0.01, 2)}</div></div>`;

    // P/L matrix
    const prices = Array.from({ length: 9 }, (_, i) => st.spot * Math.exp(((i - 4) / 4) * 2 * sigma * Math.sqrt(T))).reverse();
    const dates = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * daysMax));
    const uniqDates = [...new Set(dates)];
    $('#matrix').innerHTML = `<table class="t"><thead><tr><th class="l">Price</th>${uniqDates.map(d => `<th>${d === daysMax ? 'Expiry' : d === 0 ? 'Today' : 'T+' + d}</th>`).join('')}</tr></thead><tbody>
      ${prices.map(S => `<tr><td class="l"><b>${fmt.px(S)}</b> <span class="tiny muted">${fmt.spct(S / st.spot - 1, 1)}</span></td>${uniqDates.map(d => {
        const v = d === daysMax ? pnlAt(legs, S, hMs, st.rate) : pnlAt(legs, S, Date.now() + d * 86400000, st.rate, st.ivShift / 100);
        const max = Math.max(Math.abs(a.maxLoss === -Infinity ? 1e9 : a.maxLoss), Math.abs(a.maxProfit === Infinity ? 1e9 : a.maxProfit), 1);
        const alpha = Math.min(0.55, Math.abs(v) / max * 0.55 + 0.04);
        return `<td style="background:${v >= 0 ? `rgba(52,199,123,${alpha})` : `rgba(255,107,107,${alpha})`}">${fmt.usd(v)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function draw() { drawLegs(); drawAnalysis(); }

  // ----- events -----
  $('#symf').addEventListener('submit', async e => {
    e.preventDefault();
    const s = $('#symi').value.trim().toUpperCase(); if (!s) return;
    st.symbol = s; st.legs = []; st.label = 'Custom';
    try { await loadSymbol(); draw(); } catch (err) { toast(err.message, true); }
  });
  $('#texp').addEventListener('change', e => { st.exp = e.target.value; });
  $('#tpl').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) applyTemplate(b.dataset.k).catch(err => toast(err.message, true)); });
  $('#pricing').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    st.pricing = b.dataset.v; prefs.set('b-pricing', st.pricing);
    root.querySelectorAll('#pricing button').forEach(x => x.classList.toggle('on', x === b));
    for (const l of st.legs) {
      if (l.type === 'stock') continue;
      const c = (await chainFor(l.expiry)).expiration.rows.find(r => Math.abs(r.strike - l.strike) < 1e-6)?.[l.type];
      if (c) l.price = legPrice(c, l.qty);
    }
    draw();
  });
  $('#add').addEventListener('click', async () => {
    const ch = await chainFor(st.exp);
    const c = ch.expiration.rows.reduce((a, r) => (Math.abs(r.strike - ch.spot) < Math.abs(a.strike - ch.spot) ? r : a)).call;
    st.legs.push(mk(c, 1)); draw();
  });
  $('#clear').addEventListener('click', () => { st.legs = []; st.label = 'Custom'; draw(); });
  $('#days').addEventListener('input', e => { st.days = Number(e.target.value); drawAnalysis(); });
  $('#iv').addEventListener('input', e => { st.ivShift = Number(e.target.value); $('#ivv').textContent = (st.ivShift >= 0 ? '+' : '') + st.ivShift; drawAnalysis(); });

  $('#legs').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const i = Number(b.closest('tr').dataset.i), l = st.legs[i];
    if (b.dataset.a === 'del') st.legs.splice(i, 1);
    if (b.dataset.a === 'side') l.qty = -l.qty;
    draw();
  });
  $('#legs').addEventListener('change', async e => {
    const el = e.target, a = el.dataset.a; if (!a) return;
    const i = Number(el.closest('tr').dataset.i), l = st.legs[i];
    if (a === 'qty') l.qty = Math.sign(l.qty || 1) * Math.max(1, Math.round(Number(el.value) || 1));
    if (a === 'price') l.price = Number(el.value) || 0;
    if (a === 'type') {
      l.type = el.value;
      if (l.type === 'stock') { Object.assign(l, { qty: Math.sign(l.qty) * 100, price: +st.spot.toFixed(2), strike: undefined, expiry: undefined, occ: undefined, iv: undefined }); }
      else { l.expiry = l.expiry || st.exp; l.strike = l.strike || st.spot; l.qty = Math.sign(l.qty) || 1; }
    }
    if (a === 'exp') l.expiry = el.value;
    if (a === 'strike') l.strike = Number(el.value);
    if (l.type !== 'stock' && ['type', 'exp', 'strike'].includes(a)) {
      const ch = await chainFor(l.expiry);
      const c = ch.expiration.rows.reduce((b, r) => (r[l.type] && (!b || Math.abs(r.strike - l.strike) < Math.abs(b.strike - l.strike)) ? r[l.type] : b), null);
      if (c) Object.assign(l, { strike: c.strike, price: legPrice(c, l.qty), iv: c.iv, occ: c.occ });
    }
    draw();
  });
  $('#track').addEventListener('click', async () => {
    if (!st.legs.length) return toast('Add legs first', true);
    const optLegs = st.legs.filter(l => l.type !== 'stock');
    const sigma = optLegs.length ? optLegs.reduce((s, l) => s + (l.iv || 0.3), 0) / optLegs.length : 0.3;
    const a = analyze(st.legs, { spot: st.spot, sigma, r: st.rate });
    try {
      await api.post('positions', {
        symbol: st.symbol, label: st.label, key: st.key, legs: st.legs, spot: st.spot,
        maxProfit: Number.isFinite(a.maxProfit) ? a.maxProfit : null, maxLoss: Number.isFinite(a.maxLoss) ? a.maxLoss : null,
      });
      toast('Position tracked'); location.hash = '#/positions';
    } catch (err) { toast(err.message, true); }
  });

  $('#legs').innerHTML = loading();
  try {
    [st.settings] = await Promise.all([api.get('settings'), loadSymbol()]);
  } catch (e) { $('#legs').innerHTML = errorBox(e); return; }
  draw();
  const onResize = () => drawAnalysis();
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
