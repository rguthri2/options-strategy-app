// Charles Schwab Trader API (market data) provider.
// Docs: https://developer.schwab.com  (Market Data Production product)
// OAuth: 3-legged authorization code flow. Access token lives 30 min (auto-refreshed);
// refresh token lives 7 days, after which you must re-connect from Settings.
import crypto from 'node:crypto';
import { greeks, impliedVol } from '../../shared/bs.js';
import { nyDateStr, marketSession, expiryMs, daysToExpiry } from '../../shared/time.js';
import { config } from '../config.js';
import { readJson, writeJson } from '../store.js';
import { nameOf } from '../universe.js';

const API = 'https://api.schwabapi.com';
const TOKENS = 'schwab-tokens.json';
const REFRESH_LIFETIME_MS = 7 * 24 * 3600 * 1000;

let tokens = readJson(TOKENS, null);
let refreshing = null;
const pendingStates = new Map();

// ---------- rate limiting (Schwab: 120 req/min) ----------
const window = [];
const queue = [];
let draining = false;
function limit() {
  return new Promise(resolve => { queue.push(resolve); drain(); });
}
async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const now = Date.now();
    while (window.length && now - window[0] > 60000) window.shift();
    if (window.length >= 110) { await new Promise(r => setTimeout(r, 60000 - (now - window[0]) + 20)); continue; }
    window.push(now);
    queue.shift()();
  }
  draining = false;
}

// ---------- OAuth ----------
const basicAuth = () => 'Basic ' + Buffer.from(`${config.schwab.clientId}:${config.schwab.clientSecret}`).toString('base64');
export const schwabConfigured = () => Boolean(config.schwab.clientId && config.schwab.clientSecret && config.schwab.callbackUrl);

export function authorizeUrl() {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now());
  const u = new URL(`${API}/v1/oauth/authorize`);
  u.searchParams.set('client_id', config.schwab.clientId);
  u.searchParams.set('redirect_uri', config.schwab.callbackUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  return u.toString();
}

export function checkState(state) {
  // Pasted redirect URLs from the manual flow may not carry our state; accept those only when absent.
  if (!state) return true;
  const t = pendingStates.get(state);
  pendingStates.delete(state);
  return Boolean(t && Date.now() - t < 15 * 60000);
}

async function tokenRequest(body) {
  const res = await fetch(`${API}/v1/oauth/token`, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Schwab token error ${res.status}: ${data.error_description || data.error || res.statusText}`);
  return data;
}

export async function exchangeCode(code) {
  const d = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.schwab.callbackUrl });
  const now = Date.now();
  tokens = {
    access_token: d.access_token, refresh_token: d.refresh_token,
    access_expires_at: now + (d.expires_in || 1800) * 1000,
    refresh_expires_at: now + REFRESH_LIFETIME_MS, issued_at: now,
  };
  writeJson(TOKENS, tokens);
}

async function refreshAccess() {
  if (!tokens?.refresh_token) throw new Error('Schwab not connected');
  const d = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  tokens = {
    ...tokens,
    access_token: d.access_token,
    refresh_token: d.refresh_token || tokens.refresh_token,
    access_expires_at: Date.now() + (d.expires_in || 1800) * 1000,
  };
  writeJson(TOKENS, tokens);
}

async function accessToken() {
  if (!tokens?.access_token) throw new Error('Schwab not connected');
  if (Date.now() > tokens.access_expires_at - 60000) {
    refreshing ??= refreshAccess().finally(() => { refreshing = null; });
    await refreshing;
  }
  return tokens.access_token;
}

export function disconnect() {
  tokens = null;
  writeJson(TOKENS, null);
}

export const schwabConnected = () => Boolean(tokens?.refresh_token && Date.now() < tokens.refresh_expires_at);

async function get(path, params = {}, retry = true) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  await limit();
  const res = await fetch(u, { headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' } });
  if (res.status === 401 && retry) {
    tokens.access_expires_at = 0;
    return get(path, params, false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Schwab ${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ---------- normalization ----------
const num = v => (typeof v === 'number' && Number.isFinite(v) && v > -999 ? v : NaN);

function normQuote(sym, d) {
  const q = d.quote || {}, f = d.fundamental || {}, ref = d.reference || {};
  const last = num(q.lastPrice) || num(q.mark) || num(q.closePrice);
  return {
    symbol: sym, name: ref.description || nameOf(sym), last,
    change: num(q.netChange), changePct: num(q.netPercentChange) / 100,
    open: num(q.openPrice), high: num(q.highPrice), low: num(q.lowPrice), prevClose: num(q.closePrice),
    bid: num(q.bidPrice), ask: num(q.askPrice), volume: num(q.totalVolume),
    avgVolume: num(f.avg10DaysVolume) || num(f.avg1YearVolume),
    high52: num(q['52WeekHigh']), low52: num(q['52WeekLow']),
    pe: num(f.peRatio), divYield: num(f.divYield),
    session: marketSession(), time: q.tradeTime || q.quoteTime || Date.now(), delayed: d.realtime === false,
  };
}

function normContract(c, type, S, expiry, expType, r) {
  const strike = num(c.strikePrice);
  const bid = num(c.bid ?? c.bidPrice) || 0, ask = num(c.ask ?? c.askPrice) || 0;
  const mark = num(c.mark) || (bid + ask) / 2;
  const T = Math.max((expiryMs(expiry) - Date.now()) / (365 * 86400000), 0.5 / 365);
  let iv = num(c.volatility) / 100;
  if (!(iv > 0.005 && iv < 8)) iv = impliedVol(type, mark, S, strike, T, r);
  let g = { delta: num(c.delta), gamma: num(c.gamma), theta: num(c.theta), vega: num(c.vega), rho: num(c.rho) };
  if (!Number.isFinite(g.delta) && iv > 0) g = greeks(type, S, strike, T, iv, r);
  return {
    occ: c.symbol, type, strike, expiry, expType,
    bid, ask, mark: +mark.toFixed(3), last: num(c.last ?? c.lastPrice) || 0,
    volume: num(c.totalVolume) || 0, oi: num(c.openInterest) || 0, iv: iv || NaN,
    delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega, rho: g.rho,
    theo: num(c.theoreticalOptionValue), itm: type === 'call' ? S > strike : S < strike,
  };
}

const expTypeOf = t => (t === 'W' ? 'W' : t === 'Q' ? 'Q' : 'M');

function normChain(raw) {
  const S = num(raw.underlyingPrice) || num(raw.underlying?.last) || num(raw.underlying?.mark);
  let r = num(raw.interestRate);
  r = Number.isFinite(r) ? (r > 0.5 ? r / 100 : r) : config.riskFreeRate;
  const exps = new Map();
  for (const [mapName, type] of [['callExpDateMap', 'call'], ['putExpDateMap', 'put']]) {
    for (const [expKey, strikes] of Object.entries(raw[mapName] || {})) {
      const date = expKey.split(':')[0];
      for (const [, arr] of Object.entries(strikes)) {
        const c = arr[0];
        let e = exps.get(date);
        if (!e) { e = { date, dte: daysToExpiry(date), type: expTypeOf(c.expirationType), rows: new Map() }; exps.set(date, e); }
        const k = num(c.strikePrice);
        let row = e.rows.get(k);
        if (!row) { row = { strike: k, call: null, put: null }; e.rows.set(k, row); }
        row[type] = normContract(c, type, S, date, e.type, r);
      }
    }
  }
  const expirations = [...exps.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({ ...e, rows: [...e.rows.values()].sort((a, b) => a.strike - b.strike) }));
  return { symbol: raw.symbol, spot: S, rate: r, expirations, time: Date.now() };
}

function normCandles(c, intraday) {
  return (c || []).map(b => ({
    t: intraday ? b.datetime / 1000 : Date.parse(nyDateStr(new Date(b.datetime + 6 * 3600000)) + 'T00:00:00Z') / 1000,
    o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume,
  }));
}

const HISTORY = {
  '1D': { periodType: 'day', period: 1, frequencyType: 'minute', frequency: 5 },
  '5D': { periodType: 'day', period: 5, frequencyType: 'minute', frequency: 15 },
  '1M': { periodType: 'month', period: 1, frequencyType: 'daily', frequency: 1 },
  '6M': { periodType: 'month', period: 6, frequencyType: 'daily', frequency: 1 },
  YTD: { periodType: 'ytd', period: 1, frequencyType: 'daily', frequency: 1 },
  '1Y': { periodType: 'year', period: 1, frequencyType: 'daily', frequency: 1 },
  '5Y': { periodType: 'year', period: 5, frequencyType: 'weekly', frequency: 1 },
  MAX: { periodType: 'year', period: 20, frequencyType: 'monthly', frequency: 1 },
};

// ---------- provider API ----------
export const schwabProvider = {
  name: 'schwab',

  status() {
    return {
      provider: 'schwab', connected: schwabConnected(), realtime: true,
      refreshExpiresAt: tokens?.refresh_expires_at || null,
      accessExpiresAt: tokens?.access_expires_at || null,
    };
  },

  async getQuotes(symbols) {
    const out = {};
    for (let i = 0; i < symbols.length; i += 150) {
      const chunk = symbols.slice(i, i + 150);
      const data = await get('/marketdata/v1/quotes', { symbols: chunk.join(','), fields: 'quote,fundamental,reference', indicative: false });
      for (const [sym, d] of Object.entries(data)) if (d?.quote) out[sym] = normQuote(sym, d);
    }
    return out;
  },

  async getHistory(sym, range = '6M') {
    const p = HISTORY[range] || HISTORY['6M'];
    const intraday = p.frequencyType === 'minute';
    let data = await get('/marketdata/v1/pricehistory', { symbol: sym, ...p, needExtendedHoursData: false });
    if (range === '1D' && (!data.candles || !data.candles.length)) {
      data = await get('/marketdata/v1/pricehistory', { symbol: sym, ...p, period: 2, needExtendedHoursData: false });
    }
    let candles = normCandles(data.candles, intraday);
    if (range === '1D' && candles.length) {
      const lastDay = nyDateStr(new Date(candles.at(-1).t * 1000));
      candles = candles.filter(c => nyDateStr(new Date(c.t * 1000)) === lastDay);
    }
    return candles;
  },

  async getDailyHistory(sym, years = 2) {
    const data = await get('/marketdata/v1/pricehistory', {
      symbol: sym, periodType: 'year', period: years, frequencyType: 'daily', frequency: 1, needExtendedHoursData: false,
    });
    return normCandles(data.candles, false);
  },

  async getExpirations(sym) {
    const data = await get('/marketdata/v1/expirationchain', { symbol: sym });
    return (data.expirationList || [])
      .map(e => ({ date: e.expirationDate, dte: daysToExpiry(e.expirationDate), type: expTypeOf(e.expirationType) }))
      .filter(e => e.dte >= 0);
  },

  async getChain(sym, { fromDate, toDate, strikeCount = 40 } = {}) {
    const raw = await get('/marketdata/v1/chains', {
      symbol: sym, contractType: 'ALL', strikeCount, includeUnderlyingQuote: true,
      strategy: 'SINGLE', range: 'ALL', fromDate, toDate,
    });
    if (raw.status && raw.status !== 'SUCCESS') throw new Error(`No option chain for ${sym}`);
    return normChain(raw);
  },

  async getOptionQuotes(occs) {
    const out = {};
    for (let i = 0; i < occs.length; i += 100) {
      const chunk = occs.slice(i, i + 100);
      const data = await get('/marketdata/v1/quotes', { symbols: chunk.join(','), fields: 'quote,reference' });
      for (const [occ, d] of Object.entries(data)) {
        const q = d.quote || {}, ref = d.reference || {};
        const type = (ref.contractType || occ.charAt(12)) === 'C' ? 'call' : 'put';
        const m = occ.match(/(\d{2})(\d{2})(\d{2})[CP](\d{8})$/);
        const expiry = m ? `20${m[1]}-${m[2]}-${m[3]}` : '';
        const S = num(q.underlyingPrice);
        out[occ] = {
          ...normContract({ ...q, symbol: occ, strikePrice: m ? Number(m[4]) / 1000 : num(ref.strikePrice) }, type, S, expiry, 'M', config.riskFreeRate),
          underlying: S,
        };
      }
    }
    return out;
  },

  async search(q) {
    const data = await get('/marketdata/v1/instruments', { symbol: `${q.toUpperCase()}.*`, projection: 'symbol-regex' });
    return (data.instruments || [])
      .filter(i => ['EQUITY', 'ETF', 'INDEX'].includes(i.assetType))
      .sort((a, b) => a.symbol.length - b.symbol.length)
      .slice(0, 10).map(i => ({ symbol: i.symbol, name: i.description }));
  },
};
