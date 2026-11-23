import express from 'express';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { buildMoneyInStatement, buildMoneyOutStatement } from '../services/cashbook';

const router = express.Router();

router.get('/money-in/statement', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const statement = await buildMoneyInStatement(String(req.query.period || 'month'));
    if (!statement) return res.status(400).json({ error: 'Choose a statement period.' });
    res.json(statement);
  } catch (error) {
    console.error('Money in statement:', error);
    res.status(500).json({ error: 'Failed to build money-in statement' });
  }
});

router.get('/money-out/statement', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const statement = await buildMoneyOutStatement(String(req.query.period || 'month'));
    if (!statement) return res.status(400).json({ error: 'Choose a statement period.' });
    res.json(statement);
  } catch (error) {
    console.error('Money out statement:', error);
    res.status(500).json({ error: 'Failed to build money-out statement' });
  }
});

export default router;
