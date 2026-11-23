import mongoose from 'mongoose';
import Product from '../../../models/Product';
import PurchaseOrder from '../../../models/PurchaseOrder';
import Vendor from '../../../models/Vendor';

export type PurchaseRateLine = {
  product_id: string;
  vendor_id: string;
  vendor_name: string;
  po_id: string;
  po_number: string;
  unit_cost: number;
  quantity_received: number;
  at: Date;
  method: 'purchase_order';
};

export type DamagedPurchaseFields = {
  purchase_rate: number | null;
  purchase_match: 'rate' | 'none';
  purchase_vendor_id?: mongoose.Types.ObjectId;
  purchase_vendor_name?: string;
  purchase_po_id?: mongoose.Types.ObjectId;
  purchase_po_number?: string;
  purchase_unit_cost?: number;
};

/** Purchase unit cost matches the product cost rate to the cent. */
export function ratesMatch(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.005;
}

/**
 * The supplier is the one who sold this product at the product's cost rate.
 * A cheaper purchase at a different rate is a different lot. When several
 * received purchases share the rate, the most recent one is the source.
 */
export function pickPurchaseSourceByRate(
  lines: PurchaseRateLine[],
  rate: number | null | undefined
): { matched: false; rate: number | null } | { matched: true; rate: number; source: PurchaseRateLine } {
  if (rate == null || !Number.isFinite(Number(rate)) || Number(rate) < 0) {
    return { matched: false, rate: null };
  }
  const wanted = Number(rate);
  const hits = lines.filter((line) => line.quantity_received > 0 && ratesMatch(line.unit_cost, wanted));
  if (!hits.length) return { matched: false, rate: wanted };
  hits.sort((a, b) => b.at.getTime() - a.at.getTime());
  return { matched: true, rate: wanted, source: hits[0] };
}

export function damagedHoldNote(
  quantity: number,
  source: {
    purchase_match?: string;
    purchase_rate?: number | null;
    purchase_vendor_name?: string;
    purchase_po_number?: string;
    purchase_unit_cost?: number | null;
  }
): string {
  const held = `${quantity} damaged, held out of sellable stock`;
  if (source.purchase_match === 'rate' && source.purchase_vendor_name && source.purchase_po_number) {
    const rate = Number(source.purchase_unit_cost);
    const rateText = Number.isFinite(rate) ? `$${rate.toFixed(2)}` : 'the matching rate';
    return `${held}. Bought from ${source.purchase_vendor_name} at ${rateText} on ${source.purchase_po_number}`;
  }
  if (source.purchase_rate == null || !Number.isFinite(Number(source.purchase_rate))) {
    return `${held}. No cost rate is on file, so the supplier was not matched`;
  }
  return `${held}. No received purchase matches the cost rate $${Number(source.purchase_rate).toFixed(2)}`;
}

export async function annotateDamagedPurchaseSources<T extends { product_id: unknown }>(
  items: T[]
): Promise<Array<T & DamagedPurchaseFields>> {
  const ids = [...new Set(items.map((item) => String(item.product_id || '')))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id)
  );
  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  const products = objectIds.length
    ? await Product.find({ _id: { $in: objectIds } }).select('cost_price').lean()
    : [];
  const rates = new Map(
    products.map((product) => [String(product._id), product.cost_price == null ? null : Number(product.cost_price)])
  );

  const pos = objectIds.length
    ? await PurchaseOrder.find({
        status: { $nin: ['draft', 'cancelled'] },
        'items.product_id': { $in: objectIds },
      })
        .select('vendor_id po_number created_at received_at items')
        .lean()
    : [];

  const vendorIds = [
    ...new Set(
      pos
        .map((po) => (po.vendor_id ? String(po.vendor_id) : ''))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];
  const vendors = vendorIds.length
    ? await Vendor.find({ _id: { $in: vendorIds } }).select('name').lean()
    : [];
  const names = new Map(vendors.map((vendor) => [String(vendor._id), vendor.name || 'Supplier']));

  const linesByProduct = new Map<string, PurchaseRateLine[]>();
  for (const po of pos) {
    const vendorId = po.vendor_id ? String(po.vendor_id) : '';
    if (!mongoose.Types.ObjectId.isValid(vendorId)) continue;
    const at = po.received_at ? new Date(po.received_at) : po.created_at ? new Date(po.created_at) : new Date(0);
    for (const line of po.items || []) {
      const productId = line.product_id ? String(line.product_id) : '';
      if (!ids.includes(productId)) continue;
      const bucket = linesByProduct.get(productId) || [];
      bucket.push({
        product_id: productId,
        vendor_id: vendorId,
        vendor_name: names.get(vendorId) || 'Supplier',
        po_id: String(po._id),
        po_number: po.po_number || '',
        unit_cost: Number(line.unit_cost),
        quantity_received: Number(line.quantity_received) || 0,
        at,
        method: 'purchase_order',
      });
      linesByProduct.set(productId, bucket);
    }
  }

  return items.map((item) => {
    const picked = pickPurchaseSourceByRate(linesByProduct.get(String(item.product_id)) || [], rates.get(String(item.product_id)));
    if (!picked.matched) {
      return { ...item, purchase_rate: picked.rate, purchase_match: 'none' as const };
    }
    return {
      ...item,
      purchase_rate: picked.rate,
      purchase_match: 'rate' as const,
      purchase_vendor_id: new mongoose.Types.ObjectId(picked.source.vendor_id),
      purchase_vendor_name: picked.source.vendor_name,
      purchase_po_id: new mongoose.Types.ObjectId(picked.source.po_id),
      purchase_po_number: picked.source.po_number,
      purchase_unit_cost: picked.source.unit_cost,
    };
  });
}
