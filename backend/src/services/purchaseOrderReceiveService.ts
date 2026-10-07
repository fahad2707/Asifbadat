import mongoose from 'mongoose';
import PurchaseOrder from '../models/PurchaseOrder';
import Product from '../models/Product';
import { createStockMovement, StockMovementWriteError } from '../utils/createStockMovement';
import { postVendorLedger } from '../modules/vendors/services/vendorLedgerService';
import { LedgerReferenceType, StockMovementType } from '../shared/enums';

const PURCHASE_ORDER_REFERENCE_TYPE = 'purchase_order';
const MAX_RECEIVE_ATTEMPTS = 3;

export type PurchaseOrderReceiveItemInput = {
  product_id: string;
  quantity_received: number;
};

export class PurchaseOrderReceiveError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error || 'Failed to receive PO'));
    this.status = status;
    this.body = body;
    this.name = 'PurchaseOrderReceiveError';
  }
}

type ClaimedLine = {
  productId: mongoose.Types.ObjectId;
  lineId: mongoose.Types.ObjectId;
  quantityOrdered: number;
  quantity: number;
};

function poLineProductId(item: { product_id?: unknown }): string {
  const p = item?.product_id as { _id?: unknown; id?: unknown } | string | undefined;
  if (!p) return '';
  if (typeof p === 'string') return p;
  if (p._id) return String(p._id);
  if (p.id) return String(p.id);
  return String(p);
}

function lineIdOf(item: { _id?: unknown }): mongoose.Types.ObjectId | null {
  const raw = item?._id;
  if (!raw) return null;
  if (raw instanceof mongoose.Types.ObjectId) return raw;
  const asString = String(raw);
  if (!mongoose.Types.ObjectId.isValid(asString)) return null;
  return new mongoose.Types.ObjectId(asString);
}

function remainingOf(item: { quantity_ordered?: unknown; quantity_received?: unknown }): number {
  return Number(item.quantity_ordered || 0) - Number(item.quantity_received || 0);
}

function toObjectId(value: unknown, field: string): mongoose.Types.ObjectId {
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = String(value || '');
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
    throw new PurchaseOrderReceiveError(400, { error: `Invalid ${field}.` });
  }
  return new mongoose.Types.ObjectId(raw);
}

function optionalAdminId(adminId?: string): mongoose.Types.ObjectId | undefined {
  if (!adminId || !mongoose.Types.ObjectId.isValid(adminId)) return undefined;
  return new mongoose.Types.ObjectId(adminId);
}

function isTransientTxnError(error: unknown): boolean {
  const err = error as { errorLabels?: string[]; code?: number; hasErrorLabel?: (label: string) => boolean };
  if (typeof err?.hasErrorLabel === 'function' && err.hasErrorLabel('TransientTransactionError')) return true;
  if (Array.isArray(err?.errorLabels) && err.errorLabels.includes('TransientTransactionError')) return true;
  return err?.code === 112;
}

function sumRequestedQuantities(items: PurchaseOrderReceiveItemInput[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const productId = String(item.product_id || '').trim();
    const qty = item.quantity_received;
    if (typeof qty !== 'number' || !Number.isFinite(qty) || !Number.isInteger(qty)) {
      throw new PurchaseOrderReceiveError(400, { error: 'quantity_received must be a whole number' });
    }
    if (qty < 0) {
      throw new PurchaseOrderReceiveError(400, { error: 'quantity_received cannot be negative' });
    }
    if (!productId) {
      if (qty > 0) throw new PurchaseOrderReceiveError(400, { error: 'product_id is required' });
      continue;
    }
    if (qty === 0) continue;
    totals.set(productId, (totals.get(productId) || 0) + qty);
  }
  return totals;
}

function prepareClaims(
  po: { items?: Array<{ _id?: unknown; product_id?: unknown; quantity_ordered?: unknown; quantity_received?: unknown }> },
  requested: Map<string, number>
): ClaimedLine[] {
  const claims: ClaimedLine[] = [];
  for (const [productId, quantity] of requested) {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new PurchaseOrderReceiveError(400, {
        error: 'Product is not on this purchase order',
        product_id: productId,
      });
    }
    const line = (po.items || []).find((item) => poLineProductId(item) === productId);
    if (!line) {
      throw new PurchaseOrderReceiveError(400, {
        error: 'Product is not on this purchase order',
        product_id: productId,
      });
    }
    const remaining = remainingOf(line);
    if (quantity > remaining) {
      throw new PurchaseOrderReceiveError(400, {
        error: 'Cannot receive more than the remaining ordered quantity',
        product_id: productId,
        requested: quantity,
        remaining,
      });
    }
    const lineId = lineIdOf(line);
    if (!lineId) {
      throw new PurchaseOrderReceiveError(400, { error: 'Purchase order line is missing an id' });
    }
    claims.push({
      productId: new mongoose.Types.ObjectId(productId),
      lineId,
      quantityOrdered: Number(line.quantity_ordered || 0),
      quantity,
    });
  }
  return claims;
}

function claimFilter(poId: mongoose.Types.ObjectId, claims: ClaimedLine[]) {
  return {
    _id: poId,
    status: { $ne: 'cancelled' },
    $and: claims.map((claim) => ({
      items: {
        $elemMatch: {
          _id: claim.lineId,
          quantity_received: { $lte: claim.quantityOrdered - claim.quantity },
        },
      },
    })),
  };
}

function claimUpdate(claims: ClaimedLine[]) {
  const $inc: Record<string, number> = {};
  claims.forEach((claim, index) => {
    $inc[`items.$[l${index}].quantity_received`] = claim.quantity;
  });
  return { $inc };
}

function claimArrayFilters(claims: ClaimedLine[]) {
  return claims.map((claim, index) => ({
    [`l${index}._id`]: claim.lineId,
    [`l${index}.quantity_received`]: { $lte: claim.quantityOrdered - claim.quantity },
  }));
}

function isFullyReceived(items: Array<{ quantity_ordered?: unknown; quantity_received?: unknown }>): boolean {
  return items.every((item) => Number(item.quantity_received || 0) >= Number(item.quantity_ordered || 0));
}

async function receivePurchaseOrderAttempt(opts: {
  poId: string;
  items: PurchaseOrderReceiveItemInput[];
  adminId?: string;
}): Promise<{ id: string; status: string; items: unknown }> {
  const requested = sumRequestedQuantities(opts.items);
  if (requested.size === 0) {
    throw new PurchaseOrderReceiveError(400, { error: 'nothing to receive' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const po = await PurchaseOrder.findById(opts.poId, null, { session });
    if (!po) {
      throw new PurchaseOrderReceiveError(404, { error: 'Purchase order not found' });
    }
    if (po.status === 'cancelled') {
      throw new PurchaseOrderReceiveError(400, { error: 'PO is cancelled' });
    }

    const claims = prepareClaims(po, requested);
    const previousStatus = String(po.status || '');
    const claimed = await PurchaseOrder.findOneAndUpdate(
      claimFilter(po._id as mongoose.Types.ObjectId, claims),
      claimUpdate(claims),
      { session, new: true, arrayFilters: claimArrayFilters(claims) }
    );
    if (!claimed) {
      throw new PurchaseOrderReceiveError(409, {
        error: 'Requested quantity is no longer available to receive. Reload the purchase order and try again.',
        code: 'RECEIVE_CONFLICT',
      });
    }

    const adminId = optionalAdminId(opts.adminId);
    for (const claim of claims) {
      const updated = await Product.findOneAndUpdate(
        { _id: claim.productId },
        { $inc: { stock_quantity: claim.quantity } },
        { session, new: true }
      );
      if (!updated) {
        throw new PurchaseOrderReceiveError(404, {
          error: 'Product not found',
          product_id: String(claim.productId),
        });
      }
      const after = Number(updated.stock_quantity);
      const before = after - claim.quantity;
      try {
        await createStockMovement({
          session,
          productId: claim.productId,
          movementType: StockMovementType.PURCHASE,
          quantityBefore: before,
          quantityChange: claim.quantity,
          quantityAfter: after,
          referenceType: PURCHASE_ORDER_REFERENCE_TYPE,
          referenceId: claimed._id as mongoose.Types.ObjectId,
          referenceNumber: claimed.po_number,
          adminId,
        });
      } catch (error) {
        if (error instanceof StockMovementWriteError) {
          throw new PurchaseOrderReceiveError(error.status, { error: error.message });
        }
        throw error;
      }
    }

    const nextStatus = isFullyReceived(claimed.items || []) ? 'received' : 'partial';
    const statusUpdate: Record<string, unknown> = { status: nextStatus };
    const transitionedToReceived = previousStatus !== 'received' && nextStatus === 'received';
    if (transitionedToReceived) {
      statusUpdate.received_at = new Date();
    }

    const saved = await PurchaseOrder.findOneAndUpdate(
      { _id: claimed._id },
      { $set: statusUpdate },
      { session, new: true }
    );
    if (!saved) {
      throw new PurchaseOrderReceiveError(500, { error: 'Failed to update purchase order status' });
    }

    if (transitionedToReceived && Number(saved.total_amount) > 0) {
      await postVendorLedger(
        toObjectId(saved.vendor_id, 'vendor_id'),
        [
          {
            account_type: 'VENDOR',
            debit: saved.total_amount,
            credit: 0,
            reference_type: LedgerReferenceType.PURCHASE_ORDER,
            reference_id: saved._id as mongoose.Types.ObjectId,
            description: `PO ${saved.po_number} received`,
          },
          {
            account_type: 'PURCHASE',
            debit: 0,
            credit: saved.total_amount,
            reference_type: LedgerReferenceType.PURCHASE_ORDER,
            reference_id: saved._id as mongoose.Types.ObjectId,
            description: `PO ${saved.po_number}`,
          },
        ],
        adminId,
        session
      );
    }

    await session.commitTransaction();
    return {
      id: String(saved._id),
      status: saved.status,
      items: saved.items,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

export async function receivePurchaseOrder(opts: {
  poId: string;
  items: PurchaseOrderReceiveItemInput[];
  adminId?: string;
}): Promise<{ id: string; status: string; items: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RECEIVE_ATTEMPTS; attempt++) {
    try {
      return await receivePurchaseOrderAttempt(opts);
    } catch (error) {
      lastError = error;
      if (error instanceof PurchaseOrderReceiveError) throw error;
      if (attempt < MAX_RECEIVE_ATTEMPTS && isTransientTxnError(error)) continue;
      throw error;
    }
  }
  throw lastError;
}
