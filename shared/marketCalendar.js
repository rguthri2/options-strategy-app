// NYSE trading calendar: holidays and 1:00 pm early closes (source: nyse.com/markets/hours-calendars,
// checked 2026-10-12). Regular session 9:30–16:00 ET. Extend the tables each year.
import { nyOffsetHours, nyDateStr, addDays } from './time.js';

export const NYSE_HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Washington's Birthday",
  '2026-04-03': 'Good Friday', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day', '2026-11-26': 'Thanksgiving Day', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Washington's Birthday",
  '2027-03-26': 'Good Friday', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)', '2027-07-05': 'Independence Day (observed)',
  '2027-09-06': 'Labor Day', '2027-11-25': 'Thanksgiving Day', '2027-12-24': 'Christmas Day (observed)',
  '2028-01-17': 'Martin Luther King Jr. Day', '2028-02-21': "Washington's Birthday", '2028-04-14': 'Good Friday',
  '2028-05-29': 'Memorial Day', '2028-06-19': 'Juneteenth', '2028-07-04': 'Independence Day', '2028-09-04': 'Labor Day',
  '2028-11-23': 'Thanksgiving Day', '2028-12-25': 'Christmas Day',
};
export const NYSE_EARLY_CLOSE = { '2026-11-27': 'Day after Thanksgiving', '2026-12-24': 'Christmas Eve', '2027-11-26': 'Day after Thanksgiving', '2028-07-03': 'Day before Independence Day', '2028-11-24': 'Day after Thanksgiving' };

const dow = d => new Date(d + 'T12:00:00Z').getUTCDay();
export const isTradingDay = d => dow(d) !== 0 && dow(d) !== 6 && !NYSE_HOLIDAYS[d];

// Epoch ms of a New York wall-clock time on date d (YYYY-MM-DD).
export function nyTime(d, h, m = 0) {
  const [y, mo, dd] = d.split('-').map(Number);
  return Date.UTC(y, mo - 1, dd, h, m) - nyOffsetHours(new Date(Date.UTC(y, mo - 1, dd, 12))) * 3600000;
}
export const openMs = d => nyTime(d, 9, 30);
export const closeMs = d => (NYSE_EARLY_CLOSE[d] ? nyTime(d, 13, 0) : nyTime(d, 16, 0));

export function nextTradingDay(d) {
  let x = addDays(d, 1);
  for (let k = 0; k < 15 && !isTradingDay(x); k++) x = addDays(x, 1);
  return x;
}

// Where we are now, and the next open/close.
// state: 'open' | 'pre' (4:00–9:30 on a trading day) | 'post' (close–20:00) | 'closed' (overnight, weekend, holiday).
export function marketClock(now = Date.now()) {
  const today = nyDateStr(new Date(now));
  const trading = isTradingDay(today);
  const o = openMs(today), c = closeMs(today);
  let state = 'closed';
  if (trading) {
    if (now >= o && now < c) state = 'open';
    else if (now >= nyTime(today, 4) && now < o) state = 'pre';
    else if (now >= c && now < nyTime(today, 20)) state = 'post';
  }
  const nextOpenDay = trading && now < o ? today : nextTradingDay(today);
  return {
    state, today, isTradingDay: trading, holiday: NYSE_HOLIDAYS[today] || null, earlyClose: trading ? NYSE_EARLY_CLOSE[today] || null : null,
    openAt: o, closeAt: c,
    nextOpen: openMs(nextOpenDay), nextOpenDay, nextOpenEarlyClose: NYSE_EARLY_CLOSE[nextOpenDay] || null,
    msToOpen: state === 'open' ? 0 : openMs(nextOpenDay) - now, msToClose: state === 'open' ? c - now : null,
    sessionProgress: state === 'open' ? (now - o) / (c - o) : null,
  };
}
