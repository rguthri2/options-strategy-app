// Chart Studio: TradingView-style chart. Symbol header + live OHLC/indicator legend, 1m–monthly intervals,
// chart types (candles, hollow, bars, line, area, Heikin Ashi), log/percent scale, drawing tools,
// a watchlist sidebar, auto studies/patterns, a backtester, and the Claude Chart Copilot.
import { api } from '../api.js';
import { esc, logo, fmt, cls, loading, errorBox, toast, prefs, handoff } from '../ui.js';
import { sma, ema, bollinger, macd, rsi, stochastic, adx } from '../../shared/indicators.js';
import { autoStudies } from '../../shared/studies.js';
import { detectPatterns } from '../../shared/patterns.js';
import { heikinAshi, INTERVALS } from '../../shared/bars.js';
import { nyOffsetHours } from '../../shared/time.js';
import { DrawingLayer, DRAW_COLORS } from '../drawings.js';
import { scanCandles, candleEdge, candleRead, trendState, CANDLE_PATTERNS, STATUS_TEXT } from '../../shared/candles.js';

// Bottom range bar, like TradingView: each range picks a fitting interval.
const RANGES = [['1D', '5m'], ['5D', '15m'], ['1M', '1h'], ['3M', 'D'], ['6M', 'D'], ['YTD', 'D'], ['1Y', 'D'], ['2Y', 'D'], ['5Y', 'W'], ['All', 'M']];
const TYPES = [['candles', 'Candles'], ['hollow', 'Hollow candles'], ['bars', 'Bars'], ['ha', 'Heikin Ashi'], ['line', 'Line'], ['area', 'Area']];
const INDICATORS = [
  ['ema9', 'EMA 9'], ['ema21', 'EMA 21'], ['sma50', 'SMA 50'], ['sma200', 'SMA 200'], ['bollinger', 'Bollinger'], ['volume', 'Volume'],
  ['macd', 'MACD'], ['rsi', 'RSI'], ['stoch', 'Stoch'], ['adx', 'ADX'],
];
const AUTO = [['levels', 'S/R levels'], ['trendlines', 'Trendlines'], ['fib', 'Fibonacci'], ['avwap', 'Anchored VWAP'], ['zones', 'Supply/Demand'], ['plan', 'Swing plan'], ['patterns', 'Patterns'], ['candles', 'Candles']];
const PANES = ['macd', 'rsi', 'stoch', 'adx'];
const TOOLS = [
  ['cursor', 'Cursor (Esc)', '<path d="M5 3l12 8-5 1.5L9.5 18z"/>'],
  ['trend', 'Trend line', '<path d="M4 18L18 5" stroke-width="2"/><circle cx="4" cy="18" r="2"/><circle cx="18" cy="5" r="2"/>'],
  ['ray', 'Ray', '<path d="M4 17L20 6" stroke-width="2"/><circle cx="4" cy="17" r="2"/><path d="M20 6l-5 .5 2.5 3.5z"/>'],
  ['hline', 'Horizontal line', '<path d="M2 12h20" stroke-width="2"/><circle cx="12" cy="12" r="2"/>'],
  ['fib', 'Fibonacci retracement', '<path d="M3 5h18M3 9.5h18M3 14h18M3 19h18" stroke-width="1.6"/>'],
  ['rect', 'Rectangle', '<rect x="4" y="6" width="16" height="12" rx="1" fill="none" stroke-width="2"/>'],
  ['text', 'Text', '<path d="M5 6h14M12 6v13" stroke-width="2.4"/>'],
];
const QUICK = [
  'Analyze this chart: trend, key levels, patterns, and draw them.',
  'Is this setting up for a breakout or breakdown? What confirms it?',
  'What is the best options play here given IV and the expected move?',
  'Backtest the 21 EMA pullback and breakout strategies on this symbol and compare.',
];
// What each candle represents and what it's for (tooltips on the interval buttons; the manual has more).
const TF_HELP = {
  '1m': '1-minute candles: tape reading and precise entry timing. Very noisy; patterns are unreliable on their own.',
  '5m': '5-minute candles: day-trading view of today and the last few sessions. Good for timing an entry on a daily setup.',
  '15m': '15-minute candles: the intraday trend over 1–2 weeks. Useful for entries and for spotting intraday support/resistance.',
  '1h': '1-hour candles: about 7 per session. Bridges intraday and daily: the best entry-timing chart for swing trades.',
  D: 'Daily candles: one per session. The main chart for swing trades and options with 2–8 weeks to expiration.',
  W: 'Weekly candles: the primary trend and major support/resistance. Check it before any daily setup.',
  M: 'Monthly candles: the long-term (multi-year) trend and the biggest levels. For LEAPS and position trades.',
};
const MTF = [['W', 'Weekly', 'Primary trend'], ['D', 'Daily', 'Setup'], ['1h', 'Hourly', 'Entry timing']];

// Opus 5 list prices per million tokens (input, output, cache read, cache write) for the cost readout.
const PRICE = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const colorOf = c => ({ green: css('--up'), red: css('--down'), blue: css('--accent'), orange: '#f59e0b', purple: css('--neutral'), gray: css('--muted'), yellow: css('--warn') }[c] || css('--accent'));
const day = t => new Date(t * 1000).toISOString().slice(0, 10);
const icon = path => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-linecap="round">${path}</svg>`;

// Minimal, safe Markdown: escape first, then format.
function md(text) {
  const lines = esc(text).split('\n');
  let html = '', list = null;
  const inline = s => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m;
    if ((m = l.match(/^#{1,4}\s+(.*)/))) { close(); html += `<h4>${inline(m[1])}</h4>`; }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()) { close(); }
    else { close(); html += `<p>${inline(l)}</p>`; }
  }
  close();
  return html;
}

export async function render(root, [symArg]) {
  const symbol = symArg || prefs.get('studio-sym', 'SPY');
  if (!symArg) { location.replace(`#/chart/${encodeURIComponent(symbol)}`); return; }

  const st = {
    interval: prefs.get('studio-interval', 'D'), range: prefs.get('studio-range2', '1Y'), type: prefs.get('studio-type', 'candles'),
    scale: prefs.get('studio-scale', 0), // 0 normal, 1 log, 2 percent
    ind: new Set(prefs.get('studio-ind', ['ema21', 'sma50', 'sma200', 'volume'])),
    auto: new Set(prefs.get('studio-auto', ['levels', 'plan'])), hidden: new Set(),
    side: prefs.get('studio-side', 'watch'), showWm: prefs.get('studio-wm', true),
    bars: [], keys: [], quote: null, studies: null, patterns: null, plan: null, legend: [],
    chat: handoff.get(`chat-${symbol}`) || [], busy: null, ai: null, backtest: null, watch: [],
  };
  if (!INTERVALS[st.interval]) st.interval = 'D';

  root.innerHTML = `
    <div class="tv">
      <div class="tv-top">
        <form id="symf" class="tv-sym">${logo(symbol, 22)}<input id="symi" type="text" value="${esc(symbol)}" aria-label="Symbol" spellcheck="false"></form>
        <div class="tv-sep"></div>
        <div class="tv-seg" id="ivals">${Object.entries(INTERVALS).map(([k, v]) => `<button data-v="${k}" class="${k === st.interval ? 'on' : ''}" title="${esc(TF_HELP[k] || '')}">${v.label}</button>`).join('')}</div>
        <div class="tv-sep"></div>
        <select id="ctype" title="Chart type">${TYPES.map(([k, l]) => `<option value="${k}" ${k === st.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="tv-btn" id="indBtn">ƒx Indicators</button>
        <div class="tv-sep"></div>
        <div class="tv-seg" id="scale"><button data-v="1" class="${st.scale === 1 ? 'on' : ''}" title="Logarithmic scale">log</button><button data-v="2" class="${st.scale === 2 ? 'on' : ''}" title="Percent scale">%</button></div>
        <button class="tv-btn ${st.showWm ? 'on' : ''}" id="wmBtn" title="Show the symbol and interval in the chart background">Watermark</button>
        <span class="spacer"></span>
        <a class="tv-btn" href="#/options/${esc(symbol)}">Options chain</a>
      </div>
      <div class="tv-indpanel" id="indpanel" hidden>
        <div class="toolbar"><span class="tl">Indicators</span><div class="chips" id="ind">${INDICATORS.map(([k, l]) => `<button class="chip ${st.ind.has(k) ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
        <div class="toolbar"><span class="tl">Auto studies</span><div class="chips" id="auto">${AUTO.map(([k, l]) => `<button class="chip ${st.auto.has(k) ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
          <span class="spacer"></span><button class="btn sm ghost" id="clearai" hidden>Clear AI drawings</button></div>
      </div>
      <div class="tv-body">
        <div class="tv-left" id="tools">
          ${TOOLS.map(([k, label, p]) => `<button data-t="${k}" class="${k === 'cursor' ? 'on' : ''}" title="${label}">${icon(p)}</button>`).join('')}
          <div class="tv-sep h"></div>
          <button id="delAll" title="Remove all drawings">${icon('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke-width="1.8"/>')}</button>
        </div>
        <div class="tv-main">
          <div class="tv-chartwrap" id="wrap">
            <div id="chart" class="tv-chart">${loading('Loading chart…')}</div>
            <div class="tv-legend" id="legend"></div>
            <div id="plegends"></div>
            <div class="tv-seltools" id="seltools" hidden>${DRAW_COLORS.map(c => `<button data-c="${c}" style="background:${c}" title="Color"></button>`).join('')}<button data-del title="Delete (Del)">${icon('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke-width="1.8"/>')}</button></div>
          </div>
          <div class="tv-bottom" id="ranges">${RANGES.map(([r]) => `<button data-r="${r}" class="${r === st.range ? 'on' : ''}">${r}</button>`).join('')}
            <span class="spacer"></span><span class="muted tiny" id="tz"></span>
            <span class="tv-sep"></span>
            <span id="paneBtns">${[['macd', 'MACD'], ['rsi', 'RSI']].map(([k, l]) => `<button data-pane="${k}" class="${st.ind.has(k) ? 'on' : ''}" title="Show or hide the ${l} pane under the chart">${l}</button>`).join('')}</span>
            <button id="resetView" title="Reset chart view (Alt+R): default zoom, scroll and auto-scaled prices">⟲ Reset view</button></div>
        </div>
        <aside class="tv-side">
          <div class="tv-tabs"><button data-s="watch" class="${st.side === 'watch' ? 'on' : ''}">Watchlist</button><button data-s="ai" class="${st.side === 'ai' ? 'on' : ''}">✦ Copilot</button></div>
          <div class="tv-watch" id="watchPane" ${st.side === 'watch' ? '' : 'hidden'}>
            <form id="wadd" class="row" style="gap:6px;margin-bottom:8px"><input id="wsym" type="text" placeholder="Add symbol" style="flex:1;text-transform:uppercase"><button class="btn sm">＋</button></form>
            <div class="tv-wl-head"><span>Symbol</span><span>Last</span><span>Chg%</span></div>
            <div id="wlist">${loading()}</div>
          </div>
          <div class="copilot" id="aiPane" ${st.side === 'ai' ? '' : 'hidden'}>
            <div class="card-h"><h2>✦ Chart Copilot</h2><span id="cpst" class="muted tiny"></span><button class="btn sm ghost" id="cpclear" title="New conversation">↺</button></div>
            <div id="msgs" class="msgs"></div>
            <div class="chips" id="quick">${QUICK.map((q, i) => `<button class="chip" data-i="${i}">${esc(q.split(':')[0].split('?')[0])}</button>`).join('')}</div>
            <form id="ask" class="ask">
              <textarea id="q" rows="2" placeholder="Ask about ${esc(symbol)}… (Enter to send, Shift+Enter for a new line)"></textarea>
              <div class="row"><span id="cost" class="muted tiny"></span><span class="spacer"></span><button type="button" class="btn sm" id="stop" hidden>Stop</button><button class="btn sm primary" id="send">Send</button></div>
            </form>
          </div>
        </aside>
      </div>
    </div>
    <div class="grid g2 cdl-row" style="margin-top:14px">
      <section class="card"><div class="card-h"><h2>Candlestick patterns</h2><span class="muted small" id="cint"></span><a class="tiny" href="manual.html#candles" target="_blank" rel="noopener">Pattern guide ↗</a></div>
        <div id="cread">${loading()}</div><div id="clist"></div><div id="cdetail"></div><div id="cedge"></div></section>
      <section class="card"><div class="card-h"><h2>Timeframe alignment</h2><a class="tiny" href="manual.html#timeframes" target="_blank" rel="noopener">About timeframes ↗</a></div><div id="mtf">${loading()}</div></section>
    </div>
    <div class="grid g2" style="margin-top:14px">
      <section class="card"><div class="card-h"><h2>Chart patterns</h2><span class="muted small" id="pint">Rule-based</span></div><div id="plist">${loading()}</div></section>
      <section class="card"><div class="card-h"><h2>Backtest</h2><span class="muted small">Daily bars, up to 5 years, R multiples</span></div>
        <div class="row" style="margin-bottom:8px"><select id="bts" style="flex:1"></select>
          <label class="field">Stop ATR<input id="bstop" type="number" step="0.5" style="width:70px"></label>
          <label class="field">Target R<input id="btgt" type="number" step="0.5" style="width:70px"></label>
          <button class="btn sm primary" id="btrun" style="align-self:flex-end">Run</button></div>
        <div id="btout" class="muted small">Choose a strategy and run it; trades are marked on the chart.</div></section>
    </div>`;

  const $ = s => root.querySelector(s);
  const LW = window.LightweightCharts;
  let chart, main, markersApi, draw, watermark;
  const layers = {}; // name -> { series: [], lines: [], markers: [] }
  const intraday = () => Boolean(INTERVALS[st.interval]?.minutes);

  // ---------- time keys ----------
  // Daily/weekly/monthly bars use business-day strings; intraday bars use epoch seconds shifted to
  // New York wall-clock time so the axis reads in ET (Lightweight Charts displays UTC).
  const keyOf = t => (intraday() ? t + nyOffsetHours(new Date(t * 1000)) * 3600 : day(t));
  const idxAtOrBefore = t => {
    const b = st.bars;
    let lo = 0, hi = b.length - 1, ans = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (b[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  };
  const snapT = t => st.keys[idxAtOrBefore(t)];
  // A calendar date -> the last bar on or before it (end of that New York session for intraday).
  const snap = date => snapT(Date.parse(date + 'T00:00:00Z') / 1000 + (intraday() ? 86400 + 3 * 3600 : 0));
  const stepSec = () => (intraday() ? INTERVALS[st.interval].minutes * 60 : st.interval === 'W' ? 7 * 86400 : st.interval === 'M' ? 30 * 86400 : 86400);
  // Drawings: anchor time <-> fractional bar index (extrapolated past either end of the data).
  const timeToLogical = t => {
    const b = st.bars, n = b.length;
    if (!n) return 0;
    if (t >= b[n - 1].t) return n - 1 + (t - b[n - 1].t) / stepSec();
    if (t <= b[0].t) return (t - b[0].t) / stepSec();
    const i = idxAtOrBefore(t);
    return i + (t - b[i].t) / Math.max(1, b[i + 1].t - b[i].t);
  };
  const logicalToTime = l => {
    const b = st.bars, n = b.length;
    if (!n) return 0;
    if (l >= n - 1) return b[n - 1].t + (l - (n - 1)) * stepSec();
    if (l <= 0) return b[0].t + l * stepSec();
    const i = Math.floor(l);
    return b[i].t + (l - i) * (b[i + 1].t - b[i].t);
  };

  // ---------- chart plumbing ----------
  function layer(name) { if (!layers[name]) layers[name] = { series: [], lines: [], markers: [] }; return layers[name]; }
  function clearLayer(name) {
    const L = layers[name];
    if (!L) return;
    L.series.forEach(s => { try { chart.removeSeries(s); } catch { /* already gone */ } });
    L.lines.forEach(p => { try { main.removePriceLine(p); } catch { /* ignore */ } });
    delete layers[name];
    syncMarkers();
  }
  function syncMarkers() {
    const all = Object.values(layers).flatMap(l => l.markers).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    markersApi?.setMarkers(all);
  }
  const priceLine = (name, price, title, color, style = 2, width = 1) => {
    if (!Number.isFinite(price)) return;
    layer(name).lines.push(main.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title }));
  };
  const segment = (name, a, b, color, width = 2, style = 0) => {
    const s = chart.addSeries(LW.LineSeries, { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const p1 = { time: a.time, value: a.price }, p2 = { time: b.time, value: b.price };
    if (p1.time === p2.time) { chart.removeSeries(s); return; }
    s.setData(p1.time < p2.time ? [p1, p2] : [p2, p1]);
    layer(name).series.push(s);
  };
  const lineSeries = (name, data, color, width = 1.5, pane = 0, style = 0) => {
    const s = chart.addSeries(LW.LineSeries, { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
    s.setData(data.filter(d => Number.isFinite(d.value)));
    layer(name).series.push(s);
    return s;
  };

  function addMainSeries() {
    const up = css('--up'), dn = css('--down');
    const src = st.type === 'ha' ? heikinAshi(st.bars) : st.bars;
    const ohlc = src.map((b, i) => ({ time: st.keys[i], open: b.o, high: b.h, low: b.l, close: b.c }));
    if (st.type === 'line' || st.type === 'area') {
      const col = css('--accent');
      main = st.type === 'line'
        ? chart.addSeries(LW.LineSeries, { color: col, lineWidth: 2 })
        : chart.addSeries(LW.AreaSeries, { lineColor: col, topColor: col + '55', bottomColor: col + '05', lineWidth: 2 });
      main.setData(st.bars.map((b, i) => ({ time: st.keys[i], value: b.c })));
    } else if (st.type === 'bars') {
      main = chart.addSeries(LW.BarSeries, { upColor: up, downColor: dn, thinBars: false });
      main.setData(ohlc);
    } else {
      const hollow = st.type === 'hollow';
      main = chart.addSeries(LW.CandlestickSeries, {
        upColor: hollow ? 'rgba(0,0,0,0)' : up, downColor: dn, borderVisible: hollow, borderUpColor: up, borderDownColor: dn, wickUpColor: up, wickDownColor: dn,
      });
      main.setData(ohlc);
    }
    markersApi = LW.createSeriesMarkers(main, []);
  }

  // TradingView-style watermark: "AMD, 1D" large and faint in the main pane, company name underneath.
  const WM_LABEL = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', D: '1D', W: '1W', M: '1M' };
  function addWatermark() {
    watermark = null;
    if (typeof LW.createTextWatermark !== 'function') return;
    const light = document.documentElement.dataset.theme === 'light';
    const ink = a => (light ? `rgba(0, 0, 0, ${a})` : `rgba(255, 255, 255, ${a})`);
    const name = st.quote?.name && st.quote.name !== symbol ? st.quote.name : '';
    const title = `${symbol}, ${WM_LABEL[st.interval] || st.interval}`;
    // Size to the chart so it never overflows on a phone (bold glyphs ~0.62em wide).
    const lines = () => {
      const w = $('#chart')?.clientWidth || 800;
      const big = Math.round(Math.max(26, Math.min(72, (w * 0.8) / (title.length * 0.62))));
      const small = Math.round(Math.max(12, Math.min(22, (w * 0.8) / (Math.max(name.length, 1) * 0.55), big * 0.32)));
      return [
        { text: title, color: ink(light ? 0.07 : 0.06), fontSize: big, fontStyle: 'bold' },
        ...(name ? [{ text: name, color: ink(light ? 0.06 : 0.05), fontSize: small }] : []),
      ];
    };
    watermark = LW.createTextWatermark(chart.panes()[0], { visible: st.showWm, horzAlign: 'center', vertAlign: 'center', lines: lines() });
    watermark.resize = () => watermark?.applyOptions({ lines: lines() });
  }
  const wmRO = new ResizeObserver(() => { watermark?.resize?.(); requestAnimationFrame(() => renderPaneLegends()); });
  wmRO.observe($('#wrap'));

  function buildChart() {
    draw?.destroy(); draw = null;
    $('#chart').innerHTML = '';
    chart?.remove();
    Object.keys(layers).forEach(k => delete layers[k]);
    const grid = css('--border'), text = css('--muted');
    chart = LW.createChart($('#chart'), {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: text, fontFamily: css('--font'), panes: { separatorColor: grid } },
      grid: { vertLines: { color: grid + '66' }, horzLines: { color: grid + '66' } },
      rightPriceScale: { borderColor: grid, mode: st.scale }, timeScale: { borderColor: grid, rightOffset: 10, timeVisible: intraday(), secondsVisible: false },
      crosshair: { mode: 0 },
    });
    addMainSeries();
    addWatermark();
    drawIndicators();
    drawAuto();
    if (st.ai) applyDrawing(st.ai, false);
    if (st.backtest) drawBacktest(st.backtest);
    chart.subscribeCrosshairMove(p => updateLegend(p?.logical));
    chart.subscribeClick(() => draw?.select(null));
    draw = new DrawingLayer({
      host: $('#wrap'), chart, series: () => main, timeToLogical, logicalToTime,
      barAt: i => st.bars[i] || null,
      onChange: list => saveDrawings(list),
      onSelect: d => { $('#seltools').hidden = !d; },
      onToolDone: () => setTool('cursor'),
    });
    draw.set(st.drawings || []);
    setRange();
    updateLegend();
    requestAnimationFrame(() => renderPaneLegends()); // panes are laid out on the next frame
    $('#tz').textContent = intraday() ? 'Times in New York (ET) · regular session' : '';
  }

  // Visible range for the selected range button (works on whatever interval is loaded).
  function setRange() {
    const b = st.bars, n = b.length;
    if (!n) return;
    const sessionsBack = k => {
      const dates = [];
      for (let i = n - 1; i >= 0 && dates.length <= k; i--) { const d = keyDate(i); if (dates[dates.length - 1] !== d) dates.push(d); }
      const first = dates[Math.min(k, dates.length) - 1];
      return b.findIndex((_, i) => keyDate(i) === first);
    };
    const r = st.range;
    let from;
    if (r === '1D') from = sessionsBack(1);
    else if (r === '5D') from = sessionsBack(5);
    else if (r === '1M') from = intraday() ? sessionsBack(22) : n - 22;
    else if (r === 'YTD') from = b.findIndex(x => day(x.t) >= `${new Date().getFullYear()}-01-01`);
    else if (r === 'All') from = 0;
    else from = n - ({ '3M': 63, '6M': 126, '1Y': 252, '2Y': 504, '5Y': 1260 }[r] || 252) / (st.interval === 'W' ? 5 : st.interval === 'M' ? 21 : 1);
    if (!(from >= 0)) from = 0;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, Math.floor(from)) - 0.5, to: n - 1 + 8 });
  }
  const keyDate = i => (intraday() ? new Date(st.keys[i] * 1000).toISOString().slice(0, 10) : st.keys[i]);

  // ---------- legend (follows the crosshair) ----------
  function updateLegend(logical) {
    const b = st.bars, n = b.length;
    if (!n) return;
    const i = Number.isFinite(logical) ? Math.max(0, Math.min(n - 1, Math.round(logical))) : n - 1;
    const bar = b[i], prev = b[i - 1] || bar;
    const chg = bar.c - prev.c, pct = prev.c ? chg / prev.c : 0, c = chg >= 0 ? 'up' : 'down';
    const q = st.quote;
    const v = (arr, d = 2) => (Number.isFinite(arr?.[i]) ? arr[i].toFixed(d) : '—');
    $('#legend').innerHTML = `
      <div class="tv-lg-title">${logo(symbol, 18)}<b>${esc(symbol)}</b><span class="muted">${esc(q?.name || '')}</span><span class="muted">· ${INTERVALS[st.interval].label}</span>
        ${q ? `<span class="tv-live ${cls(q.change)}">${fmt.px(q.last)} ${fmt.schg(q.change)} (${fmt.spct(q.changePct)})</span>` : ''}</div>
      <div class="tv-lg-ohlc">O <span class="${c}">${fmt.px(bar.o)}</span> H <span class="${c}">${fmt.px(bar.h)}</span> L <span class="${c}">${fmt.px(bar.l)}</span> C <span class="${c}">${fmt.px(bar.c)}</span>
        <span class="${c}">${fmt.schg(chg)} (${fmt.spct(pct)})</span> <span class="muted">Vol ${fmt.big(bar.v)}</span>
        ${intraday() ? `<span class="muted">${new Date(st.keys[i] * 1000).toISOString().slice(5, 16).replace('T', ' ')}</span>` : `<span class="muted">${esc(st.keys[i])}</span>`}</div>
      ${st.legend.map(L => `<div class="tv-lg-ind ${st.hidden.has(L.key) ? 'off' : ''}" data-k="${L.key}"><span class="nm">${esc(L.label)}</span>
        ${L.lines.map(x => `<span style="color:${x.color}">${x.big ? fmt.big(x.arr[i]) : v(x.arr, x.d ?? 2)}</span>`).join(' ')}
        <button data-eye title="Show/hide">${st.hidden.has(L.key) ? '◌' : '👁'}</button><button data-rm title="Remove">✕</button></div>`).join('')}`;
    renderPaneLegends(i);
  }

  // TradingView-style legend inside each indicator pane (MACD, RSI, Stoch, ADX): name, live values, hide/remove.
  function renderPaneLegends(i = st.bars.length - 1) {
    const box = $('#plegends');
    if (!box) return;
    const wrapTop = $('#wrap').getBoundingClientRect().top;
    const panes = chart?.panes?.() || [];
    const v = (arr, d = 2) => (Number.isFinite(arr?.[i]) ? arr[i].toFixed(d) : '—');
    box.innerHTML = (st.paneLegend || []).map(L => {
      const el = panes[L.pane]?.getHTMLElement?.();
      if (!el) return '';
      const top = el.getBoundingClientRect().top - wrapTop + 4;
      return `<div class="tv-plg" style="top:${Math.round(top)}px"><div class="tv-lg-ind ${st.hidden.has(L.key) ? 'off' : ''}" data-k="${L.key}"><span class="nm">${esc(L.label)}</span>
        ${L.lines.map(x => `<span style="color:${x.color}">${v(x.arr, x.d ?? 2)}</span>`).join(' ')}
        <button data-eye title="Show/hide">${st.hidden.has(L.key) ? '◌' : '👁'}</button><button data-rm title="Remove pane">✕</button></div></div>`;
    }).join('');
  }

  // Proportional pane heights like TradingView: price pane 3 parts, each indicator pane 1 part.
  function sizePanes() {
    try {
      const panes = chart.panes();
      panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
    } catch { /* older API: leave the library's default split */ }
  }

  // Keep every indicator toggle in agreement: ƒx chips and the MACD/RSI buttons in the bottom bar.
  function syncIndButtons() {
    root.querySelectorAll('#ind .chip').forEach(b => b.classList.toggle('on', st.ind.has(b.dataset.k)));
    root.querySelectorAll('#paneBtns [data-pane]').forEach(b => b.classList.toggle('on', st.ind.has(b.dataset.pane)));
  }

  // ---------- indicators ----------
  function drawIndicators() {
    for (const k of Object.keys(layers)) if (k.startsWith('ind:')) clearLayer(k);
    PANES.forEach(clearLayer);
    st.legend = []; st.paneLegend = [];
    const c = st.bars.map(b => b.c), K = st.keys;
    const ser = arr => arr.map((v, i) => ({ time: K[i], value: v }));
    const col = { ema9: '#f472b6', ema21: css('--accent'), sma50: css('--warn'), sma200: css('--neutral') };
    const overlay = (key, label, arr, color, width) => {
      if (!st.ind.has(key)) return;
      lineSeries(`ind:${key}`, ser(arr), color, width);
      st.legend.push({ key, label, lines: [{ arr, color }] });
    };
    overlay('ema9', 'EMA 9', ema(c, 9), col.ema9, 1.2);
    overlay('ema21', 'EMA 21', ema(c, 21), col.ema21, 1.5);
    overlay('sma50', 'SMA 50', sma(c, 50), col.sma50, 1.5);
    overlay('sma200', 'SMA 200', sma(c, 200), col.sma200, 1.8);
    if (st.ind.has('bollinger')) {
      const bb = bollinger(c, 20, 2), m = css('--muted');
      lineSeries('ind:bollinger', ser(bb.upper), m, 1, 0, 2); lineSeries('ind:bollinger', ser(bb.mid), css('--faint'), 1, 0, 1); lineSeries('ind:bollinger', ser(bb.lower), m, 1, 0, 2);
      st.legend.push({ key: 'bollinger', label: 'BB 20 2', lines: [{ arr: bb.upper, color: m }, { arr: bb.mid, color: css('--faint') }, { arr: bb.lower, color: m }] });
    }
    if (st.ind.has('volume')) {
      const v = chart.addSeries(LW.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      v.setData(st.bars.map((b, i) => ({ time: K[i], value: b.v, color: (b.c >= b.o ? css('--up') : css('--down')) + '55' })));
      layer('ind:volume').series.push(v);
      st.legend.push({ key: 'volume', label: 'Volume', lines: [{ arr: st.bars.map(b => b.v), color: css('--muted'), big: true }] });
    }
    let pane = 1;
    const paneOf = {};
    for (const p of PANES) if (st.ind.has(p)) paneOf[p] = pane++;
    if (paneOf.macd) {
      const m = macd(c);
      const h = chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneOf.macd);
      h.setData(m.hist.map((v, i) => ({ time: K[i], value: v, color: (v >= 0 ? css('--up') : css('--down')) + '99' })).filter(d => Number.isFinite(d.value)));
      layer('macd').series.push(h);
      lineSeries('macd', ser(m.macd), css('--accent'), 1.4, paneOf.macd); lineSeries('macd', ser(m.signal), css('--warn'), 1.2, paneOf.macd);
      st.paneLegend.push({ key: 'macd', pane: paneOf.macd, label: 'MACD 12 26 9', lines: [{ arr: m.macd, color: css('--accent') }, { arr: m.signal, color: css('--warn') }, { arr: m.hist, color: css('--muted') }] });
    }
    if (paneOf.rsi) {
      const r = rsi(c, 14);
      const s = lineSeries('rsi', ser(r), css('--neutral'), 1.5, paneOf.rsi);
      [70, 30].forEach(v => s.createPriceLine({ price: v, color: css('--faint'), lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
      st.paneLegend.push({ key: 'rsi', pane: paneOf.rsi, label: 'RSI 14', lines: [{ arr: r, color: css('--neutral'), d: 1 }] });
    }
    if (paneOf.stoch) {
      const so = stochastic(st.bars);
      const s = lineSeries('stoch', ser(so.k), css('--accent'), 1.4, paneOf.stoch); lineSeries('stoch', ser(so.d), css('--warn'), 1.2, paneOf.stoch);
      [80, 20].forEach(v => s.createPriceLine({ price: v, color: css('--faint'), lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
      st.paneLegend.push({ key: 'stoch', pane: paneOf.stoch, label: 'Stoch 14 3', lines: [{ arr: so.k, color: css('--accent'), d: 1 }, { arr: so.d, color: css('--warn'), d: 1 }] });
    }
    if (paneOf.adx) {
      const a = adx(st.bars, 14);
      const s = lineSeries('adx', ser(a.adx), css('--text'), 1.6, paneOf.adx);
      lineSeries('adx', ser(a.pdi), css('--up'), 1, paneOf.adx); lineSeries('adx', ser(a.mdi), css('--down'), 1, paneOf.adx);
      s.createPriceLine({ price: 25, color: css('--faint'), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      st.paneLegend.push({ key: 'adx', pane: paneOf.adx, label: 'ADX 14', lines: [{ arr: a.adx, color: css('--text'), d: 1 }, { arr: a.pdi, color: css('--up'), d: 1 }, { arr: a.mdi, color: css('--down'), d: 1 }] });
    }
    sizePanes();
    for (const k of st.hidden) setVisible(k, false);
  }
  const layerNameOf = k => (PANES.includes(k) ? k : `ind:${k}`);
  const setVisible = (k, on) => layers[layerNameOf(k)]?.series.forEach(s => s.applyOptions({ visible: on }));

  function drawAuto() {
    ['levels', 'trendlines', 'fib', 'avwap', 'zones', 'plan', 'patterns', 'candles'].forEach(clearLayer);
    const S = st.studies, P = st.patterns;
    if (S) {
      if (st.auto.has('levels')) S.levels.forEach(l => priceLine('levels', l.price, `${l.kind === 'support' ? 'S' : 'R'} ×${l.touches}`, l.kind === 'support' ? css('--up') : css('--down'), 0, l.strength > 60 ? 2 : 1));
      if (st.auto.has('trendlines')) S.trendlines.forEach(t => segment('trendlines', { time: snapT(t.p1.t), price: t.p1.price }, { time: snapT(t.end.t), price: t.end.price }, t.kind === 'support' ? css('--up') : css('--down'), 2));
      if (st.auto.has('fib')) S.fib.levels.filter(l => l.ratio <= 1).forEach(l => priceLine('fib', l.price, `Fib ${(l.ratio * 100).toFixed(1)}%`, '#f59e0b', 1, 1));
      if (st.auto.has('avwap')) S.avwap.forEach((a, k) => lineSeries('avwap', a.series.map(p => ({ time: snapT(p.t), value: p.v })), k ? css('--down') : css('--neutral'), 1.6, 0, 0));
      if (st.auto.has('zones')) S.zones.forEach(z => { const c = z.kind === 'demand' ? css('--up') : css('--down'); priceLine('zones', z.top, `${z.kind} ▲`, c, 3); priceLine('zones', z.bottom, `${z.kind} ▼`, c, 3); });
    }
    if (st.auto.has('plan') && st.plan) {
      priceLine('plan', st.plan.stop, 'Stop', css('--down'), 0, 2); priceLine('plan', st.plan.target1, '2R', css('--up'), 0, 1); priceLine('plan', st.plan.target2, '3R', css('--up'), 2, 1);
      if (st.plan.trigger) priceLine('plan', st.plan.trigger, 'Trigger', css('--accent'), 2, 1);
    }
    if (st.auto.has('patterns') && P) {
      P.chart.slice(0, 3).forEach(p => {
        const c = p.bias === 'bull' ? css('--up') : p.bias === 'bear' ? css('--down') : css('--accent');
        for (let i = 1; i < p.points.length; i++) segment('patterns', { time: snapT(p.points[i - 1].t), price: p.points[i - 1].price }, { time: snapT(p.points[i].t), price: p.points[i].price }, c + 'cc', 1, 1);
        p.lines.forEach(l => segment('patterns', { time: snapT(l.from.t), price: l.from.price }, { time: snapT(l.to.t), price: l.to.price }, c, 1.5, 2));
        layer('patterns').markers.push({ time: snapT(p.points[p.points.length - 1].t), position: p.bias === 'bear' ? 'aboveBar' : 'belowBar', shape: 'circle', color: c, text: `${p.name} ${p.confidence}` });
        priceLine('patterns', p.target, `${p.name} target`, c, 1, 1);
      });
    }
    // Candle markers: the last 60 bars, higher-quality patterns only (plus anything in the last 5 bars) to avoid clutter.
    if (st.auto.has('candles') && st.candles) {
      const n = st.bars.length;
      st.candles.filter(k => k.end >= n - 60 && (k.end >= n - 5 || (k.score >= 60 && k.kind !== 'indecision'))).forEach(k => layer('candles').markers.push({
        time: st.keys[k.end], position: k.bias === 'bear' ? 'aboveBar' : 'belowBar', shape: k.bias === 'bear' ? 'arrowDown' : k.bias === 'bull' ? 'arrowUp' : 'circle',
        color: k.bias === 'bear' ? css('--down') : k.bias === 'bull' ? css('--up') : css('--muted'), text: k.name,
      }));
    }
    syncMarkers();
  }

  // ---------- AI drawings (Copilot) ----------
  function applyDrawing(d, store = true) {
    if (d.clear) clearLayer('ai');
    if (store) st.ai = d.clear || !st.ai ? d : { ...d, levels: [...st.ai.levels, ...d.levels], zones: [...st.ai.zones, ...d.zones], trendlines: [...st.ai.trendlines, ...d.trendlines], markers: [...st.ai.markers, ...d.markers] };
    d.levels.forEach(l => priceLine('ai', l.price, `✦ ${l.label}`, colorOf(l.color), l.style === 'solid' ? 0 : 2, 2));
    d.zones.forEach(z => { priceLine('ai', z.top, `✦ ${z.label}`, colorOf(z.color), 3, 1); priceLine('ai', z.bottom, '', colorOf(z.color), 3, 1); });
    d.trendlines.forEach(t => segment('ai', { time: snap(t.from.date), price: t.from.price }, { time: snap(t.to.date), price: t.to.price }, colorOf(t.color), 2));
    d.markers.forEach(m => layer('ai').markers.push({ time: snap(m.date), position: m.position === 'above' ? 'aboveBar' : 'belowBar', shape: m.shape, color: colorOf(m.color), text: `✦ ${m.text}` }));
    if (d.studies?.length) {
      d.studies.forEach(s => st.ind.add(s));
      syncIndButtons();
      drawIndicators(); updateLegend();
    }
    syncMarkers();
    $('#clearai').hidden = false;
  }

  // ---------- backtest (daily bars) ----------
  function drawBacktest(r) {
    clearLayer('bt');
    for (const t of r.trades.slice(-60)) {
      const long = r.side === 'long';
      layer('bt').markers.push({ time: snap(day(t.entryT)), position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: css('--accent'), text: 'In' });
      layer('bt').markers.push({ time: snap(day(t.exitT)), position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: t.r > 0 ? css('--up') : css('--down'), text: `${t.r > 0 ? '+' : ''}${t.r}R` });
    }
    syncMarkers();
  }
  function showBacktest(r) {
    st.backtest = r;
    const s = r.stats;
    $('#btout').innerHTML = s.trades ? `<div class="kv">
      <div>Trades</div><div>${s.trades} (${day(s.fromT)} → ${day(s.toT)})</div>
      <div>Win rate</div><div>${fmt.pct(s.winRate, 0)}</div>
      <div>Avg R / expectancy</div><div class="${cls(s.avgR)}">${fmt.schg(s.avgR)}R</div>
      <div>Avg win / avg loss</div><div><span class="up">+${fmt.n(s.avgWinR, 2)}R</span> / <span class="down">${fmt.n(s.avgLossR, 2)}R</span></div>
      <div>Profit factor</div><div>${Number.isFinite(s.profitFactor) ? fmt.n(s.profitFactor, 2) : '∞'}</div>
      <div>Total / max drawdown</div><div><span class="${cls(s.totalR)}">${fmt.schg(s.totalR, 1)}R</span> / <span class="down">${fmt.n(s.maxDrawdownR, 1)}R</span></div>
      <div>Avg hold</div><div>${fmt.n(s.avgBars, 1)} bars</div>
      <div>Buy &amp; hold (same period)</div><div class="${cls(s.buyHoldPct)}">${fmt.spct(s.buyHoldPct, 1)}</div></div>
      ${r.open ? `<p class="help">Open signal: entered ${day(r.open.entryT)} at ${fmt.px(r.open.entry)}, stop ${fmt.px(r.open.stop)}${r.open.target ? `, target ${fmt.px(r.open.target)}` : ''}.</p>` : ''}
      ${s.trades < 20 ? '<p class="help">⚠ Small sample. Treat the statistics as anecdotal.</p>' : ''}`
      : '<div class="muted small">No trades triggered on this symbol\'s history.</div>';
    drawBacktest(r);
  }

  // ---------- drawings persistence ----------
  let saveT = null;
  const putDrawings = () => { saveT = null; return api.put(`drawings/${encodeURIComponent(symbol)}`, { drawings: st.drawings }).catch(e => toast(`Drawings not saved: ${e.message}`, true)); };
  function saveDrawings(list) {
    st.drawings = list.map(d => ({ ...d, points: d.points.map(p => ({ ...p })) }));
    clearTimeout(saveT);
    saveT = setTimeout(putDrawings, 500);
  }
  function setTool(t) {
    root.querySelectorAll('#tools [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    draw?.setTool(t);
  }

  // ---------- data ----------
  async function loadBars() {
    let bars;
    try { bars = await api.get(`bars/${encodeURIComponent(symbol)}?interval=${st.interval}`); }
    catch (e) {
      if (st.interval === 'D') throw e;
      toast(e.message, true);
      st.interval = 'D'; prefs.set('studio-interval', 'D');
      root.querySelectorAll('#ivals button').forEach(x => x.classList.toggle('on', x.dataset.v === 'D'));
      bars = await api.get(`bars/${encodeURIComponent(symbol)}?interval=D`);
    }
    if (bars.length < 20) throw new Error('Not enough history for this symbol and interval yet.');
    st.bars = bars;
    st.keys = bars.map(b => keyOf(b.t));
    try { st.studies = bars.length >= 60 ? autoStudies(bars) : null; } catch { st.studies = null; }
    try { st.patterns = bars.length >= 60 ? detectPatterns(bars) : null; } catch { st.patterns = null; }
    try { st.candles = scanCandles(bars); st.edge = candleEdge(st.candles); st.read = candleRead(bars, st.candles); } catch { st.candles = null; st.edge = []; st.read = null; }
    renderCandles();
    const P = st.patterns;
    $('#pint').textContent = `Rule-based · ${INTERVALS[st.interval].label} bars`;
    $('#plist').innerHTML = P && P.chart.length ? `<table class="t"><thead><tr><th class="l">Pattern</th><th>Conf.</th><th class="l">Status</th><th>Breakout</th><th>Target</th><th>Invalid.</th></tr></thead><tbody>
      ${P.chart.map(p => `<tr><td class="l"><span class="pill ${p.bias}">${esc(p.name)}</span>${p.detail ? `<div class="tiny muted">${esc(p.detail)}</div>` : ''}</td><td>${p.confidence}</td><td class="l small">${esc(p.status)}</td><td>${fmt.px(p.breakout)}</td><td>${fmt.px(p.target)}</td><td>${fmt.px(p.stop)}</td></tr>`).join('')}
      </tbody></table>`
      : '<div class="muted small">No chart patterns right now. That\'s common in trending or choppy phases.</div>';
    buildChart();
  }
  // ---------- candlestick card ----------
  const biasCls = b => (b === 'bull' || b === 'bullish' ? 'bull' : b === 'bear' || b === 'bearish' ? 'bear' : 'neutral');
  const planText = pl => `${pl.dir === 'long' ? 'Buy above' : 'Short below'} ${fmt.px(pl.trigger)} · stop ${fmt.px(pl.stop)} · 2R ${fmt.px(pl.target1)}`;
  // Stopped (−1R) and target (+2R) already say their result; open/time-exit trades show the running R.
  const statusText = o => `${STATUS_TEXT[o.status] || o.status}${o.r !== undefined && (o.status === 'open' || o.status === 'time exit') ? ` (${o.r > 0 ? '+' : ''}${o.r}R)` : ''}`;
  function renderCandles() {
    const n = st.bars.length, R = st.read;
    $('#cint').textContent = `${INTERVALS[st.interval].label} candles`;
    if (!st.candles) { $('#cread').innerHTML = '<div class="muted small">Not enough bars for candle analysis.</div>'; $('#clist').innerHTML = ''; $('#cedge').innerHTML = ''; return; }
    $('#cread').innerHTML = R ? `<div class="cdl-read"><span class="pill ${biasCls(R.bias)}">Candle read: ${esc(R.bias)}</span><p class="help">${esc(R.summary)}</p></div>` : '';
    const recent = st.candles.filter(p => p.end >= n - 20).reverse().slice(0, 12);
    $('#clist').innerHTML = recent.length ? `<div class="table-wrap"><table class="t"><thead><tr><th class="l">Bar</th><th class="l">Pattern</th><th class="l">Context</th><th>Quality</th><th class="l">Plan</th><th class="l">Status</th></tr></thead><tbody>
      ${recent.map((p, k) => `<tr class="clickable" data-ci="${st.candles.indexOf(p)}"><td class="l nowrap">${esc(String(st.keys[p.end]).replace('T', ' '))}${n - 1 - p.end === 0 ? ' <span class="pill info">last</span>' : ''}</td>
        <td class="l"><span class="pill ${biasCls(p.bias)}">${esc(p.name)}</span></td>
        <td class="l small">${[p.trend === 'down' ? '↓ after decline' : p.trend === 'up' ? '↑ after advance' : '', p.atSupport ? 'at support' : '', p.atResistance ? 'at resistance' : '', p.volRatio >= 1.3 ? `vol ${p.volRatio}×` : ''].filter(Boolean).join(' · ') || '—'}</td>
        <td>${p.score}</td><td class="l small">${p.plans.map(planText).join('<br>')}</td><td class="l small">${esc(statusText(p.outcome))}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="muted small">No candlestick patterns in the last 20 bars.</div>';
    const edge = st.edge.filter(e => e.count >= 2);
    $('#cedge').innerHTML = edge.length ? `<details class="cdl-edge"><summary>History on ${esc(symbol)} (${esc(INTERVALS[st.interval].label)}): how each pattern's plan worked out</summary>
      <table class="t"><thead><tr><th class="l">Pattern</th><th>Seen</th><th>Triggered</th><th>Win %</th><th>Avg R</th></tr></thead><tbody>
      ${edge.map(e => `<tr><td class="l"><span class="pill ${biasCls(e.bias)}">${esc(e.name)}</span></td><td>${e.count}</td><td>${fmt.pct(e.triggerRate, 0)}</td><td>${fmt.pct(e.winRate, 0)}</td><td class="${cls(e.avgR)}">${e.avgR == null ? '—' : `${e.avgR > 0 ? '+' : ''}${e.avgR}R`}</td></tr>`).join('')}</tbody></table>
      <p class="help">Same rules as the plan: enter on a break of the pattern within 3 bars, stop beyond the pattern, exit at 2R, at the stop or after 15 bars. Fewer than ~20 occurrences is anecdotal.</p></details>` : '';
    $('#cdetail').innerHTML = '';
  }
  function showCandle(p) {
    const d = CANDLE_PATTERNS[p.key], e = st.edge.find(x => x.key === p.key);
    $('#cdetail').innerHTML = `<div class="cdl-detail">
      <div class="row"><b>${esc(d.name)}</b><span class="pill ${biasCls(d.bias)}">${esc(d.bias === 'neutral' ? 'either way' : d.bias + 'ish')} ${esc(d.kind)}</span><span class="muted small">${d.bars}-candle pattern</span>
        <span class="spacer"></span><a class="tiny" href="manual.html#cdl-${esc(p.key)}" target="_blank" rel="noopener">More ↗</a><button class="btn sm ghost" data-cclose>✕</button></div>
      <p class="help"><b>What it is:</b> ${esc(d.def)}</p>
      <p class="help"><b>What it means:</b> ${esc(d.psych)}</p>
      <div class="kv small"><div>Entry</div><div>${esc(d.entry)}</div><div>Stop</div><div>${esc(d.stop)}</div><div>As an exit signal</div><div>${esc(d.exit)}</div><div>Works best</div><div>${esc(d.best)}</div>
        <div>This one's plan</div><div>${p.plans.map(planText).join('<br>')} <span class="muted">(risk ${p.plans[0].riskPct}%)</span></div>
        <div>Since then</div><div>${esc(statusText(p.outcome))}</div>
        ${e ? `<div>On ${esc(symbol)}</div><div>Seen ${e.count}× · triggered ${fmt.pct(e.triggerRate, 0)} · win ${fmt.pct(e.winRate, 0)} · avg ${e.avgR == null ? '—' : `${e.avgR > 0 ? '+' : ''}${e.avgR}R`}</div>` : ''}</div>
      </div>`;
    // Show it on the chart: center the pattern and draw its plan levels.
    clearLayer('cdlplan');
    p.plans.forEach(pl => { priceLine('cdlplan', pl.trigger, pl.dir === 'long' ? 'Buy trigger' : 'Short trigger', css('--accent'), 2, 1); priceLine('cdlplan', pl.stop, 'Pattern stop', css('--down'), 0, 1); priceLine('cdlplan', pl.target1, '2R', css('--up'), 2, 1); });
    layer('cdlplan').markers.push({ time: st.keys[p.end], position: p.bias === 'bear' ? 'aboveBar' : 'belowBar', shape: 'circle', color: css('--accent'), text: `▶ ${p.name}` });
    syncMarkers();
    const span = Math.max(40, Math.round((chart.timeScale().getVisibleLogicalRange()?.to ?? 60) - (chart.timeScale().getVisibleLogicalRange()?.from ?? 0)));
    chart.timeScale().setVisibleLogicalRange({ from: p.end - span * 0.6, to: p.end + span * 0.4 });
    $('#wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- timeframe alignment ----------
  async function loadMtf() {
    const rows = await Promise.all(MTF.map(async ([iv, label, role]) => {
      try {
        const bars = iv === st.interval ? st.bars : await api.get(`bars/${encodeURIComponent(symbol)}?interval=${iv}`);
        const ts = trendState(bars), c = scanCandles(bars).filter(p => p.end >= bars.length - 3).pop();
        return { iv, label, role, ts, c };
      } catch (e) { return { iv, label, role, err: e.message }; }
    }));
    const states = rows.filter(r => r.ts && r.ts.state !== 'n/a').map(r => r.ts.state);
    const allUp = states.length === 3 && states.every(s => s === 'up'), allDn = states.length === 3 && states.every(s => s === 'down');
    const verdict = allUp ? ['bull', 'All three timeframes are up: the highest-probability conditions for longs. Use the hourly chart to time the entry.']
      : allDn ? ['bear', 'All three timeframes are down: avoid new longs; bearish setups and put spreads have the wind behind them.']
        : rows[0]?.ts?.state === 'up' && rows[1]?.ts?.state !== 'down' ? ['neutral', 'The weekly trend is up but the timeframes are not aligned. Wait for the daily and hourly to turn up before buying.']
          : rows[0]?.ts?.state === 'down' ? ['neutral', 'The weekly trend is down: daily bounces are counter-trend. Size down or wait.']
            : ['neutral', 'Mixed timeframes: no clear edge from trend alignment.'];
    const pillOf = s => (s === 'up' ? '<span class="pill bull">Up</span>' : s === 'down' ? '<span class="pill bear">Down</span>' : `<span class="pill neutral">${esc(s === 'mixed' ? 'Mixed' : 'n/a')}</span>`);
    $('#mtf').innerHTML = `<table class="t"><thead><tr><th class="l">Timeframe</th><th class="l">Role</th><th class="l">Trend</th><th>vs EMA 21</th><th class="l">Latest candle</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="clickable" data-iv="${r.iv}"><td class="l"><b>${esc(r.label)}</b></td><td class="l small muted">${esc(r.role)}</td>
        <td class="l">${r.err ? `<span class="muted small" title="${esc(r.err)}">unavailable</span>` : pillOf(r.ts.state)}</td>
        <td class="${r.ts ? cls(r.ts.last - r.ts.ma21) : ''}">${r.ts?.ma21 ? fmt.spct(r.ts.last / r.ts.ma21 - 1, 1) : '—'}</td>
        <td class="l small">${r.c ? `<span class="pill ${biasCls(r.c.bias)}">${esc(r.c.name)}</span>` : '<span class="muted">none</span>'}</td></tr>`).join('')}</tbody></table>
      <div class="cdl-read" style="margin-top:10px"><span class="pill ${verdict[0]}">${verdict[0] === 'bull' ? 'Aligned up' : verdict[0] === 'bear' ? 'Aligned down' : 'Not aligned'}</span><p class="help">${esc(verdict[1])}</p></div>
      <p class="help muted">Up = price above a rising EMA 21 that is above the SMA 50. Click a row to switch the chart to that timeframe.</p>`;
  }

  async function load() {
    const [info, drawings] = await Promise.all([
      api.get(`symbol/${encodeURIComponent(symbol)}`).catch(() => null),
      api.get(`drawings/${encodeURIComponent(symbol)}`).catch(() => []),
    ]);
    st.quote = info?.quote || null;
    st.plan = info?.tech?.hotlist?.plan || null;
    st.drawings = drawings;
    await loadBars();
    prefs.set('studio-sym', symbol); // remember only symbols that loaded
  }

  // ---------- watchlist ----------
  async function loadWatch() {
    try {
      if (!st.watch.length) st.watch = (await api.get('settings')).watchlist || [];
      if (!st.watch.length) { $('#wlist').innerHTML = '<div class="muted small">Add symbols to build your watchlist.</div>'; return; }
      const q = await api.get(`quotes?symbols=${encodeURIComponent(st.watch.join(','))}`);
      $('#wlist').innerHTML = st.watch.map(s => {
        const x = q[s] || {};
        return `<div class="tv-wl ${s === symbol ? 'on' : ''}" data-s="${esc(s)}">${logo(s, 22)}<span class="sym">${esc(s)}</span>
          <span class="num">${fmt.px(x.last)}</span><span class="num ${cls(x.changePct)}">${fmt.spct(x.changePct)}</span><button data-wrm title="Remove">✕</button></div>`;
      }).join('');
    } catch (e) { $('#wlist').innerHTML = errorBox(e); }
  }
  async function saveWatch() {
    try { await api.put('settings', { watchlist: st.watch }); } catch (e) { toast(e.message, true); }
    loadWatch();
  }

  // ---------- copilot ----------
  function renderChat() {
    const box = $('#msgs');
    box.innerHTML = st.chat.length ? st.chat.map(m => m.role === 'user'
      ? `<div class="msg user">${esc(m.content)}</div>`
      : `<div class="msg bot">${m.tools?.length ? `<div class="tools">${m.tools.map(t => `<span class="tool ${t.status}">${esc(t.label)}</span>`).join('')}</div>` : ''}${md(m.content || '')}${m.pending ? '<span class="spin"></span>' : ''}</div>`).join('')
      : `<div class="empty small">Ask Claude about <b>${esc(symbol)}</b>. It reads the chart, studies, patterns, options data and backtests, then draws its analysis on the chart.</div>`;
    box.scrollTop = box.scrollHeight;
  }
  const TOOL_LABEL = { get_market_snapshot: 'Snapshot', get_price_bars: 'Price bars', get_chart_studies: 'Levels & studies', detect_patterns: 'Patterns', get_options_summary: 'Options', get_trade_ideas: 'Trade ideas', run_backtest: 'Backtest', run_options_backtest: 'Options backtest', get_scanner_results: 'Daily scan', draw_on_chart: 'Drawing' };

  async function ask(text) {
    if (st.busy || !text.trim()) return;
    st.chat.push({ role: 'user', content: text.trim() });
    const bot = { role: 'assistant', content: '', tools: [], pending: true };
    st.chat.push(bot);
    renderChat();
    const ctl = new AbortController();
    st.busy = ctl;
    $('#send').disabled = true; $('#stop').hidden = false;
    try {
      const res = await fetch('api/copilot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ symbol, range: st.range, messages: st.chat.filter(m => !m.pending && m.content).map(m => ({ role: m.role, content: m.content })) }),
      });
      if (res.status === 401) { location.href = 'login.html' + location.hash; return; }
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '', lastPaint = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const line = chunk.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'text') bot.content += ev.delta;
          else if (ev.type === 'tool') {
            const label = TOOL_LABEL[ev.name] || ev.name;
            const existing = bot.tools.find(t => t.name === ev.name && t.status === 'start');
            if (ev.status === 'start') bot.tools.push({ name: ev.name, label, status: 'start' });
            else if (existing) existing.status = ev.status;
          } else if (ev.type === 'draw') applyDrawing(ev.drawing);
          else if (ev.type === 'backtest' && ev.symbol === symbol) showBacktest(ev.result);
          else if (ev.type === 'notice') bot.content += `\n\n*${ev.text}*`;
          else if (ev.type === 'error') bot.content += `\n\n**⚠ ${ev.message}**`;
          else if (ev.type === 'done') {
            const u = ev.usage;
            const cost = (u.input * PRICE.input + u.output * PRICE.output + u.cacheRead * PRICE.cacheRead + u.cacheWrite * PRICE.cacheWrite) / 1e6;
            $('#cost').textContent = `${ev.model} · ${fmt.int(u.input + u.cacheRead + u.cacheWrite)} in / ${fmt.int(u.output)} out · ≈ $${cost.toFixed(3)}`;
          }
          if (Date.now() - lastPaint > 60) { renderChat(); lastPaint = Date.now(); }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') bot.content += `\n\n**⚠ ${e.message}**`;
      else bot.content += '\n\n*Stopped.*';
    } finally {
      bot.pending = false;
      st.busy = null;
      $('#send').disabled = false; $('#stop').hidden = true;
      if (!bot.content.trim()) bot.content = '*No response.*';
      renderChat();
      handoff.set(`chat-${symbol}`, st.chat.slice(-20).map(({ role, content, tools }) => ({ role, content, tools })));
    }
  }

  // ---------- events ----------
  $('#symf').addEventListener('submit', e => { e.preventDefault(); const s = $('#symi').value.trim().toUpperCase(); if (s) location.hash = `#/chart/${encodeURIComponent(s)}`; });
  $('#symi').addEventListener('focus', e => e.target.select());
  const reloadBars = async () => { $('#chart').innerHTML = loading('Loading chart…'); try { await loadBars(); } catch (e) { $('#chart').innerHTML = errorBox(e); } };
  $('#ivals').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.dataset.v === st.interval) return;
    st.interval = b.dataset.v; prefs.set('studio-interval', st.interval);
    root.querySelectorAll('#ivals button').forEach(x => x.classList.toggle('on', x === b));
    reloadBars();
  });
  $('#paneBtns').addEventListener('click', e => {
    const b = e.target.closest('button[data-pane]'); if (!b) return;
    const k = b.dataset.pane;
    st.ind.has(k) ? st.ind.delete(k) : st.ind.add(k);
    st.hidden.delete(k); prefs.set('studio-ind', [...st.ind]);
    syncIndButtons(); buildChart();
  });
  $('#ranges').addEventListener('click', e => {
    const b = e.target.closest('button[data-r]'); if (!b) return;
    st.range = b.dataset.r; prefs.set('studio-range2', st.range);
    root.querySelectorAll('#ranges button').forEach(x => x.classList.toggle('on', x === b));
    const want = RANGES.find(([r]) => r === st.range)[1];
    // Switch to the range's natural interval when the loaded one can't cover it well.
    const coarser = ['1m', '5m', '15m', '1h', 'D', 'W', 'M'];
    if (coarser.indexOf(st.interval) < coarser.indexOf(want) || (INTERVALS[want].minutes && !intraday()) || (st.range === '1D' && st.interval !== '1m' && st.interval !== '5m')) {
      st.interval = want; prefs.set('studio-interval', want);
      root.querySelectorAll('#ivals button').forEach(x => x.classList.toggle('on', x.dataset.v === want));
      reloadBars();
    } else setRange();
  });
  $('#ctype').addEventListener('change', e => { st.type = e.target.value; prefs.set('studio-type', st.type); buildChart(); });
  $('#scale').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const v = Number(b.dataset.v);
    st.scale = st.scale === v ? 0 : v; prefs.set('studio-scale', st.scale);
    root.querySelectorAll('#scale button').forEach(x => x.classList.toggle('on', Number(x.dataset.v) === st.scale));
    chart?.priceScale('right').applyOptions({ mode: st.scale });
    draw?.redraw();
  });
  $('#wmBtn').addEventListener('click', e => {
    st.showWm = !st.showWm; prefs.set('studio-wm', st.showWm);
    e.currentTarget.classList.toggle('on', st.showWm); watermark?.applyOptions({ visible: st.showWm });
  });
  // Reset chart view (TradingView: Alt+R): selected range, scrolled to the latest bar, prices auto-scaled.
  function resetView() {
    if (!chart) return;
    chart.priceScale('right').applyOptions({ autoScale: true });
    sizePanes();
    setRange();
    requestAnimationFrame(() => { draw?.redraw(); renderPaneLegends(); });
  }
  $('#resetView').addEventListener('click', resetView);
  const onKey = e => {
    if (e.altKey && (e.key === 'r' || e.key === 'R') && !e.target.closest?.('input, textarea, select')) { e.preventDefault(); resetView(); }
  };
  window.addEventListener('keydown', onKey);
  // Double-clicking the price axis also resets it to auto-scale (as in TradingView).
  $('#chart').addEventListener('dblclick', e => {
    const r = $('#chart').getBoundingClientRect();
    if (chart && e.clientX - r.left > chart.timeScale().width()) { chart.priceScale('right').applyOptions({ autoScale: true }); requestAnimationFrame(() => draw?.redraw()); }
  });
  $('#indBtn').addEventListener('click', () => { $('#indpanel').hidden = !$('#indpanel').hidden; $('#indBtn').classList.toggle('on', !$('#indpanel').hidden); });
  $('#ind').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    st.ind.has(b.dataset.k) ? st.ind.delete(b.dataset.k) : st.ind.add(b.dataset.k);
    prefs.set('studio-ind', [...st.ind]);
    syncIndButtons(); buildChart();
  });
  $('#auto').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    st.auto.has(b.dataset.k) ? st.auto.delete(b.dataset.k) : st.auto.add(b.dataset.k);
    b.classList.toggle('on'); prefs.set('studio-auto', [...st.auto]); drawAuto();
  });
  const onLegendClick = e => {
    const row = e.target.closest('.tv-lg-ind'); if (!row) return;
    const k = row.dataset.k;
    if (e.target.closest('[data-eye]')) { st.hidden.has(k) ? st.hidden.delete(k) : st.hidden.add(k); setVisible(k, !st.hidden.has(k)); updateLegend(); }
    if (e.target.closest('[data-rm]')) {
      st.ind.delete(k); st.hidden.delete(k); prefs.set('studio-ind', [...st.ind]);
      syncIndButtons(); buildChart();
    }
  };
  $('#legend').addEventListener('click', onLegendClick);
  $('#plegends').addEventListener('click', onLegendClick);
  $('#tools').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'delAll') { if (draw?.list.length && confirm(`Remove all ${draw.list.length} drawings on ${symbol}?`)) draw.clear(); return; }
    setTool(b.dataset.t);
  });
  $('#seltools').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.c) draw?.setColor(b.dataset.c);
    if (b.hasAttribute('data-del')) draw?.removeSelected();
  });
  $('#clearai').addEventListener('click', () => { st.ai = null; clearLayer('ai'); $('#clearai').hidden = true; });
  root.querySelector('.tv-tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.side = b.dataset.s; prefs.set('studio-side', st.side);
    root.querySelectorAll('.tv-tabs button').forEach(x => x.classList.toggle('on', x === b));
    $('#watchPane').hidden = st.side !== 'watch'; $('#aiPane').hidden = st.side !== 'ai';
  });
  $('#wlist').addEventListener('click', e => {
    const row = e.target.closest('.tv-wl'); if (!row) return;
    if (e.target.closest('[data-wrm]')) { st.watch = st.watch.filter(s => s !== row.dataset.s); saveWatch(); return; }
    location.hash = `#/chart/${encodeURIComponent(row.dataset.s)}`;
  });
  $('#wadd').addEventListener('submit', e => {
    e.preventDefault();
    const s = $('#wsym').value.trim().toUpperCase();
    if (!/^[A-Z$][A-Z0-9.$/]{0,9}$/.test(s)) return toast('Enter a ticker symbol', true);
    if (!st.watch.includes(s)) { st.watch.push(s); saveWatch(); }
    $('#wsym').value = '';
  });
  $('#quick').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) ask(QUICK[Number(b.dataset.i)]); });
  $('#ask').addEventListener('submit', e => { e.preventDefault(); const q = $('#q').value; $('#q').value = ''; ask(q); });
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ask').requestSubmit(); } });
  $('#stop').addEventListener('click', () => st.busy?.abort());
  $('#cpclear').addEventListener('click', () => { if (st.busy) return; st.chat = []; handoff.set(`chat-${symbol}`, []); renderChat(); });
  $('#btrun').addEventListener('click', async e => {
    const key = $('#bts').value, btn = e.target;
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    try {
      const q = new URLSearchParams({ strategy: key });
      if ($('#bstop').value) q.set('stopAtr', $('#bstop').value);
      if ($('#btgt').value) q.set('targetR', $('#btgt').value);
      showBacktest(await api.get(`backtest/${encodeURIComponent(symbol)}?${q}`));
    } catch (err) { toast(err.message, true); }
    btn.disabled = false; btn.textContent = 'Run';
  });

  // ---------- init ----------
  renderChat();
  api.get('copilot/status').then(s => {
    $('#cpst').textContent = s.configured ? s.model : 'not configured';
    if (!s.configured) $('#msgs').innerHTML = '<div class="banner">The Copilot needs an Anthropic API key. Add <code>ANTHROPIC_API_KEY=...</code> to <code>.env</code> (from console.anthropic.com) and restart the app. All chart studies, patterns and backtests work without it.</div>';
  }).catch(() => {});
  api.get('strategies').then(list => {
    const sel = $('#bts');
    sel.innerHTML = Object.entries(list).map(([k, s]) => `<option value="${esc(k)}" title="${esc(s.desc)}">${esc(s.label)}</option>`).join('');
    const setDefaults = () => { const d = list[sel.value]?.defaults || {}; $('#bstop').value = d.stopAtr ?? ''; $('#btgt').value = d.targetR ?? ''; };
    sel.addEventListener('change', setDefaults); setDefaults();
  }).catch(() => {});
  loadWatch();
  const wt = setInterval(() => { if (!document.hidden && st.side === 'watch') loadWatch(); }, 15000);
  // Live last bar: refresh the loaded interval every 30s (intraday) or 60s (daily+) while visible.
  const lt = setInterval(async () => {
    if (document.hidden || !main || draw?.tool !== 'cursor' || draw?.drag) return;
    try {
      const bars = await api.get(`bars/${encodeURIComponent(symbol)}?interval=${st.interval}`);
      const last = bars[bars.length - 1];
      if (!last || !st.bars.length) return;
      const k = keyOf(last.t);
      if (last.t < st.bars[st.bars.length - 1].t) return;
      if (last.t === st.bars[st.bars.length - 1].t) st.bars[st.bars.length - 1] = last; else { st.bars.push(last); st.keys.push(k); }
      const shown = st.type === 'ha' ? heikinAshi(st.bars).at(-1) : last;
      main.update(st.type === 'line' || st.type === 'area' ? { time: k, value: last.c } : { time: k, open: shown.o, high: shown.h, low: shown.l, close: shown.c });
      updateLegend();
    } catch { /* keep the last good chart */ }
  }, 30000);
  $('#clist').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-ci]'); if (!tr) return;
    root.querySelectorAll('#clist tr').forEach(x => x.classList.toggle('sel', x === tr));
    showCandle(st.candles[Number(tr.dataset.ci)]);
  });
  $('#cdetail').addEventListener('click', e => { if (e.target.closest('[data-cclose]')) { $('#cdetail').innerHTML = ''; clearLayer('cdlplan'); root.querySelectorAll('#clist tr.sel').forEach(x => x.classList.remove('sel')); } });
  $('#mtf').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-iv]'); if (!tr) return;
    root.querySelector(`#ivals button[data-v="${tr.dataset.iv}"]`)?.click();
    $('#wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  try { await load(); } catch (e) { $('#chart').innerHTML = errorBox(e); $('#plist').innerHTML = ''; $('#cread').innerHTML = ''; }
  loadMtf().catch(e => { const m = $('#mtf'); if (m) m.innerHTML = errorBox(e); });
  // (Theme changes re-render the whole view via the router, which rebuilds the chart in the new colors.)
  return () => {
    st.busy?.abort(); clearInterval(wt); clearInterval(lt); wmRO.disconnect(); window.removeEventListener('keydown', onKey);
    if (saveT) { clearTimeout(saveT); putDrawings(); } // don't lose a just-made drawing when leaving
    draw?.destroy(); chart?.remove();
  };
}
