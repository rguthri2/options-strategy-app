// Simulated market-data provider. Deterministic per symbol/date so charts and chains are stable,
// with a live "tick" during market hours. Options are priced with Black-Scholes on a skewed,
// term-structured volatility surface so every screen behaves like it would on real data.
import { greeks } from '../../shared/bs.js';
import { occSymbol, parseOcc } from '../../shared/strategy.js';
import { nyDateStr, nyClock, nyOffsetHours, marketSession, expiryMs, daysToExpiry, addDays } from '../../shared/time.js';
import { PROFILES, INDEXES, nameOf } from '../universe.js';
import { config } from '../config.js';

const RATE = config.riskFreeRate;

// ---------- seeded randomness ----------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seedStr) {
  let a = hash(seedStr);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  const u = Math.max(r(), 1e-12), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function profile(sym) {
  const p = PROFILES[sym];
  if (p) return { name: p[0], base: p[1], vol: p[2], avgVol: p[3] };
  const idx = INDEXES.find(i => i.symbol === sym);
  if (idx) return { name: idx.name, base: idx.demo[0], vol: idx.demo[1], avgVol: 0, index: true };
  const r = rng('profile' + sym);
  return { name: sym, base: Math.round(20 + r() * 300), vol: 0.25 + r() * 0.45, avgVol: 1e6 + r() * 2e7 };
}

// ---------- sessions ----------
const isWeekday = d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w > 0 && w < 6; };
function prevWeekday(d) { do { d = addDays(d, -1); } while (!isWeekday(d)); return d; }

// Most recent session that has started (today once 9:30 ET passes).
function currentSession(now = new Date()) {
  const today = nyDateStr(now);
  const { h, m } = nyClock(now);
  if (isWeekday(today) && h * 60 + m >= 570) return today;
  return prevWeekday(today);
}

// Fraction of the current session elapsed (1 once closed).
function sessionFraction(session, now = new Date()) {
  if (session !== nyDateStr(now)) return 1;
  const { h, m } = nyClock(now);
  return Math.min(1, Math.max(0, (h * 60 + m - 570) / 390));
}

const ANCHOR = '2023-01-02';
const dailyCache = new Map();

// Full daily path from ANCHOR to the current session (last bar = today's full-day target).
function dailyPath(sym, session) {
  const key = sym + '|' + session;
  if (dailyCache.has(key)) return dailyCache.get(key);
  const p = profile(sym);
  const isVix = sym === '$VIX';
  const out = [];
  let d = ANCHOR, logP = Math.log(p.base), idx = 0;
  const logBase = Math.log(p.base);
  let regime = null;
  while (d <= session) {
    if (isWeekday(d)) {
      const block = Math.floor(idx / 28);
      if (!regime || regime.block !== block) {
        const rr = rng(`reg|${sym}|${block}`);
        regime = {
          block,
          drift: (gauss(rr) * 0.55 + 0.12) * (isVix ? 0 : 1),
          volMult: rr() < 0.22 ? 0.55 : 0.8 + rr() * 0.6,
        };
      }
      const r = rng(`day|${sym}|${d}`);
      const dvol = (p.vol * regime.volMult) / Math.sqrt(252);
      const revert = (isVix ? 0.06 : 0.012) * (logP - logBase);
      const gap = r() < 0.015 ? gauss(r) * dvol * 3 : 0;
      const ret = regime.drift / 252 - revert + dvol * gauss(r) + gap;
      const prev = Math.exp(logP);
      logP += ret;
      const c = Math.exp(logP);
      const o = prev * Math.exp(gap * 0.7 + gauss(r) * dvol * 0.25);
      const h = Math.max(o, c) * Math.exp(Math.abs(gauss(r)) * dvol * 0.45);
      const l = Math.min(o, c) * Math.exp(-Math.abs(gauss(r)) * dvol * 0.45);
      const v = p.avgVol * Math.exp(gauss(r) * 0.3) * (1 + (1.8 * Math.abs(ret)) / dvol / 3);
      out.push({ date: d, o, h, l, c, v: Math.round(v) });
      idx++;
    }
    d = addDays(d, 1);
  }
  if (dailyCache.size > 400) dailyCache.clear();
  dailyCache.set(key, out);
  return out;
}

// Intraday 5-minute bridge from the day's open to close (78 bars).
function intradayBars(sym, bar, vol) {
  const r = rng(`intra|${sym}|${bar.date}`);
  const n = 78, dvol = vol / Math.sqrt(252 * n);
  const w = [0];
  for (let i = 1; i <= n; i++) w.push(w[i - 1] + gauss(r) * dvol);
  const lo = Math.log(bar.o), lc = Math.log(bar.c);
  const pts = w.map((x, i) => Math.exp(lo + (lc - lo) * (i / n) + x - (w[n] * i) / n));
  const [y, mo, dd] = bar.date.split('-').map(Number);
  const openUtc = Date.UTC(y, mo - 1, dd, 9, 30) - nyOffsetHours(new Date(Date.UTC(y, mo - 1, dd, 12))) * 3600000;
  const bars = [];
  for (let i = 0; i < n; i++) {
    const o = pts[i], c = pts[i + 1];
    const h = Math.max(o, c) * (1 + Math.abs(gauss(r)) * dvol * 0.4);
    const l = Math.min(o, c) * (1 - Math.abs(gauss(r)) * dvol * 0.4);
    const shape = 1.6 - Math.sin((Math.PI * i) / n);
    bars.push({ t: (openUtc + i * 300000) / 1000, o, h, l, c, v: Math.round((bar.v / n) * shape * (0.6 + r() * 0.8)) });
  }
  return bars;
}

// Daily candles with today's bar truncated to the elapsed session plus a live jitter.
function history(sym, now = new Date()) {
  const session = currentSession(now);
  const path = dailyPath(sym, session);
  const frac = sessionFraction(session, now);
  const bars = path.map(b => ({ ...b }));
  if (frac < 1) {
    const last = bars[bars.length - 1];
    const intra = intradayBars(sym, last, profile(sym).vol);
    const k = Math.max(1, Math.floor(frac * 78));
    const seen = intra.slice(0, k);
    const jit = rng(`tick|${sym}|${Math.floor(now.getTime() / 15000)}`);
    const px = seen[k - 1].c * (1 + gauss(jit) * profile(sym).vol * 0.0006);
    last.h = Math.max(last.o, px, ...seen.map(b => b.h));
    last.l = Math.min(last.o, px, ...seen.map(b => b.l));
    last.c = px;
    last.v = Math.round(seen.reduce((s, b) => s + b.v, 0));
  }
  return bars;
}

const toCandle = b => ({ t: Date.parse(b.date + 'T00:00:00Z') / 1000, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });

// ---------- volatility surface ----------
function ivBase(sym, now = new Date()) {
  const p = profile(sym);
  const week = Math.floor(now.getTime() / (7 * 86400000));
  const r = rng(`ivr|${sym}|${week}`);
  // IV/HV ratio varies by symbol and week so some names are rich (sell) and some cheap (buy).
  return p.vol * (0.78 + r() * 0.75);
}

function atmIvForT(sym, T, now) {
  const base = ivBase(sym, now);
  const r = rng(`term|${sym}`);
  const frontBump = 0.9 + r() * 0.35; // >1 = event premium (earnings-like) in the front months
  return base * (0.96 + (frontBump - 0.96) * Math.exp(-T * 5));
}

function strikeIv(atm, S, K, T) {
  const m = Math.log(K / S) / Math.max(atm * Math.sqrt(Math.max(T, 1 / 365)), 0.02);
  return Math.max(atm * 0.45, atm * (1 - 0.075 * m + 0.022 * m * m));
}

function strikeStep(S) {
  if (S < 5) return 0.5; if (S < 25) return 1; if (S < 100) return 2.5; if (S < 250) return 5; if (S < 600) return 5; if (S < 1500) return 10; return 25;
}

// ---------- expirations ----------
function thirdFriday(y, m) {
  const d = new Date(Date.UTC(y, m, 1));
  const first = (5 - d.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(y, m, 1 + first + 14)).toISOString().slice(0, 10);
}

function expirationList(now = new Date()) {
  const today = nyDateStr(now);
  const set = new Map();
  // Weeklies: next 8 Fridays.
  let d = today;
  for (let i = 0; i < 8;) {
    if (new Date(d + 'T12:00:00Z').getUTCDay() === 5) { set.set(d, 'W'); i++; }
    d = addDays(d, 1);
  }
  const t = new Date(today + 'T12:00:00Z');
  for (let k = 0; k < 13; k++) {
    const y = t.getUTCFullYear() + Math.floor((t.getUTCMonth() + k) / 12);
    const m = (t.getUTCMonth() + k) % 12;
    set.set(thirdFriday(y, m), 'M');
  }
  for (const y of [t.getUTCFullYear() + 1, t.getUTCFullYear() + 2]) set.set(thirdFriday(y, 0), 'M');
  return [...set.entries()]
    .filter(([date]) => expiryMs(date) > now.getTime())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, type]) => ({ date, dte: daysToExpiry(date, now.getTime()), type }));
}

// ---------- contracts ----------
function buildContract(sym, p, S, expiry, expType, type, K, now) {
  const T = Math.max((expiryMs(expiry) - now.getTime()) / (365 * 86400000), 0.5 / 365);
  const atm = atmIvForT(sym, T, now);
  const iv = strikeIv(atm, S, K, T);
  const g = greeks(type, S, K, T, iv, RATE);
  const session = currentSession(now);
  const r = rng(`oc|${sym}|${session}|${expiry}|${type}|${K}`);
  const moneyness = Math.log(K / S) / (atm * Math.sqrt(T));
  const liq = Math.max(0.15, Math.min(1.5, p.avgVol / 2e7)) * (expType === 'M' ? 1.4 : 1) * Math.exp(-T * 0.9);
  const spreadPct = 0.018 + 0.03 / liq + 0.01 * Math.abs(moneyness);
  const spread = Math.min(Math.max(0.01, g.price * spreadPct + 0.015), Math.max(0.05, g.price * 0.3));
  const theo = g.price;
  const tick = theo < 3 ? 0.01 : 0.05;
  const rt = x => Math.round(x / tick) * tick;
  let bid = Math.max(0, rt(theo - spread / 2)), ask = Math.max(0.01, rt(theo + spread / 2));
  if (ask <= bid) ask = +(bid + tick).toFixed(2);
  const roundBonus = K % (strikeStep(S) * 2) === 0 ? 1.5 : 1;
  const oi = Math.round((p.avgVol / 2500) * liq * Math.exp(-0.5 * (moneyness / 1.3) ** 2) * roundBonus * (0.4 + r() * 1.2)
    * (type === 'put' && moneyness < 0 ? 1.15 : 1));
  let volume = Math.round(oi * (0.02 + r() * 0.35) * (T < 0.06 ? 2.2 : 1) * sessionFraction(session, now));
  if (r() < 0.012) volume = Math.round(oi * (1.8 + r() * 3) + 800); // unusual activity
  const mark = +((bid + ask) / 2).toFixed(2);
  return {
    occ: occSymbol(sym, expiry, type, K), type, strike: K, expiry, expType,
    bid: +bid.toFixed(2), ask: +ask.toFixed(2), mark,
    last: +Math.max(0.01, mark + (r() - 0.5) * spread * 0.6).toFixed(2),
    volume, oi, iv,
    delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega, rho: g.rho,
    theo, itm: type === 'call' ? S > K : S < K,
  };
}

// ---------- provider API ----------
export const demoProvider = {
  name: 'demo',

  status() {
    return { provider: 'demo', connected: true, realtime: false, note: 'Simulated data (Black-Scholes). Connect Schwab in Settings for live data.' };
  },

  async getQuotes(symbols) {
    const now = new Date();
    const out = {};
    for (const sym of symbols) {
      const p = profile(sym);
      const bars = history(sym, now);
      const lastBar = bars[bars.length - 1], prevBar = bars[bars.length - 2];
      const yr = bars.slice(-252);
      const last = lastBar.c;
      const spread = p.index ? 0 : Math.max(0.01, last * 0.0002);
      out[sym] = {
        symbol: sym, name: p.name, last,
        change: last - prevBar.c, changePct: (last - prevBar.c) / prevBar.c,
        open: lastBar.o, high: lastBar.h, low: lastBar.l, prevClose: prevBar.c,
        bid: +(last - spread / 2).toFixed(2), ask: +(last + spread / 2).toFixed(2),
        volume: lastBar.v, avgVolume: Math.round(bars.slice(-51, -1).reduce((s, b) => s + b.v, 0) / 50),
        high52: Math.max(...yr.map(b => b.h)), low52: Math.min(...yr.map(b => b.l)),
        pe: p.index ? null : +(12 + rng('pe' + sym)() * 45).toFixed(1),
        divYield: p.index ? null : +(rng('dy' + sym)() * 2.5).toFixed(2),
        session: marketSession(now), time: now.getTime(), delayed: false,
      };
    }
    return out;
  },

  // range: 1D 5D 1M 6M YTD 1Y 5Y MAX -> candles [{t (epoch sec), o, h, l, c, v}]
  async getHistory(sym, range = '6M') {
    const now = new Date();
    const bars = history(sym, now);
    if (range === '1D' || range === '5D') {
      const days = range === '1D' ? 1 : 5;
      const p = profile(sym);
      const frac = sessionFraction(currentSession(now), now);
      const out = [];
      for (const b of bars.slice(-days)) {
        const full = dailyPath(sym, currentSession(now)).find(x => x.date === b.date) || b;
        let intra = intradayBars(sym, full, p.vol);
        if (b === bars[bars.length - 1] && frac < 1) {
          intra = intra.slice(0, Math.max(1, Math.floor(frac * 78)));
          intra[intra.length - 1] = { ...intra[intra.length - 1], c: b.c };
        }
        out.push(...(range === '5D' ? aggregate(intra, 3) : intra));
      }
      return out;
    }
    const cut = {
      '1M': 23, '6M': 128, '1Y': 253, '5Y': 1300, MAX: 5000,
      YTD: bars.filter(b => b.date >= `${nyDateStr(now).slice(0, 4)}-01-01`).length + 1,
    }[range] || 128;
    return bars.slice(-cut).map(toCandle);
  },

  async getDailyHistory(sym) {
    return history(sym).map(toCandle);
  },

  // Simulated 5-minute session bars (1-minute requests get the same 5-minute path; 15 = 3 bars merged).
  async getIntraday(sym, minutes) {
    const now = new Date(), bars = history(sym, now), p = profile(sym);
    const days = { 1: 5, 5: 20, 15: 40 }[minutes] || 20;
    const frac = sessionFraction(currentSession(now), now);
    const out = [];
    for (const b of bars.slice(-days)) {
      const full = dailyPath(sym, currentSession(now)).find(x => x.date === b.date) || b;
      let intra = intradayBars(sym, full, p.vol);
      if (b === bars[bars.length - 1] && frac < 1) intra = intra.slice(0, Math.max(1, Math.floor(frac * 78)));
      out.push(...(minutes === 15 ? aggregate(intra, 3) : intra));
    }
    return out;
  },

  async getExpirations(sym) {
    return expirationList();
  },

  async getChain(sym, { fromDate, toDate, strikeCount = 40 } = {}) {
    const now = new Date();
    const p = profile(sym);
    const S = history(sym, now).at(-1).c;
    const step = strikeStep(S);
    const exps = expirationList(now).filter(e => (!fromDate || e.date >= fromDate) && (!toDate || e.date <= toDate));
    const expirations = exps.map(e => {
      const T = Math.max((expiryMs(e.date) - now.getTime()) / (365 * 86400000), 0.5 / 365);
      const atm = atmIvForT(sym, T, now);
      const width = Math.max(S * 0.1, S * atm * Math.sqrt(T) * 3.2);
      const center = Math.round(S / step) * step;
      const half = Math.min(Math.ceil(width / step), Math.ceil(strikeCount / 2));
      const rows = [];
      for (let i = -half; i <= half; i++) {
        const K = +(center + i * step).toFixed(2);
        if (K <= 0) continue;
        rows.push({
          strike: K,
          call: buildContract(sym, p, S, e.date, e.type, 'call', K, now),
          put: buildContract(sym, p, S, e.date, e.type, 'put', K, now),
        });
      }
      return { ...e, rows };
    });
    return { symbol: sym, spot: S, rate: RATE, expirations, time: now.getTime() };
  },

  async getOptionQuotes(occs) {
    const now = new Date();
    const out = {};
    for (const occ of occs) {
      const o = parseOcc(occ);
      if (!o) continue;
      const S = history(o.symbol, now).at(-1).c;
      const expType = expirationList(now).find(e => e.date === o.expiry)?.type || 'M';
      out[occ] = { ...buildContract(o.symbol, profile(o.symbol), S, o.expiry, expType, o.type, o.strike, now), underlying: S };
    }
    return out;
  },

  async search(q) {
    q = q.toUpperCase();
    return Object.entries(PROFILES)
      .filter(([s, p]) => s.startsWith(q) || p[0].toUpperCase().includes(q))
      .slice(0, 10).map(([s]) => ({ symbol: s, name: nameOf(s) }));
  },
};

function aggregate(bars, n) {
  const out = [];
  for (let i = 0; i < bars.length; i += n) {
    const g = bars.slice(i, i + n);
    out.push({ t: g[0].t, o: g[0].o, h: Math.max(...g.map(b => b.h)), l: Math.min(...g.map(b => b.l)), c: g.at(-1).c, v: g.reduce((s, b) => s + b.v, 0) });
  }
  return out;
}
