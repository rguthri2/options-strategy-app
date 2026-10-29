// Company logos for the UI, fetched from Finnhub's company profile and cached on disk (data/logos).
// Served from our own origin (CSP img-src 'self'). Raster images only: SVG is refused because it can
// carry scripts. Missing logos get a "none" marker so we don't ask Finnhub again for a week; the
// browser then shows a letter avatar.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { readJson, writeJson } from './store.js';
import { fundamentalsProgress } from './fundamentals.js';

const DIR = path.join(config.dataDir, 'logos');
const INDEX = 'logos/index.json';
const OK_TTL = 30 * 86400000, NONE_TTL = 7 * 86400000, MAX_BYTES = 300 * 1024;
const SYM_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

let index = null;
const idx = () => (index ??= readJson(INDEX, {}));
const saveIndex = () => writeJson(INDEX, idx());
const fileOf = (sym, ext) => path.join(DIR, `${sym.replace(/\./g, '_')}.${ext}`);

// Real image type from the first bytes (never trust the server's Content-Type alone).
export function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// ---------- fetch queue (Finnhub free tier: 60 calls/min, shared with earnings + fundamentals) ----------
const queue = [], queued = new Set();
let running = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Only Finnhub's own image servers, over HTTPS.
export function finnhubHost(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && (x.hostname === 'finnhub.io' || x.hostname.endsWith('.finnhub.io')); } catch { return false; }
}
// Finnhub's logo URLs redirect between its static hosts (static2 -> static9). Follow up to 3 hops,
// re-checking every hop so a redirect can never lead anywhere outside finnhub.io.
export async function fetchFinnhub(url) {
  for (let hop = 0; hop < 4; hop++) {
    if (!finnhubHost(url)) return null;
    const res = await fetch(url, { redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const next = res.headers.get('location');
    if (!next) return null;
    url = new URL(next, url).href;
  }
  return null;
}

async function fetchLogo(sym) {
  const u = new URL('https://finnhub.io/api/v1/stock/profile2');
  u.searchParams.set('symbol', sym); u.searchParams.set('token', config.finnhubKey);
  const res = await fetch(u);
  if (res.status === 429) return 'retry';
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  const logoUrl = (await res.json())?.logo;
  if (!finnhubHost(logoUrl)) return 'none';
  // Prefer the raster version (Finnhub publishes .png next to .svg; SVG is never served by us).
  const img = await fetchFinnhub(logoUrl.replace(/\.svg(\?.*)?$/i, '.png'));
  if (!img?.ok) return 'none';
  const buf = Buffer.from(await img.arrayBuffer());
  const ext = buf.length <= MAX_BYTES ? sniff(buf) : null;
  if (!ext) return 'none';
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileOf(sym, ext), buf, { mode: 0o600 });
  return ext;
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      // Finnhub's 60/min is shared: let the nightly fundamentals refresh go first.
      while (fundamentalsProgress().running) await sleep(5000);
      const sym = queue.shift();
      try {
        const r = await fetchLogo(sym);
        if (r === 'retry') { queue.push(sym); await sleep(30000); continue; }
        idx()[sym] = { t: Date.now(), ext: r === 'none' ? null : r, v: LOGO_V };
        saveIndex();
      } catch { idx()[sym] = { t: Date.now(), ext: null, err: true, v: LOGO_V }; saveIndex(); }
      queued.delete(sym);
      await sleep(1300);
    }
  } finally { running = false; }
}

// "No logo" markers from before redirects were followed (v < 2) are wrong: retry them.
const LOGO_V = 2;
const fresh = e => e && (e.ext || e.v >= LOGO_V) && Date.now() - e.t < (e.ext ? OK_TTL : NONE_TTL);
export function requestLogos(symbols) {
  if (!config.finnhubKey) return;
  for (const s of symbols) {
    const sym = String(s).toUpperCase();
    if (!SYM_RE.test(sym) || sym.startsWith('$') || queued.has(sym) || fresh(idx()[sym])) continue;
    queued.add(sym); queue.push(sym);
  }
  drain();
}

export const logoProgress = () => ({ cached: Object.values(idx()).filter(e => e.ext).length, none: Object.values(idx()).filter(e => !e.ext).length, queued: queue.length });

// GET /api/logo/:symbol -> the image, or 404 (the browser falls back to a letter avatar).
export function sendLogo(raw, res) {
  const sym = raw.toUpperCase();
  if (!SYM_RE.test(sym)) return res.status(404).end();
  const e = idx()[sym];
  if (e?.ext && fs.existsSync(fileOf(sym, e.ext))) {
    res.setHeader('Content-Type', TYPES[e.ext]);
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(fs.readFileSync(fileOf(sym, e.ext)));
  }
  if (!fresh(e)) requestLogos([sym]);
  // Known "no logo": let the browser cache the 404 for a day; pending: don't cache, retry next view.
  res.setHeader('Cache-Control', fresh(e) && !e.ext ? 'private, max-age=86400' : 'no-store');
  return res.status(404).end();
}
