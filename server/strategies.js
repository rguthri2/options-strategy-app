// Strategy engine: turns a symbol's setup (hot-list row) and live option chain into concrete,
// scored trade candidates. Rules follow widely published professional mechanics:
//   - tastytrade (Sosnoff/Battista): sell premium when IV Rank is elevated, ~45 DTE, 16-30 delta shorts,
//     collect >= 1/3 of the width on defined-risk spreads, take profits at 50%, manage/roll at 21 DTE.
//   - Stock-replacement long options (e.g. Minervini/O'Neil style setups expressed with ~70 delta,
//     60-120 DTE calls): high delta, low extrinsic, low daily theta.
//   - Debit verticals: buy ~60 delta / sell ~30 delta or the technical target; pay <= ~50% of width.
//   - Poor Man's Covered Call: 80 delta LEAPS + 30 delta 30-45 DTE short call; debit < 75% of width.
//   - The Wheel: cash-secured puts at ~30 delta on names you want to own, covered calls once assigned.
import crypto from 'node:crypto';
import { analyze, pickByDelta, legFrom, strikeBeyond, describeLegs, MULT } from '../shared/strategy.js';
import { atmIV } from '../shared/analytics.js';
import { yearsToExpiry } from '../shared/time.js';
import { market } from './providers/index.js';
import { getSettings } from './settings.js';
import { hotlistState, symbolTechnicals } from './scanner.js';
import { earningsBefore } from './earnings.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

export const PLAYBOOK = {
  longCall: {
    label: 'Long Call (stock replacement)', bias: 'bull', kind: 'debit', ivPref: 'low',
    rules: ['Bullish setup: Trend Template ≥ 6/8, breakout / pivot / 21-EMA pullback', '~70Δ call, 60–120 DTE (target ~90)', 'Prefer IV Rank < 30 (buy premium when it is cheap)', 'Extrinsic value < ~30% of premium; theta < 1%/day'],
    manage: 'Exit on the underlying: stop below the setup low / 2 ATR, take profits at 2R–3R. Close or roll before 30 DTE to avoid theta acceleration.',
  },
  longPut: {
    label: 'Long Put', bias: 'bear', kind: 'debit', ivPref: 'low',
    rules: ['Bearish setup: breakdown, failed rally at 21 EMA, downtrend momentum', '~70Δ put, 60–120 DTE', 'Prefer IV Rank < 30'],
    manage: 'Stop above the setup high / 2 ATR; take profits at 2R–3R; close or roll before 30 DTE.',
  },
  leaps: {
    label: 'LEAPS Call', bias: 'bull', kind: 'debit', ivPref: 'low',
    rules: ['Long-term leader in a stage-2 uptrend', '~80Δ call, ≥ 270 DTE', 'Buy when IV Rank is low; costs a fraction of 100 shares'],
    manage: 'Treat as stock: exit on a close below the 200-day SMA or a trend-template failure. Roll out when < 120 DTE remain.',
  },
  pmcc: {
    label: "Poor Man's Covered Call", bias: 'bull', kind: 'debit', ivPref: 'any',
    rules: ['Long ~80Δ LEAPS call + short ~30Δ call 30–45 DTE', 'Net debit < 75% of strike width so an assignment cannot lock a loss', 'Short strike above the long call breakeven'],
    manage: 'Roll the short call at 50% profit or 21 DTE; roll up and out if tested. Close the whole position if the LEAPS falls below ~60Δ.',
  },
  bullCallSpread: {
    label: 'Bull Call Debit Spread', bias: 'bull', kind: 'debit', ivPref: 'mid',
    rules: ['Buy ~60Δ call, sell ~30Δ call or at the 2R target', '25–65 DTE (target ~45)', 'Debit ≤ 50% of width (reward ≥ risk)'],
    manage: 'Take profits at 50–75% of max value; stop at 50% loss of debit or a close through the setup stop.',
  },
  bearPutSpread: {
    label: 'Bear Put Debit Spread', bias: 'bear', kind: 'debit', ivPref: 'mid',
    rules: ['Buy ~60Δ put, sell ~30Δ put or at the 2R target', '25–65 DTE', 'Debit ≤ 50% of width'],
    manage: 'Take profits at 50–75% of max value; stop at 50% loss of debit.',
  },
  bullPutSpread: {
    label: 'Bull Put Credit Spread', bias: 'bull', kind: 'credit', ivPref: 'high',
    rules: ['Bullish or neutral-bullish; short put ~25–30Δ below support', '30–50 DTE (target 45)', 'IV Rank ≥ 30; credit ≥ 1/3 of width'],
    manage: 'Close at 50% of max profit; manage or roll at 21 DTE; stop if loss reaches 2× the credit received.',
  },
  bearCallSpread: {
    label: 'Bear Call Credit Spread', bias: 'bear', kind: 'credit', ivPref: 'high',
    rules: ['Bearish or neutral-bearish; short call ~25–30Δ above resistance', '30–50 DTE (target 45)', 'IV Rank ≥ 30; credit ≥ 1/3 of width'],
    manage: 'Close at 50% of max profit; manage at 21 DTE; stop at 2× credit.',
  },
  csp: {
    label: 'Cash-Secured Put (Wheel)', bias: 'bull', kind: 'credit', ivPref: 'high',
    rules: ['Quality name you want to own, bullish/neutral', '~25–30Δ put, 30–50 DTE', 'IV Rank ≥ 30; target ≥ 15% annualized on capital'],
    manage: 'Buy back at 50% profit or roll at 21 DTE. If assigned, sell 30Δ covered calls (the Wheel).',
  },
  coveredCall: {
    label: 'Covered Call', bias: 'bull', kind: 'credit', ivPref: 'high',
    rules: ['Own (or buy) 100 shares', 'Sell ~30Δ call 30–45 DTE above resistance', 'Richer when IV Rank is high'],
    manage: 'Buy back at 50% profit; roll up/out if the stock runs and you want to keep the shares.',
  },
  ironCondor: {
    label: 'Iron Condor', bias: 'neutral', kind: 'credit', ivPref: 'high',
    rules: ['Range-bound: ADX < 25, price inside the bands', '~16Δ short strikes (≈1 SD), 30–50 DTE', 'IV Rank ≥ 30; credit ≥ ~1/4–1/3 of width'],
    manage: 'Close at 50% of max profit; manage at 21 DTE; roll the untested side toward price if one side is challenged.',
  },
};

function pickExp(exps, [min, max], target) {
  let best = null, bestS = Infinity;
  for (const e of exps) {
    if (e.dte < min || e.dte > max || !e.rows.length) continue;
    const s = Math.abs(e.dte - target) - (e.type === 'M' ? 6 : 0);
    if (s < bestS) { bestS = s; best = e; }
  }
  return best;
}

function niceWidth(S, rows) {
  const steps = rows.map((r, i) => (i ? r.strike - rows[i - 1].strike : Infinity)).filter(x => x > 0);
  const minStep = Math.min(...steps);
  const target = S * 0.03;
  const cands = [1, 2, 2.5, 5, 10, 15, 20, 25, 50, 100].filter(w => w >= minStep - 1e-9);
  return cands.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a), cands[0] || minStep);
}

const spreadPct = c => (c.mark > 0 ? (c.ask - c.bid) / c.mark : 1);

function liquidity(contracts, f) {
  const minOi = Math.min(...contracts.map(c => c.oi || 0));
  const maxSp = Math.max(...contracts.map(spreadPct));
  const ok = minOi >= f.minOI && maxSp <= f.maxSpreadPct / 100;
  const score = 7.5 * clamp(Math.log10(Math.max(minOi, 1)) / 3) + 7.5 * clamp(1 - maxSp / 0.2);
  return { ok, minOi, maxSpreadPct: maxSp, score };
}

function sizing(capital, maxLoss, defined, account) {
  const risk = (account.size * account.riskPerTradePct) / 100;
  const alloc = (account.size * account.maxAllocationPct) / 100;
  const byRisk = defined && Number.isFinite(maxLoss) && maxLoss < 0 ? risk / -maxLoss : Infinity;
  const n = Math.floor(Math.min(byRisk, capital > 0 ? alloc / capital : Infinity));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function makeIdea(key, legs, contracts, ctx, quality, notes = []) {
  const info = PLAYBOOK[key];
  const { spot, row, settings, sigmaReal } = ctx;
  const nearest = contracts.reduce((a, c) => (c.expiry < a.expiry ? c : a), contracts[0]);
  const ivDist = nearest.iv > 0 ? nearest.iv : ctx.ivAtm;
  const a = analyze(legs, { spot, sigma: ivDist, r: ctx.rate });
  const real = analyze(legs, { spot, sigma: sigmaReal || ivDist, r: ctx.rate });
  const liq = liquidity(contracts, settings.filters);
  const defined = Number.isFinite(a.maxLoss);
  const capital = a.capital;
  const qual = quality(a);

  // Fit to the current setup and IV regime.
  const dir = info.bias === 'bull' ? row?.bullScore ?? 50 : info.bias === 'bear' ? row?.bearScore ?? 50 : row?.rangeScore ?? 50;
  const dirAdj = key === 'csp' || key === 'coveredCall' || key === 'bullPutSpread' ? Math.max(dir, ((row?.bullScore ?? 50) + (row?.rangeScore ?? 50)) / 2)
    : key === 'bearCallSpread' ? Math.max(dir, ((row?.bearScore ?? 50) + (row?.rangeScore ?? 50)) / 2) : dir;
  const ivr = ctx.ivr ?? 50;
  const ivFit = info.ivPref === 'high' ? clamp((ivr - 10) / 50) * 15 + (ctx.ivHv > 1.15 ? 0 : -3)
    : info.ivPref === 'low' ? clamp((70 - ivr) / 50) * 15
      : info.ivPref === 'mid' ? 15 - clamp(Math.abs(ivr - 40) / 40) * 8 : 11;
  const edge = capital > 0 ? clamp(7.5 + (real.ev / capital) * 75, 0, 15) : 7.5;
  const exp = nearest.expiry;

  // Earnings inside the trade: gap risk for short premium, IV crush for long premium.
  const er = earningsBefore(ctx.symbol, exp);
  const erPenalty = !er ? 0 : info.kind === 'credit' ? 10 : ['longCall', 'longPut', 'leaps'].includes(key) ? (er.days <= 21 ? 6 : 0) : 4;
  const erNote = er ? [`⚠ Earnings ${er.date}${er.hour ? ` (${er.hour})` : ''} before expiry`] : [];
  const score = Math.round(clamp((25 * dirAdj) / 100 + ivFit + qual.score + edge + liq.score - erPenalty, 0, 100));

  const credit = -a.cost;
  const dte = Math.round(yearsToExpiry(exp) * 365);
  const id = crypto.createHash('sha1').update(key + JSON.stringify(legs.map(l => [l.type, l.qty, l.strike, l.expiry]))).digest('hex').slice(0, 12);
  return {
    id, key, label: info.label, kind: info.kind, bias: info.bias, symbol: ctx.symbol, spot,
    legs, description: describeLegs(legs), expiry: exp, dte,
    cost: a.cost, credit: credit > 0 ? credit : 0, maxProfit: a.maxProfit, maxLoss: a.maxLoss,
    breakevens: a.breakevens, pop: a.pop, popReal: real.pop, ev: a.ev, evReal: real.ev,
    // R:R is meaningless for a lone long option (its "max" assumes the stock goes to zero / infinity).
    rr: legs.length > 1 && Number.isFinite(a.maxProfit) && a.maxLoss < 0 ? a.maxProfit / -a.maxLoss : null,
    capital, greeks: a.greeks, contracts: sizing(capital, a.maxLoss, defined, settings.account),
    liquidity: liq, liquidityOk: liq.ok, score,
    scoreParts: { setup: Math.round((25 * dirAdj) / 100), iv: Math.round(ivFit), quality: Math.round(qual.score), edge: Math.round(edge), liquidity: Math.round(liq.score) },
    rationale: [...erNote, ...qual.notes, ...notes, `IVR ${Number.isFinite(ivr) ? Math.round(ivr) : '—'} (${ctx.ivRegime || 'n/a'})`],
    manage: info.manage, setup: row?.setup, ivr: ctx.ivr, earnings: er,
  };
}

// ----- builders -----
function buildLong(ctx, type, key, window, target, delta, minDte) {
  const e = minDte ? pickExp(ctx.exps.filter(x => x.dte >= minDte), [minDte, 900], 450) : pickExp(ctx.exps, window, target);
  if (!e) return [];
  const c = pickByDelta(e.rows, type, delta);
  if (!c) return [];
  const legs = [legFrom(c, 1)];
  return [makeIdea(key, legs, [c], ctx, a => {
    const px = legs[0].price;
    const intr = type === 'call' ? Math.max(0, ctx.spot - c.strike) : Math.max(0, c.strike - ctx.spot);
    const extr = px > 0 ? (px - intr) / px : 1;
    const thetaPct = px > 0 ? (Math.abs(c.theta) / px) * 100 : 9;
    return {
      score: 15 * clamp((0.45 - extr) / 0.35) + 15 * clamp((1.2 - thetaPct) / 1.0),
      notes: [`${Math.round(Math.abs(c.delta) * 100)}Δ, ${e.dte} DTE`, `Extrinsic ${Math.round(extr * 100)}%`, `Theta ${thetaPct.toFixed(2)}%/day`],
    };
  })];
}

function buildDebitSpread(ctx, type, key) {
  const { rules } = ctx.settings;
  const e = pickExp(ctx.exps, rules.debitDte, rules.debitTargetDte);
  if (!e) return [];
  const long = pickByDelta(e.rows, type, 0.62);
  if (!long) return [];
  const dir = type === 'call' ? 1 : -1;
  const shorts = new Map();
  for (const d of [0.4, 0.33, 0.25]) {
    const s = pickByDelta(e.rows, type, d);
    if (s && (s.strike - long.strike) * dir > 0) shorts.set(s.strike, s);
  }
  const tgt = ctx.row?.plan?.target1;
  if (tgt) {
    const byTarget = e.rows.map(r => r[type])
      .filter(c => c && (c.strike - long.strike) * dir > 0 && Math.abs(c.delta) >= 0.15 && Math.abs(c.delta) <= 0.45)
      .reduce((a, c) => (!a || Math.abs(c.strike - tgt) < Math.abs(a.strike - tgt) ? c : a), null);
    if (byTarget) shorts.set(byTarget.strike, byTarget);
  }
  return [...shorts.values()].map(s => {
    const legs = [legFrom(long, 1), legFrom(s, -1)];
    const width = Math.abs(s.strike - long.strike);
    return makeIdea(key, legs, [long, s], ctx, a => {
      const d = a.cost / (width * MULT);
      const rr = a.maxProfit / -a.maxLoss;
      return {
        score: 20 * clamp((0.65 - d) / 0.25) + 10 * clamp(rr / 1.5),
        notes: [`Debit ${Math.round(d * 100)}% of $${width} width`, `R:R ${rr.toFixed(2)}`, `${e.dte} DTE`, tgt && Math.abs(s.strike - tgt) < width * 0.3 ? 'Short strike at 2R target' : `Short ${Math.round(Math.abs(s.delta) * 100)}Δ`],
      };
    });
  });
}

function buildCreditSpread(ctx, type, key) {
  const { rules } = ctx.settings;
  const e = pickExp(ctx.exps, rules.creditDte, rules.creditTargetDte);
  if (!e) return [];
  const byDelta = pickByDelta(e.rows, type, rules.creditShortDelta);
  if (!byDelta) return [];
  const dir = type === 'call' ? 1 : -1;
  // Structure-to-setup alignment: for a bull put spread also try the short strike at/below the
  // setup's stop (bear call: at/above), so the spread only loses if the chart setup fails.
  const shorts = [{ c: byDelta, why: null }];
  const stop = ctx.row?.plan?.stop;
  if (Number.isFinite(stop)) {
    const cands = e.rows.map(r => r[type]).filter(c => c && (type === 'put' ? c.strike <= stop : c.strike >= stop) && Math.abs(c.delta) >= 0.08 && Math.abs(c.delta) <= 0.45 && c.bid > 0);
    const atStop = cands.sort((a, b) => Math.abs(a.strike - stop) - Math.abs(b.strike - stop))[0];
    if (atStop && atStop.strike !== byDelta.strike) shorts.push({ c: atStop, why: `Short strike beyond the setup stop ${stop}` });
  }
  const w = niceWidth(ctx.spot, e.rows);
  const out = [];
  for (const { c: short, why } of shorts) {
    for (const width of [w, w * 2]) {
      const long = strikeBeyond(e.rows, type, short.strike, width, dir);
      if (!long) continue;
      const legs = [legFrom(short, -1), legFrom(long, 1)];
      const realW = Math.abs(long.strike - short.strike);
      out.push(makeIdea(key, legs, [short, long], ctx, a => {
        const r = -a.cost / (realW * MULT);
        return {
          score: 18 * clamp((r - 0.15) / 0.2) + 12 * clamp((a.pop - 0.5) / 0.25) + (why ? 3 : 0),
          notes: [`Credit ${Math.round(r * 100)}% of $${realW} width`, `Short ${Math.round(Math.abs(short.delta) * 100)}Δ`, `${e.dte} DTE`, `POP ${Math.round(a.pop * 100)}%`, ...(why ? [why] : [])],
        };
      }));
    }
  }
  return out;
}

function buildCsp(ctx) {
  const { rules } = ctx.settings;
  const e = pickExp(ctx.exps, rules.creditDte, rules.creditTargetDte);
  if (!e) return [];
  const p = pickByDelta(e.rows, 'put', rules.creditShortDelta);
  if (!p) return [];
  const legs = [legFrom(p, -1)];
  return [makeIdea('csp', legs, [p], ctx, a => {
    const credit = -a.cost;
    const ann = (credit / (p.strike * MULT - credit)) * (365 / Math.max(e.dte, 1));
    return {
      score: 18 * clamp(ann / 0.25) + 12 * clamp((a.pop - 0.55) / 0.25),
      notes: [`${(ann * 100).toFixed(1)}% annualized on cash`, `Effective buy price $${(p.strike - credit / MULT).toFixed(2)}`, `${Math.round(Math.abs(p.delta) * 100)}Δ, ${e.dte} DTE`],
    };
  })];
}

function buildCoveredCall(ctx) {
  const { rules } = ctx.settings;
  const e = pickExp(ctx.exps, rules.creditDte, rules.creditTargetDte);
  if (!e) return [];
  const c = pickByDelta(e.rows, 'call', 0.3);
  if (!c) return [];
  const legs = [{ type: 'stock', qty: 100, price: +ctx.spot.toFixed(2) }, legFrom(c, -1)];
  return [makeIdea('coveredCall', legs, [c], ctx, () => {
    const credit = legs[1].price;
    const ann = (credit / ctx.spot) * (365 / Math.max(e.dte, 1));
    const called = (c.strike - ctx.spot + credit) / ctx.spot;
    return {
      score: 18 * clamp(ann / 0.2) + 12 * clamp(called / 0.06),
      notes: [`Premium ${(ann * 100).toFixed(1)}% annualized`, `If called: +${(called * 100).toFixed(1)}%`, `${Math.round(c.delta * 100)}Δ, ${e.dte} DTE`],
    };
  })];
}

function buildCondor(ctx) {
  const { rules } = ctx.settings;
  const e = pickExp(ctx.exps, rules.creditDte, rules.creditTargetDte);
  if (!e) return [];
  const sp = pickByDelta(e.rows, 'put', rules.condorShortDelta);
  const sc = pickByDelta(e.rows, 'call', rules.condorShortDelta);
  if (!sp || !sc || sp.strike >= sc.strike) return [];
  const w = niceWidth(ctx.spot, e.rows);
  const out = [];
  for (const width of [w, w * 2]) {
    const lp = strikeBeyond(e.rows, 'put', sp.strike, width, -1);
    const lc = strikeBeyond(e.rows, 'call', sc.strike, width, 1);
    if (!lp || !lc) continue;
    const legs = [legFrom(lp, 1), legFrom(sp, -1), legFrom(sc, -1), legFrom(lc, 1)];
    const realW = Math.max(sp.strike - lp.strike, lc.strike - sc.strike);
    out.push(makeIdea('ironCondor', legs, [lp, sp, sc, lc], ctx, a => {
      const r = -a.cost / (realW * MULT);
      return {
        score: 16 * clamp((r - 0.12) / 0.2) + 14 * clamp((a.pop - 0.45) / 0.3),
        notes: [`Credit ${Math.round(r * 100)}% of $${realW} width`, `Shorts ${sp.strike}P / ${sc.strike}C (~${Math.round(rules.condorShortDelta * 100)}Δ)`, `${e.dte} DTE`, `POP ${Math.round(a.pop * 100)}%`],
      };
    }));
  }
  return out;
}

function buildPmcc(ctx) {
  const { rules } = ctx.settings;
  const le = pickExp(ctx.exps.filter(x => x.dte >= rules.leapsMinDte), [rules.leapsMinDte, 900], 450);
  const se = pickExp(ctx.exps, rules.creditDte, rules.creditTargetDte);
  if (!le || !se) return [];
  const long = pickByDelta(le.rows, 'call', rules.leapsDelta);
  if (!long) return [];
  const longBe = long.strike + long.ask;
  const short = se.rows.map(r => r.call).filter(c => c && c.strike >= longBe && c.delta <= 0.4)
    .reduce((a, c) => (!a || Math.abs(c.delta - 0.3) < Math.abs(a.delta - 0.3) ? c : a), null);
  if (!short) return [];
  const legs = [legFrom(long, 1), legFrom(short, -1)];
  return [makeIdea('pmcc', legs, [long, short], ctx, a => {
    const width = short.strike - long.strike;
    const ratio = a.cost / (width * MULT);
    const yieldPct = (legs[1].price / legs[0].price) * 100;
    return {
      score: 18 * clamp((0.85 - ratio) / 0.3) + 12 * clamp(yieldPct / 8),
      notes: [`Debit ${Math.round(ratio * 100)}% of width (${ratio < 0.75 ? 'OK' : 'too high'})`, `Short call yields ${yieldPct.toFixed(1)}% of LEAPS cost`, `LEAPS ${le.dte} DTE / short ${se.dte} DTE`],
    };
  }, [`LEAPS ${Math.round(long.delta * 100)}Δ`])];
}

const BUILDERS = {
  longCall: ctx => buildLong(ctx, 'call', 'longCall', ctx.settings.rules.longDte, ctx.settings.rules.longTargetDte, ctx.settings.rules.longDelta),
  longPut: ctx => buildLong(ctx, 'put', 'longPut', ctx.settings.rules.longDte, ctx.settings.rules.longTargetDte, ctx.settings.rules.longDelta),
  leaps: ctx => buildLong(ctx, 'call', 'leaps', null, null, ctx.settings.rules.leapsDelta, ctx.settings.rules.leapsMinDte),
  pmcc: buildPmcc,
  bullCallSpread: ctx => buildDebitSpread(ctx, 'call', 'bullCallSpread'),
  bearPutSpread: ctx => buildDebitSpread(ctx, 'put', 'bearPutSpread'),
  bullPutSpread: ctx => buildCreditSpread(ctx, 'put', 'bullPutSpread'),
  bearCallSpread: ctx => buildCreditSpread(ctx, 'call', 'bearCallSpread'),
  csp: buildCsp,
  coveredCall: buildCoveredCall,
  ironCondor: buildCondor,
};

const BY_BIAS = {
  // Covered calls assume you hold shares, so they only appear in per-symbol analysis.
  bull: ['longCall', 'leaps', 'pmcc', 'bullCallSpread', 'bullPutSpread', 'csp'],
  bear: ['longPut', 'bearPutSpread', 'bearCallSpread'],
  neutral: ['ironCondor', 'csp'],
};

// Only the expirations the strategy rules can select, so each symbol costs a handful of chain requests.
function neededDates(list, settings) {
  const r = settings.rules;
  const withRows = list.map(e => ({ ...e, rows: [{}] })); // pickExp skips empty expirations
  const picks = [
    pickExp(withRows, r.creditDte, r.creditTargetDte), pickExp(withRows, r.debitDte, r.debitTargetDte),
    pickExp(withRows, r.longDte, r.longTargetDte), pickExp(withRows, [25, 60], 30),
  ];
  if (settings.strategies.leaps || settings.strategies.pmcc) picks.push(pickExp(withRows.filter(e => e.dte >= r.leapsMinDte), [r.leapsMinDte, 900], 450));
  return [...new Set(picks.filter(Boolean).map(e => e.date))].sort();
}

async function context(symbol, row) {
  const settings = getSettings();
  const dates = neededDates(await market.expirations(symbol), settings);
  if (!dates.length) throw new Error(`No suitable expirations for ${symbol}`);
  const chains = await Promise.all(dates.map(d => market.chain(symbol, { fromDate: d, toDate: d, strikeCount: 60 }).catch(() => null)));
  const near = chains.find(Boolean);
  if (!near) throw new Error(`No option chain for ${symbol}`);
  const exps = chains.filter(Boolean).flatMap(c => c.expirations).sort((a, b) => a.date.localeCompare(b.date));
  const ref = exps.find(e => e.dte >= 25 && e.type === 'M') || exps[0];
  const ivAtm = ref ? atmIV(ref.rows, near.spot) : NaN;
  const tech = row || (await symbolTechnicals(symbol).catch(() => null));
  const hv = tech ? (tech.hv20 || 0) * 0.5 + (tech.hv60 || tech.hv20 || 0) * 0.5 : NaN;
  return {
    symbol, spot: near.spot, rate: near.rate, exps, settings, row: row || tech?.hotlist || null,
    ivAtm, ivr: row?.ivr ?? tech?.ivr, ivHv: row?.ivHv ?? tech?.ivHv, ivRegime: row?.ivRegime ?? tech?.regime,
    sigmaReal: hv > 0 ? hv : ivAtm,
  };
}

// Best trades for one symbol across all enabled strategies.
export async function ideasForSymbol(symbol, keys) {
  const row = hotlistState().rows.find(r => r.symbol === symbol);
  const ctx = await context(symbol, row);
  const enabled = (keys || Object.keys(BUILDERS)).filter(k => ctx.settings.strategies[k] !== false);
  const ideas = enabled.flatMap(k => { try { return BUILDERS[k](ctx); } catch { return []; } });
  return bestPerKey(ideas).sort((a, b) => b.score - a.score);
}

function bestPerKey(ideas, n = 1) {
  const by = new Map();
  for (const i of ideas) { const a = by.get(i.key) || []; a.push(i); by.set(i.key, a); }
  return [...by.values()].flatMap(a => a.sort((x, y) => y.score - x.score).slice(0, n));
}

let global = { updated: 0, ideas: [] };
let building = null;

export function globalIdeas() { return global; }

// Scan the strongest hot-list names with bias-appropriate strategies.
export function refreshIdeas() {
  building ??= (async () => {
    const rows = hotlistState().rows;
    const picks = [
      ...rows.filter(r => r.bias === 'bull' && r.score >= 55).slice(0, 12),
      ...rows.filter(r => r.bias === 'bear' && r.score >= 55).slice(0, 8),
      ...rows.filter(r => r.bias === 'neutral' && r.ivRegime === 'rich').slice(0, 6),
    ];
    const settings = getSettings();
    const all = [];
    for (const row of picks) {
      try {
        const ctx = await context(row.symbol, row);
        const keys = BY_BIAS[row.bias].filter(k => settings.strategies[k] !== false);
        const ideas = keys.flatMap(k => { try { return BUILDERS[k](ctx); } catch { return []; } });
        all.push(...bestPerKey(ideas).filter(i => i.liquidityOk));
      } catch { /* skip symbol */ }
    }
    global = { updated: Date.now(), ideas: all.sort((a, b) => b.score - a.score).slice(0, 80) };
    return global;
  })().finally(() => { building = null; });
  return building;
}
