// Price / indicator alerts. Rules persist in alerts.json and are checked every minute against live quotes
// (and daily RSI for indicator rules). A triggered rule fires once, then is marked so it is not repeated.
import { readJson, writeJson } from './store.js';
import { market } from './providers/index.js';
import { sendTelegram, telegramStatus } from './notify.js';
import { rsi } from '../shared/indicators.js';

const FILE = 'alerts.json';
const KINDS = { price_above: 'Price above', price_below: 'Price below', rsi_above: 'RSI(14) above', rsi_below: 'RSI(14) below' };
const bad = m => Object.assign(new Error(m), { status: 400 });

export const listAlerts = () => readJson(FILE, []);

export function addAlert(body) {
  const symbol = String(body?.symbol || '').toUpperCase();
  const kind = body?.kind, value = Number(body?.value);
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) throw bad('Bad symbol');
  if (!KINDS[kind]) throw bad('Unknown alert type');
  if (!Number.isFinite(value) || value <= 0 || value > 1e7) throw bad('Bad value');
  const list = listAlerts();
  if (list.length >= 100) throw bad('Up to 100 alerts');
  const a = { id: Math.random().toString(36).slice(2, 10), symbol, kind, value, created: Date.now(), triggered: null };
  writeJson(FILE, [...list, a]);
  return a;
}

export function deleteAlert(id) {
  writeJson(FILE, listAlerts().filter(a => a.id !== id));
  return { ok: true };
}

export async function checkAlerts() {
  const list = listAlerts().filter(a => !a.triggered);
  if (!list.length) return;
  const symbols = [...new Set(list.map(a => a.symbol))];
  const quotes = await market.quotes(symbols).catch(() => ({}));
  const rsis = {};
  const fired = [];
  for (const a of list) {
    let cur = null;
    if (a.kind.startsWith('price')) cur = quotes[a.symbol]?.last;
    else {
      if (!(a.symbol in rsis)) rsis[a.symbol] = await market.daily(a.symbol).then(b => rsi(b.map(x => x.c), 14).at(-1)).catch(() => null);
      cur = rsis[a.symbol];
    }
    if (!Number.isFinite(cur)) continue;
    if (a.kind.endsWith('above') ? cur >= a.value : cur <= a.value) fired.push({ a, cur });
  }
  if (!fired.length) return;
  const all = listAlerts();
  for (const { a, cur } of fired) {
    const m = all.find(x => x.id === a.id);
    if (m) m.triggered = { at: Date.now(), value: cur };
    if (telegramStatus().ready) await sendTelegram(`🔔 <b>${a.symbol}</b>: ${KINDS[a.kind]} ${a.value} (now ${cur.toFixed(2)})`).catch(() => {});
  }
  writeJson(FILE, all);
}

export const alertKinds = KINDS;
