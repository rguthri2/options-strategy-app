import { api } from '../api.js';
import { esc, logo, fmt, cls, biasPill, loading, errorBox, toast, prefs } from '../ui.js';
import { priceChart } from '../charts.js';
import { ideaCard, bindIdeaActions } from './ideas.js';

const RANGES = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y'];

export async function render(root, [symbol]) {
  let range = prefs.get('range', '6M');
  let chart = null;
  root.innerHTML = `
    <div class="muted small" style="margin-bottom:6px"><a href="#/">Home</a> › ${esc(symbol)}</div>
    <div class="grid main-side">
      <div class="stack">
        <section class="card">
          <div id="head">${loading()}</div>
          <div class="row" style="margin:10px 0 4px"><div class="ranges" id="ranges">${RANGES.map(r => `<button data-r="${r}" class="${r === range ? 'on' : ''}">${r}</button>`).join('')}</div>
            <span class="spacer"></span><div class="legend" id="legend"></div></div>
          <div class="chart-box" id="chart"></div>
        </section>
        <section class="card"><div class="card-h"><h2>Swing setup</h2><span id="setup-pill"></span></div><div id="setup">${loading()}</div></section>
        <section><div class="card-h"><h2>Best option trades for ${esc(symbol)}</h2><span class="muted small">Every enabled strategy, scored against the current setup and IV regime</span></div><div id="ideas" class="ideas-grid">${loading('Scanning option chain…')}</div></section>
      </div>
      <aside class="stack">
        <section class="card"><div class="card-h"><h2>Key stats</h2></div><div id="stats">${loading()}</div></section>
        <section class="card"><div class="card-h"><h2>Volatility</h2></div><div id="vol">${loading()}</div></section>
        <section class="card"><div class="card-h"><h2>Trend template</h2><span id="tt-score" class="muted"></span></div><div id="tt">${loading()}</div></section>
        <section class="card"><div class="card-h"><h2>CANSLIM fundamentals</h2><span id="ca-grade"></span></div><div id="canslim">${loading()}</div></section>
      </aside>
    </div>`;

  let data = null;
  const $ = s => root.querySelector(s);

  const drawHead = q => {
    const pct = range === '1D' ? q.changePct : null;
    $('#head').innerHTML = `
      <div class="row" style="align-items:flex-start">
        <div style="flex:1;display:flex;gap:14px;align-items:center">${logo(q.symbol, 46)}<div><div class="muted small">${esc(q.symbol)}</div><h1>${esc(q.name)}</h1></div></div>
        <a class="btn primary" href="#/chart/${esc(q.symbol)}">✦ Chart Studio</a>
        <a class="btn" href="#/options/${esc(q.symbol)}">Option chain</a>
        <button class="btn" id="watch">☆ Watch</button>
      </div>
      <div class="quote-head"><span class="px">${fmt.px(q.last)}</span>
        <span class="chg ${cls(q.change)}">${fmt.schg(q.change)} (${fmt.spct(q.changePct)})</span>
        <span class="muted small">${q.session === 'open' ? 'Live' : 'At close'} · ${new Date(q.time).toLocaleTimeString()}${q.delayed ? ' · delayed' : ''}</span></div>`;
    $('#watch').addEventListener('click', async () => {
      const s = await api.get('settings');
      if (s.watchlist.includes(q.symbol)) return toast(`${q.symbol} is already on your watchlist`);
      await api.put('settings', { watchlist: [...s.watchlist, q.symbol] });
      toast(`Added ${q.symbol} to watchlist`);
    });
  };

  const drawChart = async () => {
    try {
      const candles = await api.get(`history/${encodeURIComponent(symbol)}?range=${range}`);
      const intraday = range === '1D' || range === '5D';
      if (!candles.length) {
        chart?.remove?.(); chart = null;
        $('#chart').innerHTML = `<div class="empty">${intraday ? 'Intraday bars aren\'t available from the current data source. Choose 1M or longer.' : 'No price history yet.'}</div>`;
        $('#legend').innerHTML = '';
        return;
      }
      const plan = data?.tech?.hotlist?.plan;
      const levels = !intraday && plan ? [
        { price: plan.stop, title: 'Stop', color: getComputedStyle(document.documentElement).getPropertyValue('--down').trim() },
        { price: plan.target1, title: '2R', color: getComputedStyle(document.documentElement).getPropertyValue('--up').trim() },
      ] : [];
      chart?.remove?.();
      chart = await priceChart($('#chart'), candles, { intraday, prevClose: range === '1D' ? data?.quote?.prevClose : undefined, smas: range === '5Y' ? [50] : [21, 50, 200], levels });
      $('#legend').innerHTML = intraday ? '' : '<span><i style="background:var(--accent)"></i>21 SMA</span><span><i style="background:var(--warn)"></i>50 SMA</span><span><i style="background:var(--neutral)"></i>200 SMA</span>';
    } catch (e) { $('#chart').innerHTML = errorBox(e); }
  };

  const drawSide = () => {
    const q = data.quote, t = data.tech;
    $('#stats').innerHTML = `<div class="kv">
      <div>Open</div><div>${fmt.px(q.open)}</div><div>Day range</div><div>${fmt.px(q.low)} – ${fmt.px(q.high)}</div>
      <div>Prev close</div><div>${fmt.px(q.prevClose)}</div><div>52-wk range</div><div>${fmt.px(q.low52)} – ${fmt.px(q.high52)}</div>
      <div>Volume</div><div>${fmt.big(q.volume)}</div><div>Avg volume</div><div>${fmt.big(q.avgVolume)}</div>
      <div>P/E</div><div>${fmt.n(q.pe, 1)}</div><div>Div yield</div><div>${q.divYield != null ? fmt.n(q.divYield, 2) + '%' : '—'}</div>
      <div>Next earnings</div><div>${t?.earnings ? `<span class="${t.earnings.days <= 14 ? 'pill warn' : ''}">${esc(t.earnings.date)}${t.earnings.hour ? ' ' + esc(t.earnings.hour) : ''} · ${t.earnings.days}d</span>` : '—'}</div></div>`;
    if (!t) { $('#vol').innerHTML = $('#tt').innerHTML = $('#setup').innerHTML = '<div class="muted small">Not enough history.</div>'; return; }
    const em = q.last * t.iv * Math.sqrt(30 / 365);
    $('#vol').innerHTML = `<div class="kv">
      <div>Implied vol (30d ATM)</div><div>${fmt.iv(t.iv)}</div>
      <div>IV Rank ${t.source === 'hv-proxy' ? '<span class="faint" title="Estimated from realized vol until 30 days of IV snapshots are stored">(est.)</span>' : ''}</div><div>${fmt.n(t.ivr, 0)}</div>
      <div>IV Percentile</div><div>${fmt.n(t.ivp, 0)}</div>
      <div>HV 20 / 60</div><div>${fmt.iv(t.hv20)} / ${fmt.iv(t.hv60)}</div>
      <div>IV / HV</div><div class="${t.ivHv >= 1.25 ? 'down' : t.ivHv < 0.95 ? 'up' : ''}">${fmt.n(t.ivHv, 2)}</div>
      <div>30-day expected move</div><div>±${fmt.px(em)} (${fmt.pct(em / q.last, 1)})</div></div>
      <p class="help"><span class="pill ${t.regime === 'rich' ? 'bad' : t.regime === 'cheap' ? 'good' : 'info'}">${t.regime === 'rich' ? 'Rich IV' : t.regime === 'cheap' ? 'Cheap IV' : 'Fair IV'}</span>
      ${t.regime === 'rich' ? 'Premium is expensive — favor selling (credit spreads, CSPs, condors).' : t.regime === 'cheap' ? 'Premium is cheap — favor buying (long calls/puts, debit spreads, LEAPS).' : 'Neutral — debit spreads balance vega risk.'}</p>`;
    const h = t.hotlist;
    const checks = h?.trendChecks || [];
    $('#tt-score').textContent = h ? `${h.trendTemplate}/8 · RS ${h.rsRating}` : '';
    $('#tt').innerHTML = checks.length ? `<ul class="checklist">${checks.map(c => `<li class="${c.pass ? 'ok' : ''}">${esc(c.label)}</li>`).join('')}</ul>` : '<div class="muted small">Add this symbol to your universe (Settings) to rank it on the hot list.</div>';
    $('#setup-pill').innerHTML = h ? biasPill(h.bias) : '';
    $('#setup').innerHTML = `<div class="grid g3">
      <div class="kv"><div>Setup</div><div>${esc(h?.setup || '—')}</div><div>Score</div><div>${h ? h.score : '—'}</div><div>Suggested</div><div class="small">${esc(h?.strategy || '—')}</div></div>
      <div class="kv"><div>RSI 14</div><div>${fmt.n(t.rsi, 1)}</div><div>ADX 14</div><div>${fmt.n(t.adx, 1)}</div><div>ATR 14</div><div>${fmt.px(t.atr)} (${fmt.pct(t.atrPct, 1)})</div></div>
      <div class="kv"><div>21 EMA</div><div>${fmt.px(t.ema21)}</div><div>50 / 200 SMA</div><div>${fmt.px(t.sma50)} / ${fmt.px(t.sma200)}</div><div>Squeeze</div><div>${t.squeezeOn ? `On (${t.squeezeDays}d)` : t.squeezeFired ? 'Fired' : 'Off'}</div></div>
    </div>
    ${h ? `<hr class="sep"><div class="row small"><b>Plan:</b> entry ${fmt.px(h.plan.entry)}${h.plan.trigger ? ` (trigger ${fmt.px(h.plan.trigger)})` : ''} · stop <span class="down">${fmt.px(h.plan.stop)}</span> · 2R <span class="up">${fmt.px(h.plan.target1)}</span> · 3R <span class="up">${fmt.px(h.plan.target2)}</span></div>` : ''}`;
  };

  const loadCanslim = async () => {
    try {
      const d = await api.get(`fundamentals/${encodeURIComponent(symbol)}`);
      const f = d.fundamentals, g = d.grade;
      const mark = v => (v === 'pass' ? '<span class="pill good">pass</span>' : v === 'fail' ? '<span class="pill bad">fail</span>' : '<span class="pill info">n/a</span>');
      if (!d.configured) { $('#canslim').innerHTML = '<div class="muted small">Add a free <code>FINNHUB_API_KEY</code> (Settings → Earnings calendar) to grade earnings and sales growth.</div>'; return; }
      if (!f) { $('#canslim').innerHTML = '<div class="muted small">No fundamentals available for this symbol (common for ETFs and ADRs).</div>'; return; }
      const pct = v => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(0)}%` : '—');
      $('#ca-grade').innerHTML = `C ${mark(g.C)} A ${mark(g.A)}`;
      $('#canslim').innerHTML = `<div class="kv">
        <div title="Latest quarter vs same quarter last year (O'Neil: >= 25%)">Qtr EPS growth (C)</div><div class="${cls(f.epsQYoY)}">${pct(f.epsQYoY)}${f.turnaround ? ' (turnaround)' : ''}</div>
        <div>Prior quarter EPS growth</div><div>${pct(f.epsQYoYPrev)}${f.accelerating ? ' <span class="up">↑ accelerating</span>' : ''}</div>
        <div>Qtr sales growth</div><div class="${cls(f.salesQYoY)}">${pct(f.salesQYoY)}</div>
        <div title="O'Neil: >= 25% a year over 3 years">3-yr EPS growth (A)</div><div>${Number.isFinite(f.eps3Y) ? `${f.eps3Y.toFixed(0)}%/yr` : '—'}</div>
        <div title="O'Neil: >= 17%">Return on equity</div><div>${Number.isFinite(f.roe) ? `${f.roe.toFixed(0)}%` : '—'}</div></div>
        <p class="help">Source: Finnhub${f.latestQuarter ? ` · latest quarter ${esc(f.latestQuarter)}` : ''} · updated ${d.asOf ? new Date(d.asOf).toLocaleDateString() : '—'}. ${Object.values(f.sources || {}).some(s => s.startsWith('computed')) ? 'Some growth rates computed from reported EPS/sales series.' : ''}</p>`;
    } catch (e) { $('#canslim').innerHTML = errorBox(e); }
  };

  const loadIdeas = async () => {
    try {
      const ideas = await api.get(`ideas/${encodeURIComponent(symbol)}`);
      $('#ideas').innerHTML = ideas.length ? ideas.map(ideaCard).join('') : '<div class="card empty">No option candidates for this symbol.</div>';
      bindIdeaActions($('#ideas'), ideas);
    } catch (e) { $('#ideas').innerHTML = errorBox(e); }
  };

  try {
    data = await api.get(`symbol/${encodeURIComponent(symbol)}`);
    drawHead(data.quote); drawSide(); drawChart(); loadIdeas(); loadCanslim();
  } catch (e) { $('#head').innerHTML = errorBox(e); return; }

  $('#ranges').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    range = b.dataset.r; prefs.set('range', range);
    root.querySelectorAll('#ranges button').forEach(x => x.classList.toggle('on', x === b));
    drawHead(data.quote); drawChart();
  });

  const t = setInterval(async () => {
    if (document.hidden) return;
    try {
      const q = await api.get(`quotes?symbols=${encodeURIComponent(symbol)}`);
      if (q[symbol]) { data.quote = q[symbol]; drawHead(data.quote); }
      if (range === '1D') drawChart();
    } catch { /* ignore */ }
  }, 15000);
  return () => { clearInterval(t); chart?.remove?.(); };
}
