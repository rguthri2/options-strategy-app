import { AppDataSource } from '@/config/database';
import { StockPrice } from '@/models/StockPrice';
import { TechnicalIndicator } from '@/models/TechnicalIndicator';

class TechnicalAnalysisService {
  initialize() {
    console.log('Technical Analysis Service initialized');
  }

  // Exponential Moving Average
  calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return 0;
    
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;

    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * multiplier + ema * (1 - multiplier);
    }

    return ema;
  }

  // Simple Moving Average
  calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) return 0;
    return prices.slice(-period).reduce((a, b) => a + b) / period;
  }

  // Relative Strength Index
  calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period) return 0;

    let gains = 0,
      losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = prices[prices.length - i] - prices[prices.length - i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return isFinite(rsi) ? rsi : 50;
  }

  // MACD
  calculateMACD(prices: number[]) {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;
    const signal = this.calculateEMA([macd], 9);

    return {
      macd,
      signal,
      histogram: macd - signal,
    };
  }

  // Bollinger Bands
  calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2) {
    const sma = this.calculateSMA(prices, period);
    const variance =
      prices
        .slice(-period)
        .reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const std = Math.sqrt(variance);

    return {
      upper: sma + std * stdDev,
      middle: sma,
      lower: sma - std * stdDev,
    };
  }

  // Average True Range
  calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14) {
    const trueRanges: number[] = [];

    for (let i = 1; i < closes.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trueRanges.push(tr);
    }

    if (trueRanges.length < period) return 0;
    return trueRanges.slice(-period).reduce((a, b) => a + b) / period;
  }

  // On-Balance Volume
  calculateOBV(closes: number[], volumes: number[]) {
    let obv = 0;
    for (let i = 0; i < closes.length; i++) {
      if (i === 0) {
        obv = closes[i] > closes[i - 1] ? volumes[i] : -volumes[i];
      } else if (closes[i] > closes[i - 1]) {
        obv += volumes[i];
      } else if (closes[i] < closes[i - 1]) {
        obv -= volumes[i];
      }
    }
    return obv;
  }

  // Detect breakout
  detectBreakout(prices: number[], period: number = 20): boolean {
    if (prices.length < period + 1) return false;

    const recentPrices = prices.slice(-period);
    const previousHigh = Math.max(...recentPrices.slice(0, -1));
    const currentPrice = prices[prices.length - 1];

    return currentPrice > previousHigh;
  }

  // Detect gap
  detectGap(opens: number[], closes: number[], index: number, threshold: number = 0.02): boolean {
    if (index === 0) return false;

    const previousClose = closes[index - 1];
    const currentOpen = opens[index];
    const gapPercent = Math.abs(currentOpen - previousClose) / previousClose;

    return gapPercent > threshold;
  }

  // Detect reversal
  detectReversal(prices: number[], period: number = 3): boolean {
    if (prices.length < period * 2) return false;

    const recent = prices.slice(-period);
    const previous = prices.slice(-period * 2, -period);

    const recentTrend = recent[recent.length - 1] > recent[0] ? 'up' : 'down';
    const previousTrend = previous[previous.length - 1] > previous[0] ? 'up' : 'down';

    return recentTrend !== previousTrend;
  }

  async calculateAndStoreIndicators(stockId: string, symbol: string) {
    try {
      const stockPriceRepository = AppDataSource.getRepository(StockPrice);

      // Get last 200 days of price data
      const prices = await stockPriceRepository.find({
        where: { stock_id: stockId },
        order: { timestamp: 'ASC' },
        take: 200,
      });

      if (prices.length < 20) {
        console.warn(`Not enough price data for ${symbol}`);
        return;
      }

      const closes = prices.map((p) => Number(p.close));
      const opens = prices.map((p) => Number(p.open));
      const highs = prices.map((p) => Number(p.high));
      const lows = prices.map((p) => Number(p.low));
      const volumes = prices.map((p) => p.volume);

      const lastPrice = prices[prices.length - 1];

      // Calculate indicators
      const ema21 = this.calculateEMA(closes, 21);
      const ma50 = this.calculateSMA(closes, 50);
      const ma200 = this.calculateSMA(closes, 200);
      const rsi14 = this.calculateRSI(closes, 14);
      const { macd, signal: macdSignal, histogram } = this.calculateMACD(closes);
      const { upper: bbUpper, middle: bbMiddle, lower: bbLower } = this.calculateBollingerBands(closes);
      const atr14 = this.calculateATR(highs, lows, closes, 14);
      const obv = this.calculateOBV(closes, volumes);

      const isBreakout = this.detectBreakout(closes);
      const isGap = this.detectGap(opens, closes, closes.length - 1);
      const isReversal = this.detectReversal(closes);

      // Store in database
      const indicatorRepository = AppDataSource.getRepository(TechnicalIndicator);
      let indicator = await indicatorRepository.findOne({
        where: {
          stock_id: stockId,
          timestamp: lastPrice.timestamp,
        },
      });

      if (!indicator) {
        indicator = new TechnicalIndicator();
        indicator.stock_id = stockId;
        indicator.timestamp = lastPrice.timestamp;
      }

      indicator.ema_21 = ema21;
      indicator.ma_50 = ma50;
      indicator.ma_200 = ma200;
      indicator.rsi_14 = rsi14;
      indicator.macd = macd;
      indicator.macd_signal = macdSignal;
      indicator.macd_histogram = histogram;
      indicator.bb_upper = bbUpper;
      indicator.bb_middle = bbMiddle;
      indicator.bb_lower = bbLower;
      indicator.atr_14 = atr14;
      indicator.obv = obv;
      indicator.is_breakout = isBreakout;
      indicator.is_gap = isGap;
      indicator.is_reversal = isReversal;

      await indicatorRepository.save(indicator);
      return indicator;
    } catch (error) {
      console.error(`Error calculating indicators for ${symbol}:`, error);
      throw error;
    }
  }
}

export const technicalAnalysisService = new TechnicalAnalysisService();
