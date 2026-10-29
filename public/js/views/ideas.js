import { api } from '../api.js';
import { esc, logo, fmt, biasPill, ring, loading, errorBox, toast, handoff, prefs } from '../ui.js';

const KEYS = {
  longCall: 'Long Call', longPut: 'Long Put', leaps: 'LEAPS', pmcc: 'PMCC', bullCallSpread: 'Bull Call Spread', bearPutSpread: 'Bear Put Spread',
  bullPutSpread: 'Bull Put Credit', bearCallSpread: 'Bear Call Credit', csp: 'Cash-Secured Put', coveredCall: 'Covered Call', ironCondor: 'Iron Condor',
};

export function ideaCard(i) {
  const credit = i.cost < 0;
  return `<article class="idea" data-id="${esc(i.id)}">
    <div class="top">
      ${ring(i.score)}
      <div class="title">
        <div class="sym-inline">${logo(i.symbol, 22)}<a class="sym" href="#/t/${esc(i.symbol)}">${esc(i.symbol)}</a> <span class="muted">${fmt.px(i.spot)}</span> ${biasPill(i.bias)}</div>
        <div class="small"><b>${esc(i.label)}</b> <span class="muted">· ${i.dte} DTE${i.setup ? ` · ${esc(i.setup)}` : ''}</span></div>
      </div>
      ${i.earnings ? `<span class="pill warn" title="Earnings ${esc(i.earnings.date)} ${esc(i.earnings.hour || '')} falls before expiration">ER ${i.earnings.days}d</span>` : ''}
      ${i.liquidityOk ? '' : '<span class="pill warn" title="Open interest or bid/ask spread outside your filters">Thin</span>'}
    </div>
    <div class="legs">${esc(i.description)}</div>
    <div class="metrics">
      <div><span>${credit ? 'Credit' : 'Debit'}</span><b>${fmt.usd(Math.abs(i.cost))}</b></div>
      <div><span>Max profit</span><b class="up">${fmt.usd(i.maxProfit)}</b></div>
      <div><span>Max loss</span><b class="down">${fmt.usd(i.maxLoss)}</b></div>
      <div><span>R:R</span><b>${i.rr != null ? i.rr.toFixed(2) : '—'}</b></div>
      <div><span title="Probability of profit at expiry, implied-vol distribution">POP</span><b>${fmt.pct(i.pop, 0)}</b></div>
      <div><span title="POP using realized (historical) volatility">POP (HV)</span><b>${fmt.pct(i.popReal, 0)}</b></div>
      <div><span title="Expected value using realized volatility">EV (HV)</span><b class="${i.evReal >= 0 ? 'up' : 'down'}">${fmt.usd(i.evReal)}</b></div>
      <div><span title="Contracts sized to your risk settings">Size</span>${i.contracts > 0 ? `<b>${i.contracts}×</b>` : `<b class="down" title="One contract needs ${fmt.usd(i.capital)}, above your max capital per trade">Over limit</b>`}</div>
    </div>
    <ul>${i.rationale.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    <div class="help"><b>Manage:</b> ${esc(i.manage)}</div>
    <div class="row">
      <button class="btn sm primary" data-act="analyze">Analyze</button>
      <button class="btn sm" data-act="track">Track</button>
      <a class="btn sm ghost" href="#/options/${esc(i.symbol)}?exp=${esc(i.expiry)}">Chain</a>
      <span class="spacer"></span>
      <span class="tiny faint" title="Setup / IV fit / trade quality / edge / liquidity">${Object.values(i.scoreParts).join(' · ')}</span>
    </div>
  </article>`;
}

export function bindIdeaActions(container, ideas) {
  container.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const idea = ideas.find(x => x.id === btn.closest('.idea').dataset.id);
    if (!idea) return;
    if (btn.dataset.act === 'analyze') {
      handoff.set('builder', { symbol: idea.symbol, legs: idea.legs, label: idea.label, key: idea.key });
      location.hash = '#/builder';
    } else if (btn.dataset.act === 'track') {
      await trackIdea(idea);
    }
  });
}

export async function trackIdea(idea) {
  try {
    await api.post('positions', {
      symbol: idea.symbol, label: idea.label, key: idea.key, legs: idea.legs, spot: idea.spot,
      maxProfit: Number.isFinite(idea.maxProfit) ? idea.maxProfit : null, maxLoss: Number.isFinite(idea.maxLoss) ? idea.maxLoss : null,
    });
    toast(`Tracking ${idea.symbol} ${idea.label}`);
  } catch (e) { toast(e.message, true); }
}

export async function render(root) {
  const state = { keys: new Set(prefs.get('ideas-keys', Object.keys(KEYS))), bias: 'all', minPop: 0, sort: 'score', liquidOnly: true };
  root.innerHTML = `
    <div class="page-h">
      <div style="flex:1"><h1>Trade Ideas</h1><div class="muted small">Concrete, scored option trades on the strongest hot-list setups. Rules: <a href="#/playbook">Playbook</a></div></div>
      <form id="symform" class="row"><input id="sym" type="text" placeholder="Scan a symbol…" style="width:150px"><button class="btn">Scan</button></form>
      <span id="meta" class="muted small"></span>
      <button id="refresh" class="btn">↻ Refresh</button>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="chips" id="keys">${Object.entries(KEYS).map(([k, v]) => `<button class="chip ${state.keys.has(k) ? 'on' : ''}" data-k="${k}">${v}</button>`).join('')}</div>
      <hr class="sep">
      <div class="row">
        <div class="seg" id="bias">${['all', 'bull', 'bear', 'neutral'].map(b => `<button data-v="${b}" class="${b === 'all' ? 'on' : ''}">${b === 'all' ? 'All' : b[0].toUpperCase() + b.slice(1)}</button>`).join('')}</div>
        <label class="row small muted">Min POP <input id="pop" type="range" min="0" max="90" step="5" value="0"><b id="popv">0%</b></label>
        <label class="row small muted">Sort <select id="sort"><option value="score">Score</option><option value="pop">POP</option><option value="evReal">EV (HV)</option><option value="rr">Reward:Risk</option><option value="dte">DTE</option></select></label>
        <label class="check small"><input id="liq" type="checkbox" checked> Liquid only</label>
      </div>
    </div>
    <div id="sym-results"></div>
    <div id="list" class="ideas-grid">${loading('Building trade ideas…')}</div>`;

  let ideas = [];
  const list = root.querySelector('#list');
  bindIdeaActions(list, { find: f => ideas.find(f) });

  const draw = () => {
    const rows = ideas.filter(i => state.keys.has(i.key) && (state.bias === 'all' || i.bias === state.bias) && i.pop * 100 >= state.minPop && (!state.liquidOnly || i.liquidityOk))
      .sort((a, b) => (state.sort === 'dte' ? a.dte - b.dte : (b[state.sort] ?? -1) - (a[state.sort] ?? -1)));
    list.innerHTML = rows.length ? rows.map(ideaCard).join('') : '<div class="card empty">No ideas match. Loosen the filters or rescan.</div>';
  };

  const load = async () => {
    try {
      const g = await api.get('ideas');
      ideas = g.ideas;
      root.querySelector('#meta').textContent = g.updated ? `${ideas.length} ideas · ${fmt.ago(g.updated)}` : 'Building…';
      draw();
    } catch (e) { list.innerHTML = errorBox(e); }
  };

  root.querySelector('#keys').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    state.keys.has(b.dataset.k) ? state.keys.delete(b.dataset.k) : state.keys.add(b.dataset.k);
    b.classList.toggle('on'); prefs.set('ideas-keys', [...state.keys]); draw();
  });
  root.querySelector('#bias').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.bias = b.dataset.v; root.querySelectorAll('#bias button').forEach(x => x.classList.toggle('on', x === b)); draw();
  });
  root.querySelector('#pop').addEventListener('input', e => { state.minPop = Number(e.target.value); root.querySelector('#popv').textContent = state.minPop + '%'; draw(); });
  root.querySelector('#sort').addEventListener('change', e => { state.sort = e.target.value; draw(); });
  root.querySelector('#liq').addEventListener('change', e => { state.liquidOnly = e.target.checked; draw(); });
  root.querySelector('#refresh').addEventListener('click', async e => {
    e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span> Building…';
    try { await api.post('ideas/refresh'); await load(); } catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = '↻ Refresh';
  });
  root.querySelector('#symform').addEventListener('submit', async e => {
    e.preventDefault();
    const s = root.querySelector('#sym').value.trim().toUpperCase();
    if (!s) return;
    const box = root.querySelector('#sym-results');
    box.innerHTML = `<div class="card" style="margin-bottom:14px">${loading(`Scanning ${s}…`)}</div>`;
    try {
      const res = await api.get(`ideas/${encodeURIComponent(s)}`);
      box.innerHTML = `<div class="card-h"><h2>${esc(s)} — every strategy, ranked</h2><button class="btn sm ghost" id="clr">Close</button></div><div class="ideas-grid" id="symlist" style="margin-bottom:22px">${res.map(ideaCard).join('') || '<div class="empty">No candidates.</div>'}</div>`;
      bindIdeaActions(box.querySelector('#symlist'), res);
      box.querySelector('#clr').addEventListener('click', () => { box.innerHTML = ''; });
    } catch (err) { box.innerHTML = errorBox(err); }
  });

  await load();
  const t = setInterval(() => { if (!document.hidden) load(); }, 90000);
  return () => clearInterval(t);
}
