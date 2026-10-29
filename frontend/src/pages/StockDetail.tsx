import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { createChart, ColorType } from 'lightweight-charts';
import '../styles/stock-detail.css';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Indicator {
  ema_21: number;
  ma_50: number;
  ma_200: number;
  rsi_14: number;
  macd: number;
  macd_signal: number;
  bb_upper: number;
  bb_middle: number;
  bb_lower: number;
  atr_14: number;
  is_breakout: boolean;
  is_gap: boolean;
  is_reversal: boolean;
}

const StockDetail: React.FC = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [indicators, setIndicators] = useState<Indicator | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (symbol) {
      fetchChartData(symbol);
      fetchIndicators(symbol);
    }
  }, [symbol]);

  useEffect(() => {
    if (candles.length > 0 && chartContainerRef.current) {
      renderChart();
    }
  }, [candles]);

  const fetchChartData = async (sym: string) => {
    try {
      const response = await axios.get(`/api/prices/${sym}/candles`);
      setCandles(response.data);
    } catch (error) {
      console.error('Failed to fetch candles:', error);
    }
  };

  const fetchIndicators = async (sym: string) => {
    try {
      const response = await axios.get(`/api/indicators/${sym}`);
      setIndicators(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch indicators:', error);
      setLoading(false);
    }
  };

  const renderChart = () => {
    if (!chartContainerRef.current || candles.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0e27' },
        textColor: '#d1d5db',
      },
      width: chartContainerRef.current.clientWidth,
      height: 500,
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    candlestickSeries.setData(candles);

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  };

  return (
    <div className="stock-detail">
      <div className="stock-header">
        <h1>{symbol}</h1>
        {indicators && (
          <div className="technical-summary">
            <div className="summary-item">
              <span>EMA 21:</span>
              <strong>${indicators.ema_21?.toFixed(2)}</strong>
            </div>
            <div className="summary-item">
              <span>MA 50:</span>
              <strong>${indicators.ma_50?.toFixed(2)}</strong>
            </div>
            <div className="summary-item">
              <span>MA 200:</span>
              <strong>${indicators.ma_200?.toFixed(2)}</strong>
            </div>
            <div className="summary-item">
              <span>RSI 14:</span>
              <strong>{indicators.rsi_14?.toFixed(2)}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="chart-container">
        <div ref={chartContainerRef} className="chart" />
      </div>

      {indicators && (
        <div className="indicators-grid">
          <div className="indicator-card">
            <h3>MACD</h3>
            <div className="indicator-value">
              <div>MACD: {indicators.macd?.toFixed(4)}</div>
              <div>Signal: {indicators.macd_signal?.toFixed(4)}</div>
              <div>Histogram: {(indicators.macd - indicators.macd_signal)?.toFixed(4)}</div>
            </div>
          </div>

          <div className="indicator-card">
            <h3>Bollinger Bands</h3>
            <div className="indicator-value">
              <div>Upper: ${indicators.bb_upper?.toFixed(2)}</div>
              <div>Middle: ${indicators.bb_middle?.toFixed(2)}</div>
              <div>Lower: ${indicators.bb_lower?.toFixed(2)}</div>
            </div>
          </div>

          <div className="indicator-card">
            <h3>Volatility</h3>
            <div className="indicator-value">
              <div>ATR 14: {indicators.atr_14?.toFixed(4)}</div>
            </div>
          </div>

          <div className="indicator-card">
            <h3>Patterns</h3>
            <div className="patterns">
              {indicators.is_breakout && <span className="pattern breakout">Breakout</span>}
              {indicators.is_gap && <span className="pattern gap">Gap</span>}
              {indicators.is_reversal && <span className="pattern reversal">Reversal</span>}
              {!indicators.is_breakout && !indicators.is_gap && !indicators.is_reversal && (
                <span className="pattern">No patterns detected</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StockDetail;
