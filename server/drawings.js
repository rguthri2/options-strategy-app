// Chart drawings (trendlines, rays, horizontal lines, Fibonacci, rectangles, text), saved per symbol so
// they follow you between desktop and phone. Strictly validated: numbers, known types, short text.
import { readJson, writeJson } from './store.js';

const TYPES = new Set(['trend', 'ray', 'hline', 'fib', 'rect', 'text']);
const COLOR = /^#[0-9a-f]{6}$/i;
const file = sym => `drawings/${sym.replace(/[^A-Z0-9.]/g, '_')}.json`;
const bad = m => Object.assign(new Error(m), { status: 400 });

const point = p => {
  const t = Number(p?.t), price = Number(p?.p);
  if (!Number.isFinite(t) || t < 0 || t > 4102444800 || !Number.isFinite(price) || Math.abs(price) > 1e9) throw bad('Bad drawing point');
  return { t: Math.round(t), p: price };
};

export const getDrawings = sym => readJson(file(sym), []);

export function saveDrawings(sym, body) {
  const list = Array.isArray(body?.drawings) ? body.drawings : null;
  if (!list || list.length > 200) throw bad('Up to 200 drawings per symbol');
  const clean = list.map(d => {
    if (!TYPES.has(d?.type)) throw bad('Unknown drawing type');
    const pts = (d.points || []).map(point);
    const need = d.type === 'hline' || d.type === 'text' ? 1 : 2;
    if (pts.length !== need) throw bad(`${d.type} needs ${need} point${need > 1 ? 's' : ''}`);
    return {
      id: typeof d.id === 'string' && /^[\w-]{1,40}$/.test(d.id) ? d.id : Math.random().toString(36).slice(2),
      type: d.type, points: pts, color: COLOR.test(d.color) ? d.color : '#2962ff',
      ...(d.type === 'text' ? { text: String(d.text || '').slice(0, 120) } : {}),
    };
  });
  writeJson(file(sym), clean);
  return clean;
}
