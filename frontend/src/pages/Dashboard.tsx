import React, { useEffect, useState } from 'react';
import axios from 'axios';
import '../styles/dashboard.css';

interface Stock {
  id: string;
  symbol: string;
  name: string;
  price: number;
  volume: number;
  market_cap: number;
}

const Dashboard: React.FC = () => {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStocks();
  }, []);

  const fetchStocks = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/stocks');
      setStocks(response.data);
    } catch (error) {
      console.error('Failed to fetch stocks:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Market Overview</h1>
        <p>Real-time stock data and technical analysis</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Market Status</div>
          <div className="stat-value">Open</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Top Movers</div>
          <div className="stat-value">+5.2%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Volume</div>
          <div className="stat-value">2.4M</div>
        </div>
      </div>

      <div className="stocks-section">
        <div className="section-header">
          <h2>Top Stocks by Volume</h2>
          <button className="btn-secondary">Refresh</button>
        </div>

        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          <div className="stocks-table">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Price</th>
                  <th>Volume</th>
                  <th>Market Cap</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((stock) => (
                  <tr key={stock.id}>
                    <td className="symbol">{stock.symbol}</td>
                    <td>${stock.price?.toFixed(2) || 'N/A'}</td>
                    <td>{(stock.volume / 1000000).toFixed(2)}M</td>
                    <td>${(stock.market_cap / 1000000000).toFixed(2)}B</td>
                    <td>
                      <a href={`/stock/${stock.symbol}`} className="btn-link">
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
