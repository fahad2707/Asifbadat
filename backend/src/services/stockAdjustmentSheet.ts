import mongoose from 'mongoose';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import StockAdjustmentSheet, {
  type IStockAdjustmentSheet,
  type IStockSheetLine,
  type StockSheetKind,
} from '../models/StockAdjustmentSheet';
import { StockMovementType } from '../shared/enums';
import { createStockMovement, StockMovementWriteError } from '../utils/createStockMovement';
import { renderCode128Png } from '../utils/productLabelPdf';
import { formatAdjustmentNumber } from '../utils/physicalCount';

export const STOCK_ADJUSTMENT_REFERENCE_TYPE = 'ADJUSTMENT';

export class StockSheetError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error || 'Stock document failed'));
    this.status = status;
    this.body = body;
    this.name = 'StockSheetError';
  }
}

export type SheetLineDraft = {
  product_id: mongoose.Types.ObjectId;
  product_name: string;
  sku?: string;
  quantity_before: number;
  quantity_change: number;
  quantity_after: number;
  counted_quantity?: number;
  notes?: string;
  cost_before?: number | null;
  cost_after?: number | null;
  price_before?: number | null;
  price_after?: number | null;
};

function adminObjectId(adminId?: string): mongoose.Types.ObjectId | undefined {
  if (adminId && mongoose.Types.ObjectId.isValid(adminId)) return new mongoose.Types.ObjectId(adminId);
  return undefined;
}

function moneyEqual(a: unknown, b: unknown): boolean {
  return Math.round((Number(a) || 0) * 100) === Math.round((Number(b) || 0) * 100);
}

export async function createStockSheet(
  session: mongoose.ClientSession,
  input: {
    kind: StockSheetKind;
    notes?: string;
    adminId?: string;
    lines: SheetLineDraft[];
  }
): Promise<IStockAdjustmentSheet> {
  const last = await StockAdjustmentSheet.findOne({}, { sequence: 1 })
    .sort({ sequence: -1 })
    .session(session);
  const sequence = (Number(last?.sequence) || 0) + 1;
  const number = formatAdjustmentNumber(sequence);
  const [created] = await StockAdjustmentSheet.create(
    [
      {
        kind: input.kind,
        sequence,
        number,
        barcode: number,
        notes: input.notes?.trim() || undefined,
        lines: input.lines,
        admin_id: adminObjectId(input.adminId),
      },
    ],
    { session }
  );
  return created;
}

export function serializeStockSheet(sheet: IStockAdjustmentSheet | Record<string, unknown>, barcodePng?: string) {
  const doc = sheet as IStockAdjustmentSheet;
  const lines = (doc.lines || []) as IStockSheetLine[];
  return {
    id: String(doc._id),
    kind: doc.kind,
    number: doc.number,
    barcode: doc.barcode,
    notes: doc.notes || null,
    created_at: doc.created_at,
    line_count: lines.length,
    lines: lines.map((line) => ({
      product_id: String(line.product_id),
      product_name: line.product_name,
      sku: line.sku || null,
      quantity_before: line.quantity_before,
      quantity_change: line.quantity_change,
      quantity_after: line.quantity_after,
      counted_quantity: line.counted_quantity ?? null,
      notes: line.notes?.trim() || null,
      cost_before: line.cost_before ?? null,
      cost_after: line.cost_after ?? null,
      price_before: line.price_before ?? null,
      price_after: line.price_after ?? null,
    })),
    ...(barcodePng ? { barcode_png: barcodePng } : {}),
  };
}

export async function barcodeDataUrl(barcode: string): Promise<string | null> {
  try {
    const { png } = await renderCode128Png(barcode);
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function listStockSheets(kind: StockSheetKind) {
  const rows = await StockAdjustmentSheet.find({ kind }).sort({ created_at: -1 }).limit(200).lean();
  return rows.map((row) => serializeStockSheet(row as unknown as IStockAdjustmentSheet));
}

export async function getStockSheet(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const sheet = await StockAdjustmentSheet.findById(id);
  if (!sheet) return null;
  const png = await barcodeDataUrl(sheet.barcode);
  return serializeStockSheet(sheet, png || undefined);
}

export async function getStockSheetByBarcode(code: string) {
  const barcode = code.trim();
  if (!barcode) return null;
  const sheet = await StockAdjustmentSheet.findOne({
    $or: [{ barcode }, { number: barcode }, { barcode: barcode.toUpperCase() }, { number: barcode.toUpperCase() }],
  });
  if (!sheet) return null;
  const png = await barcodeDataUrl(sheet.barcode);
  return serializeStockSheet(sheet, png || undefined);
}

export type AdjustmentLineInput = {
  product_id: string;
  quantity_change: number;
  cost_price?: number;
  price?: number;
  line_notes?: string;
};

export async function applyStockAdjustment(opts: {
  lines: AdjustmentLineInput[];
  notes?: string;
  adminId?: string;
}) {
  const notes = opts.notes?.trim() || undefined;
  const seen = new Set<string>();
  const prepared: Array<SheetLineDraft & { hasQty: boolean; priceUpdate: Record<string, number> }> = [];

  for (const line of opts.lines) {
    if (seen.has(line.product_id)) {
      throw new StockSheetError(400, { error: 'Duplicate product in this adjustment' });
    }
    seen.add(line.product_id);
    if (!mongoose.Types.ObjectId.isValid(line.product_id)) {
      throw new StockSheetError(404, { error: 'Product not found' });
    }
    const product = await Product.findById(line.product_id).select('name sku stock_quantity cost_price price');
    if (!product) throw new StockSheetError(404, { error: 'Product not found', product_id: line.product_id });
    const current = Number(product.stock_quantity) || 0;
    const delta = Math.trunc(line.quantity_change);
    const after = current + delta;
    if (after < 0) {
      throw new StockSheetError(400, {
        error: `"${product.name}" would go below zero (${current} ${delta >= 0 ? '+' : ''}${delta}).`,
      });
    }
    const hasCost = line.cost_price !== undefined;
    const hasPrice = line.price !== undefined;
    const nextCost = hasCost ? Number(line.cost_price) : Number(product.cost_price || 0);
    const nextPrice = hasPrice ? Number(line.price) : Number(product.price || 0);
    if (nextCost > 0) {
      const min = Math.round(nextCost * 1.05 * 100) / 100;
      if (nextPrice + 1e-9 < min) {
        throw new StockSheetError(400, {
          error: `"${product.name}" selling price must be at least $${min.toFixed(2)} (5% above cost $${nextCost.toFixed(2)}).`,
        });
      }
    }
    if (delta === 0 && !hasCost && !hasPrice) continue;
    const priceUpdate: Record<string, number> = {};
    if (hasCost) priceUpdate.cost_price = nextCost;
    if (hasPrice) priceUpdate.price = nextPrice;
    prepared.push({
      product_id: product._id as mongoose.Types.ObjectId,
      product_name: product.name,
      sku: product.sku || undefined,
      quantity_before: current,
      quantity_change: delta,
      quantity_after: after,
      notes: line.line_notes?.trim() || undefined,
      cost_before: hasCost ? Number(product.cost_price || 0) : null,
      cost_after: hasCost ? nextCost : null,
      price_before: hasPrice ? Number(product.price || 0) : null,
      price_after: hasPrice ? nextPrice : null,
      hasQty: delta !== 0,
      priceUpdate,
    });
  }

  if (prepared.length === 0) {
    throw new StockSheetError(400, { error: 'Nothing to update' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    for (const row of prepared) {
      const updated = await Product.findOneAndUpdate(
        { _id: row.product_id, stock_quantity: row.quantity_before },
        {
          ...(row.hasQty ? { $inc: { stock_quantity: row.quantity_change } } : {}),
          ...(Object.keys(row.priceUpdate).length ? { $set: row.priceUpdate } : {}),
        },
        { session, new: true }
      );
      if (!updated) {
        throw new StockSheetError(409, {
          error: 'Stock changed since this adjustment started. Reload and try again.',
          code: 'STOCK_CONFLICT',
          product_id: String(row.product_id),
          product_name: row.product_name,
        });
      }
      row.quantity_after = Number(updated.stock_quantity);
    }

    const sheet = await createStockSheet(session, {
      kind: 'adjustment',
      notes,
      adminId: opts.adminId,
      lines: prepared.map(({ hasQty: _hasQty, priceUpdate: _priceUpdate, ...line }) => line),
    });

    for (const row of prepared) {
      if (!row.hasQty) continue;
      await createStockMovement({
        session,
        productId: row.product_id,
        movementType: StockMovementType.ADJUSTMENT,
        quantityBefore: row.quantity_before,
        quantityChange: row.quantity_change,
        quantityAfter: row.quantity_after,
        referenceType: STOCK_ADJUSTMENT_REFERENCE_TYPE,
        referenceId: sheet._id as mongoose.Types.ObjectId,
        referenceNumber: sheet.number,
        reason: 'ADJUSTMENT',
        notes: row.notes,
        adminId: opts.adminId,
      });
    }

    await session.commitTransaction();
    const png = await barcodeDataUrl(sheet.barcode);
    return serializeStockSheet(sheet, png || undefined);
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof StockMovementWriteError) {
      throw new StockSheetError(error.status, { error: error.message });
    }
    throw error;
  } finally {
    session.endSession();
  }
}

export async function deleteStockSheet(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new StockSheetError(404, { error: 'Adjustment not found' });
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sheet = await StockAdjustmentSheet.findById(id).session(session);
    if (!sheet) throw new StockSheetError(404, { error: 'Adjustment not found' });

    for (const line of sheet.lines) {
      const product = await Product.findById(line.product_id).select('name stock_quantity cost_price price').session(session);
      if (!product) {
        throw new StockSheetError(409, {
          error: `Cannot delete ${sheet.number}. ${line.product_name} is no longer in the catalog.`,
        });
      }
      const current = Number(product.stock_quantity) || 0;
      const delta = Number(line.quantity_change) || 0;
      if (delta !== 0 && current - delta < 0) {
        throw new StockSheetError(409, {
          error: `Cannot delete ${sheet.number}. Reversing ${line.product_name} would make stock negative.`,
        });
      }
      if (line.cost_after != null && !moneyEqual(product.cost_price, line.cost_after)) {
        throw new StockSheetError(409, {
          error: `Cannot delete ${sheet.number}. The cost of ${line.product_name} changed after this document.`,
        });
      }
      if (line.price_after != null && !moneyEqual(product.price, line.price_after)) {
        throw new StockSheetError(409, {
          error: `Cannot delete ${sheet.number}. The selling price of ${line.product_name} changed after this document.`,
        });
      }

      const restore: Record<string, number> = {};
      if (line.cost_after != null && line.cost_before != null) restore.cost_price = Number(line.cost_before);
      if (line.price_after != null && line.price_before != null) restore.price = Number(line.price_before);
      if (delta === 0 && Object.keys(restore).length === 0) continue;

      const updated = await Product.findOneAndUpdate(
        { _id: line.product_id, stock_quantity: current },
        {
          ...(delta !== 0 ? { $inc: { stock_quantity: -delta } } : {}),
          ...(Object.keys(restore).length ? { $set: restore } : {}),
        },
        { session, new: true }
      );
      if (!updated) {
        throw new StockSheetError(409, {
          error: `Cannot delete ${sheet.number}. Stock changed while deleting. Try again.`,
          code: 'STOCK_CONFLICT',
        });
      }
    }

    await StockMovement.deleteMany({ reference_id: sheet._id }).session(session);
    await sheet.deleteOne({ session });
    await session.commitTransaction();
    return { deleted: true, number: sheet.number };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}
