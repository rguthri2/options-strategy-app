# Deploying to CyberPanel (OpenLiteSpeed) at rginvestor67.com/optionsTrader

The app is a Node.js server on `127.0.0.1:3100`. OpenLiteSpeed proxies `/optionsTrader/` to it.
The rest of rginvestor67.com is untouched.

## 1. Install Node.js 22 LTS and PM2 (once)

SSH in as root.

Ubuntu:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
```
AlmaLinux / Rocky:
```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && dnf install -y nodejs
```
Then:
```bash
npm install -g pm2
```

## 2. Create a dedicated low-privilege user (security)

Never run the app as root. If it were ever compromised, the attacker would only get this user,
not your server or your other websites.
```bash
useradd -m -s /bin/bash optrader
```

## 3. Upload the app (outside any web root)

On your PC:
```powershell
powershell -ExecutionPolicy Bypass -File deploy\package.ps1
scp deploy\options-trader.zip root@YOUR_VPS_IP:/home/optrader/
```
On the VPS (as root):
```bash
chown optrader:optrader /home/optrader/options-trader.zip
su - optrader
```
Then, as `optrader`:
```bash
mkdir -p ~/options-trader && cd ~/options-trader
unzip -o ../options-trader.zip && npm ci --omit=dev
cp .env.example .env && chmod 600 .env
nano .env        # add your TRADIER_API_KEY, TELEGRAM_BOT_TOKEN, etc. Keep NODE_ENV=production and HOST=127.0.0.1
npm run set-password -- "choose-a-long-unique-password"
mkdir -p data && chmod 700 data
```
The app lives in `/home/optrader`, outside `public_html`, so `.env` (API keys) and `data/` (tokens, positions)
can never be served by the web server. `HOST=127.0.0.1` means port 3100 is unreachable from the internet;
only OpenLiteSpeed can talk to it.

## 4. Start it with PM2 (survives reboots)

As `optrader`:
```bash
cd ~/options-trader
pm2 start deploy/ecosystem.config.cjs && pm2 save
curl -I http://127.0.0.1:3100/optionsTrader/login.html
```
You should get `HTTP/1.1 200 OK`. Then enable start-on-boot: run `exit` to return to root, then:
```bash
env PATH=$PATH:/usr/bin pm2 startup systemd -u optrader --hp /home/optrader
```
## 5. Proxy /optionsTrader through OpenLiteSpeed

CyberPanel → **Websites → List Websites → rginvestor67.com → Manage → vHost Conf**. Append:

```
extprocessor optionstrader {
  type                    proxy
  address                 127.0.0.1:3100
  maxConns                100
  pcKeepAliveTimeout      60
  initTimeout             60
  retryTimeout            0
  respBuffer              0
}

context /optionsTrader/ {
  type                    proxy
  handler                 optionstrader
  addDefaultCharset       off
}
```

Save it. Friendly links for mobile (URL paths are case-sensitive and phones capitalize the first letter): append this
after the `/optionsTrader/` context (from the terminal: `/usr/local/lsws/conf/vhosts/rginvestor67.com/vhost.conf`).
`.htaccess` does not work here because `/` is proxied to another app. The real `optionsTrader` spelling is deliberately
absent from the list so it can't redirect to itself.
```
context exp:^/(OptionsTrader|Optionstrader|optionstrader|OPTIONSTRADER|OptionsTRADER|ot|OT|Ot)/?$ {
  type                    redirect
  externalRedirect        1
  statusCode              301
  location                /optionsTrader/
}
```
Restart OpenLiteSpeed:
```bash
systemctl restart lsws
```
Open https://rginvestor67.com/optionsTrader/ and sign in.


## 6. Market data

### 6a. Tradier (what you use: real-time, no daily login)

1. In the Tradier dashboard, go to **Settings → API Access** and copy the access token.
2. Add `TRADIER_API_KEY=...` to `.env`. Add `TRADIER_SANDBOX=true` only for a developer-sandbox token, which is 15-min delayed.
3. `pm2 restart options-trader`. Tradier is picked up automatically, with no connect step. Check **Settings → Market data — Tradier**.

### 6b. E*TRADE (optional backup)

1. Add `ETRADE_CONSUMER_KEY` and `ETRADE_CONSUMER_SECRET` to `.env`. Set `ETRADE_SANDBOX=true` for sandbox keys (fixed sample data)
   and `false` for production keys.
2. Add `TIINGO_API_KEY` (free at tiingo.com). E*TRADE has no price history, so Tiingo supplies daily bars.
3. `pm2 restart options-trader`, then **Settings → Connect E*TRADE**. Log in, click **Accept**, and paste the code.
   Sessions end at **midnight Eastern daily**. With Telegram set up, you get a reminder.

### 6c. Schwab (optional, needs the Market Data Production product on your Schwab app)

Callback URL: `https://rginvestor67.com/optionsTrader/api/schwab/callback`. Set `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET` and
`SCHWAB_CALLBACK_URL`, restart, then **Settings → Connect Schwab**. Tokens last 7 days.

Auto order when several are configured: Schwab (if connected) → Tradier → E*TRADE (if connected) → demo.
Set `DATA_PROVIDER=tradier|etrade|schwab|demo` to force one.

## 7. Earnings calendar + CANSLIM fundamentals (Finnhub)

1. Get a free API key at https://finnhub.io.
2. Add `FINNHUB_API_KEY=...` to `.env` and run `pm2 restart options-trader`.
3. Earnings dates load in about a minute and refresh every 12 hours. CANSLIM fundamentals (quarterly EPS/sales growth,
   3-year EPS growth, ROE) load for leaders (RS >= 80) and O'Neil candidates after each post-close scan, about 5 minutes the
   first time on the free tier (60 calls/min), then weekly per stock.

## 8. Telegram alerts

1. Add `TELEGRAM_BOT_TOKEN=...` and `PUBLIC_URL=https://rginvestor67.com/optionsTrader` to `.env`, then run `pm2 restart options-trader`.
2. Open your bot in Telegram and send `/start` from **your own account**.
3. In **Settings → Telegram alerts**, click **Detect chat ID**. Check that the name it shows is you, then click **Send test**.

## 8b. Chart Copilot (Claude)

1. Create an API key at https://console.anthropic.com (Settings → API keys) and set a monthly spend limit there.
2. Add `ANTHROPIC_API_KEY=...` to `.env`, then run `pm2 restart options-trader`.
3. Open **Chart Studio ✦** and ask the copilot. Each answer shows its token use and approximate cost.
   The app caps usage at 40 requests/hour.

The copilot streams its answers. The proxy settings in step 5 (`respBuffer 0`) already allow this; if answers appear
all at once instead of word by word, check that line in the vHost config.

## 9. Security checklist before going public

- [ ] **HTTPS on:** CyberPanel → SSL → Issue SSL for rginvestor67.com. The app sets `Secure` cookies and HSTS in production, so login won't work over plain HTTP.
- [ ] **Strong, unique password** set with `npm run set-password` (the server refuses to start in production without one). Changing it later logs out every session.
- [ ] **`.env` is `chmod 600`** and owned by `optrader`; `data/` is `chmod 700`.
- [ ] **`HOST=127.0.0.1`** in `.env`, so port 3100 isn't reachable from the internet. Confirm from your PC that `http://YOUR_VPS_IP:3100` does **not** load.
- [ ] **Firewall** (CyberPanel → Security → Firewall) allows only 22, 80, 443 and the CyberPanel port 8090. Don't open 3100.
- [ ] **App runs as `optrader`**, not root: `ps -o user= -C node` should print `optrader`.
- [ ] **Backups:** copy `/home/optrader/options-trader/data/` (positions, settings, IV history) and `.env` somewhere safe.
- [ ] **Keys:** if an API key or bot token is ever exposed (pasted in chat, email, screenshot), rotate it at the provider and update `.env`.
- [ ] **OS updates:** keep the VPS patched (`apt upgrade` / `dnf upgrade`).

## Updating

Upload the new zip to `/home/optrader/`, then:
```bash
chown optrader:optrader /home/optrader/options-trader.zip && su - optrader -c 'cd ~/options-trader && unzip -o ../options-trader.zip && chmod -R u=rwX,go=rX . && chmod 600 .env && chmod -R go= data && npm ci --omit=dev && pm2 restart options-trader'
```
The `chmod` steps matter: zips built on Windows carry world-writable (`rw-rw-rw-`) permissions, which would let any
other account on the server modify the app. After them, only `optrader` can change files, and `.env`/`data/` are private.
`data/` holds your settings, positions, tokens and IV history, and is preserved on update. Back it up occasionally.

## Troubleshooting

- `su - optrader -c "pm2 logs options-trader"` shows server logs (also in `data/logs/`).
- 503 from the site: the Node process is down. Check `su - optrader -c "pm2 status"`.
- Login loop: the site must be HTTPS (cookies are `Secure` in production). Use CyberPanel's SSL → Issue SSL.
- "Cross-site request blocked" when saving: make sure `PUBLIC_URL` in `.env` matches the address in your browser.