// Black-Scholes-Merton pricing, Greeks and implied volatility.
// Shared by the server (scanner / demo data) and the browser (what-if, builder).
// Conventions: T in years, sigma/r/q as decimals, theta per calendar day,
// vega and rho per 1 percentage point.

const SQRT2PI = Math.sqrt(2 * Math.PI);

export function normPdf(x) {
  return Math.exp(-0.5 * x * x) / SQRT2PI;
}

// Cody-style rational approximation via erfc; max abs error ~1e-7.
export function normCdf(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * z);
  const erfc = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - 0.5 * erfc : 0.5 * erfc;
}

function d1d2(S, K, T, sigma, r, q) {
  const vt = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / vt;
  return [d1, d1 - vt];
}

export function intrinsic(type, S, K) {
  return type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
}

export function price(type, S, K, T, sigma, r = 0.04, q = 0) {
  if (!(T > 0) || !(sigma > 0) || !(S > 0) || !(K > 0)) return intrinsic(type, S, K);
  const [d1, d2] = d1d2(S, K, T, sigma, r, q);
  const dfq = Math.exp(-q * T), dfr = Math.exp(-r * T);
  return type === 'call'
    ? S * dfq * normCdf(d1) - K * dfr * normCdf(d2)
    : K * dfr * normCdf(-d2) - S * dfq * normCdf(-d1);
}

export function greeks(type, S, K, T, sigma, r = 0.04, q = 0) {
  if (!(T > 0) || !(sigma > 0) || !(S > 0) || !(K > 0)) {
    const itm = type === 'call' ? S > K : S < K;
    return { price: intrinsic(type, S, K), delta: itm ? (type === 'call' ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const sqT = Math.sqrt(T);
  const [d1, d2] = d1d2(S, K, T, sigma, r, q);
  const dfq = Math.exp(-q * T), dfr = Math.exp(-r * T);
  const pdf = normPdf(d1);
  const gamma = dfq * pdf / (S * sigma * sqT);
  const vega = S * dfq * pdf * sqT / 100;
  let p, delta, theta, rho;
  if (type === 'call') {
    p = S * dfq * normCdf(d1) - K * dfr * normCdf(d2);
    delta = dfq * normCdf(d1);
    theta = (-S * dfq * pdf * sigma / (2 * sqT) - r * K * dfr * normCdf(d2) + q * S * dfq * normCdf(d1)) / 365;
    rho = K * T * dfr * normCdf(d2) / 100;
  } else {
    p = K * dfr * normCdf(-d2) - S * dfq * normCdf(-d1);
    delta = -dfq * normCdf(-d1);
    theta = (-S * dfq * pdf * sigma / (2 * sqT) + r * K * dfr * normCdf(-d2) - q * S * dfq * normCdf(-d1)) / 365;
    rho = -K * T * dfr * normCdf(-d2) / 100;
  }
  return { price: p, delta, gamma, theta, vega, rho };
}

// Newton-Raphson with bisection fallback. Returns NaN when price is outside no-arbitrage bounds.
export function impliedVol(type, optPrice, S, K, T, r = 0.04, q = 0) {
  if (!(optPrice > 0) || !(T > 0)) return NaN;
  const lower = Math.max(0, type === 'call' ? S * Math.exp(-q * T) - K * Math.exp(-r * T) : K * Math.exp(-r * T) - S * Math.exp(-q * T));
  const upper = type === 'call' ? S : K;
  if (optPrice <= lower + 1e-9 || optPrice >= upper) return NaN;
  let lo = 0.001, hi = 6, sigma = 0.4;
  for (let i = 0; i < 60; i++) {
    const p = price(type, S, K, T, sigma, r, q);
    const diff = p - optPrice;
    if (Math.abs(diff) < 1e-6) return sigma;
    if (diff > 0) hi = sigma; else lo = sigma;
    const v = greeks(type, S, K, T, sigma, r, q).vega * 100;
    let next = v > 1e-8 ? sigma - diff / v : NaN;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    sigma = next;
  }
  return sigma;
}

// ---------- American options: Barone-Adesi & Whaley (1987) quadratic approximation ----------
// Cost of carry b = r - q. Critical-price iteration follows Haug, "The Complete Guide to Option
// Pricing Formulas" (2nd ed.). Accurate to a few basis points of price for listed-equity inputs.

function bawCallCritical(K, T, r, b, v) {
  const N = (2 * b) / (v * v), m = (2 * r) / (v * v);
  const q2u = (-(N - 1) + Math.sqrt((N - 1) ** 2 + 4 * m)) / 2;
  const su = K / (1 - 1 / q2u);
  const h2 = -(b * T + 2 * v * Math.sqrt(T)) * (K / (su - K));
  let Si = K + (su - K) * (1 - Math.exp(h2));
  const k = (2 * r) / (v * v * (1 - Math.exp(-r * T)));
  const Q2 = (-(N - 1) + Math.sqrt((N - 1) ** 2 + 4 * k)) / 2;
  const cf = Math.exp((b - r) * T), vt = v * Math.sqrt(T);
  for (let i = 0; i < 100; i++) {
    const d1 = (Math.log(Si / K) + (b + (v * v) / 2) * T) / vt;
    const LHS = Si - K;
    const RHS = price('call', Si, K, T, v, r, r - b) + ((1 - cf * normCdf(d1)) * Si) / Q2;
    if (Math.abs(LHS - RHS) / K < 1e-7) break;
    const bi = cf * normCdf(d1) * (1 - 1 / Q2) + (1 - (cf * normPdf(d1)) / vt) / Q2;
    Si = (K + RHS - bi * Si) / (1 - bi);
  }
  return Si;
}

function bawPutCritical(K, T, r, b, v) {
  const N = (2 * b) / (v * v), m = (2 * r) / (v * v);
  const q1u = (-(N - 1) - Math.sqrt((N - 1) ** 2 + 4 * m)) / 2;
  const su = K / (1 - 1 / q1u);
  const h1 = (b * T - 2 * v * Math.sqrt(T)) * (K / (K - su));
  let Si = su + (K - su) * Math.exp(h1);
  const k = (2 * r) / (v * v * (1 - Math.exp(-r * T)));
  const Q1 = (-(N - 1) - Math.sqrt((N - 1) ** 2 + 4 * k)) / 2;
  const cf = Math.exp((b - r) * T), vt = v * Math.sqrt(T);
  for (let i = 0; i < 100; i++) {
    const d1 = (Math.log(Si / K) + (b + (v * v) / 2) * T) / vt;
    const LHS = K - Si;
    const RHS = price('put', Si, K, T, v, r, r - b) - ((1 - cf * normCdf(-d1)) * Si) / Q1;
    if (Math.abs(LHS - RHS) / K < 1e-7) break;
    const bi = -cf * normCdf(-d1) * (1 - 1 / Q1) - (1 + (cf * normPdf(-d1)) / vt) / Q1;
    Si = (K - RHS + bi * Si) / (1 + bi);
  }
  return Si;
}

// American option price (continuous dividend yield q).
export function americanPrice(type, S, K, T, sigma, r = 0.04, q = 0) {
  if (!(T > 0) || !(sigma > 0) || !(S > 0) || !(K > 0)) return intrinsic(type, S, K);
  const b = r - q;
  const euro = price(type, S, K, T, sigma, r, q);
  if (type === 'call') {
    if (b >= r) return euro; // no dividends: never optimal to exercise a call early
    const Sk = bawCallCritical(K, T, r, b, sigma);
    if (!(Sk > 0) || S >= Sk) return Math.max(euro, S - K);
    const N = (2 * b) / (sigma * sigma), k = (2 * r) / (sigma * sigma * (1 - Math.exp(-r * T)));
    const Q2 = (-(N - 1) + Math.sqrt((N - 1) ** 2 + 4 * k)) / 2;
    const d1 = (Math.log(Sk / K) + (b + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
    const A2 = (Sk / Q2) * (1 - Math.exp((b - r) * T) * normCdf(d1));
    return Math.max(euro + A2 * (S / Sk) ** Q2, S - K);
  }
  if (!(r > 0)) return euro; // no early-exercise value for puts without a positive rate
  const Sk = bawPutCritical(K, T, r, b, sigma);
  if (!(Sk > 0) || S <= Sk) return Math.max(euro, K - S);
  const N = (2 * b) / (sigma * sigma), k = (2 * r) / (sigma * sigma * (1 - Math.exp(-r * T)));
  const Q1 = (-(N - 1) - Math.sqrt((N - 1) ** 2 + 4 * k)) / 2;
  const d1 = (Math.log(Sk / K) + (b + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const A1 = -(Sk / Q1) * (1 - Math.exp((b - r) * T) * normCdf(-d1));
  return Math.max(euro + A1 * (S / Sk) ** Q1, K - S);
}

// Implied volatility under the American model (bracketed bisection/secant; monotone in sigma).
export function impliedVolAmerican(type, optPrice, S, K, T, r = 0.04, q = 0) {
  if (!(optPrice > 0) || !(T > 0)) return NaN;
  const intr = intrinsic(type, S, K);
  if (optPrice <= intr + 1e-6) return NaN; // no time value: IV not identifiable
  let lo = 0.005, hi = 6;
  if (americanPrice(type, S, K, T, hi, r, q) < optPrice) return NaN;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (americanPrice(type, S, K, T, mid, r, q) > optPrice) hi = mid; else lo = mid;
    if (hi - lo < 1e-6) break;
  }
  return (lo + hi) / 2;
}

// Greeks of any pricer by central finite differences. Units match greeks(): theta per calendar day,
// vega per 1 vol point, rho per 1 percentage point.
export function greeksNumeric(pricer, type, S, K, T, sigma, r = 0.04, q = 0) {
  const P = (s = S, t = T, v = sigma, rr = r) => pricer(type, s, K, t, v, rr, q);
  const p0 = P();
  const dS = Math.max(S * 1e-3, 1e-4);
  const up = P(S + dS), dn = P(S - dS);
  const day = 1 / 365;
  return {
    price: p0,
    delta: (up - dn) / (2 * dS),
    gamma: (up - 2 * p0 + dn) / (dS * dS),
    theta: T > day ? P(S, T - day) - p0 : -p0 + intrinsic(type, S, K),
    vega: (P(S, T, sigma + 0.005) - P(S, T, Math.max(1e-4, sigma - 0.005))) / 1,
    rho: (P(S, T, sigma, r + 0.0005) - P(S, T, sigma, r - 0.0005)) / 0.1,
  };
}

// Probability (lognormal, drift r - q) that S_T ends above K.
export function probAbove(S, K, T, sigma, r = 0, q = 0) {
  if (!(T > 0) || !(sigma > 0)) return S > K ? 1 : 0;
  return normCdf(d1d2(S, K, T, sigma, r, q)[1]);
}
