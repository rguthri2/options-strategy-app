import express from 'express';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { requireAuth, loginHandler, logoutHandler, authEnabled, isAuthed } from './auth.js';
import { apiRouter } from './routes.js';
import { refreshHotlist, hotlistState } from './scanner.js';
import { refreshIdeas } from './strategies.js';
import { getSettings } from './settings.js';
import { marketSession, nyClock, nyDateStr } from '../shared/time.js';
import { etradeConnected, etradeConfigured, etradeRenew } from './providers/etrade.js';
import { refreshEarnings, earningsSource } from './earnings.js';
import { refreshRates } from './rates.js';
import { activeProvider } from './providers/index.js';
import { buildAutoUniverse, scanSymbols } from './universeAuto.js';
import { updateAllBars, storedBars } from './bars.js';
import { startDailySchedule } from './daily.js';
import { refreshFundamentals } from './fundamentals.js';
import { requestLogos } from './logos.js';
import { notifySetups, notifyPositions, telegramStatus, sendOnce } from './notify.js';
import { listPositions, evaluatePositions } from './positions.js';

// Never serve a production deployment without a login.
if (process.env.NODE_ENV === 'production' && !authEnabled()) {
  console.error('Refusing to start: NODE_ENV=production but no password is set. Run: npm run set-password -- "your-password"');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// Background jobs must never take the server down; log and carry on (PM2 would restart anyway).
process.on('unhandledRejection', e => console.error('[unhandled]', e?.message || e));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});

// Behind the HTTPS proxy: bounce any plain-HTTP request (reported via X-Forwarded-Proto) to HTTPS,
// so the password and session cookie never travel unencrypted. Direct localhost checks are untouched.
app.use((req, res, next) => {
  if (config.cookieSecure && req.get('x-forwarded-proto') === 'http' && ['GET', 'HEAD'].includes(req.method)) {
    return res.redirect(301, `https://${req.get('x-forwarded-host') || req.get('host')}${req.originalUrl}`);
  }
  next();
});

// CSRF defense in depth (on top of SameSite=Lax cookies): state-changing requests must come from this site.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin') || req.get('referer');
  if (!origin) return next(); // non-browser clients (curl) carry no ambient cookies to abuse
  try {
    // Behind OpenLiteSpeed the Host header may be the backend address, so also accept the
    // forwarded host (trusted only from the loopback proxy) and the configured PUBLIC_URL.
    const allowed = new Set([req.get('host'), req.hostname, config.publicUrl && new URL(config.publicUrl).host].filter(Boolean));
    const o = new URL(origin);
    if (allowed.has(o.host) || allowed.has(o.hostname)) return next();
  } catch { /* malformed */ }
  res.status(403).json({ error: 'Cross-site request blocked' });
});

const site = express.Router();
site.use(express.json({ limit: '200kb' }));

// Public: login page and its assets.
site.post('/api/login', loginHandler);
site.post('/api/logout', logoutHandler);
site.get('/api/me', (req, res) => res.json({ authed: isAuthed(req), authEnabled: authEnabled() }));
site.get('/login.html', (req, res) => res.sendFile(path.join(ROOT, 'public', 'login.html')));
site.use('/css', express.static(path.join(ROOT, 'public', 'css'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
site.get('/favicon.svg', (req, res) => res.sendFile(path.join(ROOT, 'public', 'favicon.svg')));
site.get('/js/login.js', (req, res) => res.sendFile(path.join(ROOT, 'public', 'js', 'login.js')));

// Everything below requires a session.
site.use(requireAuth);
site.use('/api', apiRouter());
// Revalidate app code on every load (cheap 304s via ETag) so updates reach the browser immediately.
const fresh = { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') };
site.use('/shared', express.static(path.join(ROOT, 'shared'), fresh));
site.use('/vendor', express.static(path.join(ROOT, 'node_modules', 'lightweight-charts', 'dist'), { maxAge: '7d' }));
site.use(express.static(path.join(ROOT, 'public'), { index: 'index.html', ...fresh }));

if (config.basePath) {
  app.get('/', (req, res) => res.redirect(`${config.basePath}/`));
  app.get(config.basePath, (req, res, next) => (req.originalUrl === config.basePath ? res.redirect(`${config.basePath}/`) : next()));
}
app.use(config.basePath || '/', site);

// Never leak stack traces (e.g. malformed JSON bodies) to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[error]', err.message);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.expose ? err.message : 'Bad request' });
});

app.listen(config.port, config.host, () => {
  console.log(`Options Trader on http://${config.host}:${config.port}${config.basePath}/  (auth ${authEnabled() ? 'on' : 'OFF - run npm run set-password'})`);
});

// ----- background scanning -----
let ratesAt = 0;
async function cycle() {
  try {
    if (Date.now() - ratesAt > 6 * 3600000) { await refreshRates(); ratesAt = Date.now(); }
    // Earnings refresh in the background (cached 12h; a full Finnhub pass takes ~1 min on the free tier).
    // Demo calendars are instant, so await those to have dates on the very first scan.
    const er = refreshEarnings(listPositions().map(p => p.symbol)).catch(e => console.error('[earnings]', e.message));
    if (earningsSource() !== 'finnhub') await er;
    await refreshHotlist();
    await refreshIdeas();
    console.log(`[scan] hot list ${hotlistState().rows.length} rows (${hotlistState().provider})`);
    await notifySetups(hotlistState().rows).catch(e => console.error('[telegram]', e.message));
    // Warm the logo cache for what you're most likely to look at (only missing/stale ones are fetched).
    const rows = hotlistState().rows;
    requestLogos([...getSettings().watchlist, ...rows.filter(r => r.traderSetups?.length).map(r => r.symbol),
      ...[...rows].sort((a, b) => b.score - a.score).slice(0, 150).map(r => r.symbol)]);
  } catch (e) {
    console.error('[scan] failed:', e.message);
  }
}

// E*TRADE: keep the session from idling out (2h rule) and remind on Telegram when a daily login is due.
setInterval(async () => {
  if (etradeConnected()) { await etradeRenew().catch(e => console.error('[etrade] renew', e.message)); return; }
  const { h, dow } = nyClock();
  if (etradeConfigured() && dow > 0 && dow < 6 && h >= 8 && h < 16 && telegramStatus().ready) {
    await sendOnce(`etrade-login|${nyDateStr()}`, '🔑 <b>E*TRADE session expired.</b> Log in again: Settings → Connect E*TRADE to resume live data.').catch(() => {});
  }
}, 30 * 60000).unref();

// Position alerts to Telegram every 5 minutes while the market is active.
setInterval(async () => {
  if (marketSession() === 'closed' || !telegramStatus().ready) return;
  try { await notifyPositions(await evaluatePositions()); } catch (e) { console.error('[telegram]', e.message); }
}, 5 * 60000).unref();

function schedule() {
  const s = marketSession();
  const mins = s === 'open' ? getSettings().refreshMinutes : s === 'closed' ? 120 : 30;
  setTimeout(async () => { await cycle(); schedule(); }, mins * 60000).unref();
}

// First boot on a live feed: build the universe and its price history in the background, then scan.
(async () => {
  try {
    await buildAutoUniverse();
    const syms = scanSymbols();
    const missing = syms.filter(s => !storedBars(s)).length;
    if (missing > 20 && activeProvider().name !== 'demo' && activeProvider().name !== 'etrade') {
      console.log(`[startup] fetching daily history for ${missing} symbols (background; ~${Math.ceil(missing / 100)} min)`);
      await updateAllBars(syms);
    }
  } catch (e) { console.error('[startup]', e.message); }
  await cycle();
  schedule();
  // Fundamentals for today's leaders (only stale ones are fetched; weekly cache).
  const rows = hotlistState().rows;
  refreshFundamentals(rows.filter(r => r.rsRating >= 80 || (r.traderSetups || []).some(s => s.trader === "O'Neil")).map(r => r.symbol))
    .then(p => (p?.total ? refreshHotlist() : null)).catch(() => {});
})();
startDailySchedule();
