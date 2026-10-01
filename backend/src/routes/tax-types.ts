import express from 'express';
import mongoose from 'mongoose';
import TaxType from '../models/TaxType';
import Product from '../models/Product';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = express.Router();

// Get all tax types
router.get('/', async (req, res) => {
  try {
    const list = await TaxType.find().sort({ name: 1 }).lean();
    res.json(
      list.map((t: any) => ({
        id: t._id.toString(),
        name: t.name,
        rate_type: t.rate_type || 'percent',
        rate: t.rate,
      }))
    );
  } catch (error) {
    console.error('Get tax types error:', error);
    res.status(500).json({ error: 'Failed to fetch tax types' });
  }
});

// Admin: Create tax type
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      rate_type: z.enum(['percent', 'amount']).optional(),
      rate: z.number().min(0),
    });
    const data = schema.parse(req.body);
    const tax = await TaxType.create({ name: data.name, rate_type: data.rate_type || 'percent', rate: data.rate });
    res.status(201).json({ id: tax._id.toString(), name: tax.name, rate_type: (tax as any).rate_type, rate: tax.rate });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    res.status(500).json({ error: 'Failed to create tax type' });
  }
});

// Admin: Update tax type
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({ name: z.string().min(1).optional(), rate_type: z.enum(['percent', 'amount']).optional(), rate: z.number().min(0).optional() });
    const data = schema.parse(req.body);
    const tax = await TaxType.findByIdAndUpdate(req.params.id, data, { new: true });
    if (!tax) return res.status(404).json({ error: 'Tax type not found' });
    const t = tax as any;
    res.json({ id: t._id.toString(), name: t.name, rate_type: t.rate_type || 'percent', rate: t.rate });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    res.status(500).json({ error: 'Failed to update' });
  }
});

// Admin: Delete tax type
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid tax type id' });
    }
    const assigned = await Product.countDocuments({ tax_type_id: new mongoose.Types.ObjectId(req.params.id) });
    if (assigned > 0) {
      return res.status(400).json({
        error: `Cannot delete a tax type assigned to ${assigned} product${assigned === 1 ? '' : 's'}.`,
      });
    }
    const deleted = await TaxType.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Tax type not found' });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

export default router;
