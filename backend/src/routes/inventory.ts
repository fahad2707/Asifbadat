import express from 'express';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import AuditLog from '../models/AuditLog';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = express.Router();

// Inventory summary: total in/out per product
router.get('/summary', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const agg = await StockMovement.aggregate([
      {
        $group: {
          _id: '$product_id',
          in_qty: {
            $sum: {
              $cond: [{ $gt: ['$quantity_change', 0] }, '$quantity_change', 0],
            },
          },
          out_qty: {
            $sum: {
              $cond: [{ $lt: ['$quantity_change', 0] }, { $multiply: ['$quantity_change', -1] }, 0],
            },
          },
        },
      },
    ]);
    const summary: Record<string, { in: number; out: number }> = {};
    for (const row of agg) {
      summary[String(row._id)] = { in: row.in_qty || 0, out: row.out_qty || 0 };
    }
    res.json({ summary });
  } catch (error) {
    console.error('Inventory summary error:', error);
    res.status(500).json({ error: 'Failed to fetch inventory summary' });
  }
});

// Adjust stock (manual adjustment) and optionally update listed cost / selling price
router.post('/adjust', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      product_id: z.string(),
      quantity_change: z.coerce.number().int().optional().default(0), // positive = add, negative = remove
      cost_price: z.coerce.number().min(0).optional(),
      price: z.coerce.number().min(0).optional(),
      notes: z.string().optional(),
    });
    const { product_id, quantity_change, cost_price, price, notes } = schema.parse(req.body);
    const product = await Product.findById(product_id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const hasQty = quantity_change !== 0;
    const hasCost = cost_price !== undefined;
    const hasPrice = price !== undefined;
    if (!hasQty && !hasCost && !hasPrice) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const nextCost = hasCost ? Number(cost_price) : Number((product as any).cost_price || 0);
    const nextPrice = hasPrice ? Number(price) : Number(product.price || 0);
    if (nextCost > 0) {
      const min = Math.round(nextCost * 1.05 * 100) / 100;
      if (nextPrice + 1e-9 < min) {
        return res.status(400).json({
          error: `"${product.name}" selling price must be at least $${min.toFixed(2)} (5% above cost $${nextCost.toFixed(2)}).`,
        });
      }
    }

    const oldQty = product.stock_quantity;
    const newQty = oldQty + quantity_change;
    const update: Record<string, unknown> = {};
    if (hasQty) update.stock_quantity = newQty;
    if (hasCost) update.cost_price = nextCost;
    if (hasPrice) update.price = nextPrice;

    await Product.findByIdAndUpdate(product_id, update);
    if (hasQty) {
      await StockMovement.create({
        product_id,
        movement_type: 'adjustment',
        quantity_change,
        notes: notes || undefined,
        admin_id: req.userId,
      });
    }
    await AuditLog.create({
      admin_id: req.userId,
      action: 'stock_adjust',
      entity_type: 'Product',
      entity_id: product_id,
      old_value: { stock_quantity: oldQty, cost_price: (product as any).cost_price, price: product.price },
      new_value: {
        stock_quantity: hasQty ? newQty : oldQty,
        cost_price: hasCost ? nextCost : (product as any).cost_price,
        price: hasPrice ? nextPrice : product.price,
      },
      details: notes || `Stock adjusted by ${quantity_change >= 0 ? '+' : ''}${quantity_change}`,
    });
    const updated = await Product.findById(product_id).lean();
    res.json({
      id: updated!._id.toString(),
      stock_quantity: (updated as any).stock_quantity,
      cost_price: (updated as any).cost_price ?? null,
      price: (updated as any).price,
      message: hasQty
        ? `Stock adjusted by ${quantity_change >= 0 ? '+' : ''}${quantity_change}`
        : 'Prices updated',
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Adjust stock error:', error);
    res.status(500).json({ error: 'Failed to adjust stock' });
  }
});

// Get stock movements for a product
router.get('/movements/:productId', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { productId } = req.params;
    const { limit = 50 } = req.query;
    const movements = await StockMovement.find({ product_id: productId })
      .sort({ created_at: -1 })
      .limit(Number(limit))
      .lean();
    res.json({
      movements: movements.map((m: any) => ({
        id: m._id.toString(),
        movement_type: m.movement_type,
        quantity_change: m.quantity_change,
        reference_type: m.reference_type,
        notes: m.notes,
        created_at: m.created_at,
      })),
    });
  } catch (error) {
    console.error('Get movements error:', error);
    res.status(500).json({ error: 'Failed to fetch movements' });
  }
});

export default router;
