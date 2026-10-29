import { Router } from 'express';
import { AppDataSource } from '@/config/database';
import { StockPrice } from '@/models/StockPrice';
import { Stock } from '@/models/Stock';

const router = Router();
const priceRepository = AppDataSource.getRepository(StockPrice);
const stockRepository = AppDataSource.getRepository(Stock);

// Get historical prices for a stock
router.get('/:symbol', async (req, res) => {
  try {
    const { days = 100 } = req.query;

    const stock = await stockRepository.findOneBy({ symbol: req.params.symbol });
    if (!stock) {
      return res.status(404).json({ error: 'Stock not found' });
    }

    const prices = await priceRepository.find({
      where: { stock_id: stock.id },
      order: { timestamp: 'DESC' },
      take: Number(days),
    });

    res.json(prices.reverse());
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});

// Get OHLCV data for chart
router.get('/:symbol/candles', async (req, res) => {
  try {
    const { days = 100, interval = '1d' } = req.query;

    const stock = await stockRepository.findOneBy({ symbol: req.params.symbol });
    if (!stock) {
      return res.status(404).json({ error: 'Stock not found' });
    }

    const prices = await priceRepository.find({
      where: { stock_id: stock.id, interval: interval as string },
      order: { timestamp: 'ASC' },
      take: Number(days),
    });

    const candles = prices.map((p) => ({
      time: Math.floor(p.timestamp.getTime() / 1000),
      open: Number(p.open),
      high: Number(p.high),
      low: Number(p.low),
      close: Number(p.close),
      volume: p.volume,
    }));

    res.json(candles);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch candles' });
  }
});

// Get latest price
router.get('/:symbol/latest', async (req, res) => {
  try {
    const stock = await stockRepository.findOneBy({ symbol: req.params.symbol });
    if (!stock) {
      return res.status(404).json({ error: 'Stock not found' });
    }

    const price = await priceRepository.findOne({
      where: { stock_id: stock.id },
      order: { timestamp: 'DESC' },
    });

    res.json(price);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch latest price' });
  }
});

export default router;
