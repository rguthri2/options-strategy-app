// Tiny JSON-file persistence (atomic writes). Keeps the VPS deploy free of native DB modules.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = name => path.join(config.dataDir, name);

export function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return typeof fallback === 'function' ? fallback() : structuredClone(fallback);
  }
}

export function writeJson(name, value) {
  const f = file(name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

export function fileAgeMs(name) {
  try { return Date.now() - fs.statSync(file(name)).mtimeMs; } catch { return Infinity; }
}
