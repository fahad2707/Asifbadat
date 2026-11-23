import mongoose from 'mongoose';
import PurchaseOrder from '../../../models/PurchaseOrder';
import { getVendorCreditMemoSplits } from '../../credit-memo/services/creditMemoBalances';
import { vendorAccountPosition, type VendorAccountPosition } from './vendorAccountPosition';

export async function loadVendorAccountPosition(
  vendorId: string | mongoose.Types.ObjectId
): Promise<VendorAccountPosition> {
  const id = typeof vendorId === 'string' ? new mongoose.Types.ObjectId(vendorId) : vendorId;
  const [poAgg, splits] = await Promise.all([
    PurchaseOrder.aggregate([
      { $match: { vendor_id: id, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: null,
          totalPurchases: { $sum: '$total_amount' },
          totalPaid: { $sum: { $ifNull: ['$amount_paid', 0] } },
        },
      },
    ]),
    getVendorCreditMemoSplits('VENDOR', [id]),
  ]);
  const split = splits.get(id.toString()) || { open: 0, received: 0 };
  return vendorAccountPosition({
    purchases: poAgg[0]?.totalPurchases ?? 0,
    paid: poAgg[0]?.totalPaid ?? 0,
    credits_open: split.open,
    credits_received: split.received,
  });
}
