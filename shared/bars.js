// Bar aggregation + chart transforms shared by the server (/api/bars) and the chart.
// Bars: { t (epoch seconds, UTC), o, h, l, c, v }.
import { nyOffsetHours } from './time.js';

const merge = group => ({
  t: group[0].t, o: group[0].o, h: Math.max(...group.map(b => b.h)), l: Math.min(...group.map(b => b.l)),
  c: group[group.length - 1].c, v: group.reduce((s, b) => s + (b.v || 0), 0),
});
function bucketize(bars, keyOf) {
  const out = [];
  let cur = null, key = null;
  for (const b of bars) {
    const k = keyOf(b);
    if (k !== key) { if (cur) out.push(merge(cur)); cur = [b]; key = k; } else cur.push(b);
  }
  if (cur) out.push(merge(cur));
  return out;
}

// Daily -> weekly (weeks start Monday) or monthly. The bar's time is its first session's date.
export function toWeekly(daily) {
  return bucketize(daily, b => {
    const d = new Date(b.t * 1000), dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    return Math.floor((b.t - dow * 86400) / 86400);
  });
}
export const toMonthly = daily => bucketize(daily, b => new Date(b.t * 1000).toISOString().slice(0, 7));

// Intraday -> N-minute bars aligned to the 9:30 ET open (so 1H = 9:30, 10:30, ...).
export function toMinutes(intraday, minutes) {
  return bucketize(intraday, b => {
    const d = new Date(b.t * 1000), off = nyOffsetHours(d);
    const ny = new Date(b.t * 1000 + off * 3600e3);
    const sinceOpen = ny.getUTCHours() * 60 + ny.getUTCMinutes() - 570;
    return `${ny.toISOString().slice(0, 10)}|${Math.floor(sinceOpen / minutes)}`;
  });
}

// Heikin Ashi candles (display only; never used for signals or P/L).
export function heikinAshi(bars) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], c = (b.o + b.h + b.l + b.c) / 4;
    const o = i ? (out[i - 1].o + out[i - 1].c) / 2 : (b.o + b.c) / 2;
    out.push({ t: b.t, o, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c), c, v: b.v });
  }
  return out;
}

export const INTERVALS = {
  '1m': { label: '1m', minutes: 1, intraday: true },
  '5m': { label: '5m', minutes: 5, intraday: true },
  '15m': { label: '15m', minutes: 15, intraday: true },
  '1h': { label: '1H', minutes: 60, intraday: true },
  D: { label: 'D' }, W: { label: 'W' }, M: { label: 'M' },
};
