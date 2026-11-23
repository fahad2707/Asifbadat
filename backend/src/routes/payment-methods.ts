import express from 'express';
import PaymentMethod from '../models/PaymentMethod';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = express.Router();

// Get all payment methods (used by receive-payment and catalog)
router.get('/', async (req, res) => {
  try {
    const list = await PaymentMethod.find().sort({ display_order: 1, name: 1 }).lean();
    res.json(
      list.map((p: any) => ({
        id: p._id.toString(),
        name: p.name,
        display_order: p.display_order ?? 0,
      }))
    );
  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({ error: 'Failed to fetch payment methods' });
  }
});

// Admin: Create payment method
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      display_order: z.number().optional(),
    });
    const data = schema.parse(req.body);
    const pm = await PaymentMethod.create({
      name: data.name.trim(),
      display_order: data.display_order ?? 0,
    });
    const p = pm as any;
    res.status(201).json({ id: p._id.toString(), name: p.name, display_order: p.display_order ?? 0 });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to create payment method' });
  }
});

// Admin: Update payment method
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      display_order: z.number().optional(),
    });
    const data = schema.parse(req.body);
    const pm = await PaymentMethod.findByIdAndUpdate(req.params.id, data, { new: true });
    if (!pm) return res.status(404).json({ error: 'Payment method not found' });
    const p = pm as any;
    res.json({ id: p._id.toString(), name: p.name, display_order: p.display_order ?? 0 });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to update' });
  }
});

// Admin: Delete payment method
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    await PaymentMethod.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

export default router;
