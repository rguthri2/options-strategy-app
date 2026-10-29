// Tradier -> Trade Journal sync (READ-ONLY on the Tradier side).
// 1. Normalize Tradier history events (nightly, date only) and today's filled orders into executions.
// 2. Group by day | contract | side and subtract what the journal already has for that day/contract/side
//    (manual or previously imported fills), so re-running never double-counts.
// 3. Pair same-day opposite option legs into vertical spreads, apply the rest to stock/single-option trades,
//    close expired/assigned/exercised options at 0, and list anything ambiguous for manual review.
import { parseOcc, occSymbol } from '../shared/strategy.js';
import { computeTrade, sortFills } from '../shared/journal.js';
import { nyDateStr, nyOffsetHours } from '../shared/time.js';

const EPS = 1e-9;
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const occKey = (sym, expiry, type, strike) => 'O:' + occSymbol(sym, expiry, type, strike).replace(/\s+/g, '');
const stockKey = sym => 'S:' + String(sym).toUpperCase();

function instrumentOf(symbol) {
  const o = parseOcc(String(symbol || '').replace(/\s+/g, ''));
  if (o) return { key: occKey(o.symbol, o.expiry, o.type, o.strike), assetType: 'option', symbol: o.symbol, optionType: o.type, expiry: o.expiry, strike: o.strike };
  const s = String(symbol || '').toUpperCase().replace('/', '.');
  return /^[A-Z][A-Z0-9.]{0,9}$/.test(s) ? { key: stockKey(s), assetType: 'stock', symbol: s } : null;
}

// ---------- normalization ----------
// Tradier documents both a flat event and one with details nested under "trade" / "option": accept either.
export function fromHistory(events) {
  const execs = [], rejected = [];
  for (const ev of events || []) {
    if (ev?.type !== 'trade' && ev?.type !== 'option') continue; // dividends, transfers, fees...
    const f = k => ev?.trade?.[k] ?? ev?.option?.[k] ?? ev?.[k];
    const day = String(ev?.date || '').slice(0, 10);
    const inst = instrumentOf(f('symbol'));
    const qtyRaw = Number(f('quantity')), price = Number(f('price')), desc = String(f('description') || '');
    const base = { src: 'history', day, desc, raw: `${day} ${ev?.type} ${f('symbol')} ${f('quantity')} @ ${f('price')} ${desc}`.trim() };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !inst || !Number.isFinite(qtyRaw) || qtyRaw === 0) { rejected.push({ ...base, reason: 'Unrecognized event' }); continue; }
    if (ev.type === 'option') {
      // Expiration / assignment / exercise: the option position closes at 0 (assigned stock arrives as its own trade event).
      if (inst.assetType !== 'option') { rejected.push({ ...base, reason: 'Option event without an option symbol' }); continue; }
      execs.push({ ...base, ...inst, kind: 'close0', qty: Math.abs(qtyRaw), price: 0, fees: 0, what: /assign/i.test(desc) ? 'assigned' : /exerc/i.test(desc) ? 'exercised' : 'expired' });
      continue;
    }
    if (ev.type !== 'trade') continue;
    const side = /\b(sold|sell|sto|stc)\b/i.test(desc) ? 'sell' : /\b(bought|buy|bto|btc)\b/i.test(desc) ? 'buy' : qtyRaw < 0 ? 'sell' : 'buy';
    if (!(price >= 0)) { rejected.push({ ...base, reason: 'Missing price' }); continue; }
    execs.push({ ...base, ...inst, kind: 'fill', side, qty: Math.abs(qtyRaw), price, fees: Math.abs(Number(f('commission')) || 0) });
  }
  return { execs, rejected };
}

const SIDE = { buy: 'buy', buy_to_open: 'buy', buy_to_close: 'buy', buy_to_cover: 'buy', sell: 'sell', sell_short: 'sell', sell_to_open: 'sell', sell_to_close: 'sell' };
const nyTime = iso => { const d = new Date(iso); if (!Number.isFinite(d.getTime())) return null; const s = new Date(d.getTime() + nyOffsetHours(d) * 3600e3).toISOString(); return { day: s.slice(0, 10), time: s.slice(11, 16) }; };

// Today's filled (or partially filled) orders, one execution per leg.
export function fromOrders(orders, today) {
  const execs = [];
  for (const o of orders || []) {
    const t = nyTime(o.transaction_date || o.create_date);
    if (!t || t.day !== today) continue;
    const legs = Array.isArray(o.leg) ? o.leg : o.leg ? [o.leg] : [o];
    for (const l of legs) {
      const qty = Number(l.exec_quantity), price = Number(l.avg_fill_price), side = SIDE[l.side];
      if (!(qty > 0) || !(price >= 0) || !side) continue;
      const inst = instrumentOf(l.option_symbol || l.symbol || o.symbol);
      if (!inst) continue;
      execs.push({ src: 'orders', day: t.day, time: t.time, ...inst, kind: 'fill', side, qty, price, fees: 0, raw: `${t.day} ${t.time} ${l.side} ${qty} ${l.option_symbol || l.symbol} @ ${price} (order ${o.id})` });
    }
  }
  return execs;
}

// ---------- journal state ----------
const tradeKeys = t => (t.assetType !== 'option' ? [stockKey(t.symbol)]
  : t.strike2 ? [occKey(t.symbol, t.expiry, t.optionType, t.strike), occKey(t.symbol, t.expiry, t.optionType, t.strike2)]
    : [occKey(t.symbol, t.expiry, t.optionType, t.strike)]);
const flip = s => (s === 'buy' ? 'sell' : 'buy');

// Leg-level quantities already recorded in the journal per day|contract|side (a vertical fill covers both legs).
function coverage(trades) {
  const cov = new Map();
  for (const t of trades) {
    const keys = tradeKeys(t);
    for (const f of t.fills) {
      const legs = keys.length === 2 ? [[keys[0], f.side], [keys[1], flip(f.side)]] : [[keys[0], f.side]];
      for (const [k, side] of legs) {
        const id = `${String(f.date).slice(0, 10)}|${k}|${side}`;
        const c = cov.get(id) || { qty: 0, fills: [] };
        c.qty += f.qty; c.fills.push({ tradeId: t.id, fillId: f.id, fees: f.fees || 0, source: f.source });
        cov.set(id, c);
      }
    }
  }
  return cov;
}

// ---------- the plan ----------
export function planSync(trades, execs, { accountId, today = nyDateStr() } = {}) {
  const mine = trades.filter(t => t.accountId === accountId).map(t => ({ ...t, fills: [...t.fills] }));
  const cov = coverage(mine);
  const plan = { newTrades: [], addFills: [], feeUpdates: [], review: [], skipped: 0 };
  const newId = () => `new-${plan.newTrades.length + 1}`;

  // Aggregate executions into day|key|side groups (VWAP price, summed fees).
  const groups = new Map();
  for (const e of execs) {
    const side = e.kind === 'close0' ? null : e.side;
    const id = `${e.day}|${e.key}|${side ?? 'close0'}`;
    const g = groups.get(id) || { ...e, side, qty: 0, notional: 0, fees: 0, raws: [] };
    g.qty += e.qty; g.notional += e.qty * e.price; g.fees += e.fees; g.raws.push(e.raw);
    if (e.time && (!g.time || e.time < g.time)) g.time = e.time;
    groups.set(id, g);
  }
  // Subtract what the journal already has; backfill commissions onto earlier same-day order imports.
  const pending = [];
  for (const g of groups.values()) {
    if (g.kind === 'close0') { pending.push(g); continue; }
    g.price = g.qty ? g.notional / g.qty : 0;
    const c = cov.get(`${g.day}|${g.key}|${g.side}`);
    const covered = Math.min(c?.qty || 0, g.qty);
    if (covered >= g.qty - EPS) {
      plan.skipped++;
      const imported = (c?.fills || []).filter(f => f.source === 'tradier' && !f.fees);
      if (g.fees > 0 && imported.length && !(c.fills.some(f => f.fees))) {
        const each = round(g.fees / imported.length, 2);
        for (const f of imported) plan.feeUpdates.push({ tradeId: f.tradeId, fillId: f.fillId, fees: each });
      }
      continue;
    }
    const k = (g.qty - covered) / g.qty;
    pending.push({ ...g, qty: g.qty - covered, fees: round(g.fees * k, 2) });
  }
  pending.sort((a, b) => a.day.localeCompare(b.day) || (a.time || '').localeCompare(b.time || '') || (a.side === 'buy' ? -1 : 1));

  // Live position state while planning.
  const state = mine.map(t => ({ t, open: computeTrade(t).openSize, keys: tradeKeys(t) }));
  const findOpen = (key, vertical) => state.find(s => s.open > EPS && (vertical ? s.keys.length === 2 && s.keys.includes(key) : s.keys.length === 1 && s.keys[0] === key));
  const fillOf = (g, side, qty, price, fees) => ({ date: g.time ? `${g.day}T${g.time}` : g.day, side, qty: round(qty, 6), price: round(price), fees: round(fees, 2), source: 'tradier' });
  const addTo = (s, fill, note) => {
    const openSide = s.t.direction === 'short' ? 'sell' : 'buy';
    s.open += fill.side === openSide ? fill.qty : -fill.qty;
    if (s.t.id.startsWith('new-')) s.t.fills.push(fill);
    else plan.addFills.push({ tradeId: s.t.id, instrument: s.label, fill, note });
  };
  const create = (fields, fill) => {
    const t = { id: newId(), accountId, ...fields, tags: ['tradier-sync'], notes: 'Imported from Tradier', fills: [fill] };
    plan.newTrades.push(t);
    const s = { t, open: fill.qty, keys: tradeKeys(t), label: labelOf(t) };
    state.push(s);
    return s;
  };
  const labelOf = t => (t.assetType !== 'option' ? t.symbol : `${t.symbol} ${t.expiry} ${t.strike}${t.strike2 ? '/' + t.strike2 : ''}${t.optionType === 'put' ? 'P' : 'C'}`);
  for (const s of state) s.label = labelOf(s.t);

  // 1) Verticals: exactly two same-day legs, same underlying/expiry/type, opposite sides, equal size.
  const used = new Set();
  const byBucket = new Map();
  for (const g of pending) if (g.assetType === 'option' && g.kind === 'fill') {
    const b = `${g.day}|${g.symbol}|${g.expiry}|${g.optionType}`;
    byBucket.set(b, [...(byBucket.get(b) || []), g]);
  }
  for (const legs of byBucket.values()) {
    if (legs.length !== 2) continue;
    const [a, b] = legs;
    if (a.side === b.side || Math.abs(a.qty - b.qty) > EPS) continue;
    const buy = a.side === 'buy' ? a : b, sell = a.side === 'buy' ? b : a;
    const vert = findOpen(a.key, true);
    if (vert && vert.keys.includes(b.key)) {
      // Existing spread. k1 = long leg of a long spread / short leg of a short spread, and in every case
      // (open or close, debit or credit) the spread's price is k1's fill price minus k2's.
      const openSide = vert.t.direction === 'short' ? 'sell' : 'buy', k1 = vert.keys[0];
      const g1 = a.key === k1 ? a : b, g2 = g1 === a ? b : a;
      const opening = g1.side === openSide;
      const combo = g1.price - g2.price;
      if (combo < 0 || (!opening && a.qty > vert.open + EPS)) continue;
      addTo(vert, fillOf(a, opening ? openSide : flip(openSide), a.qty, combo, a.fees + b.fees), opening ? 'add to spread' : 'close spread');
      used.add(a).add(b);
      continue;
    }
    if (findOpen(a.key, false) || findOpen(b.key, false)) continue; // legs belong to open single-leg trades
    const net = buy.price - sell.price;
    if (Math.abs(net) < EPS) continue;
    const long = net > 0, k1 = long ? buy : sell, k2 = long ? sell : buy;
    create({ symbol: a.symbol, assetType: 'option', direction: long ? 'long' : 'short', optionType: a.optionType, expiry: a.expiry, strike: k1.strike, strike2: k2.strike },
      fillOf(a, long ? 'buy' : 'sell', a.qty, Math.abs(net), a.fees + b.fees));
    used.add(a).add(b);
  }

  // 2) Stocks and single options.
  for (const g of pending) {
    if (used.has(g)) continue;
    if (g.kind === 'close0') {
      const s = findOpen(g.key, false);
      const already = s && cov.get(`${g.day}|${g.key}|${s.t.direction === 'short' ? 'buy' : 'sell'}`);
      if (already && already.qty >= g.qty - EPS) { plan.skipped++; continue; }
      if (!s) { plan.review.push({ ...g, reason: findOpen(g.key, true) ? `Option ${g.what} but it's a leg of a spread: close the spread manually` : `Option ${g.what} with no open position in this account` }); continue; }
      const q = Math.min(g.qty, s.open);
      addTo(s, fillOf(g, s.t.direction === 'short' ? 'buy' : 'sell', q, 0, 0), `option ${g.what}`);
      continue;
    }
    if (findOpen(g.key, true)) { plan.review.push({ ...g, reason: 'Single leg of an open spread (legged in or out): apply manually' }); continue; }
    const s = findOpen(g.key, false);
    const fields = g.assetType === 'option'
      ? { symbol: g.symbol, assetType: 'option', optionType: g.optionType, expiry: g.expiry, strike: g.strike }
      : { symbol: g.symbol, assetType: 'stock' };
    if (!s) { create({ ...fields, direction: g.side === 'buy' ? 'long' : 'short' }, fillOf(g, g.side, g.qty, g.price, g.fees)); continue; }
    const openSide = s.t.direction === 'short' ? 'sell' : 'buy';
    if (g.side === openSide) { addTo(s, fillOf(g, g.side, g.qty, g.price, g.fees), 'add'); continue; }
    const closeQty = Math.min(g.qty, s.open);
    addTo(s, fillOf(g, g.side, closeQty, g.price, g.fees * (closeQty / g.qty)), closeQty < s.open ? 'scale out' : 'close');
    if (g.qty - closeQty > EPS) create({ ...fields, direction: g.side === 'buy' ? 'long' : 'short' }, fillOf(g, g.side, g.qty - closeQty, g.price, g.fees * (1 - closeQty / g.qty)));
  }
  for (const t of plan.newTrades) t.fills = sortFills(t.fills);
  return plan;
}

export const planCounts = p => ({
  newTrades: p.newTrades.length, fills: p.newTrades.reduce((s, t) => s + t.fills.length, 0) + p.addFills.length,
  feeUpdates: p.feeUpdates.length, review: p.review.length, alreadyInJournal: p.skipped,
});
