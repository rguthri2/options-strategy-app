// Swing Hot List: ranks the universe on trend, relative strength, setup quality, volume and
// volatility regime. Rule sets are drawn from widely published swing methods:
//   - Mark Minervini's Trend Template (stage-2 uptrend filter) and VCP-style tightening
//   - William O'Neil / IBD relative strength (weighted 3/6/9/12-month performance rank)
//   - John Carter's TTM Squeeze (Bollinger inside Keltner = volatility compression)
//   - Linda Raschke-style pullbacks to the rising 21 EMA ("Holy Grail"/"Anti" family)
//   - tastytrade IV-regime logic (IV Rank decides buy premium vs sell premium)
import { sma, ema, rsi, atr, adx, bollinger, keltner, histVol, percentRank, last } from '../shared/indicators.js';
import { atmIV } from '../shared/analytics.js';
import { marketSession } from '../shared/time.js';
import { market, recordIv, ivHistory } from './providers/index.js';
import { getSettings } from './settings.js';
import { readJson, writeJson } from './store.js';
import { nameOf } from './universe.js';
import { nextEarnings } from './earnings.js';
import { detectSetups, marketRegime } from '../shared/setups.js';
import { scanSymbols } from './universeAuto.js';
import { runLow } from './priority.js';
import { storedFundamentals, canslimGrade } from './fundamentals.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const roc = (c, n) => (c.length > n ? c.at(-1) / c.at(-1 - n) - 1 : NaN);

export function technicals(bars) {
  const c = bars.map(b => b.c), v = bars.map(b => b.v);
  const n = c.length, i = n - 1;
  const s20 = sma(c, 20), s50 = sma(c, 50), s150 = sma(c, 150), s200 = sma(c, 200), e21 = ema(c, 21), e9 = ema(c, 9);
  const r = rsi(c, 14), a = atr(bars, 14), a10 = atr(bars, 10), ad = adx(bars, 14);
  const bb = bollinger(c, 20, 2), kc = keltner(bars, 20, 1.5);
  const hv20 = histVol(c, 20), hv60 = histVol(c, 60);
  const yr = bars.slice(-252);
  const prior20 = bars.slice(-21, -1);
  const avgVol50 = v.slice(-51, -1).reduce((x, y) => x + y, 0) / Math.min(50, Math.max(1, n - 1));
  const squeezeOn = bb.upper[i] < kc.upper[i] && bb.lower[i] > kc.lower[i];
  const squeezeDays = (() => { let k = 0; for (let j = i; j > 0 && bb.upper[j] < kc.upper[j] && bb.lower[j] > kc.lower[j]; j--) k++; return k; })();
  return {
    close: c[i], prevClose: c[i - 1], sma20: s20[i], sma50: s50[i], sma150: s150[i], sma200: s200[i],
    sma200Prev: s200[i - 21], sma50Prev: s50[i - 10], ema21: e21[i], ema9: e9[i],
    rsi: r[i], rsiPrev: r[i - 1], atr: a[i], atrPct: a[i] / c[i], atrContraction: a10[i] / (atr(bars, 50)[i] || a10[i]),
    adx: ad.adx[i], pdi: ad.pdi[i], mdi: ad.mdi[i],
    bbWidth: bb.width[i], bbWidthRank: percentRank(bb.width.slice(-126), bb.width[i]),
    squeezeOn, squeezeDays, squeezeFired: !squeezeOn && bb.upper[i - 1] < kc.upper[i - 1],
    hv20: hv20[i], hv60: hv60[i], hvSeries: hv20.slice(-252),
    high52: Math.max(...yr.map(b => b.h)), low52: Math.min(...yr.map(b => b.l)),
    high20: Math.max(...prior20.map(b => b.h)), low20: Math.min(...prior20.map(b => b.l)),
    low10: Math.min(...bars.slice(-10).map(b => b.l)), high10: Math.max(...bars.slice(-10).map(b => b.h)),
    touchedEma21: bars.slice(-3).some((b, k) => b.l <= e21[i - 2 + k] * 1.005 && b.h >= e21[i - 2 + k] * 0.995),
    volume: v[i], avgVol50, volRatio: v[i] / (avgVol50 || 1),
    roc5: roc(c, 5), roc20: roc(c, 20), roc63: roc(c, 63), roc126: roc(c, 126), roc189: roc(c, 189), roc252: roc(c, 252),
  };
}

// IBD-style weighted performance (most recent quarter double-weighted).
const rsRaw = t => 0.4 * (t.roc63 || 0) + 0.2 * (t.roc126 || 0) + 0.2 * (t.roc189 || 0) + 0.2 * (t.roc252 || 0);

function trendTemplate(t, rsRating) {
  const checks = [
    ['Price > 150 & 200 SMA', t.close > t.sma150 && t.close > t.sma200],
    ['150 SMA > 200 SMA', t.sma150 > t.sma200],
    ['200 SMA rising (1 mo)', t.sma200 > t.sma200Prev],
    ['50 SMA > 150 & 200', t.sma50 > t.sma150 && t.sma50 > t.sma200],
    ['Price > 50 SMA', t.close > t.sma50],
    ['≥30% above 52w low', t.close >= t.low52 * 1.3],
    ['Within 25% of 52w high', t.close >= t.high52 * 0.75],
    ['RS rating ≥ 70', rsRating >= 70],
  ];
  return { passed: checks.filter(c => c[1]).length, checks };
}

function downTemplate(t, rsRating) {
  return [
    t.close < t.sma150 && t.close < t.sma200, t.sma150 < t.sma200, t.sma200 < t.sma200Prev,
    t.sma50 < t.sma150 && t.sma50 < t.sma200, t.close < t.sma50, t.close <= t.high52 * 0.75,
    t.close <= t.low52 * 1.25, rsRating <= 30,
  ].filter(Boolean).length;
}

function bullSetups(t) {
  const s = [];
  if (t.close >= t.high20 * 0.995 && t.volRatio >= 1.2 && t.close > t.sma50) s.push(['Breakout', 25]);
  if (t.close >= t.high20 * 0.97 && t.close < t.high20 && t.atrContraction < 0.85 && t.close > t.sma50) s.push(['Pivot / VCP', 21]);
  if (t.close > t.sma50 && t.sma50 > t.sma200 && t.touchedEma21 && Math.abs(t.close - t.ema21) <= 0.8 * t.atr && t.rsi >= 38 && t.rsi <= 60) s.push(['Pullback to 21 EMA', 22]);
  if (t.squeezeOn && t.squeezeDays >= 4 && t.close > t.sma50) s.push(['Squeeze (coiled)', 18]);
  if (t.squeezeFired && t.close > t.ema21 && t.roc5 > 0) s.push(['Squeeze fired ↑', 23]);
  if (t.rsi >= 55 && t.rsi <= 75 && t.roc20 > 0.05 && t.close > t.ema21 && t.ema21 > t.sma50) s.push(['Momentum', 17]);
  return s.sort((a, b) => b[1] - a[1]);
}

function bearSetups(t) {
  const s = [];
  if (t.close <= t.low20 * 1.005 && t.volRatio >= 1.2 && t.close < t.sma50) s.push(['Breakdown', 25]);
  if (t.close < t.sma50 && t.sma50 < t.sma200 && t.touchedEma21 && Math.abs(t.close - t.ema21) <= 0.8 * t.atr && t.rsi >= 42 && t.rsi <= 62) s.push(['Failed rally at 21 EMA', 22]);
  if (t.squeezeFired && t.close < t.ema21 && t.roc5 < 0) s.push(['Squeeze fired ↓', 23]);
  if (t.squeezeOn && t.squeezeDays >= 4 && t.close < t.sma50) s.push(['Squeeze (coiled, weak)', 16]);
  if (t.rsi >= 25 && t.rsi <= 45 && t.roc20 < -0.05 && t.close < t.ema21 && t.ema21 < t.sma50) s.push(['Downtrend momentum', 17]);
  return s.sort((a, b) => b[1] - a[1]);
}

// RSI sweet spot scoring: rewards strength without chasing an overbought print.
const momentumPts = (rsiV, bull) => {
  const x = bull ? rsiV : 100 - rsiV;
  if (x >= 55 && x <= 70) return 10;
  if (x > 70) return clamp(10 - (x - 70) * 0.6, 0, 10);
  return clamp((x - 35) / 2, 0, 10);
};

export function ivRegime(iv, t, symbol) {
  const hist = Object.values(ivHistory(symbol));
  let ivr, ivp, source;
  if (hist.length >= 30 && iv > 0) {
    const w = hist.slice(-252);
    const lo = Math.min(...w, iv), hi = Math.max(...w, iv);
    ivr = hi > lo ? (100 * (iv - lo)) / (hi - lo) : 50;
    ivp = percentRank(w, iv);
    source = 'history';
  } else if (iv > 0) {
    // Proxy until enough IV snapshots exist: rank IV against the past year of 20-day realized vol.
    // IV normally carries a ~15% premium over realized vol, so strip it before ranking (else everything looks rich).
    const w = t.hvSeries.filter(Number.isFinite);
    const lo = Math.min(...w), hi = Math.max(...w), adj = iv / 1.15;
    ivr = clamp(hi > lo ? (100 * (adj - lo)) / (hi - lo) : 50, 0, 100);
    ivp = percentRank(w, adj);
    source = 'hv-proxy';
  }
  // Compare with the larger of 20/60-day HV: a tight base (VCP, flag) crushes HV20 and would make any IV look rich.
  const hvRef = Math.max(Number.isFinite(t.hv20) ? t.hv20 : 0, Number.isFinite(t.hv60) ? t.hv60 : 0) || NaN;
  const ivHv = iv / hvRef;
  const regime = ivr >= 50 || ivHv >= 1.4 ? 'rich' : ivr <= 25 && ivHv < 1.05 ? 'cheap' : 'fair';
  return { iv, ivr, ivp, ivHv, source, regime };
}

function suggest(bias, regime) {
  if (bias === 'bull') return regime === 'cheap' ? 'Long Call (70Δ) / Bull Call Spread' : regime === 'rich' ? 'Bull Put Credit Spread / CSP' : 'Bull Call Debit Spread';
  if (bias === 'bear') return regime === 'cheap' ? 'Long Put (70Δ) / Bear Put Spread' : regime === 'rich' ? 'Bear Call Credit Spread' : 'Bear Put Debit Spread';
  return regime === 'rich' ? 'Iron Condor (16Δ)' : 'No edge — wait';
}

function riskPlan(t, bias) {
  if (bias === 'bear') {
    const stop = Math.max(t.close + t.atr, Math.min(t.high10, t.close + 2 * t.atr));
    const risk = stop - t.close;
    return { entry: t.close, stop, target1: t.close - 2 * risk, target2: t.close - 3 * risk, trigger: t.close > t.low20 ? t.low20 : null };
  }
  const stop = Math.min(t.close - t.atr, Math.max(t.low10, t.close - 2 * t.atr));
  const risk = t.close - stop;
  return { entry: t.close, stop, target1: t.close + 2 * risk, target2: t.close + 3 * risk, trigger: t.close < t.high20 ? t.high20 : null };
}

// ATM IV of the ~30-day monthly expiration. Fetches a single expiration to keep API usage low
// (E*TRADE returns one expiration per request).
async function atmIvFor(symbol, spot) {
  const exps = (await market.expirations(symbol)).filter(e => e.dte >= 20 && e.dte <= 55);
  const pick = exps.find(e => e.type === 'M') || exps[0];
  if (!pick) return NaN;
  const ch = await market.chain(symbol, { fromDate: pick.date, toDate: pick.date, strikeCount: 6, spot });
  const e = ch.expirations[0];
  if (!e) return NaN;
  const iv = atmIV(e.rows, ch.spot);
  // Only real market IV builds the IV Rank history; simulated/sandbox values would corrupt it.
  const st = market.status();
  if (st.provider !== 'demo' && !st.sample) recordIv(symbol, iv);
  return iv;
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(e => ({ error: e.message })); }
  }));
  return out;
}

let state = readJson('hotlist.json', { updated: 0, rows: [], errors: [] });
let running = null;

export const hotlistState = () => state;

const ivCache = new Map(); // symbol -> { iv, t }: ATM IV is refreshed at most every 90 minutes per symbol
async function cachedIv(symbol, spot) {
  const hit = ivCache.get(symbol);
  if (hit && Date.now() - hit.t < 90 * 60000) return hit.iv;
  const iv = await atmIvFor(symbol, spot).catch(() => NaN);
  ivCache.set(symbol, { iv, t: Date.now() });
  return iv;
}
const tick = () => new Promise(r => setImmediate(r)); // keep the server responsive during long scans

export function refreshHotlist() {
  running ??= runLow(async () => {
    const settings = getSettings();
    const symbols = scanSymbols();
    const t0 = Date.now();
    const barsMap = await market.dailyBulk(symbols);
    const spyBars = barsMap.SPY || (await market.daily('SPY').catch(() => null));
    const raw = [];
    let missing = 0, k = 0;
    for (const sym of symbols) {
      if (++k % 40 === 0) await tick();
      const bars = barsMap[sym];
      if (!bars || bars.length < 210) { missing++; continue; }
      try { raw.push({ symbol: sym, bars, t: technicals(bars) }); } catch { /* bad data */ }
    }
    const manual = new Set([...settings.universe, ...settings.watchlist]);
    // Same liquidity bar as the universe build (re-checked on fresh bars); manual symbols always kept.
    const liquid = raw.filter(r => manual.has(r.symbol) || (r.t.close >= settings.scan.minPrice && r.t.avgVol50 >= settings.scan.minAvgVolume));
    const sortedRs = liquid.map(r => rsRaw(r.t)).sort((a, b) => a - b);
    const rankOf = x => { let lo = 0, hi = sortedRs.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedRs[mid] < x) lo = mid + 1; else hi = mid; } return lo; };
    const breadth = {
      above50: liquid.filter(r => r.t.close > r.t.sma50).length / Math.max(1, liquid.length),
      above200: liquid.filter(r => r.t.close > r.t.sma200).length / Math.max(1, liquid.length),
      stage2: NaN,
    };
    const regime = spyBars?.length > 260 ? marketRegime(spyBars, breadth) : null;

    // Pass 1: scores, trader setups (no IV yet).
    const pre = [];
    k = 0;
    for (const r of liquid) {
      if (++k % 25 === 0) await tick();
      const t = r.t;
      const rsRating = Math.round(clamp((99 * rankOf(rsRaw(t))) / Math.max(1, sortedRs.length - 1), 1, 99));
      const tt = trendTemplate(t, rsRating);
      const dn = downTemplate(t, rsRating);
      const bs = bullSetups(t), ds = bearSetups(t);
      const volPts = clamp((t.volRatio - 0.6) / 1.4, 0, 1) * 10;
      const bull = (tt.passed / 8) * 30 + (rsRating / 99) * 25 + (bs[0]?.[1] || 0) + volPts * (t.close > t.prevClose ? 1 : 0.4) + momentumPts(t.rsi, true);
      const bear = (dn / 8) * 30 + ((99 - rsRating) / 99) * 25 + (ds[0]?.[1] || 0) + volPts * (t.close < t.prevClose ? 1 : 0.4) + momentumPts(t.rsi, false);
      let det = { setups: [], stage: null, stageLabel: 'n/a', mansfield: NaN, adr: NaN };
      const canslim = canslimGrade(storedFundamentals(r.symbol)?.f);
      try { det = detectSetups(r.bars, { spyBars, trendPassed: tt.passed, rsRating, regime, minAdr: settings.scan.minAdr ?? 4, canslim }); } catch { /* keep going */ }
      pre.push({ r, t, rsRating, tt, dn, bs, ds, bull, bear, det, canslim });
    }
    if (regime) regime.stage2Pct = pre.filter(p => p.det.stage === 2).length / Math.max(1, pre.length);

    // IV only where it matters: the strongest candidates, anything with a live setup, and the watchlist.
    const byStrength = [...pre].sort((a, b) => Math.max(b.bull, b.bear) - Math.max(a.bull, a.bear));
    const ivSet = new Set([
      ...byStrength.slice(0, settings.scan.ivTopN).map(p => p.r.symbol),
      ...pre.filter(p => p.det.setups.length).sort((a, b) => b.det.setups[0].score - a.det.setups[0].score).slice(0, settings.scan.ivTopN).map(p => p.r.symbol),
      ...settings.watchlist,
    ]);
    const ivList = pre.filter(p => ivSet.has(p.r.symbol));
    const ivs = new Map((await mapLimit(ivList, 4, p => cachedIv(p.r.symbol, p.t.close))).map((iv, j) => [ivList[j].r.symbol, iv]));
    const quotes = await market.quotes(liquid.map(r => r.symbol)).catch(() => ({}));

    const rows = pre.map(({ r, t, rsRating, tt, dn, bs, ds, bull, bear, det, canslim }) => {
      const iv = ivRegime(ivs.get(r.symbol) ?? NaN, t, r.symbol);
      const range = clamp((25 - (t.adx || 25)) / 15, 0, 1) * 40 + clamp((iv.ivr || 0) / 100, 0, 1) * 35
        + (Math.abs(t.close - t.sma20) < t.atr ? 15 : 0) + (t.bbWidthRank > 30 ? 10 : 0);
      let bias = 'neutral', score = Math.round(range);
      if (bull >= bear + 8 && bull >= 45) { bias = 'bull'; score = Math.round(bull); }
      else if (bear >= bull + 8 && bear >= 45) { bias = 'bear'; score = Math.round(bear); }
      const setups = bias === 'bull' ? bs : bias === 'bear' ? ds : [['Range / high IV', 0]];
      const q = quotes[r.symbol] || {};
      const primary = det.setups[0] || null;
      // A trader setup's levels (pivot/stop/targets) take precedence over the generic ATR plan.
      const basePlan = riskPlan(t, bias === 'neutral' ? (t.close > t.sma50 ? 'bull' : 'bear') : bias);
      const planFromSetup = primary && primary.bias === 'bull'
        ? { entry: primary.entry, stop: primary.stop, target1: primary.target1, target2: primary.target2, trigger: primary.status === 'setting up' ? primary.pivot : null,
          pivot: primary.pivot, source: `${primary.trader} ${primary.name}`, setupKey: primary.key }
        : null;
      return {
        symbol: r.symbol, name: q.name || nameOf(r.symbol),
        price: q.last ?? t.close, changePct: q.changePct ?? (t.close / t.prevClose - 1),
        score: clamp(score, 0, 100), bullScore: Math.round(bull), bearScore: Math.round(bear), rangeScore: Math.round(range),
        bias, setup: setups[0]?.[0] || '—', setups: setups.map(s => s[0]),
        trendTemplate: tt.passed, trendChecks: tt.checks.map(([label, pass]) => ({ label, pass })),
        rsRating, rsi: t.rsi, adx: t.adx, atr: t.atr, atrPct: t.atrPct, volRatio: t.volRatio, avgVolume: t.avgVol50,
        roc20: t.roc20, roc63: t.roc63, hv20: t.hv20, hv60: t.hv60, squeezeOn: t.squeezeOn, squeezeDays: t.squeezeDays,
        sma20: t.sma20, sma50: t.sma50, sma200: t.sma200, ema21: t.ema21, high52: t.high52, low52: t.low52, high20: t.high20, low20: t.low20,
        iv: iv.iv, ivr: iv.ivr, ivp: iv.ivp, ivHv: iv.ivHv, ivSource: iv.source, ivRegime: iv.regime,
        strategy: suggest(primary?.bias || bias, iv.regime), plan: planFromSetup || basePlan,
        earnings: nextEarnings(r.symbol), earningsDays: nextEarnings(r.symbol)?.days ?? null,
        stage: det.stage, stageLabel: det.stageLabel, mansfield: det.mansfield, adr: det.adr,
        traderSetups: det.setups, topSetupScore: primary?.score ?? 0,
        canslim: canslim.C !== 'n/a' || canslim.A !== 'n/a' ? { C: canslim.C, A: canslim.A, notes: canslim.notes } : null,
      };
    }).sort((a, b) => b.score - a.score);

    state = {
      updated: Date.now(), tookMs: Date.now() - t0, provider: market.status().provider, rows, errors: [], regime,
      universe: { requested: symbols.length, scanned: raw.length, missingHistory: missing, ivFetched: ivList.length },
    };
    writeJson('hotlist.json', state);
    console.log(`[scan] ${rows.length} symbols in ${((Date.now() - t0) / 1000).toFixed(1)}s (${missing} awaiting history, ${ivList.length} with IV)`);
    return state;
  }).finally(() => { running = null; });
  return running;
}
export const hotlistRunning = () => Boolean(running);

// Single-symbol technical snapshot for the ticker page.
export async function symbolTechnicals(symbol) {
  const bars = await market.daily(symbol);
  if (bars.length < 60) return null;
  const t = technicals(bars);
  const row = state.rows.find(r => r.symbol === symbol);
  const iv = row?.iv ?? (await atmIvFor(symbol).catch(() => NaN));
  const regime = ivRegime(iv, t, symbol);
  const { hvSeries, ...rest } = t;
  return { ...rest, ...regime, hotlist: row || null, session: marketSession(), earnings: nextEarnings(symbol) };
}
