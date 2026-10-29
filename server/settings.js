import { readJson, writeJson } from './store.js';
import { DEFAULT_UNIVERSE } from './universe.js';

export const STRATEGY_KEYS = [
  'longCall', 'longPut', 'leaps', 'pmcc', 'bullCallSpread', 'bearPutSpread',
  'bullPutSpread', 'bearCallSpread', 'csp', 'coveredCall', 'ironCondor',
];

export const DEFAULT_SETTINGS = {
  universe: DEFAULT_UNIVERSE,
  watchlist: ['SPY', 'QQQ', 'IWM', 'AAPL', 'NVDA', 'TSLA', 'AMD', 'META', 'MSFT', 'AMZN'],
  strategies: Object.fromEntries(STRATEGY_KEYS.map(k => [k, true])),
  account: { size: 100000, riskPerTradePct: 2, maxAllocationPct: 10, configured: false },
  notifications: { telegramChatId: '', positionAlerts: true, setupAlerts: true, minSetupScore: 85 },
  filters: { minPrice: 15, minAvgVolume: 1000000, minOI: 100, maxSpreadPct: 12 },
  rules: {
    creditDte: [30, 50], creditTargetDte: 45, creditShortDelta: 0.28, condorShortDelta: 0.16,
    debitDte: [25, 65], debitTargetDte: 45, longDte: [60, 130], longTargetDte: 90, longDelta: 0.7,
    leapsMinDte: 270, leapsDelta: 0.8, profitTakePct: 50, manageDte: 21, minIvrForCredit: 30,
  },
  refreshMinutes: 15,
  // Full-market scan: 'auto' = every liquid optionable US stock (rebuilt weekly) + the manual universe.
  scan: { mode: 'auto', minPrice: 10, minAvgVolume: 500000, minDollarVolume: 20000000, includeEtfs: false, ivTopN: 100, minAdr: 4 },
};

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base ? merge(base[k], over[k]) : over[k];
  return out;
}

// Clamp numbers to sane ranges (bad values would produce NaN sizing or runaway API usage).
const LIMITS = {
  account: { size: [1000, 1e9, 100000], riskPerTradePct: [0.1, 25, 2], maxAllocationPct: [0.5, 100, 10] },
  filters: { minPrice: [0, 10000, 15], minAvgVolume: [0, 1e9, 1e6], minOI: [0, 1e6, 100], maxSpreadPct: [1, 100, 12] },
  rules: {
    creditTargetDte: [7, 120, 45], creditShortDelta: [0.05, 0.5, 0.28], condorShortDelta: [0.05, 0.4, 0.16],
    debitTargetDte: [7, 180, 45], longTargetDte: [14, 365, 90], longDelta: [0.3, 0.95, 0.7],
    leapsMinDte: [180, 900, 270], leapsDelta: [0.5, 0.98, 0.8], minIvrForCredit: [0, 100, 30],
    profitTakePct: [10, 100, 50], manageDte: [0, 60, 21],
  },
  notifications: { minSetupScore: [40, 100, 85] },
  scan: { minPrice: [1, 1000, 10], minAvgVolume: [50000, 1e8, 500000], minDollarVolume: [1e6, 1e10, 2e7], ivTopN: [20, 400, 100], minAdr: [1, 15, 4] },
};
function sanitize(s) {
  for (const [group, fields] of Object.entries(LIMITS)) {
    for (const [k, [lo, hi, def]] of Object.entries(fields)) {
      const v = Number(s[group]?.[k]);
      s[group][k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
    }
  }
  s.refreshMinutes = Math.min(240, Math.max(5, Number(s.refreshMinutes) || 15));
  s.scan.mode = s.scan.mode === 'manual' ? 'manual' : 'auto';
  s.scan.includeEtfs = s.scan.includeEtfs === true;
  s.universe = s.universe.slice(0, 300);
  s.watchlist = s.watchlist.slice(0, 50);
  s.notifications.telegramChatId = String(s.notifications.telegramChatId || '').replace(/[^0-9-]/g, '').slice(0, 20);
  for (const k of Object.keys(s.strategies)) if (!STRATEGY_KEYS.includes(k)) delete s.strategies[k];
  for (const k of STRATEGY_KEYS) s.strategies[k] = s.strategies[k] !== false;
  for (const k of Object.keys(s)) if (!(k in DEFAULT_SETTINGS)) delete s[k];
}

export const getSettings = () => merge(DEFAULT_SETTINGS, readJson('settings.json', {}));

export function saveSettings(patch) {
  const next = merge(getSettings(), patch);
  if (patch.account) next.account.configured = true;
  sanitize(next);
  next.universe = [...new Set((next.universe || []).map(s => String(s).trim().toUpperCase()).filter(s => /^[A-Z$][A-Z0-9.$/]{0,9}$/.test(s)))];
  next.watchlist = [...new Set((next.watchlist || []).map(s => String(s).trim().toUpperCase()).filter(s => /^[A-Z$][A-Z0-9.$/]{0,9}$/.test(s)))];
  writeJson('settings.json', next);
  return next;
}
