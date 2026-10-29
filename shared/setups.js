// Trader setup scanners on daily bars. Each detector implements the published rules of one trader
// and returns concrete levels: pivot/trigger, entry, stop (per that trader's rule), targets.
//
//  Qullamaggie (Kristjan Kullamägi): momentum breakouts and episodic pivots.
//    Breakout: ADR% >= 4, a 30-100%+ move within ~1-3 months, then a 2-8 week tightening
//    consolidation "surfing" rising 10/20-day MAs; buy the break of the range high; stop <= 1x ADR;
//    sell 1/3-1/2 after 3-5 days, trail the rest on the 10 or 20-day MA.
//    Episodic pivot: gap up >= 10% on >= 2x volume on a catalyst, ideally after months of neglect.
//  Mark Minervini: Trend Template + VCP (2-4 contractions, drying volume), pivot on expanding
//    volume, stop 6-8% (max 10%), target >= 3:1.
//  William O'Neil (CANSLIM technicals): RS rating >= 80, sound base >= 5 weeks & <= ~35% deep,
//    breakout on volume >= 40-50% above average, buy within 5% of the pivot, 7-8% max loss,
//    only in a confirmed market uptrend ("M").
//  Stan Weinstein: Stage Analysis on the 30-week MA (~150 days) + Mansfield relative strength;
//    buy Stage 2 breakouts above resistance on >= 2x volume with RS > 0; avoid Stage 4.
import { sma, ema, atr } from './indicators.js';
import { swings } from './studies.js';

const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const last = a => a[a.length - 1];
const avg = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);

// Shared per-symbol metrics used by several detectors.
export function setupMetrics(bars, spyBars) {
  const n = bars.length, i = n - 1;
  const c = bars.map(b => b.c), v = bars.map(b => b.v || 0);
  const s10 = sma(c, 10), s20 = sma(c, 20), s50 = sma(c, 50), s150 = sma(c, 150), s200 = sma(c, 200), e21 = ema(c, 21);
  const adr = avg(bars.slice(-20).map(b => (b.h / b.l - 1) * 100)); // Qullamaggie ADR%
  const av50 = avg(v.slice(-51, -1));
  // Mansfield RS vs SPY: (ratio / 52-week SMA of ratio - 1) x 100.
  let mansfield = NaN, mansfieldPrev = NaN;
  if (spyBars?.length) {
    // Align SPY to the stock's dates, carrying the latest SPY close forward over any gaps.
    const ratio = [];
    let j = 0, spyC = NaN;
    for (const b of bars) {
      while (j < spyBars.length && spyBars[j].t <= b.t) spyC = spyBars[j++].c;
      ratio.push(spyC > 0 ? b.c / spyC : NaN);
    }
    const rs = ratio.map((r, k) => {
      if (k < 251) return NaN;
      const w = ratio.slice(k - 251, k + 1).filter(Number.isFinite);
      return w.length > 200 ? (r / avg(w) - 1) * 100 : NaN;
    });
    mansfield = rs[i]; mansfieldPrev = rs[i - 10];
  }
  const slope150 = s150[i - 20] > 0 ? s150[i] / s150[i - 20] - 1 : NaN;
  const slope150Long = s150[i - 100] > 0 ? s150[i] / s150[i - 100] - 1 : NaN;
  return { n, i, c, v, s10, s20, s50, s150, s200, e21, adr, av50, a: last(atr(bars, 14)), mansfield, mansfieldPrev, slope150, slope150Long, volRatio: v[i] / (av50 || 1) };
}

// Weinstein stage from the 30-week (150-day) MA slope and price location.
export function weinsteinStage(m) {
  const { c, i, s150, slope150, slope150Long } = m;
  if (!Number.isFinite(s150[i])) return { stage: null, label: 'n/a' };
  const above = c[i] > s150[i];
  const rising = slope150 > 0.01, falling = slope150 < -0.01;
  let stage;
  if (above && rising) stage = 2;
  else if (!above && falling) stage = 4;
  else if (!rising && !falling) stage = slope150Long > 0.05 ? 3 : 1;
  else stage = above ? 1 : 3; // transitional: above a falling MA = basing attempt; below a rising MA = topping risk
  const label = { 1: 'Stage 1 · basing', 2: 'Stage 2 · advancing', 3: 'Stage 3 · topping', 4: 'Stage 4 · declining' }[stage];
  return { stage, label, above, rising, falling };
}

function plan(entry, stop, extra = {}) {
  const risk = entry - stop;
  return { entry: +entry.toFixed(2), stop: +stop.toFixed(2), stopPct: +((risk / entry) * 100).toFixed(1), target1: +(entry + 2 * risk).toFixed(2), target2: +(entry + 3 * risk).toFixed(2), ...extra };
}

// Where price sits relative to a pivot on the latest bar.
function pivotStatus(m, bars, pivot, { volNeed = 1.4, zonePct = 5 } = {}) {
  const { i, c, volRatio } = m;
  const prevC = c[i - 1];
  if (c[i] > pivot && prevC <= pivot && volRatio >= volNeed) return 'breakout today';
  if (c[i] > pivot && c[i] <= pivot * (1 + zonePct / 100)) return 'in buy zone';
  if (c[i] > pivot * (1 + zonePct / 100)) return 'extended';
  if (c[i] >= pivot * 0.95) return 'setting up';
  return null;
}

// ---------- Qullamaggie ----------
export function qullaBreakout(bars, m, opts = {}) {
  const minAdr = opts.minAdr ?? 4;
  const { i, c, s10, s20, s50, adr } = m;
  if (!(adr >= minAdr) || !(c[i] > s50[i])) return null;
  // Consolidation: the last 10-40 bars; find the length whose range is tightest relative to ADR.
  let best = null;
  for (const len of [10, 15, 20, 25, 30, 40]) {
    const seg = bars.slice(-len - 1, -1); // exclude today (today may be the breakout)
    const hi = Math.max(...seg.map(b => b.h)), lo = Math.min(...seg.map(b => b.l));
    const depth = (hi - lo) / hi;
    // Prior move: largest run-up in the ~3 months before the consolidation.
    const pre = bars.slice(-len - 64, -len);
    if (pre.length < 20) continue;
    const preLow = Math.min(...pre.map(b => b.l)), preHigh = Math.max(...pre.map(b => b.h), hi);
    const move = preHigh / preLow - 1;
    if (move < 0.3 || depth > 0.28 || depth * 100 > adr * 6) continue;
    // Tightening: the second half of the base is narrower than the first.
    const half = Math.floor(seg.length / 2);
    const r1 = Math.max(...seg.slice(0, half).map(b => b.h)) - Math.min(...seg.slice(0, half).map(b => b.l));
    const r2 = Math.max(...seg.slice(half).map(b => b.h)) - Math.min(...seg.slice(half).map(b => b.l));
    const tight = r2 < r1 * 0.85;
    const score = move * 40 + (tight ? 20 : 0) + (1 - depth / 0.35) * 25 + Math.min(len, 30) / 2;
    if (!best || score > best.score) best = { len, hi, lo, depth, move, tight, score };
  }
  if (!best) return null;
  // "Surfing" the MAs: stacked 10 >= 20 > 50 with price holding the 20-day. (The 20-day naturally
  // flattens during a proper multi-week flag, so it is not required to still be rising.)
  const surfing = c[i] >= s20[i] * 0.98 && s10[i] >= s20[i] * 0.995 && s20[i] > s50[i];
  if (!surfing) return null;
  const pivot = best.hi;
  const status = pivotStatus(m, bars, pivot, { volNeed: 1.5, zonePct: Math.min(5, adr) });
  if (!status || status === 'extended') return null;
  const entry = status === 'setting up' ? pivot * 1.001 : c[i];
  // Stop: the lower of the last 3 days' low, but never wider than 1x ADR (Qullamaggie's rule).
  const lod = Math.min(...bars.slice(-3).map(b => b.l));
  const stop = Math.max(lod, entry * (1 - adr / 100));
  return {
    trader: 'Qullamaggie', key: 'qulla_breakout', name: 'Momentum breakout', bias: 'bull', status, pivot: +pivot.toFixed(2),
    ...plan(entry, stop, { trail: '10-day MA (fast) / 20-day MA (slower)', manage: 'Sell 1/3-1/2 after 3-5 days of strength, move stop to breakeven, trail the rest on the 10/20-day MA.' }),
    score: Math.round(clamp(35 + Math.min(best.move, 1) * 20 + (best.tight ? 12 : 0) + (1 - best.depth / 0.28) * 12 + (status === 'breakout today' ? 15 : status === 'in buy zone' ? 8 : 0) + Math.min(adr, 8) * 0.75)),
    notes: [`${(best.move * 100).toFixed(0)}% prior move, ${best.len}-day base ${(best.depth * 100).toFixed(0)}% deep${best.tight ? ', tightening' : ''}`, `ADR ${adr.toFixed(1)}%, surfing the 10/20-day MAs`],
  };
}

export function qullaEpisodicPivot(bars, m) {
  const { i, av50 } = m;
  for (let k = 0; k <= 4; k++) {
    const d = i - k;
    const gap = bars[d].o / bars[d - 1].c - 1;
    const vr = (bars[d].v || 0) / (av50 || 1);
    if (gap < 0.1 || vr < 2) continue;
    // Strength: the gap day must close in the upper half of its range (a gap that fades to the lows
    // is a failed EP), no close back below the gap day's low since, and still above its midpoint.
    const mid = (bars[d].h + bars[d].l) / 2;
    if (bars[d].c < mid) return null;
    const held = bars.slice(d).every(b => b.c >= bars[d].l) && bars[i].c >= mid;
    if (!held) return null;
    // Neglect before the catalyst: not already up > 40% over the prior ~3 months.
    const prior = bars.slice(Math.max(0, d - 63), d);
    const priorMove = prior.length ? bars[d - 1].c / Math.min(...prior.map(b => b.l)) - 1 : 0;
    const epHigh = bars[d].h, epLow = bars[d].l;
    const entry = k === 0 ? bars[i].c : Math.max(bars[i].c, epHigh * 1.001);
    // Extended: if price has run so far that the gap-day low is > 1.5x ADR away, it's no longer a buy.
    if ((entry - epLow) / entry * 100 > Math.max(1.5 * m.adr, 6)) return null;
    return {
      trader: 'Qullamaggie', key: 'qulla_ep', name: 'Episodic pivot', bias: 'bull', status: k === 0 ? 'EP today' : `EP ${k}d ago · holding`,
      pivot: +epHigh.toFixed(2), ...plan(entry, epLow, { manage: 'Stop = low of the gap day. Sell 1/3-1/2 into the first 3-5 days of strength; trail the rest on the 10/20-day MA. Confirm the catalyst (earnings/news).' }),
      score: Math.round(clamp(55 + Math.min(gap * 100, 30) + Math.min(vr, 6) * 3 + (priorMove < 0.2 ? 8 : 0) - k * 4)),
      notes: [`Gap +${(gap * 100).toFixed(1)}% on ${vr.toFixed(1)}× volume`, priorMove < 0.2 ? 'Neglected beforehand (fresh catalyst)' : `Already up ${(priorMove * 100).toFixed(0)}% before the gap`],
    };
  }
  return null;
}

// ---------- Minervini VCP ----------
export function minerviniVcp(bars, m, trendPassed, rsRating = null) {
  const { i, c, v, av50 } = m;
  if (trendPassed < 7) return null; // Trend Template first
  if (rsRating != null && rsRating < 70) return null; // Minervini: RS rank no less than 70 (ideally 80-90+)
  const sw = swings(bars, 4).filter(s => s.i > i - 130);
  const legs = [];
  for (let k = 0; k < sw.length - 1; k++) if (sw[k].type === 'H' && sw[k + 1].type === 'L') legs.push({ hi: sw[k], lo: sw[k + 1], depth: (sw[k].price - sw[k + 1].price) / sw[k].price });
  if (legs.length < 2) return null;
  const tail = legs.slice(-4);
  let n = 1;
  for (let k = tail.length - 1; k > 0 && tail[k].depth <= tail[k - 1].depth * 0.8; k--) n++;
  const lastLeg = last(tail);
  if (n < 2 || lastLeg.depth > 0.10) return null; // final contraction <= 10% (Minervini: ideally 2-6%)
  const pivot = Math.max(...bars.slice(lastLeg.hi.i, i).map(b => b.h));
  const status = pivotStatus(m, bars, pivot, { volNeed: 1.4, zonePct: 5 });
  if (!status || status === 'extended') return null;
  const dryUp = avg(v.slice(-10, -1)) < av50 * 0.8;
  const entry = status === 'setting up' ? pivot * 1.001 : c[i];
  // Stop under the last contraction low, capped at 8% (Minervini: 6-8% typical, never > 10%).
  const stop = Math.max(lastLeg.lo.price * 0.995, entry * 0.92);
  const used = tail.slice(-n);
  return {
    trader: 'Minervini', key: 'minervini_vcp', name: `VCP (${n}T)`, bias: 'bull', status, pivot: +pivot.toFixed(2),
    ...plan(entry, stop, { target2Note: '3:1 reward/risk minimum', manage: 'Cut at the stop without exception; sell into strength at 2-3R or on a close below the 50-day MA; never let a 2R gain turn into a loss.' }),
    score: Math.round(clamp(40 + Math.min(n, 4) * 6 + (dryUp ? 8 : 0) + (1 - lastLeg.depth / 0.10) * 10 + (rsRating != null ? clamp((rsRating - 70) * 0.6, 0, 18) : 9) + (trendPassed === 8 ? 4 : 0) + (status === 'breakout today' ? 15 : status === 'in buy zone' ? 8 : 0))),
    notes: [`Contractions ${used.map(l => `${(l.depth * 100).toFixed(0)}%`).join(' → ')}`, dryUp ? 'Volume drying up into the pivot' : 'Volume not yet drying up', `Trend Template ${trendPassed}/8`, ...(rsRating != null ? [`RS rating ${rsRating}`] : [])],
  };
}

// ---------- O'Neil base breakout ----------
export function oneilBreakout(bars, m, rsRating, regime, canslim = null) {
  const { i, c, s50, volRatio } = m;
  if (!(rsRating >= 80) || !(c[i] > s50[i])) return null;
  // Base: 25-65 bars (5-13 weeks), <= 35% deep, prior uptrend >= 30% into the base.
  // O'Neil base types: flat base >= 5 weeks and <= 15% deep; cup-type >= 7 weeks, 12-33% deep.
  // Prefer the longest valid base (the most constructive consolidation).
  let best = null;
  for (const len of [65, 55, 45, 35, 25]) {
    const seg = bars.slice(-len - 1, -1);
    if (seg.length < len) continue;
    const hi = Math.max(...seg.map(b => b.h)), lo = Math.min(...seg.map(b => b.l));
    const depth = (hi - lo) / hi;
    // (< 5% deep for weeks is usually a pending deal/merger arb, not a base.)
    const flat = depth >= 0.05 && depth <= 0.15, cup = len >= 35 && depth >= 0.12 && depth <= 0.33;
    if (!flat && !cup) continue;
    const pre = bars.slice(-len - 80, -len);
    const priorUp = pre.length > 30 ? hi / Math.min(...pre.map(b => b.l)) - 1 : 0;
    if (priorUp < 0.3) continue;
    // Handle: the last 5-15 bars pulled back less than ~12% in the upper half of the base.
    const hseg = seg.slice(-10), hHi = Math.max(...hseg.map(b => b.h)), hLo = Math.min(...hseg.map(b => b.l));
    const handle = (hHi - hLo) / hHi <= 0.12 && hLo > lo + (hi - lo) / 2;
    const pivot = handle ? hHi : hi;
    if (!best) best = { len, depth, pivot, handle, priorUp, type: flat ? 'flat base' : 'cup-type base' };
  }
  if (!best) return null;
  const status = pivotStatus(m, bars, best.pivot, { volNeed: 1.4, zonePct: 5 });
  if (!status || status === 'extended') return null;
  const entry = status === 'setting up' ? best.pivot * 1.001 : c[i];
  const stop = entry * 0.925; // O'Neil: cut every loss at 7-8% below the buy point
  const mOk = regime?.state !== 'correction';
  const fund = canslim && (canslim.C !== 'n/a' || canslim.A !== 'n/a') ? canslim : null;
  return {
    trader: "O'Neil", key: 'oneil_base', name: best.type === 'flat base' ? 'Flat base' : best.handle ? 'Cup w/ handle' : 'Cup-type base', bias: 'bull', status, pivot: +best.pivot.toFixed(2),
    ...plan(entry, stop, { manage: 'Sell at 7-8% loss, no exceptions. Take most profits at 20-25%, unless the stock gains 20%+ within 3 weeks of breakout (then hold 8 weeks).', marketOk: mOk, canslim: fund ? { C: fund.C, A: fund.A } : null }),
    score: Math.round(clamp(40 + (rsRating - 80) + (best.handle ? 10 : 0) + (1 - best.depth / 0.35) * 15 + (status === 'breakout today' && volRatio >= 1.5 ? 18 : status === 'in buy zone' ? 8 : 0) - (mOk ? 0 : 20) + (fund ? fund.points : 0))),
    notes: [`${Math.round(best.len / 5)}-week ${best.type}, ${(best.depth * 100).toFixed(0)}% deep${best.handle ? ', with handle' : ''}`, `RS rating ${rsRating}`, status === 'breakout today' ? `Breakout volume ${volRatio.toFixed(1)}× average` : 'Needs breakout volume ≥ 1.4-1.5× average', mOk ? 'Market in uptrend' : '⚠ Market in correction: O\'Neil says no new buys', fund ? `CANSLIM C: ${fund.C} · A: ${fund.A} (${fund.notes.join(', ')})` : 'Fundamentals: n/a (add a Finnhub key)'],
  };
}

// ---------- Weinstein ----------
export function weinsteinSetup(bars, m) {
  const st = weinsteinStage(m);
  const { i, c, s150, mansfield, mansfieldPrev, volRatio } = m;
  if (!st.stage) return null;
  const base = bars.slice(-31, -1);
  const resistance = Math.max(...base.map(b => b.h)), support = Math.min(...base.map(b => b.l));
  if ((st.stage === 2 || st.stage === 1) && c[i] > resistance && mansfield > 0) {
    // Breakout above the 6-week range: Weinstein wants >= 2x volume on the breakout.
    const fresh = bars[i - 1].c <= resistance;
    // Chasing limit: a same-day close > 10% above resistance (e.g. a +100% news gap) is extended, not a Stage 2 entry.
    const status = fresh ? (c[i] <= resistance * 1.1 ? (volRatio >= 2 ? 'breakout today' : 'breakout, light volume') : null) : c[i] <= resistance * 1.05 ? 'in buy zone' : null;
    if (!status) return null;
    // Stop under the most recent correction low (last 10 bars), at least 1 ATR away; capped at 15%.
    const recentLow = Math.min(...bars.slice(-10).map(b => b.l));
    let stop = Math.min(Math.max(recentLow, s150[i]) * 0.99, c[i] - m.a);
    const structural = stop;
    const capped = (c[i] - stop) / c[i] > 0.15;
    if (capped) stop = c[i] * 0.85;
    return {
      trader: 'Weinstein', key: 'weinstein_s2', name: 'Stage 2 breakout', bias: 'bull', status, pivot: +resistance.toFixed(2), stage: st.label,
      ...plan(c[i], stop, { manage: 'Hold while price stays above a rising 30-week MA; raise the stop under each new correction low; exit on a weekly close below the 30-week MA.' + (capped ? ` Structural stop ${structural.toFixed(2)} is > 15% away: size down or wait for a pullback.` : '') }),
      score: Math.round(clamp(50 + Math.min(mansfield, 30) + (mansfieldPrev < 0 ? 10 : 0) + (volRatio >= 2 ? 15 : 0) + (st.stage === 2 ? 5 : 0))),
      notes: [st.label, `Mansfield RS ${mansfield.toFixed(1)}${mansfieldPrev < 0 ? ' (just turned positive)' : ''}`, `Breakout volume ${volRatio.toFixed(1)}× (wants ≥ 2×)`],
    };
  }
  if (st.stage === 4 && mansfield < 0 && c[i] < support && c[i] >= support * 0.9 && bars[i - 1].c >= support) {
    return {
      trader: 'Weinstein', key: 'weinstein_s4', name: 'Stage 4 breakdown', bias: 'bear', status: 'breakdown today', pivot: +support.toFixed(2), stage: st.label,
      entry: +c[i].toFixed(2), stop: +(Math.min(resistance, s150[i]) * 1.01).toFixed(2), stopPct: +(((Math.min(resistance, s150[i]) * 1.01) / c[i] - 1) * 100).toFixed(1),
      target1: +(c[i] - 2 * (Math.min(resistance, s150[i]) * 1.01 - c[i])).toFixed(2), target2: null,
      manage: 'Avoid longs. For shorts/puts: stop above the 30-week MA or the breakdown level.',
      score: Math.round(clamp(50 + Math.min(-mansfield, 30) + (volRatio >= 1.5 ? 10 : 0))),
      notes: [st.label, `Mansfield RS ${mansfield.toFixed(1)}`, `Broke 6-week support on ${volRatio.toFixed(1)}× volume`],
    };
  }
  return null;
}

// ---------- market regime (O'Neil "M" + Weinstein market stage) ----------
export function marketRegime(spyBars, breadth) {
  const m = setupMetrics(spyBars, null);
  const st = weinsteinStage(m);
  // Distribution days: SPY down >= 0.2% on volume above the prior day, last 25 sessions.
  let dist = 0;
  for (let k = spyBars.length - 25; k < spyBars.length; k++) {
    if (k > 0 && spyBars[k].c < spyBars[k - 1].c * 0.998 && spyBars[k].v > spyBars[k - 1].v) dist++;
  }
  const { i, c, s50, s200 } = m;
  let state = 'uptrend';
  if (c[i] < s50[i] && (st.stage === 4 || breadth.above50 < 0.4)) state = 'correction';
  else if (dist >= 5 || breadth.above50 < 0.5 || c[i] < s50[i]) state = 'under pressure';
  const label = { uptrend: 'Confirmed uptrend', 'under pressure': 'Uptrend under pressure', correction: 'Market in correction' }[state];
  const exposure = { uptrend: 'Full size on A+ setups', 'under pressure': 'Half size, tighter stops, only the best setups', correction: 'No new long breakouts (cash, hedges or short setups)' }[state];
  return {
    state, label, exposure, spyStage: st.label, distributionDays: dist, spy: c[i], spyAbove50: c[i] > s50[i], spyAbove200: c[i] > s200[i],
    breadthAbove50: breadth.above50, breadthAbove200: breadth.above200, stage2Pct: breadth.stage2,
  };
}

// Run every detector for one symbol.
export function detectSetups(bars, ctx) {
  const m = setupMetrics(bars, ctx.spyBars);
  const out = [qullaBreakout(bars, m, ctx), qullaEpisodicPivot(bars, m), minerviniVcp(bars, m, ctx.trendPassed, ctx.rsRating), oneilBreakout(bars, m, ctx.rsRating, ctx.regime, ctx.canslim), weinsteinSetup(bars, m)].filter(Boolean);
  const st = weinsteinStage(m);
  return { setups: out.sort((a, b) => b.score - a.score), stage: st.stage, stageLabel: st.label, mansfield: m.mansfield, adr: m.adr };
}
