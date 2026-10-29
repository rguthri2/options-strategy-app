// Single-user password login with an HMAC-signed session cookie.
import crypto from 'node:crypto';
import { config } from './config.js';
import { readJson, writeJson } from './store.js';

const COOKIE = 'ot_session';

// Session secret: env var, or a random one generated once and persisted in the data dir.
function sessionSecret() {
  if (config.sessionSecret) return config.sessionSecret;
  const s = readJson('secret.json', {});
  if (!s.secret) { s.secret = crypto.randomBytes(32).toString('hex'); writeJson('secret.json', s); }
  return s.secret;
}
// Bind sessions to the current password hash: changing the password logs out every session.
const SECRET = sessionSecret() + '|' + config.passwordHash;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const sign = payload => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

function makeToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + config.sessionDays * 86400000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function validToken(token) {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const good = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function cookieOpts(maxAgeSec) {
  return [`Path=${config.basePath || '/'}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`, config.cookieSecure ? 'Secure' : '']
    .filter(Boolean).join('; ');
}

export const authEnabled = () => Boolean(config.passwordHash);

export function isAuthed(req) {
  return !authEnabled() || validToken(readCookie(req, COOKIE));
}

// Brute-force throttle: 8 failures per 15 minutes per IP.
const failures = new Map();
setInterval(() => {
  for (const [ip, f] of failures) if (Date.now() - f.first > 15 * 60000) failures.delete(ip);
}, 5 * 60000).unref();
function throttled(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > 15 * 60000) { failures.delete(ip); return false; }
  return f.count >= 8;
}

export function loginHandler(req, res) {
  const ip = req.ip;
  if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const pw = String(req.body?.password || '').slice(0, 256); // cap scrypt input
  if (authEnabled() && verifyPassword(pw, config.passwordHash)) {
    failures.delete(ip);
    res.setHeader('Set-Cookie', `${COOKIE}=${makeToken()}; ${cookieOpts(config.sessionDays * 86400)}`);
    return res.json({ ok: true });
  }
  const f = failures.get(ip) || { count: 0, first: Date.now() };
  f.count++; failures.set(ip, f);
  res.status(401).json({ error: 'Invalid password' });
}

export function logoutHandler(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieOpts(0)}`);
  res.json({ ok: true });
}

export function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect(`${config.basePath}/login.html`);
}
