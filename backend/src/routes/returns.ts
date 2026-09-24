import express from 'express';
import Return from '../models/Return';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';

const router = express.Router();

const generateReturnNumber = () => `RET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

// List returns
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { limit = 50 } = req.query;
    const returns = await Return.find()
      .sort({ created_at: -1 })
      .limit(Number(limit))
      .lean();
    res.json({
      returns: returns.map((r: any) => ({
        id: r._id.toString(),
        return_number: r.return_number,
        sale_id: r.sale_id?.toString(),
        order_id: r.order_id?.toString(),
        total_refund: r.total_refund,
        reason: r.reason,
        refund_method: r.refund_method,
        status: r.status,
        created_at: r.created_at,
      })),
    });
  } catch (error) {
    console.error('List returns error:', error);
    res.status(500).json({ error: 'Failed to fetch returns' });
  }
});

// Create is disabled until a Model A-safe POS refund exists (07D-10).
router.post('/', authenticateAdmin, async (_req: AuthRequest, res) => {
  return res.status(501).json({ error: 'POS returns are not currently supported.' });
});

export default router;
