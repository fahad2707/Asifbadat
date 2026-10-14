import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import PriceGroup from '../models/PriceGroup';
import Product from '../models/Product';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';

const router = express.Router();

function toValidObjectIds(ids: string[]): mongoose.Types.ObjectId[] {
  return ids
    .filter((id) => /^[a-f0-9A-F]{24}$/.test(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

function serializeGroup(g: any) {
  return {
    id: g._id.toString(),
    name: g.name,
    product_ids: (g.product_ids || []).map((id: any) => id.toString()),
    product_count: Array.isArray(g.product_ids) ? g.product_ids.length : 0,
  };
}

function serializeProduct(p: any) {
  return {
    id: p._id.toString(),
    name: p.name,
    sku: p.sku || '',
    stock_quantity: p.stock_quantity ?? 0,
    cost_price: p.cost_price != null ? Number(p.cost_price) : undefined,
    price: p.price != null ? Number(p.price) : undefined,
  };
}

// List all price groups
router.get('/', authenticateAdmin, async (_req: AuthRequest, res) => {
  try {
    const list = await PriceGroup.find().sort({ name: 1 }).lean();
    res.json(list.map(serializeGroup));
  } catch (error) {
    console.error('Get price groups error:', error);
    res.status(500).json({ error: 'Failed to fetch price groups' });
  }
});

// Get one price group with product details (for stock adjustment table)
router.get('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid price group id' });
    }
    const group = await PriceGroup.findById(req.params.id).lean();
    if (!group) return res.status(404).json({ error: 'Price group not found' });

    const products = await Product.find({
      _id: { $in: group.product_ids || [] },
      is_active: true,
    })
      .select('name sku stock_quantity cost_price price')
      .lean();

    // Preserve group order when possible
    const byId = new Map(products.map((p: any) => [p._id.toString(), p]));
    const ordered = (group.product_ids || [])
      .map((id: any) => byId.get(id.toString()))
      .filter(Boolean);

    res.json({
      ...serializeGroup(group),
      products: ordered.map(serializeProduct),
    });
  } catch (error) {
    console.error('Get price group error:', error);
    res.status(500).json({ error: 'Failed to fetch price group' });
  }
});

// Create price group (optional initial products)
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(1, 'Name is required'),
      product_ids: z.array(z.string()).optional(),
    });
    const data = schema.parse(req.body);
    const name = data.name.trim();

    const existing = await PriceGroup.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
    if (existing) {
      return res.status(400).json({ error: 'A price group with this name already exists' });
    }

    let productIds: mongoose.Types.ObjectId[] = [];
    if (data.product_ids?.length) {
      const oids = toValidObjectIds(data.product_ids);
      if (oids.length === 0) return res.status(400).json({ error: 'No valid product IDs' });
      const found = await Product.find({ _id: { $in: oids } }).select('_id').lean();
      productIds = found.map((p) => p._id as mongoose.Types.ObjectId);
    }

    const group = await PriceGroup.create({ name, product_ids: productIds });
    res.status(201).json(serializeGroup(group));
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    if (error?.code === 11000) return res.status(400).json({ error: 'A price group with this name already exists' });
    console.error('Create price group error:', error);
    res.status(500).json({ error: 'Failed to create price group' });
  }
});

// Add products to an existing price group (union, no duplicates)
router.post('/:id/products', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid price group id' });
    }
    const schema = z.object({
      product_ids: z.array(z.string()).min(1),
    });
    const { product_ids } = schema.parse(req.body);
    const oids = toValidObjectIds(product_ids);
    if (oids.length === 0) return res.status(400).json({ error: 'No valid product IDs' });

    const found = await Product.find({ _id: { $in: oids } }).select('_id').lean();
    if (found.length === 0) return res.status(400).json({ error: 'No matching products' });

    const group = await PriceGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Price group not found' });

    const existing = new Set((group.product_ids || []).map((id) => id.toString()));
    let added = 0;
    for (const p of found) {
      const id = (p._id as mongoose.Types.ObjectId).toString();
      if (!existing.has(id)) {
        group.product_ids.push(p._id as mongoose.Types.ObjectId);
        existing.add(id);
        added += 1;
      }
    }
    await group.save();

    res.json({
      ...serializeGroup(group),
      added,
      message: `Added ${added} product(s) to price group`,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Add products to price group error:', error);
    res.status(500).json({ error: 'Failed to add products to price group' });
  }
});

// Rename price group
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid price group id' });
    }
    const schema = z.object({
      name: z.string().trim().min(1),
    });
    const { name } = schema.parse(req.body);
    const trimmed = name.trim();

    const clash = await PriceGroup.findOne({
      _id: { $ne: req.params.id },
      name: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    }).lean();
    if (clash) return res.status(400).json({ error: 'A price group with this name already exists' });

    const group = await PriceGroup.findByIdAndUpdate(
      req.params.id,
      { name: trimmed },
      { new: true }
    );
    if (!group) return res.status(404).json({ error: 'Price group not found' });
    res.json(serializeGroup(group));
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    res.status(500).json({ error: 'Failed to update price group' });
  }
});

// Delete price group
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid price group id' });
    }
    const deleted = await PriceGroup.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Price group not found' });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete price group' });
  }
});

export default router;
