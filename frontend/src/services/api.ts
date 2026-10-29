import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // Stocks
  getStocks() {
    return this.client.get('/stocks');
  }

  getStock(symbol: string) {
    return this.client.get(`/stocks/${symbol}`);
  }

  searchStocks(query: string) {
    return this.client.get(`/stocks/search/${query}`);
  }

  updateStock(symbol: string) {
    return this.client.post(`/stocks/update/${symbol}`);
  }

  getStocksByVolumeDescending() {
    return this.client.get('/stocks/top/movers');
  }

  // Prices
  getPrices(symbol: string, days?: number) {
    return this.client.get(`/prices/${symbol}`, {
      params: { days },
    });
  }

  getCandles(symbol: string, days?: number, interval?: string) {
    return this.client.get(`/prices/${symbol}/candles`, {
      params: { days, interval },
    });
  }

  getLatestPrice(symbol: string) {
    return this.client.get(`/prices/${symbol}/latest`);
  }

  // Indicators
  getIndicators(symbol: string) {
    return this.client.get(`/indicators/${symbol}`);
  }

  getIndicatorHistory(symbol: string, days?: number) {
    return this.client.get(`/indicators/${symbol}/history`, {
      params: { days },
    });
  }

  scanBreakouts() {
    return this.client.get('/indicators/scan/breakouts');
  }

  scanGaps() {
    return this.client.get('/indicators/scan/gaps');
  }

  scanReversals() {
    return this.client.get('/indicators/scan/reversals');
  }

  // Portfolio
  getPortfolio(userId: string) {
    return this.client.get(`/portfolio/${userId}`);
  }

  createPosition(data: any) {
    return this.client.post('/portfolio', data);
  }

  updatePosition(id: string, data: any) {
    return this.client.put(`/portfolio/${id}`, data);
  }

  closePosition(id: string) {
    return this.client.post(`/portfolio/${id}/close`);
  }

  // Alerts
  getAlerts(userId: string) {
    return this.client.get(`/alerts/${userId}`);
  }

  createAlert(data: any) {
    return this.client.post('/alerts', data);
  }

  deleteAlert(id: string) {
    return this.client.delete(`/alerts/${id}`);
  }
}

export const apiService = new ApiService();
