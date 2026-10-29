import { Router } from 'express';
import { AppDataSource } from '@/config/database';
import { UserAlert } from '@/models/UserAlert';

const router = Router();
const alertRepository = AppDataSource.getRepository(UserAlert);

// Get user alerts
router.get('/:userId', async (req, res) => {
  try {
    const alerts = await alertRepository.find({
      where: { user_id: req.params.userId, is_active: true },
    });
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// Create alert
router.post('/', async (req, res) => {
  try {
    const { user_id, symbol, alert_type, trigger_price, trigger_condition } = req.body;

    const alert = new UserAlert();
    alert.user_id = user_id;
    alert.symbol = symbol;
    alert.alert_type = alert_type;
    alert.trigger_price = trigger_price;
    alert.trigger_condition = trigger_condition;
    alert.is_active = true;

    const saved = await alertRepository.save(alert);
    res.json(saved);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// Delete alert
router.delete('/:id', async (req, res) => {
  try {
    const alert = await alertRepository.findOneBy({ id: req.params.id });
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    alert.is_active = false;
    const updated = await alertRepository.save(alert);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

export default router;
