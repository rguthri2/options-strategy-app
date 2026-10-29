// Auto universe: every US-listed common stock with listed options that passes liquidity filters.
// Sources (free, public): CBOE optionable symbol directory + Nasdaq Trader listed-securities files.
// Rebuilt weekly; the result is merged with the user's manual universe and watchlist.
import { readJson, writeJson } from './store.js';
import { market, activeProvider } from './providers/index.js';
import { getSettings } from './settings.js';
import { runLow } from './priority.js';
import { DEFAULT_UNIVERSE } from './universe.js';

const FILE = 'universe-auto.json';
const UA = { 'User-Agent': 'Mozilla/5.0 (Options Strategy)' };
// Always kept for market-regime context even when ETFs are excluded.
export const REGIME_ETFS = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC', 'SMH'];
const JUNK = /warrant|\bunits?\b|\bright(s)?\b|preferred|depositary shares? represent|notes due|debenture|% (senior|notes|fixed)|trust preferred|acquisition corp/i;
const LEVERAGED = /\b(2x|3x|-1x|-2x|-3x|ultra|ultrapro|leveraged|inverse|short|bear|bull)\b/i;

let state = readJson(FILE, { builtAt: 0, symbols: [], stats: null });
let building = null;

async function text(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

export function autoUniverse() { return state; }

export function buildAutoUniverse(force = false) {
  const f = getSettings().scan;
  if (!force && state.symbols.length && Date.now() - state.builtAt < 6.5 * 86400000 && JSON.stringify(state.filters) === JSON.stringify(f)) return Promise.resolve(state);
  building ??= runLow(async () => {
    if (activeProvider().name === 'demo') {
      state = { builtAt: Date.now(), filters: f, symbols: DEFAULT_UNIVERSE.map(s => ({ symbol: s, name: s, etf: ['SPY', 'QQQ', 'IWM'].includes(s) })), stats: { source: 'demo list' } };
      writeJson(FILE, state);
      return state;
    }
    const [cboe, nasdaq, other] = await Promise.all([
      text('https://www.cboe.com/us/options/symboldir/equity_index_options/?download=csv'),
      text('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt'),
      text('https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'),
    ]);
    const optionable = new Set(cboe.split(/\r?\n/).slice(1).map(l => (l.match(/^"[^"]*","([^"]+)"/) || [])[1]).filter(Boolean));
    const listed = new Map();
    for (const l of nasdaq.split(/\r?\n/).slice(1)) { const x = l.split('|'); if (x.length > 7 && x[3] === 'N') listed.set(x[0], { name: x[1], etf: x[6] === 'Y' }); }
    for (const l of other.split(/\r?\n/).slice(1)) { const x = l.split('|'); if (x.length > 7 && x[6] === 'N') listed.set(x[0], { name: x[1], etf: x[4] === 'Y' }); }
    const cands = [...optionable].filter(s => /^[A-Z]{1,5}$/.test(s) && listed.has(s) && !JUNK.test(listed.get(s).name)
      && (f.includeEtfs ? !LEVERAGED.test(listed.get(s).name) || !listed.get(s).etf : !listed.get(s).etf || REGIME_ETFS.includes(s)));
    const quotes = await market.quotes(cands);
    const pass = cands.filter(s => {
      const q = quotes[s];
      if (!q) return false;
      if (REGIME_ETFS.includes(s)) return true;
      return q.last >= f.minPrice && q.avgVolume >= f.minAvgVolume && q.last * q.avgVolume >= f.minDollarVolume;
    }).map(s => ({ symbol: s, name: quotes[s].name || listed.get(s).name, etf: listed.get(s).etf }));
    if (pass.length < 50) throw new Error(`Universe build produced only ${pass.length} symbols; keeping the previous list`);
    state = { builtAt: Date.now(), filters: f, symbols: pass, stats: { optionable: optionable.size, candidates: cands.length, passed: pass.length } };
    writeJson(FILE, state);
    console.log(`[universe] ${pass.length} symbols (from ${cands.length} optionable listed)`);
    return state;
  }).finally(() => { building = null; });
  return building;
}

// Everything the scanner covers: auto universe (if enabled) + manual list + watchlist.
export function scanSymbols() {
  const s = getSettings();
  const auto = s.scan.mode === 'auto' ? state.symbols.map(x => x.symbol) : [];
  return [...new Set([...auto, ...s.universe, ...s.watchlist, 'SPY'])];
}
