import mongoose from 'mongoose';
import PurchaseOrder from '../../../models/PurchaseOrder';
import Vendor from '../../../models/Vendor';

export type PoRateLine = {
  product_id: string;
  product_name?: string;
  vendor_id: string;
  unit_cost: number;
  po_number?: string;
  at: Date;
};

export type BestSupplierRate = {
  product_id: string;
  product_name: string;
  vendor_id: string;
  vendor_name: string;
  unit_cost: number;
  po_number: string;
};

/** Lowest unit cost wins; if tied, the more recent PO wins. */
export function pickBestSupplierRates(lines: PoRateLine[]): Map<string, PoRateLine> {
  const best = new Map<string, PoRateLine>();
  for (const line of lines) {
    if (!line.product_id || !line.vendor_id) continue;
    const cost = Number(line.unit_cost);
    if (!Number.isFinite(cost) || cost < 0) continue;
    const current = best.get(line.product_id);
    if (!current) {
      best.set(line.product_id, line);
      continue;
    }
    if (cost < current.unit_cost) {
      best.set(line.product_id, line);
      continue;
    }
    if (cost === current.unit_cost && line.at.getTime() > current.at.getTime()) {
      best.set(line.product_id, line);
    }
  }
  return best;
}

export async function loadBestSupplierRates(opts?: {
  vendorId?: string;
}): Promise<BestSupplierRate[]> {
  const match: Record<string, unknown> = { status: { $in: ['sent', 'partial', 'received'] } };
  const pos = await PurchaseOrder.find(match)
    .select('vendor_id po_number created_at items')
    .lean();

  const lines: PoRateLine[] = [];
  for (const po of pos as Array<{
    vendor_id?: unknown;
    po_number?: string;
    created_at?: Date;
    items?: Array<{ product_id?: unknown; product_name?: string; unit_cost?: number }>;
  }>) {
    const vendorId = po.vendor_id ? String(po.vendor_id) : '';
    if (!vendorId) continue;
    for (const item of po.items || []) {
      if (!item.product_id) continue;
      lines.push({
        product_id: String(item.product_id),
        product_name: item.product_name || '',
        vendor_id: vendorId,
        unit_cost: Number(item.unit_cost) || 0,
        po_number: po.po_number || '',
        at: po.created_at ? new Date(po.created_at) : new Date(0),
      });
    }
  }

  const winners = [...pickBestSupplierRates(lines).values()];
  const scoped = opts?.vendorId ? winners.filter((w) => w.vendor_id === opts.vendorId) : winners;
  const vendorIds = [...new Set(scoped.map((w) => w.vendor_id))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id)
  );
  const vendors = vendorIds.length
    ? await Vendor.find({ _id: { $in: vendorIds } }).select('name').lean()
    : [];
  const names = new Map(vendors.map((v) => [String(v._id), v.name || 'Supplier']));

  return scoped.map((w) => ({
    product_id: w.product_id,
    product_name: w.product_name || '',
    vendor_id: w.vendor_id,
    vendor_name: names.get(w.vendor_id) || 'Supplier',
    unit_cost: w.unit_cost,
    po_number: w.po_number || '',
  }));
}
