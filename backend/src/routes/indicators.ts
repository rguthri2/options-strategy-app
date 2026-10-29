import { Router } from 'express';
import { AppDataSource } from '@/config/database';
import { TechnicalIndicator } from '@/models/TechnicalIndicator';
import { Stock } from '@/models/Stock';

const router = Router();
const indicatorRepository = AppDataSource.getRepository(TechnicalIndicator);
const stockRepository = AppDataSource.getRepository(Stock);

// Get latest technical indicators for a stock
router.get('/:symbol', async (req, res) => {
  try {
    const stock = await stockRepository.findOneBy({ symbol: req.params.symbol });
    if (!stock) {
      return res.status(404).json({ error: 'Stock not found' });
    }

    const indicator = await indicatorRepository.findOne({
      where: { stock_id: stock.id },
      order: { timestamp: 'DESC' },
    });

    res.json(indicator);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch indicators' });
  }
});

// Get indicator history
router.get('/:symbol/history', async (req, res) => {
  try {
    const { days = 100 } = req.query;

    const stock = await stockRepository.findOneBy({ symbol: req.params.symbol });
    if (!stock) {
      return res.status(404).json({ error: 'Stock not found' });
    }

    const indicators = await indicatorRepository.find({
      where: { stock_id: stock.id },
      order: { timestamp: 'ASC' },
      take: Number(days),
    });

    res.json(indicators);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch indicator history' });
  }
});

// Get stocks with breakouts
router.get('/scan/breakouts', async (req, res) => {
  try {
    const breakouts = await indicatorRepository
      .createQueryBuilder('indicator')
      .where('indicator.is_breakout = :isBreakout', { isBreakout: true })
      .orderBy('indicator.timestamp', 'DESC')
      .limit(50)
      .getMany();

    res.json(breakouts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to scan for breakouts' });
  }
});

// Get stocks with gaps
router.get('/scan/gaps', async (req, res) => {
  try {
    const gaps = await indicatorRepository
      .createQueryBuilder('indicator')
      .where('indicator.is_gap = :isGap', { isGap: true })
      .orderBy('indicator.timestamp', 'DESC')
      .limit(50)
      .getMany();

    res.json(gaps);
  } catch (error) {
    res.status(500).json({ error: 'Failed to scan for gaps' });
  }
});

// Get stocks with reversals
router.get('/scan/reversals', async (req, res) => {
  try {
    const reversals = await indicatorRepository
      .createQueryBuilder('indicator')
      .where('indicator.is_reversal = :isReversal', { isReversal: true })
      .orderBy('indicator.timestamp', 'DESC')
      .limit(50)
      .getMany();

    res.json(reversals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to scan for reversals' });
  }
});

export default router;
