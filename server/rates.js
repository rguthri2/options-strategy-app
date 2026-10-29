// Risk-free rate curve from the U.S. Treasury's daily published rates (free, no key):
// T-bill coupon-equivalent yields (4 weeks - 52 weeks) plus par yields (2, 3, 5 years).
// Yields are converted from bond-equivalent (semiannual) to continuous compounding and linearly
// interpolated by time to expiration. Falls back to RISK_FREE_RATE if the Treasury is unreachable.
import { config } from './config.js';
import { readJson, writeJson } from './store.js';

const FILE = 'rates.json';
let curve = readJson(FILE, null); // { asOf, points: [{ T, r }] }

const treasuryCsv = (type, year) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=${type}&field_tdr_date_value=${year}`;

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const row = lines[1].split(',').map(v => v.replace(/"/g, '').trim());
  return { date: row[0], cols: Object.fromEntries(head.map((h, i) => [h, Number(row[i])])) };
}

// Bond-equivalent (semiannual) yield in % -> continuously compounded decimal.
const toContinuous = pct => 2 * Math.log(1 + pct / 200);

export async function refreshRates() {
  try {
    const year = new Date().getFullYear();
    const [bills, par] = await Promise.all([
      fetch(treasuryCsv('daily_treasury_bill_rates', year)).then(r => (r.ok ? r.text() : Promise.reject(new Error(`bills ${r.status}`)))),
      fetch(treasuryCsv('daily_treasury_yield_curve', year)).then(r => (r.ok ? r.text() : Promise.reject(new Error(`par ${r.status}`)))),
    ]);
    const b = parseCsv(bills), p = parseCsv(par);
    const points = [];
    for (const [weeks, key] of [[4, '4 WEEKS COUPON EQUIVALENT'], [8, '8 WEEKS COUPON EQUIVALENT'], [13, '13 WEEKS COUPON EQUIVALENT'], [17, '17 WEEKS COUPON EQUIVALENT'], [26, '26 WEEKS COUPON EQUIVALENT'], [52, '52 WEEKS COUPON EQUIVALENT']]) {
      if (Number.isFinite(b.cols[key])) points.push({ T: (weeks * 7) / 365, r: toContinuous(b.cols[key]) });
    }
    for (const [yrs, key] of [[2, '2 Yr'], [3, '3 Yr'], [5, '5 Yr']]) {
      if (Number.isFinite(p.cols[key])) points.push({ T: yrs, r: toContinuous(p.cols[key]) });
    }
    if (points.length >= 3) {
      curve = { asOf: b.date, source: 'U.S. Treasury daily rates', points: points.sort((x, y) => x.T - y.T) };
      writeJson(FILE, curve);
    }
  } catch (e) {
    console.error('[rates]', e.message);
  }
  return curve;
}

// Continuously compounded risk-free rate for time T (years).
export function rateFor(T) {
  const pts = curve?.points;
  if (!pts?.length) return config.riskFreeRate;
  if (T <= pts[0].T) return pts[0].r;
  for (let i = 1; i < pts.length; i++) {
    if (T <= pts[i].T) {
      const a = pts[i - 1], b = pts[i];
      return a.r + ((b.r - a.r) * (T - a.T)) / (b.T - a.T);
    }
  }
  return pts[pts.length - 1].r;
}

export const ratesStatus = () => ({ asOf: curve?.asOf || null, source: curve?.source || `fixed ${config.riskFreeRate}`, points: curve?.points || [] });
