import mongoose from 'mongoose';
import CreditMemo from '../models/CreditMemo';
import Product from '../../../models/Product';
import Vendor from '../../../models/Vendor';
import Customer from '../../../models/Customer';
import LedgerEntry from '../../../models/LedgerEntry';
import { StockMovementType } from '../../../shared/enums';
import { createStockMovement, StockMovementWriteError } from '../../../utils/createStockMovement';
import { DOC_PREFIX, nextPrefixedNumber } from '../../../utils/documentNumbers';

const CREDIT_MEMO_REFERENCE_TYPE = 'CreditMemo';

export class CreditMemoInventoryError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'CreditMemoInventoryError';
    this.status = status;
  }
}

async function generateCreditMemoNumber(type: 'VENDOR' | 'CUSTOMER' = 'CUSTOMER'): Promise<string> {
  const prefix = type === 'VENDOR' ? DOC_PREFIX.vendorCreditMemo : DOC_PREFIX.customerCreditMemo;
  return nextPrefixedNumber(CreditMemo, 'credit_memo_number', prefix);
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

/** Same skip rule as POS return / GROUND_RG: service and non_inventory are not physical stock. */
function isSkippedProductType(productType: unknown): boolean {
  return productType === 'service' || productType === 'non_inventory';
}

/**
 * Apply signed inventory for a physical credit memo.
 * Customer: +qty (return in). Vendor: -qty (return to supplier).
 * Skips service / non_inventory lines (no $inc, no StockMovement).
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
    const product = session
      ? await Product.findById(item.product_id).session(session)
      : await Product.findById(item.product_id);
    if (!product) {
      throw new CreditMemoInventoryError('Product not found', 404);
    }
    if (isSkippedProductType((product as { product_type?: unknown }).product_type)) {
      continue;
    }

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

function isRgLinkedInventoryConflict(cm: {
  reference_shipment_id?: mongoose.Types.ObjectId | null;
  affects_inventory?: boolean;
}): boolean {
  return Boolean(cm.reference_shipment_id) && cm.affects_inventory === true;
}

const RG_LINKED_INVENTORY_ERROR =
  'Credit memos linked to a return shipment cannot affect inventory; set affects_inventory to false before approving';

/**
 * Approve credit memo: claim DRAFT → APPROVED, post ledger, update AP/AR.
 * Vendor memos also apply inventory here. Customer memos wait for
 * markCreditMemoReceived so stock updates only after goods are received.
 *
 * RG-linked memos (reference_shipment_id set) must never apply inventory —
 * shipment receipt already wrote SHIPMENT_IN. Invalid combo is rejected
 * before claim so status stays DRAFT; post-claim check aborts on race.
 */
export async function approveCreditMemo(
  creditMemoId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!mongoose.Types.ObjectId.isValid(creditMemoId)) {
      await session.abortTransaction();
      return { success: false, error: 'Credit memo not found' };
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      await session.abortTransaction();
      return { success: false, error: 'Invalid admin' };
    }

    const objId = new mongoose.Types.ObjectId(creditMemoId);
    const adminId = new mongoose.Types.ObjectId(userId);
    const approvedAt = new Date();

    // Pre-claim guard: RG-linked + inventory-on must not leave DRAFT.
    const draft = await CreditMemo.findById(objId).session(session);
    if (!draft) {
      await session.abortTransaction();
      return { success: false, error: 'Credit memo not found' };
    }
    if (draft.status !== 'DRAFT') {
      await session.abortTransaction();
      return { success: false, error: 'Only draft credit memos can be approved' };
    }
    if (isRgLinkedInventoryConflict(draft)) {
      await session.abortTransaction();
      return { success: false, error: RG_LINKED_INVENTORY_ERROR };
    }

    // Claim BEFORE inventory/ledger so concurrent approvals cannot both apply.
    const claimed = await CreditMemo.findOneAndUpdate(
      { _id: objId, status: 'DRAFT' },
      {
        $set: {
          status: 'APPROVED',
          approved_at: approvedAt,
          approved_by: adminId,
        },
      },
      { session, new: true }
    );
    if (!claimed) {
      await session.abortTransaction();
      const existing = await CreditMemo.findById(objId);
      if (!existing) return { success: false, error: 'Credit memo not found' };
      if (isRgLinkedInventoryConflict(existing)) {
        return { success: false, error: RG_LINKED_INVENTORY_ERROR };
      }
      return { success: false, error: 'Only draft credit memos can be approved' };
    }

    // Race: draft edited to RG-linked + inventory-on between pre-check and claim.
    if (isRgLinkedInventoryConflict(claimed)) {
      await session.abortTransaction();
      return { success: false, error: RG_LINKED_INVENTORY_ERROR };
    }

    if (claimed.type === 'VENDOR') {
      if (!claimed.vendor_id) {
        await session.abortTransaction();
        return { success: false, error: 'Vendor credit memo must have vendor_id' };
      }
      await postVendorCreditMemoLedger(
        objId,
        claimed.vendor_id,
        claimed.total_amount,
        `Credit memo ${claimed.credit_memo_number}`,
        adminId,
        session
      );
      // Decrease vendor's outstanding balance (Accounts Payable) by the credit memo amount
      await Vendor.findByIdAndUpdate(
        claimed.vendor_id,
        { $inc: { outstanding_balance: -claimed.total_amount } },
        { session }
      );
    } else {
      if (!claimed.customer_id) {
        await session.abortTransaction();
        return { success: false, error: 'Customer credit memo must have customer_id' };
      }
      await postCustomerCreditMemoLedger(
        objId,
        claimed.customer_id,
        claimed.total_amount,
        `Credit memo ${claimed.credit_memo_number}`,
        adminId,
        session
      );
      await Customer.findByIdAndUpdate(
        claimed.customer_id,
        { $inc: { outstanding_balance: -claimed.total_amount } },
        { session }
      );
    }

    // Inventory waits: customer mark-received, vendor mark-dispatched.

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
 * Customer credit memo: APPROVED → ADJUSTED and apply inventory.
 * Only this step puts returned goods back on the shelf.
 */
export async function markCreditMemoReceived(
  creditMemoId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!mongoose.Types.ObjectId.isValid(creditMemoId)) {
      await session.abortTransaction();
      return { success: false, error: 'Credit memo not found' };
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      await session.abortTransaction();
      return { success: false, error: 'Invalid admin' };
    }

    const objId = new mongoose.Types.ObjectId(creditMemoId);
    const adminId = new mongoose.Types.ObjectId(userId);
    const receivedAt = new Date();

    const current = await CreditMemo.findById(objId).session(session);
    if (!current) {
      await session.abortTransaction();
      return { success: false, error: 'Credit memo not found' };
    }
    if (current.type !== 'CUSTOMER') {
      await session.abortTransaction();
      return { success: false, error: 'Only customer credit memos are marked received' };
    }
    if (current.status !== 'APPROVED') {
      await session.abortTransaction();
      return { success: false, error: 'Approve the credit memo before marking it received' };
    }
    if (!current.affects_inventory) {
      await session.abortTransaction();
      return { success: false, error: 'This credit memo does not return inventory' };
    }
    if (isRgLinkedInventoryConflict(current)) {
      await session.abortTransaction();
      return { success: false, error: RG_LINKED_INVENTORY_ERROR };
    }

    const claimed = await CreditMemo.findOneAndUpdate(
      { _id: objId, status: 'APPROVED', type: 'CUSTOMER', affects_inventory: true },
      {
        $set: {
          status: 'ADJUSTED',
          received_at: receivedAt,
          received_by: adminId,
        },
      },
      { session, new: true }
    );
    if (!claimed) {
      await session.abortTransaction();
      return { success: false, error: 'This credit memo was already marked received' };
    }

    if (claimed.items && claimed.items.length > 0) {
      await applyCreditMemoInventory(
        {
          type: claimed.type,
          credit_memo_number: claimed.credit_memo_number,
          items: claimed.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        },
        objId,
        adminId,
        session
      );
    }

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
 * Vendor credit memo: APPROVED → ADJUSTED and apply inventory (stock leaves the warehouse).
 */
export async function markCreditMemoDispatched(
  creditMemoId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!mongoose.Types.ObjectId.isValid(creditMemoId) || !mongoose.Types.ObjectId.isValid(userId)) {
      await session.abortTransaction();
      return { success: false, error: 'Credit memo not found' };
    }
    const objId = new mongoose.Types.ObjectId(creditMemoId);
    const adminId = new mongoose.Types.ObjectId(userId);
    const current = await CreditMemo.findById(objId).session(session);
    if (!current) {
      await session.abortTransaction();
      return { success: false, error: 'Credit memo not found' };
    }
    if (current.type !== 'VENDOR') {
      await session.abortTransaction();
      return { success: false, error: 'Only supplier credit memos are marked dispatched' };
    }
    if (current.status !== 'APPROVED') {
      await session.abortTransaction();
      return { success: false, error: 'Approve the credit memo before marking it dispatched' };
    }
    if (!current.affects_inventory) {
      await session.abortTransaction();
      return { success: false, error: 'This credit memo does not return inventory' };
    }
    if (isRgLinkedInventoryConflict(current)) {
      await session.abortTransaction();
      return { success: false, error: RG_LINKED_INVENTORY_ERROR };
    }
    const claimed = await CreditMemo.findOneAndUpdate(
      { _id: objId, status: 'APPROVED', type: 'VENDOR', affects_inventory: true },
      { $set: { status: 'ADJUSTED', dispatched_at: new Date(), dispatched_by: adminId } },
      { session, new: true }
    );
    if (!claimed) {
      await session.abortTransaction();
      return { success: false, error: 'This credit memo was already dispatched' };
    }
    if (claimed.items && claimed.items.length > 0) {
      await applyCreditMemoInventory(
        {
          type: claimed.type,
          credit_memo_number: claimed.credit_memo_number,
          items: claimed.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        },
        objId,
        adminId,
        session
      );
    }
    await session.commitTransaction();
    return { success: true };
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}

/** Vendor credit memo: ADJUSTED → CLOSED after the vendor has the goods. No further stock change. */
export async function markCreditMemoDeliveredToVendor(
  creditMemoId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  if (!mongoose.Types.ObjectId.isValid(creditMemoId) || !mongoose.Types.ObjectId.isValid(userId)) {
    return { success: false, error: 'Credit memo not found' };
  }
  const updated = await CreditMemo.findOneAndUpdate(
    { _id: creditMemoId, type: 'VENDOR', status: 'ADJUSTED' },
    {
      $set: {
        status: 'CLOSED',
        delivered_at: new Date(),
        delivered_by: new mongoose.Types.ObjectId(userId),
      },
    },
    { new: true }
  );
  if (!updated) {
    const current = await CreditMemo.findById(creditMemoId);
    if (!current) return { success: false, error: 'Credit memo not found' };
    if (current.type !== 'VENDOR') return { success: false, error: 'Only supplier credit memos use this step' };
    if (current.status === 'CLOSED') return { success: false, error: 'Already marked delivered to the supplier' };
    return { success: false, error: 'Mark the return as dispatched before marking it delivered' };
  }
  return { success: true };
}

/**
 * Cancel credit memo.
 * DRAFT → CANCELLED is allowed (no inventory/ledger applied yet).
 * APPROVED → CANCELLED is rejected until a real stock/ledger reversal exists.
 * Uses a conditional DRAFT claim so a concurrent approve cannot be cancelled afterward.
 */
export async function cancelCreditMemo(creditMemoId: string): Promise<{ success: boolean; error?: string }> {
  const cm = await CreditMemo.findById(creditMemoId);
  if (!cm) return { success: false, error: 'Credit memo not found' };
  if (cm.status === 'CLOSED' || cm.status === 'CANCELLED') {
    return { success: false, error: 'Credit memo cannot be cancelled' };
  }
  if (cm.status === 'APPROVED' || cm.status === 'ADJUSTED') {
    return {
      success: false,
      error:
        'Approved credit memos cannot be cancelled because inventory and ledger effects are not reversed',
    };
  }

  if (cm.status === 'DRAFT') {
    const updated = await CreditMemo.findOneAndUpdate(
      { _id: creditMemoId, status: 'DRAFT' },
      { $set: { status: 'CANCELLED' } },
      { new: true }
    );
    if (!updated) {
      const current = await CreditMemo.findById(creditMemoId);
      if (current && String(current.status) === 'APPROVED') {
        return {
          success: false,
          error:
            'Approved credit memos cannot be cancelled because inventory and ledger effects are not reversed',
        };
      }
      return { success: false, error: 'Credit memo cannot be cancelled' };
    }
    return { success: true };
  }

  // Other non-terminal statuses (e.g. ADJUSTED): preserve prior cancel behavior.
  await CreditMemo.findByIdAndUpdate(creditMemoId, { status: 'CANCELLED' });
  return { success: true };
}

export { generateCreditMemoNumber };
