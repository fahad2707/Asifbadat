import mongoose from 'mongoose';
import Shipment from '../models/Shipment';
import Product from '../../../models/Product';
import CreditMemo from '../../credit-memo/models/CreditMemo';
import { StockMovementType } from '../../../shared/enums';
import { createStockMovement } from '../../../utils/createStockMovement';

function generateShipmentNumber(type: 'GROUND' | 'GROUND_RG'): string {
  const prefix = type === 'GROUND_RG' ? 'RG' : 'SH';
  return prefix + '-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function isSkippedProductType(productType: unknown): boolean {
  return productType === 'service' || productType === 'non_inventory';
}

type ReturnLine = { product_id?: unknown; quantity?: unknown };

/** Aggregate duplicate product lines for inventory only; does not mutate shipment.items. */
export function aggregateReturnInventoryQuantities(
  items: ReturnLine[] | undefined
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items || []) {
    if (item.product_id == null || item.product_id === '') continue;
    const pid = String(item.product_id);
    if (!mongoose.Types.ObjectId.isValid(pid)) {
      throw Object.assign(new Error('Invalid product on return shipment'), { status: 400 });
    }
    const raw = item.quantity;
    const qty = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      throw Object.assign(new Error('Return quantity must be a positive integer'), { status: 400 });
    }
    totals.set(pid, (totals.get(pid) || 0) + qty);
  }
  return totals;
}

/**
 * GROUND: logistics only. Wholesale invoices already own outbound SALE stock
 * (Phase 2D.2 / 2E). Mark-delivered must not decrement Product.stock_quantity
 * and must not write SHIPMENT_OUT.
 *
 * GROUND_RG inbound inventory is handled by markReturnShipmentReceived.
 */
export async function markShipmentDelivered(
  shipmentId: string,
  proofOfDeliveryUrl?: string,
  _userId?: string
): Promise<{ success: boolean; error?: string }> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const shipment = await Shipment.findById(shipmentId).session(session);
    if (!shipment) {
      await session.abortTransaction();
      return { success: false, error: 'Shipment not found' };
    }
    if (shipment.status === 'DELIVERED') {
      await session.abortTransaction();
      return { success: false, error: 'Already delivered' };
    }
    await Shipment.findByIdAndUpdate(
      shipmentId,
      {
        status: 'DELIVERED',
        delivered_date: new Date(),
        proof_of_delivery_url: proofOfDeliveryUrl,
      },
      { session }
    );
    await session.commitTransaction();
    return { success: true };
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}

/**
 * GROUND_RG: On return received at warehouse → increase stock, optionally auto-create Credit Memo.
 * Phase 2N-A: conditional claim before inventory; canonical createStockMovement; missing Product is fatal.
 */
export async function markReturnShipmentReceived(
  shipmentId: string,
  options: { autoCreateCreditMemo: boolean; customer_id?: string },
  userId?: string
): Promise<{ success: boolean; credit_memo_id?: string; error?: string }> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const shipment = await Shipment.findById(shipmentId).session(session);
    if (!shipment) {
      await session.abortTransaction();
      return { success: false, error: 'Shipment not found' };
    }
    if (shipment.shipment_type !== 'GROUND_RG') {
      await session.abortTransaction();
      return { success: false, error: 'Not a return shipment' };
    }
    if (shipment.status === 'DELIVERED' || shipment.status === 'RETURNED') {
      await session.abortTransaction();
      return { success: false, error: 'Already processed' };
    }

    let qtyByProduct: Map<string, number>;
    try {
      qtyByProduct = aggregateReturnInventoryQuantities(shipment.items as ReturnLine[]);
    } catch (validationErr: any) {
      await session.abortTransaction();
      return {
        success: false,
        error: validationErr?.message || 'Invalid return shipment quantities',
      };
    }

    // Claim BEFORE inventory so concurrent receipts cannot both apply stock.
    const claimed = await Shipment.findOneAndUpdate(
      {
        _id: shipment._id,
        shipment_type: 'GROUND_RG',
        status: { $nin: ['DELIVERED', 'RETURNED'] },
      },
      {
        $set: { status: 'RETURNED', delivered_date: new Date() },
      },
      { session, new: true }
    );
    if (!claimed) {
      await session.abortTransaction();
      return { success: false, error: 'Already processed' };
    }

    const adminId =
      userId && mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId)
        : undefined;

    for (const [productId, qty] of qtyByProduct) {
      const product = await Product.findById(productId).session(session);
      if (!product) {
        throw Object.assign(new Error('Product not found for return receipt'), { status: 400 });
      }
      if (isSkippedProductType((product as any).product_type)) {
        continue;
      }

      const updated = await Product.findOneAndUpdate(
        { _id: productId },
        { $inc: { stock_quantity: qty } },
        { session, new: true }
      );
      if (!updated) {
        throw Object.assign(new Error('Product not found for return receipt'), { status: 400 });
      }

      const after = Number((updated as any).stock_quantity);
      const before = after - qty;
      await createStockMovement({
        session,
        productId,
        movementType: StockMovementType.SHIPMENT_IN,
        quantityBefore: before,
        quantityChange: qty,
        quantityAfter: after,
        referenceType: 'Shipment',
        referenceId: shipment._id as mongoose.Types.ObjectId,
        referenceNumber: shipment.shipment_number,
        reason: `Return shipment ${shipment.shipment_number} received`,
        notes: 'Return shipment received',
        adminId,
      });
    }

    let creditMemoId: string | undefined;
    if (options.autoCreateCreditMemo && options.customer_id && shipment.items?.length) {
      const items = shipment.items.map((i) => {
        const unit_price = 0; // Would come from linked invoice in full impl
        const total = i.quantity * unit_price;
        return {
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price,
          tax_percent: 0,
          tax_amount: 0,
          total,
        };
      });
      const subtotal = items.reduce((s, i) => s + i.total, 0);
      const cm = await CreditMemo.create(
        [
          {
            credit_memo_number: 'CM-RG-' + Date.now(),
            type: 'CUSTOMER',
            reference_shipment_id: shipment._id,
            customer_id: new mongoose.Types.ObjectId(options.customer_id),
            reason: 'RETURN',
            affects_inventory: false, // already increased above
            subtotal,
            tax_amount: 0,
            total_amount: subtotal,
            status: 'DRAFT',
            items,
          },
        ],
        { session }
      );
      creditMemoId = cm[0]._id.toString();
    }

    await session.commitTransaction();
    return { success: true, credit_memo_id: creditMemoId };
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}

export { generateShipmentNumber };
