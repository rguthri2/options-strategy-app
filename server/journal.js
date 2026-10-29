// Trade journal storage + live marks. Stocks and options (single leg or vertical spread), long or short,
// with any number of fills per trade. The app never places orders: you log what you did in your broker.
import crypto from 'node:crypto';
import { readJson, writeJson } from './store.js';
import { market } from './providers/index.js';
import { occSymbol } from '../shared/strategy.js';
import { computeTrade, journalStats, describeInstrument, sortFills } from '../shared/journal.js';
import { tradierAccounts, tradierConfigured } from './providers/tradier.js';
import { fromHistory, fromOrders, planSync, planCounts } from './tradierSync.js';
import { nyDateStr, addDays } from '../shared/time.js';

const FILE = 'journal.json';
const load = () => readJson(FILE, []);
const save = list => writeJson(FILE, list);
const bad = msg => Object.assign(new Error(msg), { status: 400 });

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const SYM_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
const num = v => (v === '' || v === null || v === undefined ? null : Number(v));
const pos = (v, name) => { const n = num(v); if (!(n > 0) || n > 1e9) throw bad(`${name} must be a positive number`); return n; };
const optPos = v => { const n = num(v); return n > 0 && n < 1e9 ? n : null; };
const text = (v, max) => String(v ?? '').slice(0, max);

function cleanFill(f) {
  const date = text(f.date, 16);
  if (!DATE_RE.test(date)) throw bad('Fill date must be YYYY-MM-DD or YYYY-MM-DDTHH:MM');
  if (f.side !== 'buy' && f.side !== 'sell') throw bad('Fill side must be buy or sell');
  const price = num(f.price);
  if (price === null || !(price >= 0) || price > 1e7) throw bad('Fill price is required (0 or more)');
  const fees = num(f.fees) ?? 0;
  if (!(fees >= 0) || fees > 1e6) throw bad('Fees must be 0 or more');
  return { id: f.id && /^[\w-]{1,40}$/.test(f.id) ? f.id : crypto.randomUUID(), date, side: f.side, qty: pos(f.qty, 'Quantity'), price, fees, ...(f.source === 'tradier' ? { source: 'tradier' } : {}) };
}

function cleanTrade(b, prev = {}) {
  const t = { ...prev };
  if (b.symbol !== undefined) { t.symbol = text(b.symbol, 10).toUpperCase().trim(); if (!SYM_RE.test(t.symbol)) throw bad('Invalid symbol'); }
  if (b.assetType !== undefined) t.assetType = b.assetType === 'option' ? 'option' : 'stock';
  if (b.direction !== undefined) t.direction = b.direction === 'short' ? 'short' : 'long';
  if (t.assetType === 'option') {
    if (b.optionType !== undefined) t.optionType = b.optionType === 'put' ? 'put' : 'call';
    if (b.expiry !== undefined) { t.expiry = text(b.expiry, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(t.expiry)) throw bad('Expiration must be YYYY-MM-DD'); }
    if (b.strike !== undefined) t.strike = pos(b.strike, 'Strike');
    if (b.strike2 !== undefined) t.strike2 = optPos(b.strike2);
    if (!t.expiry || !t.strike) throw bad('Options need an expiration and a strike');
    if (t.strike2 === t.strike) t.strike2 = null;
  } else { delete t.optionType; delete t.expiry; delete t.strike; delete t.strike2; }
  for (const k of ['stop', 'target', 'riskAmount']) if (b[k] !== undefined) t[k] = optPos(b[k]);
  if (b.setup !== undefined) t.setup = text(b.setup, 60);
  if (b.strategy !== undefined) t.strategy = text(b.strategy, 60);
  if (b.tags !== undefined) t.tags = (Array.isArray(b.tags) ? b.tags : String(b.tags).split(',')).map(s => text(s, 30).trim()).filter(Boolean).slice(0, 12);
  if (b.notes !== undefined) t.notes = text(b.notes, 4000);
  if (b.lessons !== undefined) t.lessons = text(b.lessons, 2000);
  if (b.grade !== undefined) t.grade = ['A', 'B', 'C', 'D', 'F'].includes(b.grade) ? b.grade : '';
  if (b.followedPlan !== undefined) t.followedPlan = b.followedPlan === true ? true : b.followedPlan === false ? false : null;
  if (b.accountId !== undefined) {
    t.accountId = text(b.accountId, 40);
    if (t.accountId && !loadAccounts().some(a => a.id === t.accountId)) throw bad('Unknown account: add it under Accounts first');
  }
  if (!t.symbol) throw bad('Symbol required');
  return t;
}

// ---------- Brokerage accounts ----------
// Only what's needed to tell accounts apart: broker, account number (last 4 digits suggested) and a nickname.
const ACCT_FILE = 'journal-accounts.json';
const loadAccounts = () => readJson(ACCT_FILE, []);
const saveAccounts = list => writeJson(ACCT_FILE, list);
export const maskAccount = n => (n ? `••••${String(n).slice(-4)}` : '');
export const accountLabel = a => (a ? [a.broker, a.nickname, maskAccount(a.number)].filter(Boolean).join(' · ') : '');

function cleanAccount(b, prev = {}) {
  const a = { ...prev };
  if (b.broker !== undefined) a.broker = text(b.broker, 40).trim();
  if (b.number !== undefined) {
    a.number = text(b.number, 24).replace(/\s+/g, '');
    if (a.number && !/^[A-Za-z0-9-]{1,24}$/.test(a.number)) throw bad('Account number: letters, digits and dashes only');
  }
  if (b.nickname !== undefined) a.nickname = text(b.nickname, 40).trim();
  if (!a.broker) throw bad('Brokerage name required');
  return a;
}

export const listAccounts = () => loadAccounts().map(a => ({ id: a.id, broker: a.broker, nickname: a.nickname, masked: maskAccount(a.number), label: accountLabel(a),
  syncable: /tradier/i.test(a.broker), lastSync: a.lastSync || null, syncSince: a.syncSince || null }));

export function addAccount(b) {
  const list = loadAccounts();
  if (list.length >= 50) throw bad('Up to 50 accounts');
  const a = cleanAccount(b, { id: crypto.randomUUID(), broker: '', number: '', nickname: '' });
  list.push(a); saveAccounts(list);
  return listAccounts().find(x => x.id === a.id);
}

export function updateAccount(id, b) {
  const list = loadAccounts(), k = list.findIndex(a => a.id === id);
  if (k < 0) throw Object.assign(new Error('Account not found'), { status: 404 });
  list[k] = cleanAccount(b, list[k]); saveAccounts(list);
  return listAccounts().find(x => x.id === id);
}

export function deleteAccount(id) {
  const used = load().filter(t => t.accountId === id).length;
  if (used) throw bad(`${used} trade${used === 1 ? '' : 's'} use this account. Move them to another account first.`);
  saveAccounts(loadAccounts().filter(a => a.id !== id));
}

// Replay must never sell more than is open (or buy back more than was shorted).
function checkFills(t) {
  const open = t.direction === 'short' ? 'sell' : 'buy';
  let q = 0;
  for (const f of sortFills(t.fills)) {
    if (f.side === open) q += f.qty;
    else { if (f.qty > q + 1e-9) throw bad(`Fill on ${f.date} closes ${f.qty} but only ${q} ${q === 1 ? 'is' : 'are'} open`); q -= f.qty; }
  }
}

export function addTrade(body) {
  const t = cleanTrade(body, { id: crypto.randomUUID(), createdAt: Date.now(), assetType: 'stock', direction: 'long', tags: [], notes: '', fills: [] });
  t.fills = (body.fills || []).map(cleanFill);
  checkFills(t);
  const list = load(); list.unshift(t); save(list);
  return t;
}

export function updateTrade(id, body) {
  const list = load(), k = list.findIndex(x => x.id === id);
  if (k < 0) throw Object.assign(new Error('Trade not found'), { status: 404 });
  const t = cleanTrade(body, list[k]);
  if (body.fills) t.fills = body.fills.map(cleanFill);
  checkFills(t);
  list[k] = t; save(list);
  return t;
}

export function addFill(id, f) {
  const list = load(), t = list.find(x => x.id === id);
  if (!t) throw Object.assign(new Error('Trade not found'), { status: 404 });
  t.fills = [...t.fills, cleanFill(f)];
  checkFills(t);
  save(list);
  return t;
}

export function deleteFill(id, fid) {
  const list = load(), t = list.find(x => x.id === id);
  if (!t) throw Object.assign(new Error('Trade not found'), { status: 404 });
  t.fills = t.fills.filter(f => f.id !== fid);
  checkFills(t);
  save(list);
  return t;
}

export function deleteTrade(id) { save(load().filter(x => x.id !== id)); }

// ---------- Tradier sync (read-only on Tradier: history + today's orders -> journal fills) ----------
export async function syncTradier(accountId, { apply = false, since } = {}) {
  const accts = loadAccounts(), acct = accts.find(a => a.id === accountId);
  if (!acct) throw Object.assign(new Error('Account not found'), { status: 404 });
  if (!/tradier/i.test(acct.broker)) throw bad('Sync is available for Tradier accounts only');
  if (!tradierConfigured()) throw bad('TRADIER_API_KEY is not set on the server');
  const list = await tradierAccounts.list();
  const last4 = String(acct.number || '').slice(-4).toUpperCase();
  const matches = last4 ? list.filter(a => a.number.toUpperCase().endsWith(last4)) : list;
  if (!matches.length) throw bad(`No Tradier account ending in ${last4} on this API token`);
  if (matches.length > 1) throw bad('Several Tradier accounts match: enter the last 4 digits of the account number');
  const tradierNo = matches[0].number;

  const today = nyDateStr();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(since || '') ? since : acct.syncSince || addDays(today, -365);
  const [history, orders] = await Promise.all([tradierAccounts.history(tradierNo, start), tradierAccounts.orders(tradierNo)]);
  const h = fromHistory(history);
  // History is nightly: it covers past days, today's orders cover the current session.
  const execs = [...h.execs.filter(e => e.day >= start && e.day < today), ...fromOrders(orders, today)];
  const plan = planSync(load(), execs, { accountId, today });
  const out = {
    account: accountLabel(acct), tradierAccount: maskAccount(tradierNo), since: start, fetched: { history: history.length, orders: orders.length },
    counts: planCounts(plan), applied: false,
    preview: [
      ...plan.newTrades.map(t => ({ action: 'New trade', instrument: describeInstrument(t), direction: t.direction, fills: t.fills })),
      ...plan.addFills.map(a => ({ action: a.note, instrument: a.instrument, fills: [a.fill] })),
    ],
    review: [...plan.review.map(r => ({ reason: r.reason, detail: r.raws.join(' | ') })), ...h.rejected.map(r => ({ reason: r.reason, detail: r.raw }))],
    feeUpdates: plan.feeUpdates.length,
  };
  if (!apply) return out;

  const trades = load();
  for (const n of plan.newTrades) {
    const t = cleanTrade(n, { id: crypto.randomUUID(), createdAt: Date.now(), assetType: 'stock', direction: 'long', tags: [], notes: '', fills: [] });
    t.fills = n.fills.map(cleanFill);
    checkFills(t);
    trades.unshift(t);
  }
  for (const a of plan.addFills) {
    const t = trades.find(x => x.id === a.tradeId);
    if (!t) continue;
    t.fills = [...t.fills, cleanFill(a.fill)];
    checkFills(t);
  }
  for (const u of plan.feeUpdates) {
    const f = trades.find(x => x.id === u.tradeId)?.fills.find(x => x.id === u.fillId);
    if (f) f.fees = u.fees;
  }
  save(trades);
  const k = accts.findIndex(a => a.id === accountId);
  accts[k] = { ...accts[k], lastSync: Date.now(), syncSince: start };
  saveAccounts(accts);
  return { ...out, applied: true };
}

const legOccs = t => {
  if (t.assetType !== 'option') return [];
  const a = occSymbol(t.symbol, t.expiry, t.optionType, t.strike);
  return t.strike2 ? [a, occSymbol(t.symbol, t.expiry, t.optionType, t.strike2)] : [a];
};

// All trades with computed results (+ live marks for open ones) and the performance stats.
export async function journal() {
  const list = load();
  const accts = new Map(loadAccounts().map(a => [a.id, a]));
  const open = list.filter(t => computeTrade(t).status === 'open');
  const stocks = [...new Set(open.filter(t => t.assetType !== 'option').map(t => t.symbol))];
  const occs = [...new Set(open.flatMap(legOccs))];
  const [sq, oq] = await Promise.all([
    stocks.length ? market.quotes(stocks).catch(() => ({})) : {},
    occs.length ? market.optionQuotes(occs).catch(() => ({})) : {},
  ]);
  const items = list.map(t => {
    let mark = null;
    if (t.assetType === 'option') {
      const [a, b] = legOccs(t).map(o => oq[o]?.mark);
      mark = t.strike2 ? (Number.isFinite(a) && Number.isFinite(b) ? a - b : null) : a ?? null;
    } else mark = sq[t.symbol]?.last ?? null;
    const acct = accts.get(t.accountId);
    return { ...t, instrument: describeInstrument(t), broker: acct?.broker || '', account: acct ? accountLabel(acct) : '', ...computeTrade(t, mark) };
  });
  return { trades: items, stats: journalStats(items), accounts: listAccounts() };
}

// Text starting with = + - @ would run as a spreadsheet formula when opened in Excel: prefix it with '.
const csvCell = v => {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s))) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : '');

export async function journalCsv(accountId = '') {
  const trades = (await journal()).trades.filter(t => !accountId || (accountId === 'none' ? !t.accountId : t.accountId === accountId));
  const head = ['Broker', 'Account', 'Symbol', 'Instrument', 'Asset', 'Direction', 'Setup', 'Strategy', 'Status', 'Entry date', 'Exit date', 'Days', 'Entry size', 'Avg entry', 'Exit size', 'Avg exit',
    'Open size', 'Fees', 'Realized P/L', 'Unrealized P/L', 'P/L %', 'Risk $', 'R', 'Stop', 'Target', 'Grade', 'Followed plan', 'Tags', 'Notes', 'Lessons'];
  const rows = trades.map(t => [t.broker, t.account, t.symbol, t.instrument, t.assetType, t.direction, t.setup, t.strategy, t.status, t.entryDate, t.exitDate, t.days, t.entrySize, r2(t.avgEntry), t.exitSize, r2(t.avgExit),
    t.openSize, r2(t.fees), r2(t.realized), r2(t.unrealized), Number.isFinite(t.pnlPct) ? (t.pnlPct * 100).toFixed(2) : '', r2(t.risk), Number.isFinite(t.r) ? t.r.toFixed(2) : '',
    t.stop, t.target, t.grade, t.followedPlan === true ? 'yes' : t.followedPlan === false ? 'no' : '', (t.tags || []).join('; '), t.notes, t.lessons]);
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}
