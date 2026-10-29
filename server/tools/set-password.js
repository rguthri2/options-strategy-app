// Usage: npm run set-password -- "your password"
// Writes APP_PASSWORD_HASH (and a SESSION_SECRET if missing) into .env.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from '../config.js';
import { hashPassword } from '../auth.js';

const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error('Usage: npm run set-password -- "a-strong-password"   (min 10 chars)');
  process.exit(1);
}

const envPath = path.join(ROOT, '.env');
let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const set = (key, value) => {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, () => line) : `${text.trimEnd()}\n${line}\n`;
};
set('APP_PASSWORD_HASH', hashPassword(pw));
if (!/^SESSION_SECRET=.+$/m.test(text)) set('SESSION_SECRET', crypto.randomBytes(32).toString('hex'));
fs.writeFileSync(envPath, text.trimStart(), { mode: 0o600 });
console.log('Password saved to .env. Restart the server to apply.');
