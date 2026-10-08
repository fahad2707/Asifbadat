import express from 'express';
import mongoose from 'mongoose';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import AuditLog from '../models/AuditLog';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { applyPhysicalCount, PhysicalCountError } from '../services/physicalCountService';
import { serializeStockMovement } from '../utils/stockMovementDisplay';
import { createStockMovement, StockMovementWriteError } from '../utils/createStockMovement';
import { StockMovementType } from '../shared/enums';

const router = express.Router();

const countedQuantitySchema = z
  .number({ invalid_type_error: 'counted_quantity must be a number' })
  .int('counted_quantity must be a whole number')
  .min(0, 'counted_quantity cannot be negative');

const physicalCountLineSchema = z.object({
  product_id: z.string().min(1),
  counted_quantity: countedQuantitySchema,
  expected_current_quantity: z.number().int().optional(),
});

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

// Adjust stock (manual adjustment) and optionally update listed cost / selling price.
// Quantity path: $inc + canonical ADJUSTMENT movement in one Mongo transaction (delta, not absolute).
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

    const oldQty = Number(product.stock_quantity) || 0;
    const priceUpdate: Record<string, unknown> = {};
    if (hasCost) priceUpdate.cost_price = nextCost;
    if (hasPrice) priceUpdate.price = nextPrice;

    let finalStock = oldQty;
    let finalCost = hasCost ? nextCost : (product as any).cost_price;
    let finalPrice = hasPrice ? nextPrice : product.price;

    if (hasQty) {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const updatedProduct = await Product.findByIdAndUpdate(
          product_id,
          {
            $inc: { stock_quantity: quantity_change },
            ...(Object.keys(priceUpdate).length ? { $set: priceUpdate } : {}),
          },
          { new: true, session }
        );
        if (!updatedProduct) {
          throw new Error('Product not found');
        }
        const after = Number((updatedProduct as any).stock_quantity);
        const before = after - quantity_change;
        await createStockMovement({
          session,
          productId: product_id,
          movementType: StockMovementType.ADJUSTMENT,
          quantityBefore: before,
          quantityChange: quantity_change,
          quantityAfter: after,
          notes: notes || undefined,
          adminId:
            typeof req.userId === 'string' && mongoose.Types.ObjectId.isValid(req.userId)
              ? req.userId
              : undefined,
        });
        await session.commitTransaction();
        finalStock = after;
        finalCost = (updatedProduct as any).cost_price;
        finalPrice = (updatedProduct as any).price;
      } catch (txnErr) {
        await session.abortTransaction();
        throw txnErr;
      } finally {
        session.endSession();
      }
    } else {
      const updatedProduct = await Product.findByIdAndUpdate(product_id, { $set: priceUpdate }, { new: true });
      if (!updatedProduct) return res.status(404).json({ error: 'Product not found' });
      finalStock = Number((updatedProduct as any).stock_quantity) || 0;
      finalCost = (updatedProduct as any).cost_price;
      finalPrice = (updatedProduct as any).price;
    }

    await AuditLog.create({
      admin_id: req.userId,
      action: 'stock_adjust',
      entity_type: 'Product',
      entity_id: product_id,
      old_value: { stock_quantity: oldQty, cost_price: (product as any).cost_price, price: product.price },
      new_value: {
        stock_quantity: finalStock,
        cost_price: finalCost,
        price: finalPrice,
      },
      details: notes || `Stock adjusted by ${quantity_change >= 0 ? '+' : ''}${quantity_change}`,
    });

    res.json({
      id: product_id.toString(),
      stock_quantity: finalStock,
      cost_price: finalCost ?? null,
      price: finalPrice,
      message: hasQty
        ? `Stock adjusted by ${quantity_change >= 0 ? '+' : ''}${quantity_change}`
        : 'Prices updated',
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    if (error instanceof StockMovementWriteError) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error?.message === 'Product not found') {
      return res.status(404).json({ error: 'Product not found' });
    }
    console.error('Adjust stock error:', error);
    res.status(500).json({ error: 'Failed to adjust stock' });
  }
});

const physicalCountBodySchema = z
  .object({
    product_id: z.string().min(1).optional(),
    counted_quantity: countedQuantitySchema.optional(),
    expected_current_quantity: z.number().int().optional(),
    lines: z.array(physicalCountLineSchema).max(200).optional(),
    reason: z.string().max(80).optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.lines && body.lines.length > 0) return;
    if (body.product_id != null && body.counted_quantity != null) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide counted_quantity for a product, or a lines array',
    });
  });

// Physical warehouse count: counted_quantity is absolute on-hand, not a delta.
router.post('/physical-count', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const body = physicalCountBodySchema.parse(req.body);
    const lines = (body.lines && body.lines.length > 0
      ? body.lines
      : [
          {
            product_id: body.product_id as string,
            counted_quantity: body.counted_quantity as number,
            expected_current_quantity: body.expected_current_quantity,
          },
        ]
    ).filter((line) => line.product_id);

    const seen = new Set<string>();
    for (const line of lines) {
      if (seen.has(line.product_id)) {
        return res.status(400).json({ error: 'Duplicate product in this physical count' });
      }
      seen.add(line.product_id);
    }

    const result = await applyPhysicalCount({
      lines,
      reason: body.reason,
      notes: body.notes,
      adminId: req.userId,
    });
    res.json(result);
  } catch (error: any) {
    if (error instanceof PhysicalCountError) {
      return res.status(error.status).json(error.body);
    }
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Physical count error:', error);
    res.status(500).json({ error: 'Failed to record physical count' });
  }
});

// Get stock movements for a product
router.get('/movements/:productId', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Invalid product' });
    }
    const { limit = 50 } = req.query;
    const movements = await StockMovement.find({ product_id: productId })
      .populate('admin_id', 'name email')
      .sort({ created_at: -1 })
      .limit(Number(limit))
      .lean();
    res.json({
      movements: movements.map((m: any) => serializeStockMovement(m)),
    });
  } catch (error) {
    console.error('Get movements error:', error);
    res.status(500).json({ error: 'Failed to fetch movements' });
  }
});

export default router;
