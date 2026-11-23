import mongoose from 'mongoose';
import CreditMemo from '../models/CreditMemo';

/** Statuses that reduce AR/AP after approval (draft/cancelled do not). */
export const CREDIT_MEMO_BALANCE_STATUSES = ['APPROVED', 'ADJUSTED', 'CLOSED'] as const;

/**
 * Sum approved (and later-stage) credit memo totals by customer or vendor.
 * Used so open balances / paid dues reflect credit memos without relying on
 * the denormalized outstanding_balance field alone.
 */
export type VendorCreditSplit = { open: number; received: number };

export async function getCreditMemoTotalsByParty(
  type: 'CUSTOMER' | 'VENDOR',
  partyIds?: mongoose.Types.ObjectId[]
): Promise<Map<string, number>> {
  const splits = await getVendorCreditMemoSplits(type, partyIds);
  const map = new Map<string, number>();
  for (const [id, split] of splits) {
    map.set(id, split.open + split.received);
  }
  return map;
}

/** Open credits still net against AP / next PO. Received credits were collected in cash. */
export async function getVendorCreditMemoSplits(
  type: 'CUSTOMER' | 'VENDOR' = 'VENDOR',
  partyIds?: mongoose.Types.ObjectId[]
): Promise<Map<string, VendorCreditSplit>> {
  const partyField = type === 'CUSTOMER' ? 'customer_id' : 'vendor_id';
  const match: Record<string, unknown> = {
    type,
    status: { $in: [...CREDIT_MEMO_BALANCE_STATUSES] },
    [partyField]: { $exists: true, $ne: null },
  };
  if (partyIds && partyIds.length > 0) {
    match[partyField] = { $in: partyIds };
  }

  const rows = await CreditMemo.aggregate([
    { $match: match },
    {
      $group: {
        _id: `$${partyField}`,
        open: {
          $sum: {
            $cond: [{ $ifNull: ['$vendor_payment_received_at', false] }, 0, { $ifNull: ['$total_amount', 0] }],
          },
        },
        received: {
          $sum: {
            $cond: [{ $ifNull: ['$vendor_payment_received_at', false] }, { $ifNull: ['$total_amount', 0] }, 0],
          },
        },
      },
    },
  ]);

  const map = new Map<string, VendorCreditSplit>();
  for (const row of rows as Array<{ _id?: { toString(): string }; open?: number; received?: number }>) {
    if (!row._id) continue;
    map.set(row._id.toString(), { open: Number(row.open) || 0, received: Number(row.received) || 0 });
  }
  return map;
}
