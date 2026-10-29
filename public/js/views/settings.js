import { api } from '../api.js';
import { esc, fmt, loading, errorBox, toast } from '../ui.js';

const STRATS = {
  longCall: 'Long Call', longPut: 'Long Put', leaps: 'LEAPS', pmcc: "Poor Man's Covered Call", bullCallSpread: 'Bull Call Spread',
  bearPutSpread: 'Bear Put Spread', bullPutSpread: 'Bull Put Credit Spread', bearCallSpread: 'Bear Call Credit Spread',
  csp: 'Cash-Secured Put', coveredCall: 'Covered Call', ironCondor: 'Iron Condor',
};

export async function render(root, _p, query) {
  root.innerHTML = loading();
  let s, status;
  try { [s, status] = await Promise.all([api.get('settings'), api.get('status')]); } catch (e) { root.innerHTML = errorBox(e); return; }

  const cb = location.origin + location.pathname.replace(/\/$/, '') + '/api/schwab/callback';
  const refreshLeft = status.refreshExpiresAt ? status.refreshExpiresAt - Date.now() : null;
  const num = (path, label, step = 1, help = '') => {
    const v = path.split('.').reduce((o, k) => o?.[k], s);
    return `<label class="field">${label}<input type="number" step="${step}" data-path="${path}" value="${v}">${help ? `<span class="tiny faint">${help}</span>` : ''}</label>`;
  };

  root.innerHTML = `
    <div class="page-h"><h1>Settings</h1><button class="btn primary" id="save">Save settings</button></div>
    ${query.schwab === 'connected' ? '<div class="banner info">✓ Schwab connected. Live data is now active; the hot list is rescanning.</div>' : ''}
    ${query.schwab === 'error' ? `<div class="banner">Schwab connection failed: ${esc(query.msg || '')}</div>` : ''}
    <div class="grid g2">
      <section class="card">
        <div class="card-h"><h2>Market data — Charles Schwab</h2><span class="badge ${status.provider === 'schwab' ? 'live' : ''}">${status.provider === 'schwab' ? 'LIVE' : 'DEMO'}</span></div>
        ${status.schwabConnected ? `
          <div class="kv"><div>Status</div><div class="up">Connected</div>
          <div>Re-authorization due</div><div class="${refreshLeft < 36 * 3600000 ? 'down' : ''}">${new Date(status.refreshExpiresAt).toLocaleString()} (${Math.max(0, Math.floor(refreshLeft / 86400000))}d ${Math.max(0, Math.floor((refreshLeft % 86400000) / 3600000))}h)</div></div>
          <p class="help">Schwab refresh tokens expire every 7 days. Reconnect before then to avoid falling back to demo data.</p>
          <div class="row"><button class="btn" id="connect">Reconnect</button><button class="btn danger ghost" id="disconnect">Disconnect</button></div>`
        : status.schwabConfigured ? `
          <p class="help">API keys found. Connect your Schwab account to authorize market data.</p>
          <div class="row"><button class="btn primary" id="connect">Connect Schwab</button></div>
          <hr class="sep"><p class="help">Testing locally with a different callback? After logging in at Schwab, paste the full URL you were redirected to:</p>
          <div class="row"><input type="text" id="manual" placeholder="https://…?code=…" style="flex:1"><button class="btn" id="manualBtn">Submit</button></div>`
        : `
          <p class="help">Running on <b>demo data</b>. To enable real-time Schwab data:</p>
          <ol class="steps">
            <li>Sign in at <b>developer.schwab.com</b> with your Schwab login and create an app with the <b>Market Data Production</b> product.</li>
            <li>Set the app's Callback URL to <code>${esc(cb)}</code> (must match exactly, HTTPS).</li>
            <li>Wait for the app status to become <b>Ready For Use</b> (usually a few days).</li>
            <li>On the server, add to <code>.env</code>: <code>SCHWAB_CLIENT_ID</code>, <code>SCHWAB_CLIENT_SECRET</code>, <code>SCHWAB_CALLBACK_URL</code>, then restart the app.</li>
            <li>Return here and click <b>Connect Schwab</b>.</li>
          </ol>`}
      </section>
      <section class="card">
        <div class="card-h"><h2>Market data — Tradier</h2><span class="badge ${status.tradier.configured && !status.tradier.lastError ? 'live' : ''}">${!status.tradier.configured ? 'NOT SET UP' : status.tradier.lastError ? 'ERROR' : status.tradier.sandbox ? 'SANDBOX · DELAYED' : 'LIVE'}</span></div>
        ${status.tradier.configured ? `
          <div class="kv"><div>Mode</div><div>${status.tradier.sandbox ? 'Sandbox (15-min delayed)' : 'Production (real-time)'}</div>
          <div>In use</div><div>${status.provider === 'tradier' ? '<span class="up">Yes</span>' : 'No (another source has priority)'}</div></div>
          ${status.tradier.lastError ? `<p class="help down">${esc(status.tradier.lastError)}</p>` : ''}
          <p class="help">Quotes, option chains (ORATS Greeks, refreshed about hourly), daily and intraday history, all from one token. No daily login.</p>`
        : `<ol class="steps">
            <li>In your Tradier dashboard, go to <b>Settings → API Access</b> and copy your access token.</li>
            <li>Add <code>TRADIER_API_KEY=...</code> to <code>.env</code>. For a sandbox (developer) token, also add <code>TRADIER_SANDBOX=true</code>.</li>
            <li>Restart the app. Tradier becomes the data source automatically.</li></ol>`}
      </section>
      <section class="card">
        <div class="card-h"><h2>Market data — E*TRADE</h2><span class="badge ${status.etrade.connected ? 'live' : ''}">${status.etrade.connected ? (status.etrade.sandbox ? 'SANDBOX' : 'CONNECTED') : status.etrade.configured ? 'NOT CONNECTED' : 'NOT SET UP'}</span></div>
        ${!status.etrade.configured ? `
          <ol class="steps">
            <li>Add to <code>.env</code>: <code>ETRADE_CONSUMER_KEY</code>, <code>ETRADE_CONSUMER_SECRET</code>, and <code>ETRADE_SANDBOX=true</code> for sandbox keys (<code>false</code> for production keys).</li>
            <li>Add <code>TIINGO_API_KEY</code> (free at tiingo.com). E*TRADE has no price history, so charts and the Hot List use Tiingo daily bars.</li>
            <li>Restart the app, then click <b>Connect E*TRADE</b> here.</li>
          </ol>` : `
          ${status.etrade.sandbox ? '<p class="help"><span class="pill warn">Sandbox</span> E*TRADE\'s sandbox returns fixed sample data. Use it to test the login; switch to production keys for real quotes.</p>' : ''}
          ${status.etrade.connected ? `<div class="kv"><div>Session</div><div class="up">Active</div><div>Expires</div><div>${new Date(status.etrade.sessionExpiresAt).toLocaleString()} (midnight ET)</div></div>
            <p class="help">E*TRADE requires a fresh login every day. The app keeps the session alive during the day${status.telegram.ready ? ' and sends a Telegram reminder when it expires' : ''}.</p>
            <div class="row"><button class="btn danger ghost" id="etdisc">Disconnect</button></div>`
          : `<p class="help">Click connect, log in at E*TRADE, click <b>Accept</b>, then copy the verification code it shows and paste it here.</p>
            <div class="row"><button class="btn primary" id="etconn">Connect E*TRADE</button>
            <input type="text" id="etcode" placeholder="Verification code" style="width:160px" autocomplete="off"><button class="btn" id="etverify">Verify</button></div>`}
          <hr class="sep">
          <div class="kv"><div>Price history (Tiingo)</div><div class="${status.history.configured ? 'up' : 'down'}">${status.history.configured ? 'Configured' : 'Missing TIINGO_API_KEY'}</div>
          <div>Symbols queued</div><div>${status.history.queued}</div><div>Calls today</div><div>${status.history.callsToday} / 240</div></div>
          ${status.history.lastError ? `<p class="help down">${esc(status.history.lastError)}</p>` : ''}
          <p class="help">First load fetches 5 years per symbol at ~45 symbols/hour (free tier), so the Hot List fills in over about two hours. After that only new days are fetched.</p>`}
      </section>
      <section class="card">
        <div class="card-h"><h2>Account & risk</h2>${s.account.configured ? '' : '<span class="pill warn">Not set yet</span>'}</div>
        <div class="grid g3">
          ${num('account.size', 'Account size ($)', 1000)}
          ${num('account.riskPerTradePct', 'Max risk per trade (%)', 0.25)}
          ${num('account.maxAllocationPct', 'Max capital per trade (%)', 0.5)}
        </div>
        <hr class="sep">
        <div class="card-h"><h2>Liquidity filters</h2></div>
        <div class="grid g3">
          ${num('filters.minPrice', 'Min stock price', 1)}
          ${num('filters.minAvgVolume', 'Min avg volume', 100000)}
          ${num('filters.minOI', 'Min open interest / leg', 10)}
          ${num('filters.maxSpreadPct', 'Max bid/ask (% of mid)', 1)}
          ${num('refreshMinutes', 'Rescan every (min, market hours)', 1)}
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h2>Telegram alerts</h2><span class="badge ${status.telegram.ready ? 'live' : ''}">${status.telegram.ready ? 'READY' : 'OFF'}</span></div>
        ${status.telegram.tokenSet ? '' : `<ol class="steps">
          <li>In Telegram, message <b>@BotFather</b>, send <code>/newbot</code>, and copy the bot token.</li>
          <li>Add <code>TELEGRAM_BOT_TOKEN=...</code> to <code>.env</code> on the server and restart the app.</li>
          <li>Open your new bot, send it <code>/start</code>, then click <b>Detect chat ID</b> below.</li></ol>`}
        <div class="row" style="margin-bottom:10px">
          <label class="field" style="flex:1">Chat ID<input type="text" id="tgchat" value="${esc(status.telegram.chatId)}" placeholder="auto-detected"></label>
          <button class="btn" id="tgdetect" ${status.telegram.tokenSet ? '' : 'disabled'}>Detect chat ID</button>
          <button class="btn" id="tgtest" ${status.telegram.ready ? '' : 'disabled'}>Send test</button>
        </div>
        <div class="grid g3">
          <label class="check"><input type="checkbox" id="tgpos" ${s.notifications.positionAlerts ? 'checked' : ''}> Position alerts</label>
          <label class="check"><input type="checkbox" id="tgset" ${s.notifications.setupAlerts ? 'checked' : ''}> New A+ setups</label>
          ${num('notifications.minSetupScore', 'Min setup score', 1)}
        </div>
        <p class="help">Position alerts are checked every 5 minutes during market hours. Each alert is sent at most once per day.</p>
      </section>
      <section class="card">
        <div class="card-h"><h2>Earnings calendar</h2><span class="badge ${status.earnings.source === 'finnhub' ? 'live' : ''}">${status.earnings.source === 'finnhub' ? 'FINNHUB' : status.earnings.source === 'demo' ? 'DEMO' : 'OFF'}</span></div>
        <div class="kv"><div>Symbols with upcoming reports</div><div>${status.earnings.count}</div><div>Last refresh</div><div>${fmt.ago(status.earnings.updated)}</div></div>
        ${status.earnings.configured ? '' : `<p class="help">Schwab doesn't provide earnings dates. Get a free key at <b>finnhub.io</b>, add <code>FINNHUB_API_KEY=...</code> to <code>.env</code>, and restart. ${status.earnings.source === 'demo' ? 'Demo mode shows simulated dates meanwhile.' : ''}</p>`}
        <p class="help">Earnings flags appear on the Hot List, chain expirations, trade ideas (score penalty when the report falls before expiry), the Builder and position alerts.</p>
        <button class="btn sm" id="errefresh">↻ Refresh now</button>
      </section>
      <section class="card">
        <div class="card-h"><h2>Daily scanner universe</h2><span class="muted small" id="univinfo"></span></div>
        <div class="row" style="margin-bottom:10px">
          <label class="check"><input type="radio" name="scanmode" value="auto" ${s.scan.mode === 'auto' ? 'checked' : ''}> All liquid optionable US stocks (rebuilt weekly)</label>
          <label class="check"><input type="radio" name="scanmode" value="manual" ${s.scan.mode === 'manual' ? 'checked' : ''}> Only my universe list</label>
        </div>
        <div class="grid g3">
          ${num('scan.minPrice', 'Min price ($)', 1)}
          ${num('scan.minAvgVolume', 'Min avg daily volume', 100000)}
          ${num('scan.minDollarVolume', 'Min avg $ volume', 1000000)}
          ${num('scan.minAdr', 'Qullamaggie min ADR %', 0.5)}
          ${num('scan.ivTopN', 'IV lookups per scan', 10, 'API budget: top candidates only')}
        </div>
        <label class="check" style="margin-top:8px"><input type="checkbox" id="scanetf" ${s.scan.includeEtfs ? 'checked' : ''}> Include ETFs (leveraged/inverse always excluded)</label>
        <div class="row" style="margin-top:10px"><button class="btn sm" id="univrebuild">↻ Rebuild universe now</button><span class="help">Downloads the CBOE optionable list + Nasdaq listings, applies the filters, then fetches missing price history in the background.</span></div>
      </section>
      <section class="card">
        <div class="card-h"><h2>Strategies to scan</h2></div>
        <div class="grid g2">${Object.entries(STRATS).map(([k, v]) => `<label class="check"><input type="checkbox" data-strat="${k}" ${s.strategies[k] !== false ? 'checked' : ''}> ${v}</label>`).join('')}</div>
        <hr class="sep">
        <div class="card-h"><h2>Strategy rules</h2></div>
        <div class="grid g3">
          ${num('rules.creditTargetDte', 'Credit target DTE')}
          ${num('rules.creditShortDelta', 'Credit short Δ', 0.01)}
          ${num('rules.condorShortDelta', 'Condor short Δ', 0.01)}
          ${num('rules.debitTargetDte', 'Debit spread target DTE')}
          ${num('rules.longTargetDte', 'Long option target DTE')}
          ${num('rules.longDelta', 'Long option Δ', 0.01)}
          ${num('rules.leapsMinDte', 'LEAPS min DTE')}
          ${num('rules.leapsDelta', 'LEAPS Δ', 0.01)}
          ${num('rules.minIvrForCredit', 'Min IVR for credit')}
          ${num('rules.profitTakePct', 'Profit target (%)')}
          ${num('rules.manageDte', 'Manage at DTE')}
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h2>Scan universe</h2><span class="muted small">${s.universe.length} symbols</span></div>
        <textarea id="universe" rows="7">${esc(s.universe.join(', '))}</textarea>
        <p class="help">Comma or space separated. Keep it to liquid, optionable names (≈ 50–150 symbols works well within Schwab's 120 requests/minute).</p>
        <div class="card-h" style="margin-top:12px"><h2>Watchlist</h2></div>
        <textarea id="watchlist" rows="3">${esc(s.watchlist.join(', '))}</textarea>
      </section>
    </div>`;

  const $ = q => root.querySelector(q);
  $('#save').addEventListener('click', async () => {
    const patch = {
      account: {}, filters: {}, rules: {}, strategies: {},
      notifications: { telegramChatId: $('#tgchat').value.trim(), positionAlerts: $('#tgpos').checked, setupAlerts: $('#tgset').checked },
    };
    root.querySelectorAll('input[data-path]').forEach(i => {
      const parts = i.dataset.path.split('.');
      let o = patch;
      for (const p of parts.slice(0, -1)) o = o[p] = o[p] || {};
      o[parts[parts.length - 1]] = Number(i.value);
    });
    root.querySelectorAll('input[data-strat]').forEach(i => { patch.strategies[i.dataset.strat] = i.checked; });
    patch.scan = { ...(patch.scan || {}), mode: root.querySelector('input[name="scanmode"]:checked')?.value || 'auto', includeEtfs: $('#scanetf').checked };
    const split = v => v.split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
    patch.universe = split($('#universe').value);
    patch.watchlist = split($('#watchlist').value);
    try { await api.put('settings', patch); toast('Settings saved. Rescan the hot list to apply universe changes.'); }
    catch (e) { toast(e.message, true); }
  });
  api.get('scanner').then(d => {
    const u = d.universe || {};
    $('#univinfo').textContent = `${u.auto?.passed ?? u.scanned ?? '—'} symbols${u.builtAt ? ` · built ${new Date(u.builtAt).toLocaleDateString()}` : ''}${d.bars?.running ? ` · history ${d.bars.done}/${d.bars.total}` : ''}`;
  }).catch(() => {});
  $('#univrebuild').addEventListener('click', async e => {
    e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span> Rebuilding…';
    try { const r = await api.post('universe/rebuild'); toast(`Universe: ${r.symbols} symbols. Missing history is downloading in the background.`); }
    catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = '↻ Rebuild universe now';
  });
  $('#etconn')?.addEventListener('click', async () => {
    try {
      const { url } = await api.post('etrade/authorize');
      window.open(url, '_blank', 'noopener');
      toast('Log in at E*TRADE, click Accept, then paste the code here.');
      $('#etcode').focus();
    } catch (e) { toast(e.message, true); }
  });
  $('#etverify')?.addEventListener('click', async () => {
    try { await api.post('etrade/verify', { code: $('#etcode').value }); toast('E*TRADE connected. Rescanning with live data…'); render(root, [], {}); }
    catch (e) { toast(e.message, true); }
  });
  $('#etdisc')?.addEventListener('click', async () => {
    if (!confirm('Disconnect E*TRADE?')) return;
    await api.post('etrade/disconnect'); toast('Disconnected'); render(root, [], {});
  });
  $('#tgdetect').addEventListener('click', async () => {
    try { const d = await api.post('telegram/detect'); $('#tgchat').value = d.chatId; toast(`Found chat ${d.name || d.chatId}. Saved.`); render(root, [], {}); }
    catch (e) { toast(e.message, true); }
  });
  $('#tgtest').addEventListener('click', async () => {
    try { await api.post('telegram/test'); toast('Test message sent. Check Telegram.'); } catch (e) { toast(e.message, true); }
  });
  $('#errefresh').addEventListener('click', async e => {
    e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span> Refreshing…';
    try { await api.post('earnings/refresh'); toast('Earnings refreshed'); render(root, [], {}); } catch (err) { toast(err.message, true); e.target.disabled = false; }
  });
  $('#connect')?.addEventListener('click', async () => {
    try { const { url } = await api.get('schwab/authorize'); location.href = url; } catch (e) { toast(e.message, true); }
  });
  $('#disconnect')?.addEventListener('click', async () => {
    if (!confirm('Disconnect Schwab? The app will fall back to demo data.')) return;
    await api.post('schwab/disconnect'); toast('Disconnected'); render(root, [], {});
  });
  $('#manualBtn')?.addEventListener('click', async () => {
    try { await api.post('schwab/manual', { redirectUrl: $('#manual').value.trim() }); toast('Schwab connected'); render(root, [], { schwab: 'connected' }); }
    catch (e) { toast(e.message, true); }
  });
}
