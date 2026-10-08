import mongoose from 'mongoose';
import Invoice from '../models/Invoice';
import Product from '../models/Product';
import { createStockMovement, StockMovementWriteError } from '../utils/createStockMovement';
import { DOCUMENT_TYPE_INVOICE, DOCUMENT_TYPE_QUOTATION } from '../utils/documentType';
import { StockMovementType } from '../shared/enums';

const INVOICE_REFERENCE_TYPE = 'Invoice';

export class WholesaleInvoiceInventoryError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'WholesaleInvoiceInventoryError';
    this.status = status;
  }
}

export type InvoiceInventoryLine = {
  product_id?: unknown;
  quantity?: unknown;
};

export function usesMigratedWholesaleInventory(doc: { source?: unknown; invoice_type?: unknown }): boolean {
  return doc.source === 'WHOLESALE' && doc.invoice_type === DOCUMENT_TYPE_INVOICE;
}

function optionalAdminId(adminId?: string): mongoose.Types.ObjectId | undefined {
  if (!adminId || !mongoose.Types.ObjectId.isValid(adminId)) return undefined;
  return new mongoose.Types.ObjectId(adminId);
}

function toObjectId(value: unknown, field: string): mongoose.Types.ObjectId {
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = String(value || '');
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
    throw new WholesaleInvoiceInventoryError(`Invalid ${field}.`, 400);
  }
  return new mongoose.Types.ObjectId(raw);
}

function isSkippedProductType(productType: unknown): boolean {
  return productType === 'service' || productType === 'non_inventory';
}

export function aggregateInvoiceInventoryQuantities(items: InvoiceInventoryLine[] | undefined): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items || []) {
    const pid = item.product_id ? String(item.product_id) : '';
    if (!pid) continue;
    const raw = item.quantity;
    if (raw == null || raw === '') continue;
    const qty = typeof raw === 'number' ? raw : Number(raw);
    if (qty === 0) continue;
    if (!Number.isFinite(qty) || !Number.isInteger(qty)) {
      throw new WholesaleInvoiceInventoryError('Inventory quantity must be a whole number.', 400);
    }
    if (qty < 0) {
      throw new WholesaleInvoiceInventoryError('Inventory quantity cannot be negative.', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(pid)) {
      throw new WholesaleInvoiceInventoryError('Invalid product_id.', 400);
    }
    totals.set(pid, (totals.get(pid) || 0) + qty);
  }
  return totals;
}

export function netStockChangesFromInvoiceItems(
  oldItems: InvoiceInventoryLine[] | undefined,
  newItems: InvoiceInventoryLine[] | undefined
): Map<string, number> {
  const oldQty = aggregateInvoiceInventoryQuantities(oldItems);
  const newQty = aggregateInvoiceInventoryQuantities(newItems);
  const ids = new Set([...oldQty.keys(), ...newQty.keys()]);
  const deltas = new Map<string, number>();
  for (const id of ids) {
    const stockChange = (oldQty.get(id) || 0) - (newQty.get(id) || 0);
    if (stockChange !== 0) deltas.set(id, stockChange);
  }
  return deltas;
}

async function applyStockDeltas(
  deltas: Map<string, number>,
  invoice: { _id: mongoose.Types.ObjectId; invoice_number: string },
  adminId: string | undefined,
  session: mongoose.ClientSession
): Promise<void> {
  const actor = optionalAdminId(adminId);
  for (const [productId, delta] of deltas) {
    if (delta === 0) continue;
    const product = await Product.findById(productId, 'product_type', { session });
    if (!product) {
      throw new WholesaleInvoiceInventoryError('Product not found', 404);
    }
    if (isSkippedProductType((product as { product_type?: unknown }).product_type)) continue;

    const updated = await Product.findOneAndUpdate(
      { _id: toObjectId(productId, 'product_id') },
      { $inc: { stock_quantity: delta } },
      { session, new: true }
    );
    if (!updated) {
      throw new WholesaleInvoiceInventoryError('Product not found', 404);
    }
    const after = Number(updated.stock_quantity);
    const before = after - delta;
    try {
      await createStockMovement({
        session,
        productId,
        movementType: StockMovementType.SALE,
        quantityBefore: before,
        quantityChange: delta,
        quantityAfter: after,
        referenceType: INVOICE_REFERENCE_TYPE,
        referenceId: invoice._id,
        referenceNumber: invoice.invoice_number,
        adminId: actor,
      });
    } catch (error) {
      if (error instanceof StockMovementWriteError) {
        throw new WholesaleInvoiceInventoryError(error.message, error.status);
      }
      throw error;
    }
  }
}

async function withTransaction<T>(work: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

function firstCreated<T>(created: T | T[]): T {
  return Array.isArray(created) ? created[0] : created;
}

export async function createWholesaleInvoiceWithInventory(
  fields: Record<string, unknown>,
  adminId?: string
) {
  const stockDeltas = new Map<string, number>();
  for (const [productId, qty] of aggregateInvoiceInventoryQuantities(fields.items as InvoiceInventoryLine[])) {
    stockDeltas.set(productId, -qty);
  }

  return withTransaction(async (session) => {
    const created = await Invoice.create([fields], { session });
    const invoice = firstCreated(created) as { _id: mongoose.Types.ObjectId; invoice_number: string };
    await applyStockDeltas(stockDeltas, invoice, adminId, session);
    return invoice;
  });
}

export async function applyWholesaleInvoiceEditInventory(opts: {
  invoiceId: mongoose.Types.ObjectId | string;
  expectedVersion: number;
  oldItems: InvoiceInventoryLine[] | undefined;
  newItems: InvoiceInventoryLine[];
  setFields: Record<string, unknown>;
  adminId?: string;
}) {
  const deltas = netStockChangesFromInvoiceItems(opts.oldItems, opts.newItems);
  const invoiceId = toObjectId(opts.invoiceId, 'invoice_id');

  return withTransaction(async (session) => {
    const claimed = await Invoice.findOneAndUpdate(
      { _id: invoiceId, __v: opts.expectedVersion },
      { $set: opts.setFields, $inc: { __v: 1 } },
      { session, new: true, timestamps: true }
    );
    if (!claimed) {
      throw new WholesaleInvoiceInventoryError(
        'Invoice was updated by another request. Reload and try again.',
        409
      );
    }
    await applyStockDeltas(
      deltas,
      { _id: claimed._id as mongoose.Types.ObjectId, invoice_number: claimed.invoice_number },
      opts.adminId,
      session
    );
    return claimed;
  });
}

export async function deleteWholesaleInvoiceWithInventory(opts: {
  invoiceId: mongoose.Types.ObjectId | string;
  expectedVersion: number;
  items: InvoiceInventoryLine[] | undefined;
  adminId?: string;
}) {
  const invoiceId = toObjectId(opts.invoiceId, 'invoice_id');
  const restorations = aggregateInvoiceInventoryQuantities(opts.items);

  return withTransaction(async (session) => {
    const claimed = await Invoice.findOneAndUpdate(
      {
        _id: invoiceId,
        __v: opts.expectedVersion,
        $and: [
          { $or: [{ amount_paid: { $exists: false } }, { amount_paid: { $lte: 0 } }] },
          { $or: [{ payment_status: { $exists: false } }, { payment_status: { $ne: 'paid' } }] },
        ],
      },
      { $inc: { __v: 1 } },
      { session, new: true }
    );
    if (!claimed) {
      throw new WholesaleInvoiceInventoryError(
        'Invoice was updated by another request. Reload and try again.',
        409
      );
    }
    await applyStockDeltas(
      restorations,
      { _id: claimed._id as mongoose.Types.ObjectId, invoice_number: claimed.invoice_number },
      opts.adminId,
      session
    );
    await Invoice.deleteOne({ _id: claimed._id }, { session });
  });
}

function quotationStillConvertibleFilter(quoteId: mongoose.Types.ObjectId) {
  return {
    $and: [
      { _id: quoteId },
      { invoice_type: DOCUMENT_TYPE_QUOTATION },
      { shipping_type: { $ne: 'rejected' } },
      { shipping_type: { $not: /^converted:/ } },
    ],
  };
}

export async function convertQuotationWithInventory(opts: {
  quoteId: mongoose.Types.ObjectId | string;
  invoiceNumber: string;
  invoiceFields: Record<string, unknown>;
  convertedInvoiceNumber?: string;
  adminId?: string;
}) {
  const quoteId = toObjectId(opts.quoteId, 'quotation_id');
  const stockDeltas = new Map<string, number>();
  for (const [productId, qty] of aggregateInvoiceInventoryQuantities(
    opts.invoiceFields.items as InvoiceInventoryLine[]
  )) {
    stockDeltas.set(productId, -qty);
  }

  return withTransaction(async (session) => {
    const claimed = await Invoice.findOneAndUpdate(
      quotationStillConvertibleFilter(quoteId),
      { $set: { shipping_type: `converted:${opts.invoiceNumber}` } },
      { session, new: true }
    );
    if (!claimed) {
      throw new WholesaleInvoiceInventoryError(
        opts.convertedInvoiceNumber
          ? `This quotation was already converted to ${opts.convertedInvoiceNumber}.`
          : 'Only quotations can be converted to invoices.',
        400
      );
    }

    const created = await Invoice.create([opts.invoiceFields], { session });
    const invoice = firstCreated(created) as { _id: mongoose.Types.ObjectId; invoice_number: string };
    await applyStockDeltas(stockDeltas, invoice, opts.adminId, session);
    return invoice;
  });
}
