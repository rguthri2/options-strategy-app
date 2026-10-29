import { Router } from 'express';
import { AppDataSource } from '@/config/database';
import { Stock } from '@/models/Stock';
import { finnhubService } from '@/services/finnhubService';
import { technicalAnalysisService } from '@/services/technicalAnalysisService';

const router = Router();
const stockRepository = AppDataSource.getRepository(Stock);

// Batch update multiple stocks
router.post('/batch-update', async (req, res) => {
  try {
    const { symbols } = req.body;
    const results = [];

    for (const symbol of symbols) {
      try {
        const stock = await finnhubService.updateStockData(symbol);
        await technicalAnalysisService.calculateAndStoreIndicators(stock.id, symbol);
        results.push({ symbol, success: true, stock });
      } catch (error) {
        results.push({ symbol, success: false, error: (error as Error).message });
      }
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Batch update failed' });
  }
});

// Get stocks by multiple criteria
router.post('/filter', async (req, res) => {
  try {
    const { minPrice, maxPrice, minVolume, sector, limit = 50 } = req.body;

    let query = stockRepository.createQueryBuilder('stock')
      .where('stock.is_active = :isActive', { isActive: true });

    if (minPrice) {
      query = query.andWhere('stock.price >= :minPrice', { minPrice });
    }

    if (maxPrice) {
      query = query.andWhere('stock.price <= :maxPrice', { maxPrice });
    }

    if (minVolume) {
      query = query.andWhere('stock.volume >= :minVolume', { minVolume });
    }

    if (sector) {
      query = query.andWhere('stock.sector = :sector', { sector });
    }

    const stocks = await query
      .orderBy('stock.volume', 'DESC')
      .limit(limit)
      .getMany();

    res.json(stocks);
  } catch (error) {
    res.status(500).json({ error: 'Filter failed' });
  }
});

export default router;
