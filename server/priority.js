// Request priority for rate-limited market-data APIs. Background scans run inside runLow(), so
// their API calls queue behind anything the user is doing interactively.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
export const runLow = fn => als.run('low', fn);
export const isLow = () => als.getStore() === 'low';

// Sliding-window limiter with two queues. `cap` = requests per minute; background work may use at
// most `lowShare` of the window so interactive requests always find headroom.
export function makeLimiter(cap, lowShare = 0.8) {
  const window = [], high = [], low = [];
  let timer = null;
  const pump = () => {
    timer = null;
    const now = Date.now();
    while (window.length && now - window[0] > 60000) window.shift();
    while (high.length && window.length < cap) { window.push(Date.now()); high.shift()(); }
    while (low.length && !high.length && window.length < Math.floor(cap * lowShare)) { window.push(Date.now()); low.shift()(); }
    if ((high.length || low.length) && !timer) timer = setTimeout(pump, window.length ? Math.max(20, 60000 - (Date.now() - window[0]) + 20) : 20);
  };
  return () => new Promise(resolve => { (isLow() ? low : high).push(resolve); pump(); });
}
