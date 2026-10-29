import { Router } from 'express';
import { AppDataSource } from '@/config/database';
import { Portfolio } from '@/models/Portfolio';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const portfolioRepository = AppDataSource.getRepository(Portfolio);

// Get user portfolio
router.get('/:userId', async (req, res) => {
  try {
    const positions = await portfolioRepository.find({
      where: { user_id: req.params.userId, status: 'open' },
    });
    res.json(positions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

// Create new position
router.post('/', async (req, res) => {
  try {
    const { user_id, symbol, entry_price, shares, position_type, stop_loss, take_profit } = req.body;

    const position = new Portfolio();
    position.user_id = user_id;
    position.symbol = symbol;
    position.entry_price = entry_price;
    position.shares = shares;
    position.position_type = position_type;
    position.stop_loss = stop_loss;
    position.take_profit = take_profit;
    position.status = 'open';

    const saved = await portfolioRepository.save(position);
    res.json(saved);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create position' });
  }
});

// Update position
router.put('/:id', async (req, res) => {
  try {
    const position = await portfolioRepository.findOneBy({ id: req.params.id });
    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    Object.assign(position, req.body);
    const updated = await portfolioRepository.save(position);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update position' });
  }
});

// Close position
router.post('/:id/close', async (req, res) => {
  try {
    const position = await portfolioRepository.findOneBy({ id: req.params.id });
    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    position.status = 'closed';
    position.closed_at = new Date();

    const updated = await portfolioRepository.save(position);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to close position' });
  }
});

export default router;
