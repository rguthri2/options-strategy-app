// Default swing-trading universe: liquid, optionable names with tight markets. Editable in Settings.
// `demo` values only seed the simulated data feed (rough price level, annual vol, avg daily volume).

export const PROFILES = {
  SPY: ['SPDR S&P 500 ETF', 660, 0.15, 70e6], QQQ: ['Invesco QQQ Trust', 590, 0.19, 45e6],
  IWM: ['iShares Russell 2000 ETF', 240, 0.22, 30e6], AAPL: ['Apple Inc.', 245, 0.26, 55e6],
  MSFT: ['Microsoft Corp.', 510, 0.23, 20e6], NVDA: ['NVIDIA Corp.', 180, 0.45, 180e6],
  AMZN: ['Amazon.com Inc.', 225, 0.32, 40e6], META: ['Meta Platforms Inc.', 760, 0.36, 12e6],
  GOOGL: ['Alphabet Inc. Class A', 240, 0.30, 30e6], TSLA: ['Tesla Inc.', 420, 0.60, 95e6],
  AMD: ['Advanced Micro Devices', 160, 0.50, 45e6], AVGO: ['Broadcom Inc.', 340, 0.45, 22e6],
  NFLX: ['Netflix Inc.', 1200, 0.36, 3.5e6], CRM: ['Salesforce Inc.', 245, 0.34, 7e6],
  ORCL: ['Oracle Corp.', 290, 0.45, 18e6], ADBE: ['Adobe Inc.', 350, 0.34, 4e6],
  MU: ['Micron Technology', 160, 0.52, 25e6], QCOM: ['Qualcomm Inc.', 165, 0.35, 8e6],
  INTC: ['Intel Corp.', 30, 0.50, 90e6], PLTR: ['Palantir Technologies', 180, 0.62, 70e6],
  COIN: ['Coinbase Global', 330, 0.70, 10e6], MSTR: ['Strategy Inc.', 340, 0.80, 12e6],
  SHOP: ['Shopify Inc.', 150, 0.52, 9e6], UBER: ['Uber Technologies', 95, 0.40, 18e6],
  ABNB: ['Airbnb Inc.', 125, 0.40, 5e6], SNOW: ['Snowflake Inc.', 230, 0.52, 5e6],
  CRWD: ['CrowdStrike Holdings', 480, 0.46, 3.5e6], PANW: ['Palo Alto Networks', 200, 0.36, 6e6],
  NET: ['Cloudflare Inc.', 215, 0.55, 3e6], DDOG: ['Datadog Inc.', 145, 0.50, 4e6],
  JPM: ['JPMorgan Chase & Co.', 310, 0.24, 9e6], GS: ['Goldman Sachs Group', 790, 0.30, 2.2e6],
  BAC: ['Bank of America', 51, 0.26, 38e6], V: ['Visa Inc.', 345, 0.22, 7e6],
  MA: ['Mastercard Inc.', 585, 0.23, 3e6], PYPL: ['PayPal Holdings', 70, 0.40, 14e6],
  HOOD: ['Robinhood Markets', 120, 0.70, 35e6], SOFI: ['SoFi Technologies', 27, 0.62, 60e6],
  XOM: ['Exxon Mobil Corp.', 114, 0.24, 15e6], CVX: ['Chevron Corp.', 158, 0.25, 8e6],
  OXY: ['Occidental Petroleum', 46, 0.33, 12e6], CAT: ['Caterpillar Inc.', 460, 0.30, 3e6],
  DE: ['Deere & Co.', 470, 0.28, 1.5e6], BA: ['Boeing Co.', 220, 0.38, 8e6],
  LMT: ['Lockheed Martin', 490, 0.24, 1.3e6], GE: ['GE Aerospace', 290, 0.32, 5e6],
  HD: ['Home Depot Inc.', 410, 0.24, 3.5e6], LOW: ['Lowe\'s Companies', 265, 0.26, 2.5e6],
  NKE: ['Nike Inc.', 72, 0.38, 14e6], SBUX: ['Starbucks Corp.', 86, 0.33, 9e6],
  MCD: ['McDonald\'s Corp.', 305, 0.20, 3.5e6], COST: ['Costco Wholesale', 940, 0.22, 2e6],
  WMT: ['Walmart Inc.', 102, 0.22, 17e6], TGT: ['Target Corp.', 92, 0.36, 7e6],
  DIS: ['Walt Disney Co.', 115, 0.28, 9e6], LLY: ['Eli Lilly & Co.', 760, 0.36, 4e6],
  UNH: ['UnitedHealth Group', 330, 0.40, 12e6], ABBV: ['AbbVie Inc.', 220, 0.26, 6e6],
  MRNA: ['Moderna Inc.', 26, 0.70, 12e6], PFE: ['Pfizer Inc.', 25, 0.25, 35e6],
  FSLR: ['First Solar Inc.', 210, 0.55, 3e6], ENPH: ['Enphase Energy', 36, 0.65, 6e6],
  RIVN: ['Rivian Automotive', 14, 0.65, 35e6], LULU: ['Lululemon Athletica', 170, 0.45, 4e6],
  DKNG: ['DraftKings Inc.', 44, 0.48, 9e6], ROKU: ['Roku Inc.', 100, 0.55, 4e6],
  ARM: ['Arm Holdings', 150, 0.62, 5e6], TSM: ['Taiwan Semiconductor', 270, 0.38, 14e6],
  ASML: ['ASML Holding', 900, 0.38, 1.6e6], SMCI: ['Super Micro Computer', 45, 0.80, 25e6],
  ZS: ['Zscaler Inc.', 285, 0.45, 2e6], MDB: ['MongoDB Inc.', 320, 0.60, 2e6],
};

export const DEFAULT_UNIVERSE = Object.keys(PROFILES);

export const INDEXES = [
  { symbol: '$SPX', name: 'S&P 500', demo: [6600, 0.14] },
  { symbol: '$COMPX', name: 'Nasdaq', demo: [22400, 0.19] },
  { symbol: '$DJI', name: 'Dow Jones', demo: [46200, 0.13] },
  { symbol: '$RUT', name: 'Russell 2000', demo: [2420, 0.21] },
  { symbol: '$VIX', name: 'VIX', demo: [16.5, 0.9] },
];

export const nameOf = sym => PROFILES[sym]?.[0] || INDEXES.find(i => i.symbol === sym)?.name || sym;
