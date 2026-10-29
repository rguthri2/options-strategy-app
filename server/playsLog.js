// Log of every play sent to Telegram (post-close report, pre-market brief, A+ alerts, intraday triggers),
// one JSON line per play in data/plays-log.jsonl. Exported as CSV for your own records and used to
// build watchlists. Plays are logged whenever they are generated, even if Telegram is not configured.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { nyDateStr } from '../shared/time.js';

const FILE = path.join(config.dataDir, 'plays-log.jsonl');
export const PLAY_TYPES = { 'post-close': 'Post-close report', 'pre-market': 'Pre-market brief', 'a-plus': 'A+ setup alert', trigger: 'Intraday trigger' };
const num = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const playUrl = (symbol, key) => (config.publicUrl ? `${config.publicUrl}/#${key ? `/scanner?sym=${encodeURIComponent(symbol)}&setup=${encodeURIComponent(key)}` : `/t/${encodeURIComponent(symbol)}`}` : '');

// rows: [{ symbol, name, trader, setup, setupKey, status, score, price, pivot, entry, stop, target1, target2, rs, stage, ivRegime, strategy, earnings, note }]
export function logPlays(type, rows) {
  if (!PLAY_TYPES[type] || !rows?.length) return 0;
  const at = new Date().toISOString(), date = nyDateStr();
  const lines = rows.map(r => {
    const entry = num(r.entry ?? r.pivot ?? r.price), symbol = String(r.symbol || '').toUpperCase().slice(0, 10);
    return JSON.stringify({
      at, date, type, symbol, name: String(r.name || '').slice(0, 80),
      trader: String(r.trader || '').slice(0, 30), setup: String(r.setup || '').slice(0, 60), setupKey: String(r.setupKey || '').slice(0, 40),
      status: String(r.status || '').slice(0, 40), score: num(r.score), price: num(r.price), pivot: num(r.pivot), entry,
      stop: num(r.stop), stopPct: Number.isFinite(r.stop) && entry ? +((Math.abs(entry - r.stop) / entry) * 100).toFixed(2) : null,
      target1: num(r.target1), target2: num(r.target2), rs: num(r.rs), stage: r.stage ?? null,
      ivRegime: r.ivRegime || '', strategy: String(r.strategy || '').slice(0, 80), earnings: r.earnings || '', note: String(r.note || '').slice(0, 160),
      url: playUrl(symbol, r.setupKey),
    });
  });
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.appendFileSync(FILE, lines.join('\n') + '\n', { mode: 0o600 });
  return lines.length;
}

export function listPlays({ from = '', to = '', type = '' } = {}) {
  let text = '';
  try { text = fs.readFileSync(FILE, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const p = JSON.parse(line);
      if ((from && p.date < from) || (to && p.date > to) || (type && p.type !== type)) continue;
      out.push(p);
    } catch { /* skip a damaged line */ }
  }
  return out.reverse(); // newest first
}

// Text starting with = + - @ would run as a formula in Excel: prefix it with '.
const cell = v => {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s))) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const HEAD = ['Date (ET)', 'Time (UTC)', 'Alert', 'Symbol', 'Name', 'Trader', 'Setup', 'Status', 'Score', 'Price', 'Pivot', 'Entry', 'Stop', 'Stop %', '2R target', '3R target', 'RS', 'Stage', 'IV', 'Options', 'Earnings', 'Note', 'Link'];
export function playsCsv(list) {
  const rows = list.map(p => [p.date, p.at.slice(11, 19), PLAY_TYPES[p.type] || p.type, p.symbol, p.name, p.trader, p.setup, p.status, p.score, p.price, p.pivot, p.entry,
    p.stop, p.stopPct, p.target1, p.target2, p.rs, p.stage, p.ivRegime, p.strategy, p.earnings, p.note, p.url]);
  return '﻿' + [HEAD, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
}
