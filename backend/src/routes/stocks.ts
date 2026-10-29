import { Router } from 'express';
import { AppDataSource } from '@/config/database';
import { Stock } from '@/models/Stock';
import { finnhubService } from '@/services/finnhubService';
import { technicalAnalysisService } from '@/services/technicalAnalysisService';

const router = Router();
const stockRepository = AppDataSource.getRepository(Stock);

// Get all active stocks
router.get('/', async (req, res) => {
  try {
    const stocks = await stockRepository.find({
      where: { is_active: true },
      order: { volume: 'DESC' },
      take: 100,
    });
    res.json(stocks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stocks' });
  }
});

// Get stock by symbol
router.get('/:symbol', async (req, res) => {
  try {
    const stock = await stockRepository.findOneBy({ symbol: req.params.symbol });
    if (!stock) {
      return res.status(404).json({ error: 'Stock not found' });
    }
    res.json(stock);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stock' });
  }
});

// Search stocks
router.get('/search/:query', async (req, res) => {
  try {
    const results = await finnhubService.search(req.params.query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// Update stock data from Finnhub
router.post('/update/:symbol', async (req, res) => {
  try {
    const stock = await finnhubService.updateStockData(req.params.symbol);
    await technicalAnalysisService.calculateAndStoreIndicators(stock.id, stock.symbol);
    res.json({ success: true, stock });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update stock' });
  }
});

// Get stocks by sector
router.get('/sector/:sector', async (req, res) => {
  try {
    const stocks = await stockRepository.find({
      where: { sector: req.params.sector, is_active: true },
      order: { market_cap: 'DESC' },
    });
    res.json(stocks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stocks by sector' });
  }
});

// Get top movers
router.get('/top/movers', async (req, res) => {
  try {
    const stocks = await stockRepository
      .createQueryBuilder('stock')
      .where('stock.is_active = :isActive', { isActive: true })
      .orderBy('stock.volume', 'DESC')
      .limit(20)
      .getMany();
    res.json(stocks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch top movers' });
  }
});

export default router;
