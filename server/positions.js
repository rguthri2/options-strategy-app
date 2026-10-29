// Tracked (paper) positions with live marks and rule-based management alerts.
// The app never places orders; you execute in thinkorswim / Schwab and log the trade here.
import crypto from 'node:crypto';
import { netCost, MULT, describeLegs } from '../shared/strategy.js';
import { daysToExpiry } from '../shared/time.js';
import { readJson, writeJson } from './store.js';
import { market } from './providers/index.js';
import { getSettings } from './settings.js';
import { earningsBefore } from './earnings.js';

const FILE = 'positions.json';
const load = () => readJson(FILE, []);
const save = list => writeJson(FILE, list);

const cleanLeg = l => ({
  type: l.type === 'stock' ? 'stock' : l.type === 'put' ? 'put' : 'call',
  qty: Math.trunc(Number(l.qty)) || 0,
  strike: l.type === 'stock' ? undefined : Number(l.strike),
  expiry: l.type === 'stock' ? undefined : String(l.expiry).slice(0, 10),
  price: Number(l.price) || 0,
  iv: Number(l.iv) || undefined,
  occ: l.occ ? String(l.occ).slice(0, 32) : undefined,
  q: Number.isFinite(Number(l.q)) && l.q !== null && l.q !== '' ? Math.max(-0.2, Math.min(0.15, Number(l.q))) : undefined,
  r: Number.isFinite(Number(l.r)) && l.r !== null && l.r !== '' ? Math.max(0, Math.min(0.2, Number(l.r))) : undefined,
});

export function listPositions() { return load(); }

export function addPosition(body) {
  const legs = (body.legs || []).map(cleanLeg).filter(l => l.qty !== 0);
  if (!body.symbol || !legs.length) throw Object.assign(new Error('symbol and legs required'), { status: 400 });
  const pos = {
    id: crypto.randomUUID(), symbol: String(body.symbol).toUpperCase().slice(0, 10),
    label: String(body.label || 'Custom').slice(0, 60), key: body.key || 'custom',
    legs, openedAt: Date.now(), entrySpot: Number(body.spot) || null,
    maxProfit: Number.isFinite(body.maxProfit) ? body.maxProfit : null,
    maxLoss: Number.isFinite(body.maxLoss) ? body.maxLoss : null,
    notes: String(body.notes || '').slice(0, 2000), status: 'open',
  };
  const list = load(); list.unshift(pos); save(list);
  return pos;
}

export function updatePosition(id, patch) {
  const list = load();
  const p = list.find(x => x.id === id);
  if (!p) throw Object.assign(new Error('Not found'), { status: 404 });
  if (patch.notes !== undefined) p.notes = String(patch.notes).slice(0, 2000);
  if (patch.legs) p.legs = patch.legs.map(cleanLeg);
  if (patch.status === 'closed' && p.status !== 'closed') {
    p.status = 'closed'; p.closedAt = Date.now();
    p.closePnl = Number(patch.closePnl);
  }
  save(list);
  return p;
}

export function deletePosition(id) {
  save(load().filter(x => x.id !== id));
}

export async function evaluatePositions() {
  const list = load();
  const open = list.filter(p => p.status === 'open');
  const occs = open.flatMap(p => p.legs.filter(l => l.occ).map(l => l.occ));
  const syms = [...new Set(open.map(p => p.symbol))];
  const [oq, sq] = await Promise.all([
    occs.length ? market.optionQuotes(occs).catch(() => ({})) : {},
    syms.length ? market.quotes(syms).catch(() => ({})) : {},
  ]);
  const rules = getSettings().rules;
  return list.map(p => {
    if (p.status !== 'open') return { ...p, description: describeLegs(p.legs) };
    const spot = sq[p.symbol]?.last;
    let value = 0, missing = false;
    const legs = p.legs.map(l => {
      const q = l.type === 'stock' ? null : oq[l.occ];
      const mark = l.type === 'stock' ? spot : q?.mark;
      if (!Number.isFinite(mark)) missing = true;
      value += l.qty * (l.type === 'stock' ? 1 : MULT) * (mark || 0);
      return { ...l, mark, delta: q?.delta, theta: q?.theta, iv: q?.iv ?? l.iv };
    });
    const cost = netCost(p.legs);
    const pnl = value - cost;
    const optLegs = p.legs.filter(l => l.type !== 'stock');
    const dte = optLegs.length ? Math.min(...optLegs.map(l => daysToExpiry(l.expiry))) : null;
    const isCredit = cost < 0;
    const alerts = [];
    // P/L % convention: return on the debit paid, or share of the credit received.
    const ref = isCredit ? -cost : cost;
    if (!missing) {
      if (isCredit) {
        if (pnl >= (rules.profitTakePct / 100) * -cost) alerts.push({ level: 'good', text: `Take profit: ${Math.round((pnl / -cost) * 100)}% of max captured` });
        if (pnl <= 2 * cost) alerts.push({ level: 'bad', text: 'Stop: loss ≥ 2× credit received' });
      } else {
        if (Number.isFinite(p.maxProfit) && p.maxProfit > 0 && pnl >= 0.5 * p.maxProfit) alerts.push({ level: 'good', text: `Take profit: ${Math.round((pnl / p.maxProfit) * 100)}% of max profit` });
        else if (!Number.isFinite(p.maxProfit) && pnl >= cost) alerts.push({ level: 'good', text: 'Up 100% on debit: consider scaling out' });
        if (pnl <= -0.5 * cost) alerts.push({ level: 'bad', text: 'Stop: lost ≥ 50% of debit' });
      }
      if (dte !== null && dte <= rules.manageDte && isCredit) alerts.push({ level: 'warn', text: `${dte} DTE: manage or roll (≤ ${rules.manageDte})` });
      if (dte !== null && dte <= 30 && !isCredit && optLegs.every(l => l.qty > 0)) alerts.push({ level: 'warn', text: `${dte} DTE: theta accelerating — roll or exit` });
      const lastExp = optLegs.map(l => l.expiry).sort().at(-1);
      const er = earningsBefore(p.symbol, lastExp);
      if (er && er.days <= 7) alerts.push({ level: 'warn', text: `Earnings ${er.days === 0 ? 'today' : `in ${er.days}d`} (${er.date}${er.hour ? ' ' + er.hour : ''}) — hold or close?` });
      for (const l of optLegs.filter(x => x.qty < 0)) {
        if (Number.isFinite(spot) && (l.type === 'put' ? spot <= l.strike : spot >= l.strike)) alerts.push({ level: 'bad', text: `Short ${l.strike}${l.type === 'call' ? 'C' : 'P'} is being tested` });
      }
    }
    return {
      ...p, legs, description: describeLegs(p.legs), spot, value, cost, pnl: missing ? null : pnl,
      pnlPct: missing || !ref ? null : pnl / Math.abs(ref), dte, alerts,
    };
  });
}
