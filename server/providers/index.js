// Provider selection + caching facade. Everything else talks to `market`.
import { config } from '../config.js';
import { demoProvider } from './demo.js';
import { schwabProvider, schwabConnected, schwabConfigured } from './schwab.js';
import { etradeProvider, etradeConnected, etradeConfigured } from './etrade.js';
import { tradierProvider, tradierConfigured } from './tradier.js';
import { historyStatus } from '../history.js';
import { readJson, writeJson } from '../store.js';
import { nyDateStr, expiryMs, valuationTime } from '../../shared/time.js';
import { enrichExpiration } from '../../shared/pricing.js';
import { rateFor } from '../rates.js';
import { barsFor, storedBars, withLiveBar } from '../bars.js';
import { toWeekly, toMonthly, toMinutes, INTERVALS } from '../../shared/bars.js';

export function activeProvider() {
  if (config.provider === 'demo') return demoProvider;
  if (config.provider === 'schwab') return schwabProvider;
  if (config.provider === 'etrade') return etradeProvider;
  if (config.provider === 'tradier') return tradierProvider;
  if (schwabConfigured() && schwabConnected()) return schwabProvider;
  if (tradierConfigured()) return tradierProvider; // token-based, no daily login

  if (etradeConfigured() && etradeConnected()) return etradeProvider;
  return demoProvider;
}

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const p = activeProvider().name;
  const k = `${p}|${key}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  if (hit?.pending) return hit.pending;
  const pending = fn().then(v => { cache.set(k, { t: Date.now(), v }); return v; })
    .catch(e => { cache.delete(k); throw e; });
  cache.set(k, { ...(hit || { t: 0 }), pending });
  return pending;
}

setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [k, v] of cache) if (v.t < cutoff && !v.pending) cache.delete(k);
}, 600000).unref();

export const market = {
  status() {
    const p = activeProvider();
    return {
      ...p.status(), mode: config.provider, schwabConfigured: schwabConfigured(), schwabConnected: schwabConnected(),
      etrade: { configured: etradeConfigured(), connected: etradeConnected(), ...etradeProvider.status() },
      tradier: { configured: tradierConfigured(), ...tradierProvider.status() },
      history: historyStatus(),
    };
  },

  async quotes(symbols) {
    const uniq = [...new Set(symbols.map(s => s.toUpperCase()))].sort();
    return cached(`q|${uniq.join(',')}`, 5000, () => activeProvider().getQuotes(uniq));
  },

  async quote(symbol) {
    const q = await market.quotes([symbol]);
    const v = q[symbol.toUpperCase()];
    if (!v) throw Object.assign(new Error(`Unknown symbol ${symbol}`), { status: 404 });
    return v;
  },

  history(symbol, range) {
    const ttl = range === '1D' || range === '5D' ? 30000 : 300000;
    return cached(`h|${symbol}|${range}`, ttl, () => activeProvider().getHistory(symbol, range));
  },

  // ~2 years of daily bars (bar store, updated after each close) with today's live bar patched in.
  async daily(symbol) {
    const p = activeProvider();
    return cached(`d|${symbol}`, 120000, async () => {
      if (p.name === 'demo') return p.getDailyHistory(symbol);
      const bars = p.name === 'etrade' ? await p.getDailyHistory(symbol) : await barsFor(symbol);
      const q = (await market.quotes([symbol]))[symbol];
      return withLiveBar(bars, q, q?.session);
    });
  },

  // Bulk variant for the scanner: stored bars + one batched quote request per 400 symbols.
  // Symbols without stored bars yet are skipped (the nightly bar update fills them in).
  async dailyBulk(symbols) {
    const p = activeProvider();
    const out = {};
    if (p.name === 'demo' || p.name === 'etrade') {
      for (const s of symbols) { try { out[s] = await market.daily(s); } catch { /* skip */ } }
      return out;
    }
    const quotes = await market.quotes(symbols).catch(() => ({}));
    for (const s of symbols) {
      const st = storedBars(s);
      if (st?.bars?.length) out[s] = withLiveBar(st.bars, quotes[s], quotes[s]?.session);
    }
    return out;
  },
  // Chart bars for any interval: 1m/5m/15m (provider intraday), 1h (from 15m), D (bar store + live bar), W/M (from 5y daily).
  async bars(symbol, interval) {
    const p = activeProvider();
    if (interval === 'D') return market.daily(symbol);
    if (interval === 'W' || interval === 'M') {
      return cached(`b|${symbol}|${interval}`, 120000, async () => {
        const [long, recent] = await Promise.all([market.dailyLong(symbol).catch(() => []), market.daily(symbol)]);
        // Long history for depth, recent (live) bars win where they overlap.
        const cut = recent[0]?.t ?? Infinity;
        const daily = [...long.filter(b => b.t < cut), ...recent];
        return interval === 'W' ? toWeekly(daily) : toMonthly(daily);
      });
    }
    const minutes = INTERVALS[interval]?.minutes;
    if (!minutes) throw Object.assign(new Error('Unknown interval'), { status: 400 });
    if (typeof p.getIntraday !== 'function') throw Object.assign(new Error(`Intraday charts need the Tradier data feed (current: ${p.name})`), { status: 400 });
    const base = minutes === 60 ? 15 : minutes;
    return cached(`b|${symbol}|${interval}`, minutes === 1 ? 20000 : 60000, async () => {
      const raw = await p.getIntraday(symbol, base);
      return minutes === 60 ? toMinutes(raw, 60) : raw;
    });
  },

  // Up to ~5 years of daily bars for backtests (demo: from 2023; E*TRADE/Tiingo: stored 5y).
  dailyLong(symbol) {
    return cached(`dl|${symbol}`, 3600000, () => activeProvider().getDailyHistory(symbol, 5));
  },

  expirations(symbol) {
    return cached(`e|${symbol}`, 600000, () => activeProvider().getExpirations(symbol));
  },

  chain(symbol, opts = {}) {
    const key = `c|${symbol}|${opts.fromDate || ''}|${opts.toDate || ''}|${opts.strikeCount || ''}`;
    return cached(key, 15000, async () => {
      const p = activeProvider();
      const ch = await p.getChain(symbol, opts);
      // Live chains get the house model: implied forward, term-matched Treasury rate, American
      // pricing where it matters, Greeks from the live mid. (Demo chains are generated by the model.)
      if (p.name !== 'demo') {
        const now = valuationTime();
        for (const e of ch.expirations) {
          const T = Math.max((expiryMs(e.date) - now) / (365 * 864e5), 0.5 / 365);
          enrichExpiration(e, ch.spot, rateFor(T), now);
        }
        ch.rate = rateFor(30 / 365);
      }
      return ch;
    });
  },

  optionQuotes(occs) {
    const uniq = [...new Set(occs)].sort();
    return cached(`oq|${uniq.join(',')}`, 5000, () => activeProvider().getOptionQuotes(uniq));
  },

  search(q) {
    return cached(`s|${q}`, 3600000, () => activeProvider().search(q));
  },
};

// Daily ATM-IV snapshots, used to build a true IV Rank over time.
export function recordIv(symbol, iv) {
  if (!(iv > 0)) return;
  const file = `ivhistory/${symbol.replace(/[^A-Z0-9$.]/gi, '_')}.json`;
  const h = readJson(file, {});
  h[nyDateStr()] = +iv.toFixed(4);
  const keys = Object.keys(h).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete h[k];
  writeJson(file, h);
}

export function ivHistory(symbol) {
  return readJson(`ivhistory/${symbol.replace(/[^A-Z0-9$.]/gi, '_')}.json`, {});
}
