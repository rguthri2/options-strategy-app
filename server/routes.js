import express from 'express';
import { config } from './config.js';
import { market, activeProvider } from './providers/index.js';
import { etradeStartAuth, etradeVerify, etradeDisconnect } from './providers/etrade.js';
import { authorizeUrl, checkState, exchangeCode, disconnect, schwabConfigured } from './providers/schwab.js';
import { hotlistState, refreshHotlist, hotlistRunning, symbolTechnicals } from './scanner.js';
import { ideasForSymbol, globalIdeas, refreshIdeas, PLAYBOOK } from './strategies.js';
import { getSettings, saveSettings } from './settings.js';
import { listPositions, addPosition, updatePosition, deletePosition, evaluatePositions } from './positions.js';
import { sendLogo } from './logos.js';
import { getDrawings, saveDrawings } from './drawings.js';
import { journal, journalCsv, addTrade, updateTrade, deleteTrade, addFill, deleteFill, addAccount, updateAccount, deleteAccount, syncTradier } from './journal.js';
import { INDEXES } from './universe.js';
import { nextEarnings, refreshEarnings, earningsState, earningsSource } from './earnings.js';
import { telegramStatus, sendTelegram, detectChatId } from './notify.js';
import { copilotHandler, copilotStatus } from './copilot.js';
import { ratesStatus } from './rates.js';
import { autoUniverse, buildAutoUniverse, scanSymbols } from './universeAuto.js';
import { barsProgress, updateAllBars } from './bars.js';
import { dailyState, postClose, preMarket, sendPlaysCsv } from './daily.js';
import { listPlays, playsCsv, PLAY_TYPES } from './playsLog.js';
import { fundamentalsConfigured, storedFundamentals, refreshFundamentals, canslimGrade, fundamentalsProgress } from './fundamentals.js';
import { valuationTime } from '../shared/time.js';
import { runBacktest, STRATEGIES } from '../shared/backtest.js';
import { runOptionBacktest, OPTION_STRATEGIES, FILTERS } from '../shared/optbacktest.js';
import { portfolioRisk } from './risk.js';
import { earningsScan } from './earningsScan.js';

const SYM = /^[A-Z$][A-Z0-9.$/]{0,9}$/;
const sym = s => {
  const v = String(s || '').toUpperCase().trim();
  if (!SYM.test(v)) throw Object.assign(new Error('Invalid symbol'), { status: 400 });
  return v;
};
// .then(() => fn()) also catches synchronous throws (validation errors), so their messages reach the user.
const wrap = fn => (req, res) => Promise.resolve().then(() => fn(req, res)).then(v => { if (v !== undefined) res.json(v); })
  .catch(e => res.status(e.status || 502).json({ error: e.message }));

export function apiRouter() {
  const r = express.Router();

  r.get('/status', wrap(() => ({
    ...market.status(), hotlistUpdated: hotlistState().updated, hotlistRunning: hotlistRunning(),
    ideasUpdated: globalIdeas().updated, now: Date.now(),
    earnings: earningsState(), telegram: telegramStatus(), rates: ratesStatus(),
  })));

  r.get('/indices', wrap(async () => {
    const list = activeProvider().indexes || INDEXES;
    const q = await market.quotes(list.map(i => i.symbol));
    return list.filter(i => q[i.symbol]).map(i => ({ ...q[i.symbol], symbol: i.symbol, name: i.name }));
  }));

  r.get('/quotes', wrap(async req => {
    const list = String(req.query.symbols || '').split(',').filter(Boolean).slice(0, 200).map(sym);
    return market.quotes(list);
  }));

  r.get('/search', wrap(async req => {
    const q = String(req.query.q || '').trim().toUpperCase();
    if (!q || q.length > 12) return [];
    return market.search(q.replace(/[^A-Z0-9.$]/g, ''));
  }));

  r.get('/history/:symbol', wrap(req => market.history(sym(req.params.symbol), String(req.query.range || '6M'))));

  r.get('/symbol/:symbol', wrap(async req => {
    const s = sym(req.params.symbol);
    const [quote, tech] = await Promise.all([market.quote(s), symbolTechnicals(s).catch(() => null)]);
    return { quote, tech };
  }));

  r.get('/expirations/:symbol', wrap(req => market.expirations(sym(req.params.symbol))));

  r.get('/chain/:symbol', wrap(async req => {
    const s = sym(req.params.symbol);
    const expiry = String(req.query.expiry || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw Object.assign(new Error('expiry=YYYY-MM-DD required'), { status: 400 });
    const strikes = Math.min(200, Math.max(6, Number(req.query.strikes) || 40));
    const ch = await market.chain(s, { fromDate: expiry, toDate: expiry, strikeCount: strikes });
    return {
      symbol: s, spot: ch.spot, rate: ch.rate, time: ch.time, earnings: nextEarnings(s), valuationTime: valuationTime(),
      expiration: ch.expirations.find(e => e.date === expiry) || ch.expirations[0] || null,
    };
  }));

  r.get('/earnings/:symbol', wrap(req => ({ earnings: nextEarnings(sym(req.params.symbol)) })));

  // ----- Chart Studio -----
  r.get('/daily/:symbol', wrap(req => market.daily(sym(req.params.symbol))));
  r.get('/bars/:symbol', wrap(req => market.bars(sym(req.params.symbol), String(req.query.interval || 'D'))));
  r.get('/logo/:symbol', (req, res) => sendLogo(String(req.params.symbol || ''), res));
  r.get('/drawings/:symbol', wrap(req => getDrawings(sym(req.params.symbol))));
  r.put('/drawings/:symbol', wrap(req => saveDrawings(sym(req.params.symbol), req.body)));
  r.get('/strategies', wrap(() => Object.fromEntries(Object.entries(STRATEGIES).map(([k, s]) => [k, { label: s.label, side: s.side, desc: s.desc, defaults: s.defaults }]))));
  r.get('/backtest/:symbol', wrap(async req => {
    const s = sym(req.params.symbol);
    const key = String(req.query.strategy || '');
    if (!STRATEGIES[key]) throw Object.assign(new Error('Unknown strategy'), { status: 400 });
    const params = {};
    const lim = { stopAtr: [0.5, 6], targetR: [0, 10], maxBars: [2, 400] };
    for (const [k, [lo, hi]] of Object.entries(lim)) {
      if (req.query[k] === undefined || req.query[k] === '') continue;
      const v = Number(req.query[k]);
      if (!Number.isFinite(v)) throw Object.assign(new Error(`${k} must be a number`), { status: 400 });
      params[k] = Math.min(hi, Math.max(lo, v));
    }
    return runBacktest(await market.dailyLong(s), key, params);
  }));
  r.get('/option-strategies', wrap(() => ({ strategies: OPTION_STRATEGIES, filters: FILTERS })));
  r.get('/optbacktest/:symbol', wrap(async req => {
    const s = sym(req.params.symbol);
    const key = String(req.query.strategy || '');
    if (!OPTION_STRATEGIES[key]) throw Object.assign(new Error('Unknown option strategy'), { status: 400 });
    const lim = { dte: [7, 400], delta: [0.05, 0.95], widthPct: [0.5, 30], takeProfit: [10, 500], stopLoss: [10, 1000], exitDte: [0, 200], ivPremium: [0.5, 2.5], slippagePct: [0, 25] };
    const params = {};
    for (const [k, [lo, hi]] of Object.entries(lim)) {
      if (req.query[k] === undefined || req.query[k] === '') continue;
      const v = Number(req.query[k]);
      if (!Number.isFinite(v)) throw Object.assign(new Error(`${k} must be a number`), { status: 400 });
      params[k] = Math.min(hi, Math.max(lo, v));
    }
    if (req.query.filter) {
      if (!FILTERS[req.query.filter]) throw Object.assign(new Error('Unknown filter'), { status: 400 });
      params.filter = req.query.filter;
    }
    const bars = await market.dailyLong(s);
    // Real implied-vol history where an index vol exists: VIX = 30-day S&P 500 implied volatility.
    if ((s === 'SPY' || s === '$SPX') && req.query.ivSource !== 'realized' && activeProvider().name !== 'demo') {
      const vix = await market.dailyLong('$VIX').catch(() => []);
      const byDay = new Map(vix.map(b => [b.t, b.c / 100]));
      const series = bars.map(b => byDay.get(b.t) ?? NaN);
      if (series.filter(Number.isFinite).length > bars.length * 0.8) params.ivSeries = series;
    }
    return runOptionBacktest(bars, key, params);
  }));
  r.get('/risk', wrap(() => portfolioRisk()));
  r.get('/earnings-scan', wrap(req => earningsScan(req.query.refresh === '1')));
  // ----- Daily scanner -----
  r.get('/scanner', wrap(() => {
    const h = hotlistState();
    const rows = h.rows.filter(x => x.traderSetups?.length).map(x => ({
      symbol: x.symbol, name: x.name, price: x.price, changePct: x.changePct, rsRating: x.rsRating, stage: x.stage, stageLabel: x.stageLabel,
      mansfield: x.mansfield, adr: x.adr, volRatio: x.volRatio, earningsDays: x.earningsDays, ivRegime: x.ivRegime, ivr: x.ivr, strategy: x.strategy,
      trendTemplate: x.trendTemplate, setups: x.traderSetups, canslim: x.canslim,
    }));
    const stages = [1, 2, 3, 4].map(s => h.rows.filter(x => x.stage === s).length);
    return { updated: h.updated, regime: h.regime, universe: { ...h.universe, auto: autoUniverse().stats, builtAt: autoUniverse().builtAt }, stages, rows, daily: dailyState(), bars: barsProgress(),
      fundamentals: { configured: fundamentalsConfigured(), ...fundamentalsProgress() } };
  }));
  r.post('/scanner/post-close', wrap(async () => { postClose(true).catch(e => console.error('[scanner] post-close', e.message)); return { started: true }; }));
  r.post('/scanner/pre-market', wrap(async () => preMarket(true)));
  r.get('/fundamentals/:symbol', wrap(async req => {
    const s = sym(req.params.symbol);
    if (fundamentalsConfigured() && !storedFundamentals(s)) await refreshFundamentals([s]);
    const rec = storedFundamentals(s);
    return { configured: fundamentalsConfigured(), asOf: rec?.t || null, fundamentals: rec?.f || null, grade: canslimGrade(rec?.f) };
  }));
  r.post('/universe/rebuild', wrap(async () => { const u = await buildAutoUniverse(true); updateAllBars(scanSymbols()).catch(() => {}); return { symbols: u.symbols.length, stats: u.stats }; }));
  r.get('/copilot/status', wrap(() => copilotStatus()));
  r.post('/copilot', copilotHandler);
  r.post('/earnings/refresh', wrap(async () => {
    const job = refreshEarnings([], true);
    // A full Finnhub pass takes ~1 minute (free-tier rate limit): let it finish in the background.
    if (earningsSource() !== 'finnhub') await job; else job.catch(() => {});
    return earningsState();
  }));

  r.get('/telegram', wrap(() => telegramStatus()));
  r.post('/telegram/test', wrap(async () => {
    await sendTelegram('✅ <b>RG Options Trader</b> is connected. Position alerts and A+ setups will arrive here.');
    return { ok: true };
  }));
  r.post('/telegram/detect', wrap(async () => {
    const d = await detectChatId();
    saveSettings({ notifications: { telegramChatId: d.chatId } });
    return d;
  }));

  r.get('/hotlist', wrap(() => hotlistState()));
  r.post('/hotlist/refresh', wrap(async () => { await refreshHotlist(); refreshIdeas().catch(() => {}); return hotlistState(); }));

  r.get('/ideas', wrap(() => globalIdeas()));
  r.post('/ideas/refresh', wrap(() => refreshIdeas()));
  r.get('/ideas/:symbol', wrap(req => ideasForSymbol(sym(req.params.symbol))));
  r.get('/playbook', wrap(() => PLAYBOOK));

  r.get('/settings', wrap(() => getSettings()));
  r.put('/settings', wrap(req => saveSettings(req.body || {})));

  r.get('/positions', wrap(() => evaluatePositions()));
  r.post('/positions', wrap(req => addPosition(req.body || {})));
  r.put('/positions/:id', wrap(req => updatePosition(req.params.id, req.body || {})));
  r.delete('/positions/:id', wrap(req => { deletePosition(req.params.id); return { ok: true }; }));
  r.get('/positions/raw', wrap(() => listPositions()));

  // ----- Plays log (every play sent to Telegram) -----
  const playsQuery = q => ({
    from: /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : '', to: /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : '',
    type: PLAY_TYPES[q.type] ? q.type : '',
  });
  r.get('/plays', wrap(req => ({ types: PLAY_TYPES, plays: listPlays(playsQuery(req.query)) })));
  r.get('/plays/export.csv', wrap(async (req, res) => {
    const q = playsQuery(req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="plays-${q.from || 'all'}${q.to && q.to !== q.from ? `-to-${q.to}` : ''}.csv"`);
    res.send(playsCsv(listPlays(q)));
  }));
  // Add symbols from plays to the app watchlist (Settings → Watchlist; max 50).
  r.post('/plays/watchlist', wrap(req => {
    const add = (Array.isArray(req.body?.symbols) ? req.body.symbols : []).map(s => String(s).toUpperCase().trim()).filter(s => SYM.test(s)).slice(0, 50);
    const cur = getSettings().watchlist;
    const merged = [...new Set([...cur, ...add])];
    if (merged.length > 50) throw Object.assign(new Error(`The watchlist holds up to 50 symbols; it has ${cur.length}. Remove some first.`), { status: 400 });
    const saved = saveSettings({ watchlist: merged }).watchlist;
    return { watchlist: saved, added: add.filter(s => !cur.includes(s)) };
  }));
  r.post('/plays/send-csv', wrap(async () => ({ sent: await sendPlaysCsv() })));

  // ----- Trade journal -----
  r.get('/journal', wrap(() => journal()));
  r.get('/journal/export.csv', wrap(async (req, res) => {
    const csv = await journalCsv(String(req.query.account || '').slice(0, 40));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="trade-journal-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + csv); // BOM so Excel reads UTF-8
  }));
  r.post('/journal/accounts', wrap(req => addAccount(req.body || {})));
  r.put('/journal/accounts/:id', wrap(req => updateAccount(req.params.id, req.body || {})));
  r.delete('/journal/accounts/:id', wrap(req => { deleteAccount(req.params.id); return { ok: true }; }));
  // Read-only on Tradier: preview (apply=false) or import (apply=true) the account's fills into the journal.
  r.post('/journal/accounts/:id/sync', wrap(req => syncTradier(req.params.id, { apply: req.body?.apply === true, since: String(req.body?.since || '').slice(0, 10) })));
  r.post('/journal', wrap(req => addTrade(req.body || {})));
  r.put('/journal/:id', wrap(req => updateTrade(req.params.id, req.body || {})));
  r.delete('/journal/:id', wrap(req => { deleteTrade(req.params.id); return { ok: true }; }));
  r.post('/journal/:id/fills', wrap(req => addFill(req.params.id, req.body || {})));
  r.delete('/journal/:id/fills/:fid', wrap(req => deleteFill(req.params.id, req.params.fid)));

  // ----- Schwab OAuth -----
  r.get('/schwab/authorize', wrap(() => {
    if (!schwabConfigured()) throw Object.assign(new Error('Set SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET and SCHWAB_CALLBACK_URL in .env first'), { status: 400 });
    return { url: authorizeUrl() };
  }));

  r.get('/schwab/callback', async (req, res) => {
    const back = `${config.basePath}/#/settings`;
    try {
      // The redirect flow always carries our state; a missing one is a forged/replayed callback.
      if (!req.query.state || !checkState(String(req.query.state))) throw new Error('OAuth state mismatch. Start the connection again.');
      if (!req.query.code) throw new Error(String(req.query.error_description || req.query.error || 'No code returned'));
      await exchangeCode(String(req.query.code));
      refreshHotlist().then(() => refreshIdeas()).catch(() => {});
      res.redirect(`${back}?schwab=connected`);
    } catch (e) {
      res.redirect(`${back}?schwab=error&msg=${encodeURIComponent(e.message)}`);
    }
  });

  // Manual flow: paste the full URL Schwab redirected to (useful when testing locally).
  r.post('/schwab/manual', wrap(async req => {
    const u = new URL(String(req.body?.redirectUrl || ''));
    const code = u.searchParams.get('code');
    if (!code) throw Object.assign(new Error('No code= parameter found in that URL'), { status: 400 });
    if (!checkState(u.searchParams.get('state') || '')) throw Object.assign(new Error('OAuth state mismatch'), { status: 400 });
    await exchangeCode(code);
    refreshHotlist().then(() => refreshIdeas()).catch(() => {});
    return { ok: true };
  }));

  r.post('/schwab/disconnect', wrap(() => { disconnect(); return { ok: true }; }));

  // ----- E*TRADE OAuth (out-of-band verification code) -----
  r.post('/etrade/authorize', wrap(async () => ({ url: await etradeStartAuth() })));
  r.post('/etrade/verify', wrap(async req => {
    const code = String(req.body?.code || '').trim();
    if (!/^[A-Za-z0-9]{4,12}$/.test(code)) throw Object.assign(new Error('Enter the verification code shown by E*TRADE'), { status: 400 });
    await etradeVerify(code);
    refreshHotlist().then(() => refreshIdeas()).catch(() => {});
    return { ok: true };
  }));
  r.post('/etrade/disconnect', wrap(async () => { await etradeDisconnect(); return { ok: true }; }));

  r.use((req, res) => res.status(404).json({ error: 'Not found' }));
  return r;
}
