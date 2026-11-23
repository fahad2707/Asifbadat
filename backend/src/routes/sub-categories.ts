import express from 'express';
import mongoose from 'mongoose';
import SubCategory from '../models/SubCategory';
import Product from '../models/Product';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = express.Router();

// Get all sub-categories (optional filter by category_id)
router.get('/', async (req, res) => {
  try {
    const { category_id } = req.query;
    const filter = category_id ? { category_id } : {};
    const list = await SubCategory.find(filter)
      .populate('category_id', 'name slug')
      .sort({ display_order: 1, name: 1 })
      .lean();
    res.json(
      list.map((s: any) => ({
        id: s._id.toString(),
        name: s.name,
        slug: s.slug,
        category_id: s.category_id?._id?.toString(),
        category_name: s.category_id?.name,
        description: s.description,
        display_order: s.display_order,
      }))
    );
  } catch (error) {
    console.error('Get sub-categories error:', error);
    res.status(500).json({ error: 'Failed to fetch sub-categories' });
  }
});

// Admin: Create sub-category
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      category_id: z.string().min(1),
      description: z.string().optional(),
      display_order: z.number().int().default(0),
    });
    const data = schema.parse(req.body);
    const slug = data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const sub = await SubCategory.create({
      name: data.name,
      slug: `${slug}-${data.category_id.slice(-6)}`,
      category_id: data.category_id,
      description: data.description,
      display_order: data.display_order,
    });
    const populated = await SubCategory.findById(sub._id).populate('category_id', 'name slug').lean();
    res.status(201).json({
      id: (populated as any)._id.toString(),
      name: (populated as any).name,
      slug: (populated as any).slug,
      category_id: (populated as any).category_id?._id?.toString(),
      category_name: (populated as any).category_id?.name,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.message });
    console.error('Create sub-category error:', error);
    res.status(500).json({ error: 'Failed to create sub-category' });
  }
});

// Admin: Update sub-category
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      category_id: z.string().optional(),
      description: z.string().optional(),
      display_order: z.number().int().optional(),
    });
    const data = schema.parse(req.body);
    const sub = await SubCategory.findByIdAndUpdate(req.params.id, data, { new: true });
    if (!sub) return res.status(404).json({ error: 'Sub-category not found' });
    res.json({ id: sub._id.toString(), ...sub.toObject() });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to update' });
  }
});

// Admin: Bulk delete sub-categories (unset sub_category_id on products)
router.post('/bulk-delete', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({ ids: z.array(z.string()).min(1) });
    const { ids } = schema.parse(req.body);
    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
    await Product.updateMany({ sub_category_id: { $in: objectIds } }, { $unset: { sub_category_id: 1 } });
    const result = await SubCategory.deleteMany({ _id: { $in: objectIds } });
    res.json({ message: `${result.deletedCount} subcategory(ies) deleted`, deleted: result.deletedCount });
  } catch (error: any) {
    if (error?.name === 'ZodError') return res.status(400).json({ error: error.errors?.[0]?.message });
    console.error('Bulk delete sub-categories error:', error);
    res.status(500).json({ error: 'Failed to delete sub-categories' });
  }
});

// Admin: Delete sub-category
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    await SubCategory.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

export default router;
