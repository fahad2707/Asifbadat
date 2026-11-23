import express from 'express';
import mongoose from 'mongoose';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import AuditLog from '../models/AuditLog';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { applyPhysicalCount, PhysicalCountError } from '../services/physicalCountService';
import {
  applyStockAdjustment,
  barcodeDataUrl,
  deleteStockSheet,
  getStockSheet,
  getStockSheetByBarcode,
  listStockSheets,
  StockSheetError,
} from '../services/stockAdjustmentSheet';
import { serializeStockMovement } from '../utils/stockMovementDisplay';
import { buildInventoryStatement } from '../services/inventoryStatement';
import { damagedRowsForStatement, loadDamagedReturnRows } from '../services/damagedReturns';
import InventoryDamage from '../models/InventoryDamage';
import {
  markInventoryDamaged,
  serializeDamage,
  InventoryDamageError,
} from '../services/inventoryDamage';
import StoreSettings from '../models/StoreSettings';
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
  line_notes: z.string().max(500).optional(),
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
    line_notes: z.string().max(500).optional(),
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
            line_notes: body.line_notes,
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
    const barcode_png = result.barcode ? await barcodeDataUrl(result.barcode) : null;
    res.json({ ...result, barcode_png });
  } catch (error: any) {
    if (error instanceof PhysicalCountError || error instanceof StockSheetError) {
      return res.status(error.status).json(error.body);
    }
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Physical count error:', error);
    const msg = String(error?.message || '');
    if (/Transaction numbers are only allowed on a replica set/i.test(msg)) {
      return res.status(503).json({
        error:
          'Physical count needs MongoDB transactions. Start mongod as a replica set (e.g. replSetName: rs0) and run rs.initiate().',
        code: 'MONGO_REPLICA_SET_REQUIRED',
      });
    }
    res.status(500).json({ error: 'Failed to record physical count' });
  }
});

// Get stock movements for a product
router.get('/damaged-returns', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const [customerRows, warehouseDocs] = await Promise.all([
      loadDamagedReturnRows(),
      InventoryDamage.find().sort({ created_at: -1 }).lean(),
    ]);
    const warehouse = warehouseDocs.map((row) => serializeDamage(row));
    const rows = [...warehouse, ...customerRows];
    const stillHeld = rows.reduce((sum, row) => sum + row.quantity_still_held, 0);
    res.json({
      still_held: stillHeld,
      waiting: rows.filter((row) => row.hold === 'waiting').length,
      returned: rows.filter((row) => row.hold === 'returned').length,
      rows,
    });
  } catch (error) {
    console.error('Damaged returns:', error);
    res.status(500).json({ error: 'Failed to load damaged returns' });
  }
});

router.post('/mark-damaged', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      product_id: z.string().min(1),
      quantity: z.coerce.number().int().positive(),
      vendor_id: z.string().min(1),
      po_id: z.string().optional(),
      notes: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const row = await markInventoryDamaged({
      productId: data.product_id,
      quantity: data.quantity,
      vendorId: data.vendor_id,
      poId: data.po_id,
      notes: data.notes,
      adminId: req.userId,
    });
    res.status(201).json(row);
  } catch (error: unknown) {
    if (error instanceof InventoryDamageError) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Mark damaged:', error);
    res.status(500).json({ error: 'Failed to mark damaged stock' });
  }
});

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

router.get('/adjustment-sheets', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const kind = req.query.kind === 'physical_count' ? 'physical_count' : 'adjustment';
    const sheets = await listStockSheets(kind);
    res.json({ sheets });
  } catch (error) {
    console.error('List adjustment sheets error:', error);
    res.status(500).json({ error: 'Failed to load saved adjustments' });
  }
});

router.get('/adjustment-sheets/barcode/:code', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const sheet = await getStockSheetByBarcode(decodeURIComponent(req.params.code));
    if (!sheet) return res.status(404).json({ error: 'No adjustment matches that barcode' });
    res.json(sheet);
  } catch (error) {
    console.error('Lookup adjustment barcode error:', error);
    res.status(500).json({ error: 'Failed to look up adjustment' });
  }
});

router.get('/adjustment-sheets/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const sheet = await getStockSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Adjustment not found' });
    res.json(sheet);
  } catch (error) {
    console.error('Get adjustment sheet error:', error);
    res.status(500).json({ error: 'Failed to load adjustment' });
  }
});

router.post('/adjustment-sheets', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      notes: z.string().max(2000).optional(),
      lines: z
        .array(
          z.object({
            product_id: z.string().min(1),
            quantity_change: z.coerce.number().int(),
            cost_price: z.coerce.number().min(0).optional(),
            price: z.coerce.number().min(0).optional(),
            line_notes: z.string().max(500).optional(),
          })
        )
        .min(1)
        .max(200),
    });
    const body = schema.parse(req.body);
    const sheet = await applyStockAdjustment({
      lines: body.lines,
      notes: body.notes,
      adminId: req.userId,
    });
    res.status(201).json(sheet);
  } catch (error: any) {
    if (error instanceof StockSheetError) return res.status(error.status).json(error.body);
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Create adjustment sheet error:', error);
    const msg = String(error?.message || '');
    if (/Transaction numbers are only allowed on a replica set/i.test(msg)) {
      return res.status(503).json({
        error: 'Saving an adjustment needs MongoDB transactions. Start mongod as a replica set and run rs.initiate().',
        code: 'MONGO_REPLICA_SET_REQUIRED',
      });
    }
    res.status(500).json({ error: 'Failed to save adjustment' });
  }
});

router.get('/statement', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const from = new Date(String(req.query.from || ''));
    const to = new Date(String(req.query.to || ''));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
      return res.status(400).json({ error: 'Choose a valid statement period.' });
    }
    const spanDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    if (spanDays > 400) {
      return res.status(400).json({ error: 'A statement can cover at most one year.' });
    }
    const settings = await StoreSettings.findOne().select('business_name').lean();
    const products = await Product.find({})
      .select('name sku barcode product_id stock_quantity committed_quantity low_stock_threshold cost_price price is_active category_id sub_category_id')
      .populate('category_id', 'name')
      .populate('sub_category_id', 'name')
      .limit(5000)
      .lean();
    const movements = await StockMovement.find({ created_at: { $gte: from } })
      .populate('admin_id', 'name email')
      .sort({ created_at: 1 })
      .lean();
    const damagedReturns = damagedRowsForStatement(await loadDamagedReturnRows(), from, to);
    const statement = buildInventoryStatement({
      businessName: settings?.business_name || 'Express Distributors Inc',
      periodStart: from,
      periodEnd: to,
      products: products.map((product: any) => ({
        id: String(product._id),
        product_id: product.product_id || null,
        sku: product.sku || null,
        barcode: product.barcode || null,
        name: product.name,
        category_name: product.category_id?.name || null,
        sub_category_name: product.sub_category_id?.name || null,
        stock_quantity: Number(product.stock_quantity) || 0,
        committed_quantity: Number(product.committed_quantity) || 0,
        low_stock_threshold: product.low_stock_threshold == null ? null : Number(product.low_stock_threshold),
        cost_price: product.cost_price == null ? null : Number(product.cost_price),
        price: product.price == null ? null : Number(product.price),
        is_active: product.is_active !== false,
      })),
      movements: movements.map((movement: any) => {
        const serialized = serializeStockMovement(movement);
        return {
          id: serialized.id,
          product_id: serialized.product_id,
          created_at: serialized.created_at as string | Date,
          movement_type: serialized.movement_type_canonical || String(serialized.movement_type || ''),
          reference_type: serialized.reference_type as string | null,
          reference_number: serialized.reference_number as string | null,
          notes: serialized.notes as string | null,
          quantity_before: serialized.quantity_before,
          quantity_change: serialized.quantity_change,
          quantity_after: serialized.quantity_after,
          performed_by: serialized.performed_by,
        };
      }),
    });
    res.json({ ...statement, damaged_returns: damagedReturns });
  } catch (error) {
    console.error('Inventory statement error:', error);
    res.status(500).json({ error: 'Failed to build the inventory statement' });
  }
});

router.delete('/adjustment-sheets/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await deleteStockSheet(req.params.id);
    res.json(result);
  } catch (error: any) {
    if (error instanceof StockSheetError) return res.status(error.status).json(error.body);
    console.error('Delete adjustment sheet error:', error);
    const msg = String(error?.message || '');
    if (/Transaction numbers are only allowed on a replica set/i.test(msg)) {
      return res.status(503).json({
        error: 'Deleting an adjustment needs MongoDB transactions. Start mongod as a replica set and run rs.initiate().',
        code: 'MONGO_REPLICA_SET_REQUIRED',
      });
    }
    res.status(500).json({ error: 'Failed to delete adjustment' });
  }
});

export default router;
