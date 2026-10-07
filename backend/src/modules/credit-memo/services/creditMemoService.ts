import mongoose from 'mongoose';
import CreditMemo from '../models/CreditMemo';
import Product from '../../../models/Product';
import Vendor from '../../../models/Vendor';
import Customer from '../../../models/Customer';
import LedgerEntry from '../../../models/LedgerEntry';
import { StockMovementType } from '../../../shared/enums';
import { createStockMovement, StockMovementWriteError } from '../../../utils/createStockMovement';

const CREDIT_MEMO_REFERENCE_TYPE = 'CreditMemo';

export class CreditMemoInventoryError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'CreditMemoInventoryError';
    this.status = status;
  }
}

function generateCreditMemoNumber(): string {
  return 'CM-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

/**
 * Post double-entry ledger for Vendor Credit Memo:
 * DR Vendor Account (reduce AP), CR Purchase Return Account
 */
async function postVendorCreditMemoLedger(
  creditMemoId: mongoose.Types.ObjectId,
  vendorId: mongoose.Types.ObjectId,
  totalAmount: number,
  description: string,
  userId?: mongoose.Types.ObjectId,
  session?: mongoose.mongo.ClientSession
): Promise<void> {
  const date = new Date();
  await LedgerEntry.insertMany(
    [
      {
        date,
        account_type: 'VENDOR',
        party_type: 'VENDOR',
        party_id: vendorId,
        debit: totalAmount,
        credit: 0,
        reference_type: 'CREDIT_MEMO',
        reference_id: creditMemoId,
        description: description || 'Vendor credit memo',
        created_by: userId,
      },
      {
        date,
        account_type: 'PURCHASE_RETURN',
        party_type: 'VENDOR',
        party_id: vendorId,
        debit: 0,
        credit: totalAmount,
        reference_type: 'CREDIT_MEMO',
        reference_id: creditMemoId,
        description: description || 'Vendor credit memo',
        created_by: userId,
      },
    ],
    session ? { session } : {}
  );
}

/**
 * Post double-entry ledger for Customer Credit Memo:
 * DR Sales Return Account, CR Customer Account (reduce AR)
 */
async function postCustomerCreditMemoLedger(
  creditMemoId: mongoose.Types.ObjectId,
  customerId: mongoose.Types.ObjectId,
  totalAmount: number,
  description: string,
  userId?: mongoose.Types.ObjectId,
  session?: mongoose.mongo.ClientSession
): Promise<void> {
  const date = new Date();
  await LedgerEntry.insertMany(
    [
      {
        date,
        account_type: 'SALES_RETURN',
        party_type: 'CUSTOMER',
        party_id: customerId,
        debit: totalAmount,
        credit: 0,
        reference_type: 'CREDIT_MEMO',
        reference_id: creditMemoId,
        description: description || 'Customer credit memo',
        created_by: userId,
      },
      {
        date,
        account_type: 'CUSTOMER',
        party_type: 'CUSTOMER',
        party_id: customerId,
        debit: 0,
        credit: totalAmount,
        reference_type: 'CREDIT_MEMO',
        reference_id: creditMemoId,
        description: description || 'Customer credit memo',
        created_by: userId,
      },
    ],
    session ? { session } : {}
  );
}

/**
 * Apply signed inventory for a physical credit memo.
 * Customer: +qty (return in). Vendor: -qty (return to supplier).
 */
async function applyCreditMemoInventory(
  cm: {
    type: 'VENDOR' | 'CUSTOMER';
    credit_memo_number: string;
    items: { product_id: mongoose.Types.ObjectId; quantity: number }[];
  },
  referenceId: mongoose.Types.ObjectId,
  userId?: mongoose.Types.ObjectId,
  session?: mongoose.mongo.ClientSession
): Promise<void> {
  for (const item of cm.items) {
    const qty = Number(item.quantity);
    const delta = cm.type === 'VENDOR' ? -qty : qty;
    const updated = await Product.findOneAndUpdate(
      { _id: item.product_id },
      { $inc: { stock_quantity: delta } },
      { session, new: true }
    );
    if (!updated) {
      throw new CreditMemoInventoryError('Product not found', 404);
    }
    const after = Number(updated.stock_quantity);
    const before = after - delta;
    try {
      await createStockMovement({
        session,
        productId: item.product_id,
        movementType: StockMovementType.CREDIT_MEMO,
        quantityBefore: before,
        quantityChange: delta,
        quantityAfter: after,
        referenceType: CREDIT_MEMO_REFERENCE_TYPE,
        referenceId,
        referenceNumber: cm.credit_memo_number,
        adminId: userId,
      });
    } catch (error) {
      if (error instanceof StockMovementWriteError) {
        throw new CreditMemoInventoryError(error.message, error.status);
      }
      throw error;
    }
  }
}

/**
 * Approve credit memo: post ledger, update AP/AR, optionally apply signed inventory.
 * No hard delete after approval; only cancel (status = CANCELLED) allowed.
 */
export async function approveCreditMemo(
  creditMemoId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const cm = await CreditMemo.findById(creditMemoId).session(session);
    if (!cm) {
      await session.abortTransaction();
      return { success: false, error: 'Credit memo not found' };
    }
    if (cm.status !== 'DRAFT') {
      await session.abortTransaction();
      return { success: false, error: 'Only draft credit memos can be approved' };
    }

    const objId = new mongoose.Types.ObjectId(creditMemoId);
    const adminId = new mongoose.Types.ObjectId(userId);

    if (cm.type === 'VENDOR') {
      if (!cm.vendor_id) {
        await session.abortTransaction();
        return { success: false, error: 'Vendor credit memo must have vendor_id' };
      }
      await postVendorCreditMemoLedger(
        objId,
        cm.vendor_id,
        cm.total_amount,
        `Credit memo ${cm.credit_memo_number}`,
        adminId,
        session
      );
      // Reduce vendor payable (we don't have a Vendor.balance field yet - ledger is source of truth; optional: aggregate from ledger)
      // For now we rely on ledger. If Vendor has balance field we'd decrement it.
    } else {
      if (!cm.customer_id) {
        await session.abortTransaction();
        return { success: false, error: 'Customer credit memo must have customer_id' };
      }
      await postCustomerCreditMemoLedger(
        objId,
        cm.customer_id,
        cm.total_amount,
        `Credit memo ${cm.credit_memo_number}`,
        adminId,
        session
      );
      // Reduce customer outstanding_balance
      await Customer.findByIdAndUpdate(
        cm.customer_id,
        { $inc: { outstanding_balance: -cm.total_amount } },
        { session }
      );
    }

    if (cm.affects_inventory && cm.items && cm.items.length > 0) {
      await applyCreditMemoInventory(
        {
          type: cm.type,
          credit_memo_number: cm.credit_memo_number,
          items: cm.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        },
        objId,
        adminId,
        session
      );
    }

    await CreditMemo.findByIdAndUpdate(
      creditMemoId,
      {
        status: 'APPROVED',
        approved_at: new Date(),
        approved_by: adminId,
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
 * Cancel credit memo. Only DRAFT or APPROVED can be cancelled.
 * If already APPROVED, we would need to reverse ledger/inventory - for simplicity we only allow cancel of DRAFT here.
 * For APPROVED we set status to CANCELLED and could add a reversal logic in a follow-up.
 */
export async function cancelCreditMemo(creditMemoId: string): Promise<{ success: boolean; error?: string }> {
  const cm = await CreditMemo.findById(creditMemoId);
  if (!cm) return { success: false, error: 'Credit memo not found' };
  if (cm.status === 'CLOSED' || cm.status === 'CANCELLED') {
    return { success: false, error: 'Credit memo cannot be cancelled' };
  }
  if (cm.status === 'APPROVED') {
    // Business rule: cannot delete after approval; we only set CANCELLED. Reversal of ledger/stock would be a separate feature.
    await CreditMemo.findByIdAndUpdate(creditMemoId, { status: 'CANCELLED' });
    return { success: true };
  }
  await CreditMemo.findByIdAndUpdate(creditMemoId, { status: 'CANCELLED' });
  return { success: true };
}

export { generateCreditMemoNumber };
