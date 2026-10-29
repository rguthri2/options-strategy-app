import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const env = process.env;
const basePath = (env.BASE_PATH ?? '/optionsTrader').replace(/\/+$/, '');

export const config = {
  port: Number(env.PORT || 3100),
  host: env.HOST || '127.0.0.1',
  basePath: basePath === '/' ? '' : basePath,
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  sessionSecret: env.SESSION_SECRET || '',
  passwordHash: env.APP_PASSWORD_HASH || '',
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  sessionDays: Number(env.SESSION_DAYS || 14),
  provider: (env.DATA_PROVIDER || 'auto').toLowerCase(),
  riskFreeRate: Number(env.RISK_FREE_RATE || 0.04),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
  finnhubKey: env.FINNHUB_API_KEY || '',
  tiingoKey: env.TIINGO_API_KEY || '',
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  tradier: {
    token: env.TRADIER_API_KEY || '',
    sandbox: (env.TRADIER_SANDBOX || 'false').toLowerCase() === 'true',
  },
  etrade: {
    key: env.ETRADE_CONSUMER_KEY || '',
    secret: env.ETRADE_CONSUMER_SECRET || '',
    sandbox: (env.ETRADE_SANDBOX || 'false').toLowerCase() === 'true',
  },
  telegram: { token: env.TELEGRAM_BOT_TOKEN || '', chatId: env.TELEGRAM_CHAT_ID || '' },
  schwab: {
    clientId: env.SCHWAB_CLIENT_ID || '',
    clientSecret: env.SCHWAB_CLIENT_SECRET || '',
    callbackUrl: env.SCHWAB_CALLBACK_URL || '',
  },
};

fs.mkdirSync(path.join(config.dataDir, 'logs'), { recursive: true });
