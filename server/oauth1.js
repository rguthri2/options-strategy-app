// OAuth 1.0a request signing (HMAC-SHA1), as used by the E*TRADE API.
import crypto from 'node:crypto';

// RFC 3986 percent-encoding (encodeURIComponent leaves !*'() unescaped).
export const pct = s => encodeURIComponent(String(s)).replace(/[!*'()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function signature(method, url, params, consumerSecret, tokenSecret = '') {
  const norm = Object.entries(params)
    .map(([k, v]) => [pct(k), pct(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const base = [method.toUpperCase(), pct(url), pct(norm)].join('&');
  return crypto.createHmac('sha1', `${pct(consumerSecret)}&${pct(tokenSecret)}`).update(base).digest('base64');
}

// Builds the Authorization header. `query` = the request's query params (they are part of the signature).
export function authHeader({ method = 'GET', url, query = {}, consumerKey, consumerSecret, token, tokenSecret, extra = {}, nonce, timestamp }) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...(token ? { oauth_token: token } : {}),
    ...extra,
  };
  oauth.oauth_signature = signature(method, url, { ...query, ...oauth }, consumerSecret, tokenSecret);
  return 'OAuth realm="",' + Object.entries(oauth).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(',');
}
