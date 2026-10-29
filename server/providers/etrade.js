// E*TRADE API (market data) provider. OAuth 1.0a with an out-of-band verification code.
// Docs: https://apisb.etrade.com/docs/api/market/api-market-v1.html
// Session rules: the access token expires at midnight US Eastern (log in again daily) and goes
// inactive after 2 hours without requests (we renew it automatically).
// E*TRADE has no price-history endpoint, so daily bars come from Tiingo (server/history.js).
import { greeks as bsGreeks, impliedVol } from '../../shared/bs.js';
import { nyDateStr, nyOffsetHours, addDays, marketSession, expiryMs, daysToExpiry } from '../../shared/time.js';
import { occSymbol, parseOcc } from '../../shared/strategy.js';
import { config } from '../config.js';
import { readJson, writeJson } from '../store.js';
import { authHeader } from '../oauth1.js';
import { dailyBars } from '../history.js';
import { nameOf } from '../universe.js';

const OAUTH = 'https://api.etrade.com/oauth';
const base = () => (config.etrade.sandbox ? 'https://apisb.etrade.com' : 'https://api.etrade.com');
const TOKENS = 'etrade-tokens.json';

let tokens = readJson(TOKENS, null);
let pending = null; // request token awaiting the user's verification code

export const etradeConfigured = () => Boolean(config.etrade.key && config.etrade.secret);
export const etradeConnected = () => Boolean(tokens?.token && Date.now() < tokens.expiresAt && tokens.sandbox === config.etrade.sandbox);

// 00:00 New York on the day after `ms`, as epoch ms.
function nextMidnightNY(ms) {
  const next = addDays(nyDateStr(new Date(ms)), 1);
  return Date.parse(next + 'T00:00:00Z') - nyOffsetHours(new Date(Date.parse(next + 'T12:00:00Z'))) * 3600000;
}

async function oauthCall(path, { token, tokenSecret, extra } = {}) {
  const url = `${OAUTH}/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader({ url, consumerKey: config.etrade.key, consumerSecret: config.etrade.secret, token, tokenSecret, extra }) },
  });
  const text = await res.text();
  if (!res.ok) {
    const detail = /^\s*</.test(text) ? '' : `: ${text.slice(0, 160)}`;
    const hint = res.status === 401
      ? (path === 'access_token' ? ' The verification code was wrong or expired; click Connect E*TRADE again.'
        : ' Check ETRADE_CONSUMER_KEY / ETRADE_CONSUMER_SECRET, and that ETRADE_SANDBOX matches the key type.')
      : '';
    throw Object.assign(new Error(`E*TRADE rejected ${path.replace(/_/g, ' ')} (${res.status})${detail}.${hint}`), { status: 502 });
  }
  return Object.fromEntries(new URLSearchParams(text));
}

// Step 1: request token + URL where the user logs in and receives a verification code.
export async function etradeStartAuth() {
  if (!etradeConfigured()) throw Object.assign(new Error('Set ETRADE_CONSUMER_KEY and ETRADE_CONSUMER_SECRET in .env first'), { status: 400 });
  const r = await oauthCall('request_token', { extra: { oauth_callback: 'oob' } });
  pending = { token: r.oauth_token, secret: r.oauth_token_secret, at: Date.now() };
  return `https://us.etrade.com/e/t/etws/authorize?key=${encodeURIComponent(config.etrade.key)}&token=${encodeURIComponent(r.oauth_token)}`;
}

// Step 2: exchange the verification code for an access token (valid until midnight ET).
export async function etradeVerify(code) {
  if (!pending || Date.now() - pending.at > 5 * 60000) throw Object.assign(new Error('Login link expired (5 min). Click Connect E*TRADE again.'), { status: 400 });
  const r = await oauthCall('access_token', { token: pending.token, tokenSecret: pending.secret, extra: { oauth_verifier: String(code).trim() } });
  pending = null;
  const now = Date.now();
  tokens = { token: r.oauth_token, secret: r.oauth_token_secret, obtainedAt: now, lastUsed: now, expiresAt: nextMidnightNY(now), sandbox: config.etrade.sandbox };
  writeJson(TOKENS, tokens);
}

export async function etradeRenew() {
  if (!etradeConnected()) return false;
  await oauthCall('renew_access_token', { token: tokens.token, tokenSecret: tokens.secret });
  tokens.lastUsed = Date.now();
  writeJson(TOKENS, tokens);
  return true;
}

export async function etradeDisconnect() {
  if (etradeConnected()) await oauthCall('revoke_access_token', { token: tokens.token, tokenSecret: tokens.secret }).catch(() => {});
  tokens = null;
  writeJson(TOKENS, null);
}

// ---------- rate limiting (E*TRADE throttles bursts; stay around 3 req/s) ----------
let chain = Promise.resolve();
const gap = 350;
function limit() {
  const p = chain.then(() => new Promise(r => setTimeout(r, gap)));
  chain = p;
  return p;
}

async function api(path, query = {}) {
  if (!etradeConnected()) throw Object.assign(new Error('E*TRADE session expired. Reconnect in Settings.'), { status: 503 });
  if (Date.now() - tokens.lastUsed > 100 * 60000) await etradeRenew().catch(() => {});
  await limit();
  const url = base() + path;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  const res = await fetch(u, {
    headers: {
      Accept: 'application/json',
      Authorization: authHeader({ url, query: Object.fromEntries(u.searchParams), consumerKey: config.etrade.key, consumerSecret: config.etrade.secret, token: tokens.token, tokenSecret: tokens.secret }),
    },
  });
  tokens.lastUsed = Date.now();
  if (res.status === 401) {
    tokens.expiresAt = 0; writeJson(TOKENS, tokens);
    throw Object.assign(new Error('E*TRADE session expired. Reconnect in Settings.'), { status: 503 });
  }
  if (res.status === 204) return {};
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`E*TRADE ${res.status} ${path}: ${text.slice(0, 200)}`), { status: 502 });
  return JSON.parse(text);
}

// ---------- normalization ----------
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : NaN);
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

function normQuote(sym, qd) {
  const a = qd.All || {};
  const last = num(a.lastTrade);
  return {
    symbol: sym, name: a.companyName || a.symbolDescription || nameOf(sym), last,
    change: num(a.changeClose), changePct: num(a.changeClosePercentage) / 100,
    open: num(a.open), high: num(a.high), low: num(a.low), prevClose: num(a.previousClose),
    bid: num(a.bid), ask: num(a.ask), volume: num(a.totalVolume), avgVolume: num(a.averageVolume),
    high52: num(a.high52), low52: num(a.low52), pe: num(a.pe), divYield: num(a.yield ?? a.dividendYield),
    session: marketSession(), time: qd.dateTimeUTC ? qd.dateTimeUTC * 1000 : Date.now(), delayed: qd.quoteStatus === 'DELAYED',
  };
}

const expType = t => (t === 'MONTHLY' ? 'M' : t === 'QUARTERLY' ? 'Q' : 'W');

function normContract(sym, c, type, S, expiry, eType, r) {
  const strike = num(c.strikePrice);
  const bid = num(c.bid) || 0, ask = num(c.ask) || 0;
  const mark = bid > 0 && ask > 0 ? (bid + ask) / 2 : num(c.lastPrice) || ask || bid;
  const T = Math.max((expiryMs(expiry) - Date.now()) / (365 * 86400000), 0.5 / 365);
  const g = c.OptionGreeks || {};
  let iv = num(g.iv);
  if (iv > 3) iv /= 100; // guard against percent units
  if (!(iv > 0.005)) iv = impliedVol(type, mark, S, strike, T, r);
  let gr = { delta: num(g.delta), gamma: num(g.gamma), theta: num(g.theta), vega: num(g.vega), rho: num(g.rho) };
  if ((!Number.isFinite(gr.delta) || (gr.delta === 0 && gr.gamma === 0)) && iv > 0) gr = bsGreeks(type, S, strike, T, iv, r);
  return {
    occ: occSymbol(sym, expiry, type, strike), type, strike, expiry, expType: eType,
    bid, ask, mark: +mark.toFixed(3), last: num(c.lastPrice) || 0,
    volume: num(c.volume) || 0, oi: num(c.openInterest) || 0, iv: iv || NaN,
    delta: gr.delta, gamma: gr.gamma, theta: gr.theta, vega: gr.vega, rho: gr.rho,
    itm: type === 'call' ? S > strike : S < strike,
  };
}

// E*TRADE option quote symbol: underlier:year:month:day:CALL|PUT:strike
const etOptSymbol = o => `${o.symbol}:${o.expiry.slice(0, 4)}:${Number(o.expiry.slice(5, 7))}:${Number(o.expiry.slice(8, 10))}:${o.type === 'call' ? 'CALL' : 'PUT'}:${o.strike}`;

// ---------- provider API ----------
export const etradeProvider = {
  name: 'etrade',
  // E*TRADE index symbols are not reliable across accounts: show liquid ETF proxies instead.
  indexes: [
    { symbol: 'SPY', name: 'S&P 500 · SPY' }, { symbol: 'QQQ', name: 'Nasdaq 100 · QQQ' },
    { symbol: 'DIA', name: 'Dow · DIA' }, { symbol: 'IWM', name: 'Russell 2000 · IWM' },
  ],

  status() {
    return {
      provider: 'etrade', connected: etradeConnected(), realtime: !config.etrade.sandbox, sandbox: config.etrade.sandbox,
      sample: config.etrade.sandbox, // E*TRADE sandbox returns canned sample data, not the market
      sessionExpiresAt: tokens?.expiresAt || null,
    };
  },

  async getQuotes(symbols) {
    const out = {};
    for (let i = 0; i < symbols.length; i += 25) {
      const chunk = symbols.slice(i, i + 25);
      const data = await api(`/v1/market/quote/${chunk.map(encodeURIComponent).join(',')}.json`, { detailFlag: 'ALL' });
      for (const qd of arr(data.QuoteResponse?.QuoteData)) {
        const sym = qd.Product?.symbol || qd.product?.symbol;
        if (sym) out[sym] = normQuote(sym, qd);
      }
    }
    return out;
  },

  async getHistory(sym, range = '6M') {
    if (range === '1D' || range === '5D') return []; // no intraday source on this provider
    const bars = await dailyBars(sym);
    const n = { '1M': 23, '6M': 128, '1Y': 253, '5Y': 1300, MAX: 99999, YTD: bars.filter(b => b.t * 1000 >= Date.parse(`${nyDateStr().slice(0, 4)}-01-01`)).length }[range] || 128;
    return bars.slice(-n);
  },

  getDailyHistory: sym => dailyBars(sym),

  async getExpirations(sym) {
    const data = await api('/v1/market/optionexpiredate.json', { symbol: sym, expiryType: 'ALL' });
    return arr(data.OptionExpireDateResponse?.ExpirationDate)
      .map(e => {
        const date = `${e.year}-${String(e.month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}`;
        return { date, dte: daysToExpiry(date), type: expType(e.expiryType) };
      })
      .filter(e => e.dte >= 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  async getChain(sym, { fromDate, toDate, strikeCount = 40 } = {}) {
    const [quotes, exps] = await Promise.all([this.getQuotes([sym]), this.getExpirations(sym)]);
    const S = quotes[sym]?.last;
    if (!Number.isFinite(S)) throw Object.assign(new Error(`No quote for ${sym}`), { status: 404 });
    const r = config.riskFreeRate;
    const wanted = exps.filter(e => (!fromDate || e.date >= fromDate) && (!toDate || e.date <= toDate)).slice(0, 12);
    const expirations = [];
    for (const e of wanted) {
      const [y, m, d] = e.date.split('-').map(Number);
      const data = await api('/v1/market/optionchains.json', {
        symbol: sym, expiryYear: y, expiryMonth: m, expiryDay: d, chainType: 'CALLPUT', includeWeekly: 'true',
        noOfStrikes: Math.min(strikeCount, 120), strikePriceNear: Math.round(S), priceType: 'ALL', optionCategory: 'STANDARD',
      });
      const rows = arr(data.OptionChainResponse?.OptionPair).map(p => {
        const strike = num((p.Call || p.Put)?.strikePrice);
        return {
          strike,
          call: p.Call ? normContract(sym, p.Call, 'call', S, e.date, e.type, r) : null,
          put: p.Put ? normContract(sym, p.Put, 'put', S, e.date, e.type, r) : null,
        };
      }).filter(x => Number.isFinite(x.strike)).sort((a, b) => a.strike - b.strike);
      expirations.push({ ...e, rows });
    }
    return { symbol: sym, spot: S, rate: r, expirations, time: Date.now() };
  },

  async getOptionQuotes(occs) {
    const parsed = occs.map(o => ({ occ: o, p: parseOcc(o) })).filter(x => x.p);
    const unders = [...new Set(parsed.map(x => x.p.symbol))];
    const spots = await this.getQuotes(unders);
    const out = {};
    for (let i = 0; i < parsed.length; i += 25) {
      const chunk = parsed.slice(i, i + 25);
      const data = await api(`/v1/market/quote/${chunk.map(x => encodeURIComponent(etOptSymbol(x.p))).join(',')}.json`, { detailFlag: 'OPTIONS' });
      for (const qd of arr(data.QuoteResponse?.QuoteData)) {
        const pr = qd.Product || qd.product || {};
        const match = chunk.find(x => pr.symbol === x.p.symbol && Number(pr.strikePrice) === x.p.strike
          && Number(pr.expiryYear) === Number(x.p.expiry.slice(0, 4)) && Number(pr.expiryMonth) === Number(x.p.expiry.slice(5, 7))
          && Number(pr.expiryDay) === Number(x.p.expiry.slice(8, 10)) && (pr.callPut || '').toLowerCase() === x.p.type);
        if (!match) continue;
        const o = qd.Option || {}, a = qd.All || {};
        const S = spots[match.p.symbol]?.last;
        out[match.occ] = {
          ...normContract(match.p.symbol, {
            strikePrice: match.p.strike, bid: o.bid ?? a.bid, ask: o.ask ?? a.ask, lastPrice: o.lastTrade ?? a.lastTrade,
            volume: a.totalVolume, openInterest: o.openInterest, OptionGreeks: o.OptionGreeks,
          }, match.p.type, S, match.p.expiry, 'M', config.riskFreeRate),
          underlying: S,
        };
      }
    }
    return out;
  },

  async search(q) {
    const data = await api(`/v1/market/lookup/${encodeURIComponent(q)}.json`);
    return arr(data.LookupResponse?.Data)
      .filter(d => ['EQUITY', 'ETF', 'EQ'].includes(String(d.type).toUpperCase()) || !d.type)
      .slice(0, 10).map(d => ({ symbol: d.symbol, name: d.description }));
  },
};
