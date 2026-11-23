import mongoose from 'mongoose';
import Product from '../models/Product';
import { StockMovementType } from '../shared/enums';
import { createStockMovement, StockMovementWriteError } from '../utils/createStockMovement';
import { createStockSheet } from './stockAdjustmentSheet';
import {
  PHYSICAL_COUNT_REASON,
  PHYSICAL_COUNT_REFERENCE_TYPE,
  physicalCountDelta,
} from '../utils/physicalCount';

export type PhysicalCountLineInput = {
  product_id: string;
  counted_quantity: number;
  expected_current_quantity?: number;
  line_notes?: string;
};

export type PhysicalCountLineResult = {
  product_id: string;
  product_name: string;
  counted_quantity: number;
  quantity_before: number;
  quantity_delta: number;
  quantity_after: number;
  changed: boolean;
};

export class PhysicalCountError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error || 'Physical count failed'));
    this.status = status;
    this.body = body;
    this.name = 'PhysicalCountError';
  }
}

export async function applyPhysicalCount(opts: {
  lines: PhysicalCountLineInput[];
  reason?: string;
  notes?: string;
  adminId?: string;
}): Promise<{
  reference_number: string | null;
  reason: string;
  notes: string | null;
  lines: PhysicalCountLineResult[];
}> {
  const reason = (opts.reason || '').trim() || PHYSICAL_COUNT_REASON;
  const notes = (opts.notes || '').trim() || undefined;
  const adminId = opts.adminId && mongoose.Types.ObjectId.isValid(opts.adminId)
    ? new mongoose.Types.ObjectId(opts.adminId)
    : undefined;

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const prepared: Array<{
      product_id: mongoose.Types.ObjectId;
      product_name: string;
      sku?: string;
      current: number;
      counted: number;
      delta: number;
      line_notes?: string;
    }> = [];

    for (const line of opts.lines) {
      if (!mongoose.Types.ObjectId.isValid(line.product_id)) {
        throw new PhysicalCountError(404, { error: 'Product not found' });
      }
      const product = await Product.findById(line.product_id, 'name sku stock_quantity', { session });
      if (!product) {
        throw new PhysicalCountError(404, { error: 'Product not found', product_id: line.product_id });
      }
      const current = Number(product.stock_quantity) || 0;
      if (
        line.expected_current_quantity !== undefined &&
        line.expected_current_quantity !== current
      ) {
        throw new PhysicalCountError(409, {
          error: 'Stock changed since this count started. Reload current quantity and recount.',
          code: 'STOCK_CONFLICT',
          product_id: line.product_id,
          product_name: product.name,
          expected_current_quantity: line.expected_current_quantity,
          actual_current_quantity: current,
        });
      }
      const counted = line.counted_quantity;
      prepared.push({
        product_id: product._id as mongoose.Types.ObjectId,
        product_name: product.name,
        sku: (product as { sku?: string }).sku || undefined,
        current,
        counted,
        delta: physicalCountDelta(current, counted),
        line_notes: line.line_notes?.trim() || undefined,
      });
    }

    const results: PhysicalCountLineResult[] = [];
    const applied: typeof prepared = [];

    for (const row of prepared) {
      if (row.delta === 0) {
        results.push({
          product_id: String(row.product_id),
          product_name: row.product_name,
          counted_quantity: row.counted,
          quantity_before: row.current,
          quantity_delta: 0,
          quantity_after: row.current,
          changed: false,
        });
        applied.push(row);
        continue;
      }

      const updated = await Product.findOneAndUpdate(
        { _id: row.product_id, stock_quantity: row.current },
        { $inc: { stock_quantity: row.delta } },
        { session, new: true }
      );
      if (!updated) {
        throw new PhysicalCountError(409, {
          error: 'Stock changed since this count started. Reload current quantity and recount.',
          code: 'STOCK_CONFLICT',
          product_id: String(row.product_id),
          product_name: row.product_name,
          expected_current_quantity: row.current,
        });
      }

      const after = Number(updated.stock_quantity);
      applied.push(row);
      results.push({
        product_id: String(row.product_id),
        product_name: row.product_name,
        counted_quantity: row.counted,
        quantity_before: row.current,
        quantity_delta: row.delta,
        quantity_after: after,
        changed: true,
      });
    }

    const sheet = await createStockSheet(session, {
      kind: 'physical_count',
      notes,
      adminId: opts.adminId,
      lines: applied.map((row, index) => ({
        product_id: row.product_id,
        product_name: row.product_name,
        sku: row.sku,
        quantity_before: results[index].quantity_before,
        quantity_change: results[index].quantity_delta,
        quantity_after: results[index].quantity_after,
        counted_quantity: row.counted,
        notes: row.line_notes,
      })),
    });

    for (const result of results) {
      if (!result.changed) continue;
      const source = applied.find((row) => String(row.product_id) === result.product_id);
      try {
        await createStockMovement({
          session,
          productId: result.product_id,
          movementType: StockMovementType.PHYSICAL_COUNT,
          quantityBefore: result.quantity_before,
          quantityChange: result.quantity_delta,
          quantityAfter: result.quantity_after,
          referenceType: PHYSICAL_COUNT_REFERENCE_TYPE,
          referenceId: sheet._id as mongoose.Types.ObjectId,
          referenceNumber: sheet.number,
          reason,
          notes: source?.line_notes,
          adminId,
        });
      } catch (error) {
        if (error instanceof StockMovementWriteError) {
          throw new PhysicalCountError(error.status, { error: error.message });
        }
        throw error;
      }
    }

    await session.commitTransaction();
    return {
      id: String(sheet._id),
      reference_number: sheet.number,
      barcode: sheet.barcode,
      reason,
      notes: notes || null,
      lines: results,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}
