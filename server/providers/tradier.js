// Tradier Brokerage API market-data provider. Bearer token (no daily login).
// Docs: https://docs.tradier.com/docs/market-data
// Real-time for Tradier brokerage account holders; the sandbox (TRADIER_SANDBOX=true) is 15-min delayed.
// Greeks/IV come from ORATS and refresh about hourly; we fill any gaps with Black-Scholes.
import { greeks as bsGreeks, impliedVol } from '../../shared/bs.js';
import { nyDateStr, marketSession, expiryMs, daysToExpiry, addDays } from '../../shared/time.js';
import { occSymbol, parseOcc } from '../../shared/strategy.js';
import { config } from '../config.js';
import { makeLimiter } from '../priority.js';
import { nameOf } from '../universe.js';

const base = () => (config.tradier.sandbox ? 'https://sandbox.tradier.com/v1' : 'https://api.tradier.com/v1');
export const tradierConfigured = () => Boolean(config.tradier.token);

// ---------- rate limiting (market data: 120 req/min production, 60 sandbox) ----------
// Two-priority limiter: background scans (runLow) never starve interactive requests.
const limit = makeLimiter(config.tradier.sandbox ? 55 : 110);

let lastError = null;
async function get(path, query = {}, method = 'GET') {
  await limit();
  const u = new URL(base() + path);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') (method === 'POST' ? params : u.searchParams).set(k, v);
  const res = await fetch(u, {
    method,
    headers: { Authorization: `Bearer ${config.tradier.token}`, Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(method === 'POST' ? { body: params } : {}),
  });
  if (res.status === 401) {
    lastError = 'Tradier rejected the API token (401). Check TRADIER_API_KEY and TRADIER_SANDBOX.';
    throw Object.assign(new Error(lastError), { status: 502 });
  }
  const text = await res.text();
  if (!res.ok) {
    lastError = `Tradier ${res.status} ${path}`;
    throw Object.assign(new Error(`${lastError}: ${/^\s*</.test(text) ? '' : text.slice(0, 160)}`), { status: 502 });
  }
  lastError = null;
  return text ? JSON.parse(text) : {};
}

// ---------- normalization ----------
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const arr = x => (x == null || x === 'null' ? [] : Array.isArray(x) ? x : [x]);
const IDX = { $SPX: 'SPX', $VIX: 'VIX', $RUT: 'RUT', $COMPX: 'NDX', $DJI: 'DJI' };
const toTradier = s => IDX[s] || s.replace(/\./g, '/');
const fromTradier = (s, requested) => requested.find(r => toTradier(r) === s) || s;
const tradierOcc = occ => occ.replace(/\s+/g, '');

function normQuote(sym, q) {
  return {
    symbol: sym, name: q.description || nameOf(sym), last: num(q.last) || num(q.prevclose),
    change: num(q.change), changePct: num(q.change_percentage) / 100,
    open: num(q.open), high: num(q.high), low: num(q.low), prevClose: num(q.prevclose),
    bid: num(q.bid), ask: num(q.ask), volume: num(q.volume), avgVolume: num(q.average_volume),
    high52: num(q.week_52_high), low52: num(q.week_52_low), pe: NaN, divYield: NaN,
    session: marketSession(), time: num(q.trade_date) || Date.now(), delayed: config.tradier.sandbox,
  };
}

const expType = t => (t === 'standard' ? 'M' : t === 'quarterlys' ? 'Q' : 'W');

function normContract(sym, c, S, r) {
  const type = c.option_type === 'put' ? 'put' : 'call';
  const strike = num(c.strike), expiry = c.expiration_date;
  const bid = num(c.bid) || 0, ask = num(c.ask) || 0;
  const mark = bid > 0 && ask > 0 ? (bid + ask) / 2 : num(c.last) || ask || bid;
  const T = Math.max((expiryMs(expiry) - Date.now()) / (365 * 86400000), 0.5 / 365);
  const g = c.greeks || {};
  let iv = num(g.mid_iv) || num(g.smv_vol);
  if (!(iv > 0.005 && iv < 8)) iv = impliedVol(type, mark, S, strike, T, r);
  let gr = { delta: num(g.delta), gamma: num(g.gamma), theta: num(g.theta), vega: num(g.vega), rho: num(g.rho) };
  if (!Number.isFinite(gr.delta) && iv > 0) gr = bsGreeks(type, S, strike, T, iv, r);
  return {
    occ: occSymbol(sym, expiry, type, strike), type, strike, expiry, expType: expType(c.expiration_type),
    bid, ask, mark: +mark.toFixed(3), last: num(c.last) || 0,
    volume: num(c.volume) || 0, oi: num(c.open_interest) || 0, iv: iv || NaN,
    delta: gr.delta, gamma: gr.gamma, theta: gr.theta, vega: gr.vega, rho: gr.rho,
    itm: type === 'call' ? S > strike : S < strike,
  };
}

const RANGES = { '1M': 35, '6M': 190, YTD: null, '1Y': 370, '5Y': 5 * 366, MAX: 30 * 366 };

// ---------- brokerage account (READ-ONLY) ----------
// Used by the Trade Journal sync. Only GET requests: nothing here can place, change or cancel orders.
const ACCT_RE = /^[A-Za-z0-9]{4,20}$/;
const acctPath = n => { if (!ACCT_RE.test(String(n))) throw Object.assign(new Error('Invalid Tradier account number'), { status: 400 }); return `/accounts/${n}`; };
export const tradierAccounts = {
  async list() {
    const j = await get('/user/profile');
    return arr(j.profile?.account).map(a => ({ number: String(a.account_number), type: a.type, status: a.status }));
  },
  // All trade + option (expiration/assignment/exercise) events since `start` (YYYY-MM-DD), paginated.
  async history(acct, start) {
    const out = [];
    for (const type of ['trade', 'option']) {
      for (let page = 1; page <= 50; page++) {
        const j = await get(`${acctPath(acct)}/history`, { type, page, limit: 100, start });
        const ev = arr(j.history?.event);
        out.push(...ev);
        const total = Number(j.history?.total_pages);
        if (!ev.length || (Number.isFinite(total) ? page >= total : ev.length < 100)) break;
      }
    }
    return out;
  },
  // Orders of the current session (Tradier returns today's orders only).
  async orders(acct) {
    const j = await get(`${acctPath(acct)}/orders`, { includeTags: 'true' });
    return arr(j.orders?.order);
  },
};

// ---------- provider API ----------
export const tradierProvider = {
  name: 'tradier',
  indexes: [
    { symbol: '$SPX', name: 'S&P 500' }, { symbol: '$COMPX', name: 'Nasdaq 100' }, { symbol: '$DJI', name: 'Dow Jones' },
    { symbol: '$RUT', name: 'Russell 2000' }, { symbol: '$VIX', name: 'VIX' },
  ],

  status() {
    return { provider: 'tradier', connected: tradierConfigured(), realtime: !config.tradier.sandbox, sandbox: config.tradier.sandbox, lastError };
  },

  async getQuotes(symbols) {
    const out = {};
    for (let i = 0; i < symbols.length; i += 400) {
      const chunk = symbols.slice(i, i + 400);
      const data = await get('/markets/quotes', { symbols: chunk.map(toTradier).join(','), greeks: 'false' }, 'POST');
      for (const q of arr(data.quotes?.quote)) {
        const sym = fromTradier(q.symbol, chunk);
        out[sym] = normQuote(sym, q);
      }
    }
    return out;
  },

  async getHistory(sym, range = '6M') {
    const t = toTradier(sym);
    if (range === '1D' || range === '5D') {
      // Intraday: 5-minute bars for the last session(s), regular hours only.
      const days = range === '1D' ? 1 : 5;
      const start = addDays(nyDateStr(), -(days === 1 ? 4 : 9));
      const data = await get('/markets/timesales', { symbol: t, interval: range === '1D' ? '5min' : '15min', start: `${start} 09:30`, session_filter: 'open' });
      const bars = arr(data.series?.data).map(b => ({ t: num(b.timestamp), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }))
        .filter(b => Number.isFinite(b.t));
      const dayOf = b => nyDateStr(new Date(b.t * 1000));
      const sessions = [...new Set(bars.map(dayOf))].slice(-days);
      return bars.filter(b => sessions.includes(dayOf(b)));
    }
    const today = nyDateStr();
    const start = range === 'YTD' ? `${today.slice(0, 4)}-01-01` : addDays(today, -(RANGES[range] || 190));
    const interval = range === '5Y' ? 'weekly' : range === 'MAX' ? 'monthly' : 'daily';
    return this._history(t, start, interval);
  },

  // Intraday bars (regular session) for the chart: 1, 5 or 15 minutes. Tradier keeps ~20 days of
  // 1-minute and ~40 days of 5/15-minute time & sales, so the lookback is capped accordingly.
  async getIntraday(sym, minutes) {
    const interval = { 1: '1min', 5: '5min', 15: '15min' }[minutes];
    if (!interval) throw Object.assign(new Error('Unsupported interval'), { status: 400 });
    const start = addDays(nyDateStr(), -({ 1: 7, 5: 25, 15: 40 }[minutes]));
    const data = await get('/markets/timesales', { symbol: toTradier(sym), interval, start: `${start} 09:30`, session_filter: 'open' });
    return arr(data.series?.data).map(b => ({ t: num(b.timestamp), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }))
      .filter(b => Number.isFinite(b.t) && Number.isFinite(b.c));
  },

  async _history(t, start, interval = 'daily') {
    const data = await get('/markets/history', { symbol: t, interval, start, session_filter: 'open' });
    return arr(data.history?.day).map(d => ({ t: Date.parse(d.date + 'T00:00:00Z') / 1000, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volume }));
  },

  // Incremental daily bars from a date (YYYY-MM-DD), used by the nightly bar-store update.
  getDailyHistorySince(sym, start) {
    return this._history(toTradier(sym), start);
  },

  getDailyHistory(sym, years = 2) {
    return this._history(toTradier(sym), addDays(nyDateStr(), -Math.round(years * 366)));
  },

  async getExpirations(sym) {
    const data = await get('/markets/options/expirations', { symbol: toTradier(sym), includeAllRoots: 'true', expirationType: 'true' });
    const list = arr(data.expirations?.expiration);
    const rows = list.length ? list.map(e => ({ date: e.date, type: expType(e.expiration_type) }))
      : arr(data.expirations?.date).map(d => ({ date: d, type: 'W' }));
    return rows.map(e => ({ ...e, dte: daysToExpiry(e.date) })).filter(e => e.dte >= 0).sort((a, b) => a.date.localeCompare(b.date));
  },

  async getChain(sym, { fromDate, toDate, strikeCount = 40, spot } = {}) {
    // Single known expiration + a spot from the caller (scanner) => one API call instead of three.
    const single = fromDate && fromDate === toDate;
    const [quotes, exps] = await Promise.all([
      Number.isFinite(spot) ? { [sym]: { last: spot } } : this.getQuotes([sym]),
      single ? [{ date: fromDate, dte: daysToExpiry(fromDate), type: 'M' }] : this.getExpirations(sym),
    ]);
    const S = quotes[sym]?.last;
    if (!Number.isFinite(S)) throw Object.assign(new Error(`No quote for ${sym}`), { status: 404 });
    const r = config.riskFreeRate;
    const wanted = exps.filter(e => (!fromDate || e.date >= fromDate) && (!toDate || e.date <= toDate)).slice(0, 12);
    const expirations = [];
    for (const e of wanted) {
      const data = await get('/markets/options/chains', { symbol: toTradier(sym), expiration: e.date, greeks: 'true' });
      const byStrike = new Map();
      for (const c of arr(data.options?.option)) {
        if (c.contract_size && c.contract_size !== 100) continue; // skip adjusted / mini contracts
        const k = num(c.strike);
        const row = byStrike.get(k) || { strike: k, call: null, put: null };
        row[c.option_type === 'put' ? 'put' : 'call'] = normContract(sym, c, S, r);
        byStrike.set(k, row);
      }
      let rows = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
      // Keep the strikes nearest the money (the full chain can run to hundreds of strikes).
      if (rows.length > strikeCount) {
        const atm = rows.reduce((b, x, i) => (Math.abs(x.strike - S) < Math.abs(rows[b].strike - S) ? i : b), 0);
        const half = Math.ceil(strikeCount / 2);
        rows = rows.slice(Math.max(0, atm - half), atm + half + 1);
      }
      expirations.push({ ...e, type: rows[0]?.call?.expType || rows[0]?.put?.expType || e.type, rows });
    }
    return { symbol: sym, spot: S, rate: r, expirations, time: Date.now() };
  },

  async getOptionQuotes(occs) {
    const parsed = occs.map(o => ({ occ: o, p: parseOcc(o) })).filter(x => x.p);
    const spots = await this.getQuotes([...new Set(parsed.map(x => x.p.symbol))]);
    const out = {};
    for (let i = 0; i < parsed.length; i += 100) {
      const chunk = parsed.slice(i, i + 100);
      const data = await get('/markets/quotes', { symbols: chunk.map(x => tradierOcc(x.occ)).join(','), greeks: 'true' });
      for (const q of arr(data.quotes?.quote)) {
        const m = chunk.find(x => tradierOcc(x.occ) === q.symbol);
        if (!m) continue;
        const S = spots[m.p.symbol]?.last;
        out[m.occ] = { ...normContract(m.p.symbol, { ...q, expiration_date: q.expiration_date || m.p.expiry, strike: q.strike ?? m.p.strike, option_type: q.option_type || m.p.type }, S, config.riskFreeRate), underlying: S };
      }
    }
    return out;
  },

  async search(q) {
    const data = await get('/markets/lookup', { q, types: 'stock,etf,index' });
    return arr(data.securities?.security).sort((a, b) => a.symbol.length - b.symbol.length).slice(0, 10)
      .map(s => ({ symbol: s.symbol, name: s.description }));
  },
};
