// Market-time helpers. Options expire at 16:00 America/New_York.
import { marketClock, isTradingDay, closeMs } from './marketCalendar.js';

const MS_YEAR = 365 * 24 * 3600 * 1000;
const offsetFmt = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
  : null;

// Hours offset of New York from UTC at the given instant (e.g. -4 in summer, -5 in winter).
export function nyOffsetHours(date = new Date()) {
  const part = offsetFmt?.formatToParts(date).find(p => p.type === 'timeZoneName')?.value || 'GMT-5';
  const m = part.match(/GMT([+-]\d+)(?::(\d+))?/);
  return m ? Number(m[1]) + (m[2] ? Math.sign(Number(m[1])) * Number(m[2]) / 60 : 0) : -5;
}

// Epoch ms of 16:00 New York on the given YYYY-MM-DD.
export function expiryMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  return Date.UTC(y, m - 1, d, 16 - nyOffsetHours(noonUtc));
}

export function yearsToExpiry(dateStr, now = Date.now()) {
  return Math.max(0, (expiryMs(dateStr) - now) / MS_YEAR);
}

// Calendar days to expiration (0 on expiration day).
export function daysToExpiry(dateStr, now = Date.now()) {
  const today = nyDateStr(new Date(now));
  return Math.round((Date.parse(dateStr + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
}

// YYYY-MM-DD in New York.
export function nyDateStr(date = new Date()) {
  const shifted = new Date(date.getTime() + nyOffsetHours(date) * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

// {h, m, dow} wall-clock in New York.
export function nyClock(date = new Date()) {
  const shifted = new Date(date.getTime() + nyOffsetHours(date) * 3600 * 1000);
  return { h: shifted.getUTCHours(), m: shifted.getUTCMinutes(), dow: shifted.getUTCDay() };
}

// open | pre | post | closed, using the NYSE calendar (holidays closed, 1:00 pm early closes).
export function marketSession(date = new Date()) {
  return marketClock(date.getTime()).state;
}

// Valuation time for option math. While the market is open that's now; otherwise quotes are the
// last session's closing marks, so time to expiry is measured from that close (16:00 ET). Using
// "now" on a weekend would shrink time-to-expiry with unchanged prices and overstate IV.
export function valuationTime(date = new Date()) {
  const now = date.getTime(), clk = marketClock(now);
  if (clk.state === 'open') return now;
  // Closed: value at the last session's close (holidays skipped; 1:00 pm on early-close days).
  let d = clk.today;
  if (!(clk.isTradingDay && now >= clk.closeAt)) { do { d = addDays(d, -1); } while (!isTradingDay(d)); }
  return closeMs(d);
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
