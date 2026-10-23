import mongoose from 'mongoose';
import CreditMemo from '../models/CreditMemo';

/** Statuses that reduce AR/AP after approval (draft/cancelled do not). */
export const CREDIT_MEMO_BALANCE_STATUSES = ['APPROVED', 'ADJUSTED', 'CLOSED'] as const;

/**
 * Sum approved (and later-stage) credit memo totals by customer or vendor.
 * Used so open balances / paid dues reflect credit memos without relying on
 * the denormalized outstanding_balance field alone.
 */
export async function getCreditMemoTotalsByParty(
  type: 'CUSTOMER' | 'VENDOR',
  partyIds?: mongoose.Types.ObjectId[]
): Promise<Map<string, number>> {
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
        total: { $sum: { $ifNull: ['$total_amount', 0] } },
      },
    },
  ]);

  const map = new Map<string, number>();
  for (const row of rows as Array<{ _id?: { toString(): string }; total?: number }>) {
    if (!row._id) continue;
    map.set(row._id.toString(), Number(row.total) || 0);
  }
  return map;
}
