# Options Strategy — changes and additions

Live at https://optionstrategy.rginvestor67.com (login required).

## Rebrand
- Renamed to **Options Strategy** (header, login page, page titles, Telegram message, README).
- New logo: an option payoff curve (the "hockey stick") with a breakeven dot on a green-to-blue gradient tile. It is used in the header, on the login page and as the favicon.

## Deployment
- Runs on the AlmaLinux / CyberPanel / LiteSpeed VPS as the PM2 process `options-trader` on port 3250, proxied by LiteSpeed.
- Production Let's Encrypt certificate with auto-renewal; password-protected.
- Fixed the original deploy script (EPEL, Node 20, PGDG Postgres, no hardcoded password).
- Replaced the unfinished React/Postgres skeleton with the working Express + vanilla JS app (ported from your RG Options Trader).

## New features
| Feature | Where | Details |
|---|---|---|
| **Technical analysis panel** | Symbol page `#/t/SYMBOL` | Bullish/bearish/neutral verdict with conviction %, nearest support and resistance (also drawn on the chart), RSI, MACD, ADX, Bollinger and moving-average signals in plain language, detected chart and candlestick patterns. Logic in `shared/ta.js`; API `GET /api/ta/:symbol`. |
| **Strategy recommender** | Symbol page | Ranked option strategies filtered by Match chart / Bullish / Bearish / Neutral. Click a card for its P/L chart with breakevens, max profit and max loss. |
| **Stock screener** | `#/screen` | Presets: Trend, Downtrend, Breakout, Breakdown, Reversal, Pullback, Gaps, Gap fills, All. Filters for price, relative volume, RSI and symbol. Sortable columns, signal tags. API `GET /api/screen`. |
| **Price / RSI alerts** | Symbol page | Price above/below and RSI above/below rules, checked every minute, sent to Telegram once when triggered. Module `server/alerts.js`; API `/api/alerts`. |
| **Simplified navigation** | Top tabs | Core tools first (Screener, Charts, Options Chain, Trade Ideas, Strategy Builder), the rest after. The symbol box now says "Enter a symbol…". |

## Existing tools kept
Chart Studio with drawings and studies, options chain, strategy builder, options lab, hot list, daily scanner, earnings, positions, journal and playbook.

## Not done yet
- Email alerts (needs SMTP details).
- Saved chart layouts for studies and chart type (drawings are already saved per symbol).
- New watchlist features (the existing Watch button is unchanged).
- Real market data. The app runs on the demo feed, so prices and scans are simulated. Tradier or Schwab can be connected.
- Telegram delivery needs `TELEGRAM_BOT_TOKEN` and a chat id in `.env`.
- Mobile layout was not retested.
