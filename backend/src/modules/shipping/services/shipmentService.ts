import mongoose from 'mongoose';
import Shipment from '../models/Shipment';
import Product from '../../../models/Product';
import StockMovement from '../../../models/StockMovement';
import CreditMemo from '../../credit-memo/models/CreditMemo';
import { StockMovementType } from '../../../shared/enums';

function generateShipmentNumber(type: 'GROUND' | 'GROUND_RG'): string {
  const prefix = type === 'GROUND_RG' ? 'RG' : 'SH';
  return prefix + '-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
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
 * GROUND_RG: On delivered (return received at warehouse) → increase stock, optionally auto-create Credit Memo
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

    const adminId = userId ? new mongoose.Types.ObjectId(userId) : undefined;

    for (const item of shipment.items || []) {
      await Product.findByIdAndUpdate(
        item.product_id,
        { $inc: { stock_quantity: item.quantity } },
        { session }
      );
      await StockMovement.create(
        [
          {
            product_id: item.product_id,
            movement_type: StockMovementType.SHIPMENT_IN,
            quantity_change: item.quantity,
            reference_type: 'Shipment',
            reference_id: shipment._id,
            notes: 'Return shipment received',
            admin_id: adminId,
          },
        ],
        { session }
      );
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

    await Shipment.findByIdAndUpdate(
      shipmentId,
      { status: 'RETURNED', delivered_date: new Date() },
      { session }
    );

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
