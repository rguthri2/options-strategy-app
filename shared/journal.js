// Trade journal math: one trade = one instrument (stock, single option or vertical spread) with any number of
// buy/sell fills, so scaling in and out is exact. Average-cost accounting per trade; P/L is net of fees.
// Pure functions (no I/O) so the numbers are unit-tested and identical on server and client.

export const OPTION_MULT = 100;
const DAY = 86400000;

// "2026-09-28" or "2026-09-28T09:41" -> ms at that date's midnight UTC (calendar-day arithmetic, no TZ drift).
const dayMs = d => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
export const holdDays = (from, to) => Math.max(0, Math.round((dayMs(to) - dayMs(from)) / DAY));

export const multiplier = t => (t.assetType === 'option' ? OPTION_MULT : 1);
const openSide = t => (t.direction === 'short' ? 'sell' : 'buy');

export function sortFills(fills) {
  return fills.map((f, k) => ({ f, k })).sort((a, b) => String(a.f.date).localeCompare(String(b.f.date)) || a.k - b.k).map(x => x.f);
}

// Replays the fills. `mark` (current price of the instrument) adds unrealized P/L for open size.
export function computeTrade(t, mark = null, today = new Date().toISOString().slice(0, 10)) {
  const mult = multiplier(t), long = t.direction !== 'short', side = openSide(t);
  let pos = 0, avg = 0, realized = 0, fees = 0, openedQty = 0, openedNotional = 0, closedQty = 0, closedNotional = 0, maxPos = 0;
  let exitDate = null, firstPrice = null;
  const fills = sortFills(t.fills || []);
  for (const f of fills) {
    fees += f.fees || 0;
    if (f.side === side) {
      if (firstPrice === null) firstPrice = f.price;
      avg = (avg * pos + f.price * f.qty) / (pos + f.qty);
      pos += f.qty; openedQty += f.qty; openedNotional += f.price * f.qty;
      exitDate = null;
      maxPos = Math.max(maxPos, pos);
    } else {
      const q = Math.min(f.qty, pos);
      realized += (long ? f.price - avg : avg - f.price) * q * mult;
      pos -= q; closedQty += q; closedNotional += f.price * q;
      if (pos === 0) { exitDate = f.date; avg = 0; }
    }
  }
  const entryDate = fills[0]?.date ?? null;
  const status = !fills.length ? 'planned' : pos > 0 ? 'open' : 'closed';
  const avgEntry = openedQty ? openedNotional / openedQty : null;
  const avgExit = closedQty ? closedNotional / closedQty : null;
  const realizedNet = realized - fees;
  const unrealized = pos > 0 && Number.isFinite(mark) ? (long ? mark - avg : avg - mark) * pos * mult : null;

  // Initial risk: explicit $ amount, else distance from the first entry to the stop x total size.
  let risk = Number(t.riskAmount) > 0 ? Number(t.riskAmount) : null;
  if (risk === null && Number.isFinite(t.stop) && t.stop > 0 && firstPrice !== null) {
    const perUnit = long ? firstPrice - t.stop : t.stop - firstPrice;
    if (perUnit > 0) risk = perUnit * maxPos * mult;
  }
  // Long options/debit spreads: premium paid is the most you can lose.
  if (risk === null && t.assetType === 'option' && long && avgEntry) risk = avgEntry * maxPos * mult;

  const closedBasis = avgEntry && closedQty ? avgEntry * closedQty * mult : null;
  return {
    status, entryDate, exitDate: status === 'closed' ? exitDate : null,
    days: entryDate ? holdDays(entryDate, status === 'closed' ? exitDate : today) : null,
    entrySize: openedQty, exitSize: closedQty, openSize: pos, maxSize: maxPos,
    avgEntry, avgExit, avgCost: pos > 0 ? avg : null, fees,
    realized: realizedNet, unrealized, mark: pos > 0 && Number.isFinite(mark) ? mark : null,
    pnlPct: closedBasis ? realizedNet / closedBasis : null,
    risk, r: risk && closedQty ? realizedNet / risk : null,
    exposure: pos > 0 ? (Number.isFinite(mark) ? mark : avg) * pos * mult : 0,
    openRisk: pos > 0 && Number.isFinite(t.stop) && t.stop > 0 ? Math.max(0, (long ? avg - t.stop : t.stop - avg) * pos * mult) : null,
  };
}

const groupStats = list => {
  const n = list.length, wins = list.filter(x => x.realized > 0).length;
  const rs = list.filter(x => Number.isFinite(x.r));
  return { n, wins, winRate: n ? wins / n : null, net: list.reduce((s, x) => s + x.realized, 0), avgR: rs.length ? rs.reduce((s, x) => s + x.r, 0) / rs.length : null };
};
const groupBy = (list, key) => {
  const m = new Map();
  for (const x of list) { const k = key(x) || '—'; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return [...m.entries()].map(([k, v]) => ({ key: k, ...groupStats(v) })).sort((a, b) => b.net - a.net);
};

// Performance statistics over CLOSED trades (each item = trade merged with its computeTrade result).
export function journalStats(items) {
  const closed = items.filter(x => x.status === 'closed').sort((a, b) => String(a.exitDate).localeCompare(String(b.exitDate)));
  const wins = closed.filter(x => x.realized > 0), losses = closed.filter(x => x.realized < 0);
  const sum = a => a.reduce((s, x) => s + x.realized, 0);
  const gp = sum(wins), gl = sum(losses), net = gp + gl;
  const avgWin = wins.length ? gp / wins.length : null, avgLoss = losses.length ? gl / losses.length : null;
  const rs = closed.filter(x => Number.isFinite(x.r));
  const hold = a => (a.length ? a.reduce((s, x) => s + (x.days || 0), 0) / a.length : null);

  let cum = 0, peak = 0, maxDD = 0, streakW = 0, streakL = 0, maxW = 0, maxL = 0;
  const curve = [];
  for (const x of closed) {
    cum += x.realized; peak = Math.max(peak, cum); maxDD = Math.max(maxDD, peak - cum);
    curve.push({ date: String(x.exitDate).slice(0, 10), cum, symbol: x.symbol });
    if (x.realized > 0) { streakW++; streakL = 0; } else if (x.realized < 0) { streakL++; streakW = 0; } else { streakW = 0; streakL = 0; }
    maxW = Math.max(maxW, streakW); maxL = Math.max(maxL, streakL);
  }
  const open = items.filter(x => x.status === 'open');
  return {
    trades: closed.length, wins: wins.length, losses: losses.length, breakeven: closed.length - wins.length - losses.length,
    winRate: closed.length ? wins.length / closed.length : null,
    net, grossProfit: gp, grossLoss: gl, fees: closed.reduce((s, x) => s + x.fees, 0),
    avgWin, avgLoss, payoff: avgWin !== null && avgLoss ? avgWin / -avgLoss : null,
    profitFactor: gl < 0 ? gp / -gl : gp > 0 ? Infinity : null,
    expectancy: closed.length ? net / closed.length : null,
    avgR: rs.length ? rs.reduce((s, x) => s + x.r, 0) / rs.length : null, rTrades: rs.length,
    largestWin: wins.length ? Math.max(...wins.map(x => x.realized)) : null,
    largestLoss: losses.length ? Math.min(...losses.map(x => x.realized)) : null,
    avgHoldWin: hold(wins), avgHoldLoss: hold(losses),
    maxConsecWins: maxW, maxConsecLosses: maxL, maxDrawdown: maxDD, curve,
    bySetup: groupBy(closed, x => x.setup), byAsset: groupBy(closed, x => (x.assetType === 'option' ? 'Options' : 'Stocks') + (x.direction === 'short' ? ' · short' : ' · long')),
    byAccount: groupBy(closed, x => x.account || 'No account'),
    byMonth: groupBy(closed, x => String(x.exitDate).slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key)),
    open: {
      count: open.length, exposure: open.reduce((s, x) => s + x.exposure, 0),
      unrealized: open.reduce((s, x) => s + (x.unrealized || 0), 0),
      realized: open.reduce((s, x) => s + x.realized, 0), // partial exits on still-open trades
      risk: open.reduce((s, x) => s + (x.openRisk || 0), 0),
    },
  };
}

export function describeInstrument(t) {
  if (t.assetType !== 'option') return t.symbol;
  const d = new Date(t.expiry + 'T12:00:00Z');
  const exp = `${d.getUTCDate()} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${String(d.getUTCFullYear()).slice(2)}`;
  const k = x => (Number.isInteger(x) ? String(x) : String(+x.toFixed(2)));
  const c = t.optionType === 'put' ? 'P' : 'C';
  return t.strike2 ? `${t.symbol} ${exp} ${k(t.strike)}/${k(t.strike2)}${c} spread` : `${t.symbol} ${exp} ${k(t.strike)}${c}`;
}
