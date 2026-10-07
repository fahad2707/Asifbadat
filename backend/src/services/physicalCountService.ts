import mongoose from 'mongoose';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import { StockMovementType } from '../shared/enums';
import {
  PHYSICAL_COUNT_REASON,
  PHYSICAL_COUNT_REFERENCE_TYPE,
  adjustmentNumberDateKey,
  formatAdjustmentNumber,
  physicalCountDelta,
} from '../utils/physicalCount';

export type PhysicalCountLineInput = {
  product_id: string;
  counted_quantity: number;
  expected_current_quantity?: number;
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

async function nextAdjustmentNumber(session: mongoose.ClientSession): Promise<string> {
  const dateKey = adjustmentNumberDateKey();
  const prefix = `ADJ-${dateKey}-`;
  const last = await StockMovement.findOne(
    { reference_number: { $regex: `^${prefix}` } },
    'reference_number',
    { session, sort: { reference_number: -1 } }
  );
  let seq = 1;
  const lastNum = last?.reference_number ? String(last.reference_number) : '';
  if (lastNum.startsWith(prefix)) {
    const parsed = parseInt(lastNum.slice(prefix.length), 10);
    if (Number.isFinite(parsed) && parsed >= 0) seq = parsed + 1;
  }
  return formatAdjustmentNumber(dateKey, seq);
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
      current: number;
      counted: number;
      delta: number;
    }> = [];

    for (const line of opts.lines) {
      if (!mongoose.Types.ObjectId.isValid(line.product_id)) {
        throw new PhysicalCountError(404, { error: 'Product not found' });
      }
      const product = await Product.findById(line.product_id, 'name stock_quantity', { session });
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
        current,
        counted,
        delta: physicalCountDelta(current, counted),
      });
    }

    const anyChange = prepared.some((p) => p.delta !== 0);
    const reference_number = anyChange ? await nextAdjustmentNumber(session) : null;
    const results: PhysicalCountLineResult[] = [];

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
      await StockMovement.create(
        [
          {
            product_id: row.product_id,
            movement_type: StockMovementType.PHYSICAL_COUNT,
            quantity_change: row.delta,
            quantity_before: row.current,
            quantity_after: after,
            reference_type: PHYSICAL_COUNT_REFERENCE_TYPE,
            reference_number: reference_number || undefined,
            reason,
            notes,
            admin_id: adminId,
          },
        ],
        { session }
      );

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

    await session.commitTransaction();
    return {
      reference_number,
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
