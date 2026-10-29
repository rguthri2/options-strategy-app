// Telegram notifications: position management alerts and new A+ swing setups.
// Each message is sent at most once per day per key (data/notified.json).
import { config } from './config.js';
import { readJson, writeJson } from './store.js';
import { getSettings } from './settings.js';
import { nyDateStr, marketSession } from '../shared/time.js';
import { logPlays } from './playsLog.js';

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const chatId = () => config.telegram.chatId || getSettings().notifications.telegramChatId || '';

export const telegramStatus = () => ({ tokenSet: Boolean(config.telegram.token), chatId: chatId(), ready: Boolean(config.telegram.token && chatId()) });

async function tg(method, body) {
  if (!config.telegram.token) throw Object.assign(new Error('TELEGRAM_BOT_TOKEN is not set in .env'), { status: 400 });
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw Object.assign(new Error(`Telegram: ${data.description || res.status}`), { status: 502 });
  return data.result;
}

export async function sendTelegram(html) {
  if (!config.telegram.token) throw Object.assign(new Error('TELEGRAM_BOT_TOKEN is not set in .env'), { status: 400 });
  const id = chatId();
  if (!id) throw Object.assign(new Error('Telegram chat ID not set'), { status: 400 });
  return tg('sendMessage', { chat_id: id, text: html, parse_mode: 'HTML', disable_web_page_preview: true });
}

// Send a file (e.g. the day's plays as CSV) to the configured chat.
export async function sendTelegramDocument(filename, content, caption = '') {
  if (!config.telegram.token) throw Object.assign(new Error('TELEGRAM_BOT_TOKEN is not set in .env'), { status: 400 });
  const id = chatId();
  if (!id) throw Object.assign(new Error('Telegram chat ID not set'), { status: 400 });
  const fd = new FormData();
  fd.append('chat_id', id);
  if (caption) { fd.append('caption', caption.slice(0, 1000)); fd.append('parse_mode', 'HTML'); }
  fd.append('document', new Blob([content], { type: 'text/csv' }), filename);
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/sendDocument`, { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw Object.assign(new Error(`Telegram: ${data.description || res.status}`), { status: 502 });
  return data.result;
}

// Finds the chat ID of whoever last messaged the bot (send the bot "/start" first).
export async function detectChatId() {
  const updates = await tg('getUpdates', { limit: 20 });
  // Private chats only: never auto-link a group or channel the bot was added to.
  const last = [...updates].reverse().find(u => u.message?.chat?.id && u.message.chat.type === 'private');
  if (!last) throw Object.assign(new Error('No private messages found. Open your bot in Telegram, send /start, then try again.'), { status: 404 });
  const c = last.message.chat;
  return { chatId: String(c.id), name: [c.first_name, c.last_name].filter(Boolean).join(' ') + (c.username ? ` (@${c.username})` : '') };
}

function dedupe(keys) {
  const today = nyDateStr();
  const sent = readJson('notified.json', {});
  for (const [k, d] of Object.entries(sent)) if (d < today) delete sent[k];
  const fresh = keys.filter(k => !sent[k]);
  return { fresh, commit: () => { for (const k of fresh) sent[k] = today; writeJson('notified.json', sent); } };
}

// One-off message, sent at most once per day for the given key.
export async function sendOnce(key, html) {
  if (!telegramStatus().ready) return;
  const { fresh, commit } = dedupe([key]);
  if (!fresh.length) return;
  await sendTelegram(html);
  commit();
}

const link = path => (config.publicUrl ? ` <a href="${config.publicUrl}/#${path}">open</a>` : '');

// Deep link to one play: the Daily Scanner with that setup's detail panel open, or the stock page
// when the levels come from the generic swing plan. (&amp; because Telegram parses the message as HTML.)
export function playLink(symbol, setupKey) {
  if (!config.publicUrl) return '';
  const s = encodeURIComponent(symbol);
  const path = setupKey ? `/scanner?sym=${s}&amp;setup=${encodeURIComponent(setupKey)}` : `/t/${s}`;
  return ` <a href="${config.publicUrl}/#${path}">▶ open play</a>`;
}

const $ = v => (Number.isFinite(v) ? `$${v.toFixed(2)}` : '—');
// Plain-language entry: buy above a trigger that hasn't fired yet, or the entry if it already has.
export function entryText(bias, plan) {
  const short = bias === 'bear';
  if (Number.isFinite(plan.trigger)) return `${short ? 'Short below' : 'Buy above'} <b>${$(plan.trigger)}</b> (${plan.source ? 'pivot' : short ? '20-day low' : '20-day high'})`;
  return `${plan.source ? 'Triggered' : 'At market'}: entry ~<b>${$(plan.entry)}</b>${plan.pivot ? ` (pivot ${$(plan.pivot)}, in buy zone)` : ''}`;
}

export async function notifyPositions(positions) {
  const n = getSettings().notifications;
  if (!telegramStatus().ready || !n.positionAlerts) return;
  const items = positions.filter(p => p.status === 'open').flatMap(p => p.alerts.map(a => ({ p, a, key: `pos|${p.id}|${a.text}` })));
  const { fresh, commit } = dedupe(items.map(i => i.key));
  const send = items.filter(i => fresh.includes(i.key));
  if (!send.length) return;
  const icon = { good: '✅', warn: '⚠️', bad: '🛑' };
  const lines = send.map(({ p, a }) => `${icon[a.level] || '•'} <b>${esc(p.symbol)}</b> ${esc(p.label)}: ${esc(a.text)}${p.pnl != null ? ` (P/L $${Math.round(p.pnl)})` : ''}`);
  await sendTelegram(`<b>Position alerts</b>\n${lines.join('\n')}${link('/positions')}`);
  commit();
}

// A+ swing setups: sent during market hours only (the 4:40 pm report and 9:00 am brief cover the rest),
// once per stock per day, each with an explicit entry, the setup's levels and a link to that play.
export function setupAlertLines(rows) {
  return rows.map(r => {
    const p = r.plan;
    const trig = Number.isFinite(p.trigger) ? p.trigger : p.entry;
    const stopPct = trig ? (Math.abs(trig - p.stop) / trig) * 100 : NaN;
    return `${r.bias === 'bull' ? '🟢' : '🔴'} <b>${esc(r.symbol)}</b> · score ${r.score} · ${esc(p.source || r.setup)} · now ${$(r.price)}\n`
      + `   ${entryText(r.bias, p)}\n`
      + `   stop ${$(p.stop)}${Number.isFinite(stopPct) ? ` (${stopPct.toFixed(1)}%)` : ''} · 2R ${$(p.target1)} · 3R ${$(p.target2)}\n`
      + `   ${esc(r.strategy)}${r.earnings && r.earnings.days <= 21 ? ` · ⚠️ earnings ${esc(r.earnings.date)}` : ''}${playLink(r.symbol, p.setupKey)}`;
  });
}

export async function notifySetups(rows, { session = marketSession() } = {}) {
  const n = getSettings().notifications;
  if (!telegramStatus().ready || !n.setupAlerts || session !== 'open') return;
  const hits = rows.filter(r => r.bias !== 'neutral' && r.score >= n.minSetupScore && r.plan);
  const { fresh, commit } = dedupe(hits.map(r => `setup|${r.symbol}|${r.bias}`));
  const send = hits.filter(r => fresh.includes(`setup|${r.symbol}|${r.bias}`)).sort((a, b) => b.score - a.score).slice(0, 10);
  if (!send.length) return;
  await sendTelegram(`<b>New A+ setups (score ≥ ${n.minSetupScore})</b>\n${setupAlertLines(send).join('\n')}`);
  commit();
  logPlays('a-plus', send.map(r => {
    const p = r.plan;
    return { symbol: r.symbol, name: r.name, trader: p.source ? p.source.split(' ')[0] : 'Hot List', setup: p.source || r.setup, setupKey: p.setupKey,
      status: Number.isFinite(p.trigger) ? 'setting up' : 'triggered', score: r.score, price: r.price, pivot: p.pivot ?? p.trigger, entry: Number.isFinite(p.trigger) ? p.trigger : p.entry,
      stop: p.stop, target1: p.target1, target2: p.target2, rs: r.rsRating, stage: r.stage, ivRegime: r.ivRegime, strategy: r.strategy, earnings: r.earnings?.date };
  }));
}
