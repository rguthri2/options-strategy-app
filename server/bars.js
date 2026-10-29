// Daily bar store for the full-market scan: ~2 years per symbol on disk (data/bars/), updated
// incrementally after each close. Split/dividend re-adjustments are detected by comparing the
// overlap with the provider's adjusted history and trigger a full refetch.
import { readJson, writeJson } from './store.js';
import { activeProvider } from './providers/index.js';
import { runLow } from './priority.js';
import { nyDateStr, nyClock, addDays } from '../shared/time.js';

const KEEP = 520;
const mem = new Map();
const file = sym => `bars/${sym.replace(/[^A-Z0-9$.-]/gi, '_')}.json`;
const iso = t => new Date(t * 1000).toISOString().slice(0, 10);
const isWk = d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w > 0 && w < 6; };

// Most recent session whose final daily bar should be available (bars settle ~16:30 ET).
export function lastSettledSession(now = new Date()) {
  let d = nyDateStr(now);
  const { h, m } = nyClock(now);
  if (!(isWk(d) && h * 60 + m >= 16 * 60 + 30)) do { d = addDays(d, -1); } while (!isWk(d));
  return d;
}

export function storedBars(sym) {
  if (mem.has(sym)) return mem.get(sym);
  const s = readJson(file(sym), null);
  if (s) mem.set(sym, s);
  return s;
}

function save(sym, bars, asOf) {
  const s = { asOf, bars: bars.slice(-KEEP) };
  mem.set(sym, s);
  writeJson(file(sym), s);
  return s;
}

async function refresh(sym, p, asOf) {
  const stored = storedBars(sym);
  if (stored?.bars?.length > 50 && p.getDailyHistorySince) {
    const last = stored.bars[stored.bars.length - 1];
    const fresh = await p.getDailyHistorySince(sym, addDays(iso(last.t), -7));
    const overlap = fresh.find(b => b.t === last.t);
    if (overlap && Math.abs(overlap.c / last.c - 1) < 0.005) {
      const byT = new Map(stored.bars.map(b => [b.t, b]));
      for (const b of fresh) byT.set(b.t, b);
      return save(sym, [...byT.values()].sort((a, b) => a.t - b.t), asOf);
    }
    // Missing overlap or prices re-adjusted (split/special dividend): rebuild from scratch.
  }
  return save(sym, await p.getDailyHistory(sym, 2), asOf);
}

// Stored bars for one symbol, fetching them now if missing (interactive use).
export async function barsFor(sym) {
  const p = activeProvider();
  const s = storedBars(sym);
  if (s?.bars?.length && s.asOf >= lastSettledSession()) return s.bars;
  try { return (await refresh(sym, p, lastSettledSession())).bars; } catch (e) { if (s?.bars?.length) return s.bars; throw e; }
}

let progress = { running: false, done: 0, total: 0, errors: 0, startedAt: 0, finishedAt: 0 };
export const barsProgress = () => progress;

// Bring every symbol up to the last settled session (background priority, 4 at a time).
export function updateAllBars(symbols) {
  if (progress.running) return Promise.resolve(progress);
  const p = activeProvider();
  if (p.name === 'demo' || p.name === 'etrade') return Promise.resolve(progress); // demo generates; E*TRADE uses the Tiingo store
  const asOf = lastSettledSession();
  const todo = symbols.filter(s => !(storedBars(s)?.asOf >= asOf));
  progress = { running: true, done: symbols.length - todo.length, total: symbols.length, errors: 0, startedAt: Date.now(), finishedAt: 0 };
  return runLow(async () => {
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < todo.length) {
        const sym = todo[i++];
        try { await refresh(sym, p, asOf); } catch { progress.errors++; }
        progress.done++;
      }
    }));
    progress = { ...progress, running: false, finishedAt: Date.now() };
    console.log(`[bars] updated ${todo.length} symbols (${progress.errors} errors) in ${((Date.now() - progress.startedAt) / 60000).toFixed(1)} min`);
    return progress;
  });
}

// Append/replace today's bar from a live quote (during and after the session).
export function withLiveBar(bars, q, session) {
  if (!bars?.length || !q || !Number.isFinite(q.last)) return bars;
  const t = Date.parse(nyDateStr() + 'T00:00:00Z') / 1000;
  const last = bars[bars.length - 1];
  const live = { t, o: q.open || q.last, h: Math.max(q.high || q.last, q.last), l: Math.min(q.low || q.last, q.last), c: q.last, v: q.volume || 0 };
  if (last.t === t) return [...bars.slice(0, -1), live];
  if ((session === 'open' || session === 'post') && last.t < t) return [...bars, live];
  return bars;
}
