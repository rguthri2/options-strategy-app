import axios, { AxiosInstance } from 'axios';
import { AppDataSource } from '@/config/database';
import { Stock } from '@/models/Stock';
import { StockPrice } from '@/models/StockPrice';

class FinnhubService {
  private apiKey: string = '';
  private baseURL: string = 'https://finnhub.io/api/v1';
  private client: AxiosInstance | null = null;

  initialize(apiKey: string) {
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: this.baseURL,
      params: { token: this.apiKey },
    });
  }

  async getQuote(symbol: string) {
    try {
      const response = await this.client?.get('/quote', {
        params: { symbol },
      });
      return response?.data;
    } catch (error) {
      console.error(`Error fetching quote for ${symbol}:`, error);
      throw error;
    }
  }

  async getCandles(symbol: string, resolution: string = 'D', count: number = 100) {
    try {
      const from = Math.floor(Date.now() / 1000) - 86400 * count;
      const to = Math.floor(Date.now() / 1000);

      const response = await this.client?.get('/stock/candle', {
        params: {
          symbol,
          resolution,
          from,
          to,
        },
      });
      return response?.data;
    } catch (error) {
      console.error(`Error fetching candles for ${symbol}:`, error);
      throw error;
    }
  }

  async getCompanyProfile(symbol: string) {
    try {
      const response = await this.client?.get('/stock/profile2', {
        params: { symbol },
      });
      return response?.data;
    } catch (error) {
      console.error(`Error fetching profile for ${symbol}:`, error);
      throw error;
    }
  }

  async search(query: string) {
    try {
      const response = await this.client?.get('/search', {
        params: { q: query },
      });
      return response?.data;
    } catch (error) {
      console.error(`Error searching for ${query}:`, error);
      throw error;
    }
  }

  async getMarketNews(category: string = 'general') {
    try {
      const response = await this.client?.get('/news', {
        params: { category },
      });
      return response?.data;
    } catch (error) {
      console.error('Error fetching market news:', error);
      throw error;
    }
  }

  async updateStockData(symbol: string) {
    try {
      const quote = await this.getQuote(symbol);
      const stockRepository = AppDataSource.getRepository(Stock);

      let stock = await stockRepository.findOneBy({ symbol });

      if (!stock) {
        stock = new Stock();
        stock.symbol = symbol;
        stock.name = symbol;
        stock.is_active = true;
      }

      stock.price = quote.c;
      stock.previous_close = quote.pc;
      stock.volume = quote.v ?? 0;
      stock.week_52_high = quote.h52w;
      stock.week_52_low = quote.l52w;

      await stockRepository.save(stock);

      // Save price data
      const priceRepository = AppDataSource.getRepository(StockPrice);
      const price = new StockPrice();
      price.stock_id = stock.id;
      price.timestamp = new Date(quote.t * 1000);
      price.open = quote.o;
      price.high = quote.h;
      price.low = quote.l;
      price.close = quote.c;
      price.volume = quote.v ?? 0;
      price.interval = '1d';

      await priceRepository.save(price);

      return stock;
    } catch (error) {
      console.error(`Error updating stock data for ${symbol}:`, error);
      throw error;
    }
  }
}

export const finnhubService = new FinnhubService();
