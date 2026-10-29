import React, { useEffect, useState } from 'react';
import axios from 'axios';
import '../styles/portfolio.css';

interface Position {
  id: string;
  symbol: string;
  entry_price: number;
  shares: number;
  position_type: 'long' | 'short';
  current_price: number;
  stop_loss: number;
  take_profit: number;
  status: 'open' | 'closed';
  opened_at: string;
}

const Portfolio: React.FC = () => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const userId = 'user-1'; // Placeholder - should come from auth

  useEffect(() => {
    fetchPositions();
  }, []);

  const fetchPositions = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `/api/portfolio/${userId}`
      );
      setPositions(response.data);
    } catch (error) {
      console.error('Failed to fetch portfolio:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculatePnL = (position: Position) => {
    if (position.position_type === 'long') {
      return (position.current_price - position.entry_price) * position.shares;
    } else {
      return (position.entry_price - position.current_price) * position.shares;
    }
  };

  const calculatePnLPercent = (position: Position) => {
    if (position.position_type === 'long') {
      return ((position.current_price - position.entry_price) / position.entry_price) * 100;
    } else {
      return ((position.entry_price - position.current_price) / position.entry_price) * 100;
    }
  };

  const portfolioValue = positions.reduce((sum, pos) => {
    return sum + pos.current_price * pos.shares;
  }, 0);

  const totalPnL = positions.reduce((sum, pos) => {
    return sum + calculatePnL(pos);
  }, 0);

  return (
    <div className="portfolio">
      <div className="portfolio-header">
        <h1>Portfolio</h1>
        <p>Manage your open positions and track performance</p>
      </div>

      {positions.length > 0 && (
        <div className="portfolio-stats">
          <div className="stat-card">
            <div className="stat-label">Portfolio Value</div>
            <div className="stat-value">${portfolioValue.toFixed(2)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total P&L</div>
            <div className={`stat-value ${totalPnL >= 0 ? 'positive' : 'negative'}`}>
              ${totalPnL.toFixed(2)}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Open Positions</div>
            <div className="stat-value">{positions.length}</div>
          </div>
        </div>
      )}

      <div className="positions-section">
        {loading ? (
          <div className="loading">Loading positions...</div>
        ) : positions.length === 0 ? (
          <div className="empty-state">
            <p>No open positions</p>
            <a href="/scanner" className="btn-primary">
              Find Trading Opportunities
            </a>
          </div>
        ) : (
          <div className="positions-grid">
            {positions.map((position) => (
              <div key={position.id} className="position-card">
                <div className="position-header">
                  <div>
                    <h3>{position.symbol}</h3>
                    <p className={`position-type ${position.position_type}`}>
                      {position.position_type.toUpperCase()}
                    </p>
                  </div>
                  <div className="position-pnl">
                    <div className={`pnl-value ${calculatePnL(position) >= 0 ? 'positive' : 'negative'}`}>
                      ${calculatePnL(position).toFixed(2)}
                    </div>
                    <div className={`pnl-percent ${calculatePnLPercent(position) >= 0 ? 'positive' : 'negative'}`}>
                      {calculatePnLPercent(position) >= 0 ? '+' : ''}
                      {calculatePnLPercent(position).toFixed(2)}%
                    </div>
                  </div>
                </div>

                <div className="position-details">
                  <div className="detail-row">
                    <span>Entry Price:</span>
                    <strong>${position.entry_price.toFixed(2)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Current Price:</span>
                    <strong>${position.current_price.toFixed(2)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Shares:</span>
                    <strong>{position.shares}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Position Size:</span>
                    <strong>${(position.entry_price * position.shares).toFixed(2)}</strong>
                  </div>
                  {position.stop_loss && (
                    <div className="detail-row">
                      <span>Stop Loss:</span>
                      <strong>${position.stop_loss.toFixed(2)}</strong>
                    </div>
                  )}
                  {position.take_profit && (
                    <div className="detail-row">
                      <span>Take Profit:</span>
                      <strong>${position.take_profit.toFixed(2)}</strong>
                    </div>
                  )}
                </div>

                <div className="position-actions">
                  <button className="btn-secondary">Edit</button>
                  <button className="btn-danger">Close Position</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Portfolio;
