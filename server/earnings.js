// Earnings calendar. Schwab's API has none, so dates come from Finnhub (free key) when configured.
// In demo mode a deterministic simulated calendar keeps the earnings warnings visible end to end.
import { config } from './config.js';
import { readJson, writeJson } from './store.js';
import { getSettings } from './settings.js';
import { nyDateStr, addDays } from '../shared/time.js';
import { activeProvider } from './providers/index.js';
import { scanSymbols } from './universeAuto.js';

const FILE = 'earnings.json';
const ETFS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'TLT', 'GLD', 'SLV', 'XLF', 'XLE', 'XLK', 'SMH', 'ARKK', 'EEM', 'HYG', 'USO']);
let cache = readJson(FILE, { updated: 0, source: null, bySymbol: {} });
let running = null;

export function earningsSource() {
  if (config.finnhubKey) return 'finnhub';
  return activeProvider().name === 'demo' ? 'demo' : 'none';
}

function demoCalendar(symbols) {
  const today = nyDateStr();
  const out = {};
  for (const s of symbols) {
    if (ETFS.has(s) || s.startsWith('$')) continue;
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    let d = addDays(today, 2 + (h % 88));
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    if (dow === 0) d = addDays(d, 1); else if (dow === 6) d = addDays(d, 2);
    out[s] = { date: d, hour: h % 2 ? 'amc' : 'bmo' };
  }
  return out;
}

async function finnhubFor(symbol, from, to) {
  const u = new URL('https://finnhub.io/api/v1/calendar/earnings');
  u.searchParams.set('from', from); u.searchParams.set('to', to); u.searchParams.set('symbol', symbol);
  u.searchParams.set('token', config.finnhubKey);
  const res = await fetch(u);
  if (res.status === 429) { await new Promise(r => setTimeout(r, 5000)); return finnhubFor(symbol, from, to); }
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  const data = await res.json();
  const next = (data.earningsCalendar || []).filter(e => e.date >= from).sort((a, b) => a.date.localeCompare(b.date))[0];
  return next ? { date: next.date, hour: next.hour || '', epsEstimate: next.epsEstimate ?? null } : null;
}

export function refreshEarnings(extraSymbols = [], force = false) {
  const src = earningsSource();
  if (!force && cache.source === src && Date.now() - cache.updated < 12 * 3600000) return Promise.resolve(cache);
  running ??= (async () => {
    const s = getSettings();
    const symbols = [...new Set([...scanSymbols(), ...s.universe, ...s.watchlist, ...extraSymbols])].filter(x => !x.startsWith('$'));
    let bySymbol = {};
    if (src === 'demo') bySymbol = demoCalendar(symbols);
    else if (src === 'finnhub') {
      // Whole-market calendar in weekly windows (~13 calls for 90 days) instead of one call per symbol.
      const wanted = new Set(symbols);
      const start = nyDateStr();
      for (let d = 0; d < 91; d += 7) {
        const from = addDays(start, d), to = addDays(start, d + 6);
        try {
          const u = new URL('https://finnhub.io/api/v1/calendar/earnings');
          u.searchParams.set('from', from); u.searchParams.set('to', to); u.searchParams.set('token', config.finnhubKey);
          const res = await fetch(u);
          if (res.status === 429) { await new Promise(r => setTimeout(r, 5000)); d -= 7; continue; }
          if (!res.ok) throw new Error(`Finnhub ${res.status}`);
          for (const e of (await res.json()).earningsCalendar || []) {
            if (!wanted.has(e.symbol) || ETFS.has(e.symbol)) continue;
            const cur = bySymbol[e.symbol];
            if (!cur || e.date < cur.date) bySymbol[e.symbol] = { date: e.date, hour: e.hour || '', epsEstimate: e.epsEstimate ?? null };
          }
        } catch (e) { console.error('[earnings]', from, e.message); }
        await new Promise(r => setTimeout(r, 1100));
      }
    }
    cache = { updated: Date.now(), source: src, bySymbol };
    writeJson(FILE, cache);
    return cache;
  })().finally(() => { running = null; });
  return running;
}

// Next earnings for a symbol (today or later), with calendar days until it.
export function nextEarnings(symbol) {
  if (cache.source !== earningsSource()) return null;
  const e = cache.bySymbol[symbol];
  const today = nyDateStr();
  if (!e || e.date < today) return null;
  const days = Math.round((Date.parse(e.date) - Date.parse(today)) / 86400000);
  return { ...e, days, source: cache.source };
}

// True when the report lands while an option expiring on `expiry` is still alive.
export function earningsBefore(symbol, expiry) {
  const e = nextEarnings(symbol);
  if (!e || !expiry) return null;
  return e.date < expiry || (e.date === expiry && e.hour === 'bmo') ? e : null;
}

// Past report dates (last ~3 years) from Finnhub, cached per symbol for a week. Null without Finnhub.
export async function pastEarnings(symbol) {
  if (!config.finnhubKey) return null;
  const file = `earnings-past/${symbol.replace(/[^A-Z0-9.-]/gi, '_')}.json`;
  const hit = readJson(file, null);
  if (hit && Date.now() - hit.t < 7 * 86400000) return hit.list;
  const u = new URL('https://finnhub.io/api/v1/calendar/earnings');
  u.searchParams.set('from', addDays(nyDateStr(), -3 * 365)); u.searchParams.set('to', addDays(nyDateStr(), -1));
  u.searchParams.set('symbol', symbol); u.searchParams.set('token', config.finnhubKey);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  const data = await res.json();
  const list = (data.earningsCalendar || []).map(e => ({ date: e.date, hour: e.hour || '' })).sort((a, b) => a.date.localeCompare(b.date));
  writeJson(file, { t: Date.now(), list });
  return list;
}

export const earningsState = () => ({ updated: cache.updated, source: cache.source, count: Object.keys(cache.bySymbol).length, configured: Boolean(config.finnhubKey) });
