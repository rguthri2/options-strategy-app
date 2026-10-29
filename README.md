# RG Options Trader

A private options-trading workstation in the style of Google Finance, built for swing traders who trade options.
It covers idea generation through position management:

- **Swing Hot List**: ranks your universe on the Minervini Trend Template, IBD-style relative strength, setup type
  (breakout, VCP/pivot, 21-EMA pullback, TTM squeeze, momentum and bearish mirrors), volume and IV regime.
  Each row carries a stop, 2R/3R targets and a suggested strategy.
- **Options Chain**: calls/puts around the live stock price with bid/ask/mark/last, volume, OI, IV, Δ Γ Θ V.
  Also shows expected move, max pain, put/call ratios, 25Δ skew, OI walls, OI/volume-by-strike chart and unusual activity.
  A **what-if** simulator reprices every contract for a hypothetical stock price, date and IV change.
  Clicking bid/ask builds an order ticket.
- **Trade Ideas**: concrete, scored trades across 11 strategies: long calls/puts, LEAPS, PMCC, debit and credit verticals,
  CSP/Wheel, covered calls and iron condors. They use published professional mechanics (tastytrade 45 DTE / 50% / 21 DTE,
  16–30Δ shorts, ≥⅓-width credit, 70Δ stock replacement). Each trade shows POP (IV and HV), EV, R:R, liquidity and size.
- **Strategy Builder**: 14 templates or custom legs, P/L at expiry and T+n with IV shift, ±1σ/2σ bands, breakevens,
  POP, net Greeks, a P/L matrix and contract sizing from your account risk settings.
- **Positions**: tracks trades with live marks and management alerts (take profit, 21 DTE, 2× credit stop, tested strike).
- **Playbook**: every rule the engine applies, in one place.
- **Portfolio risk** (Positions page): net Greeks, beta-weighted SPY delta, and a what-if grid (SPY ±10% × IV ±10 pts, plus
  7 days of decay) that reprices every leg.
- **Earnings IV crush**: the move options are pricing into each upcoming report vs. the stock's historical earnings moves,
  front-vs-back IV term premium and a buy/sell-premium verdict.
- **Options Lab**: backtests option structures (CSP, credit spreads, iron condors, long options, debit spreads) with
  take-profit / stop / DTE management. Prices are modeled with Black-Scholes; SPY uses real VIX history as its IV.
- **Chart Studio ✦**: a TradingView-style chart with toggleable studies (EMA/SMA, Bollinger, volume, MACD, RSI,
  Stochastic, ADX panes). It auto-draws support/resistance, trendlines, Fibonacci, anchored VWAP,
  supply/demand zones and the swing plan. It detects chart patterns (double tops/bottoms, head & shoulders,
  triangles, wedges, flags, cup & handle, VCP) and candlestick patterns. It has a daily-bar backtester
  (R-multiple stats, trades marked on the chart).
- **Chart Copilot** (Claude Opus 5): chat about the chart. It reads the app's market data, studies, patterns,
  options summary and trade ideas, runs backtests, and **draws its analysis on the chart**.
  Needs `ANTHROPIC_API_KEY`.

Market data comes from the **Charles Schwab Trader API**. Until Schwab is connected, a deterministic **demo feed**
(Black-Scholes pricing on a skewed volatility surface) drives every screen. The app gives analytics only. It never places orders.

## Run locally

```bash
npm install
npm start          # http://127.0.0.1:3100/optionsTrader/
npm test           # pricing / payoff math tests
```
With no `APP_PASSWORD_HASH` set, the login is disabled. Before exposing the app, run `npm run set-password -- "..."`.

## Deploy

See [deploy/DEPLOY.md](deploy/DEPLOY.md) (CyberPanel / OpenLiteSpeed + PM2).

## Layout

```
server/            Express app, auth, Schwab + demo providers, scanner, strategy engine, positions
shared/            Pricing & analytics used by both server and browser (Black-Scholes, payoff, indicators)
public/            Single-page UI (vanilla ES modules, no build step) + TradingView Lightweight Charts
data/              Runtime state: settings, positions, OAuth tokens, IV history (gitignored)
```
