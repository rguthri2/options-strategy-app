import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/scanner.css';

interface ScannerStock {
  id: string;
  symbol: string;
  price: number;
  volume: number;
  is_breakout: boolean;
  is_gap: boolean;
  is_reversal: boolean;
  rsi_14: number;
  ema_21: number;
  ma_200: number;
}

type ScanType = 'breakouts' | 'gaps' | 'reversals';

const Scanner: React.FC = () => {
  const [scanType, setScanType] = useState<ScanType>('breakouts');
  const [results, setResults] = useState<ScannerStock[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    performScan(scanType);
  }, [scanType]);

  const performScan = async (type: ScanType) => {
    try {
      setLoading(true);
      const response = await axios.get(
        `/api/indicators/scan/${type}`
      );
      setResults(response.data);
    } catch (error) {
      console.error('Scan failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const getScanTitle = () => {
    const titles = {
      breakouts: 'Breakout Scanner',
      gaps: 'Gap Scanner',
      reversals: 'Reversal Scanner',
    };
    return titles[scanType];
  };

  return (
    <div className="scanner">
      <div className="scanner-header">
        <h1>{getScanTitle()}</h1>
        <p>Find trading opportunities based on technical patterns</p>
      </div>

      <div className="scanner-controls">
        <div className="scan-buttons">
          <button
            className={`btn-scan ${scanType === 'breakouts' ? 'active' : ''}`}
            onClick={() => setScanType('breakouts')}
          >
            🔝 Breakouts
          </button>
          <button
            className={`btn-scan ${scanType === 'gaps' ? 'active' : ''}`}
            onClick={() => setScanType('gaps')}
          >
            ↕️ Gaps
          </button>
          <button
            className={`btn-scan ${scanType === 'reversals' ? 'active' : ''}`}
            onClick={() => setScanType('reversals')}
          >
            🔄 Reversals
          </button>
        </div>
      </div>

      <div className="results-section">
        {loading ? (
          <div className="loading">Scanning market...</div>
        ) : results.length === 0 ? (
          <div className="empty-state">
            <p>No {scanType} found matching criteria</p>
          </div>
        ) : (
          <div className="results-table">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Price</th>
                  <th>Volume</th>
                  <th>RSI 14</th>
                  <th>EMA 21</th>
                  <th>MA 200</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.id} className="result-row">
                    <td className="symbol">{result.symbol}</td>
                    <td>${result.price?.toFixed(2)}</td>
                    <td>{(result.volume / 1000000).toFixed(2)}M</td>
                    <td>
                      <span className={`rsi ${result.rsi_14 > 70 ? 'overbought' : result.rsi_14 < 30 ? 'oversold' : 'normal'}`}>
                        {result.rsi_14?.toFixed(2)}
                      </span>
                    </td>
                    <td>${result.ema_21?.toFixed(2)}</td>
                    <td>${result.ma_200?.toFixed(2)}</td>
                    <td>
                      <span className="status-badge">
                        {scanType === 'breakouts' && '🔝 Breakout'}
                        {scanType === 'gaps' && '↕️ Gap'}
                        {scanType === 'reversals' && '🔄 Reversal'}
                      </span>
                    </td>
                    <td>
                      <a href={`/stock/${result.symbol}`} className="btn-link">
                        Analyze
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

export default Scanner;
