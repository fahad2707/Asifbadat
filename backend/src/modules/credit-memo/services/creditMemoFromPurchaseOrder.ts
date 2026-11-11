import mongoose from 'mongoose';
import PurchaseOrder from '../../../models/PurchaseOrder';
import CreditMemo from '../models/CreditMemo';
import { CREDIT_MEMO_BALANCE_STATUSES } from './creditMemoBalances';

export class CreditMemoFromPoError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'CreditMemoFromPoError';
    this.status = status;
  }
}

function partyId(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value && '_id' in value) return String((value as { _id: unknown })._id);
  if (typeof value === 'object' && typeof (value as { toString?: () => string }).toString === 'function') {
    const s = (value as { toString: () => string }).toString();
    if (s && s !== '[object Object]') return s;
  }
  return String(value);
}

export function poLineKey(productId: string, unitCost: number): string {
  return `${productId}:${Number(unitCost).toFixed(2)}`;
}

export function receivedQtyByLineKey(
  items: Array<{ product_id?: unknown; quantity_received?: unknown; quantity_ordered?: unknown; unit_cost?: unknown }> | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items || []) {
    if (!item.product_id) continue;
    const received = Number(item.quantity_received);
    const qty = Number.isFinite(received) && received > 0 ? received : 0;
    if (qty <= 0) continue;
    const key = poLineKey(String(item.product_id), Number(item.unit_cost));
    map.set(key, (map.get(key) || 0) + qty);
  }
  return map;
}

export function creditedQtyByLineKey(
  memos: Array<{ items?: Array<{ product_id?: unknown; quantity?: unknown; unit_price?: unknown }> }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const memo of memos || []) {
    for (const item of memo.items || []) {
      if (!item.product_id) continue;
      const productId = partyId(item.product_id);
      const qty = Number(item.quantity);
      const price = Number(item.unit_price);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price)) continue;
      const key = poLineKey(productId, price);
      map.set(key, (map.get(key) || 0) + qty);
    }
  }
  return map;
}

export function shouldVendorCreditInventory(reason: string): boolean {
  return reason === 'RETURN' || reason === 'DAMAGED';
}

export function validateVendorReturnLines(opts: {
  po: { vendor_id?: unknown; items?: Array<{ product_id?: unknown; product_name?: string; quantity_received?: unknown; unit_cost?: unknown }> };
  vendorId: string;
  existingMemos: Array<{ items?: Array<{ product_id?: unknown; quantity?: unknown; unit_price?: unknown }> }>;
  requested: Array<{ product_id: string; quantity: number; unit_price?: number }>;
}) {
  const poVendor = partyId(opts.po.vendor_id);
  if (poVendor && poVendor !== opts.vendorId) {
    throw new CreditMemoFromPoError('That purchase order does not belong to this supplier');
  }
  const received = receivedQtyByLineKey(opts.po.items);
  const credited = creditedQtyByLineKey(opts.existingMemos);
  const catalog = new Map<string, { product_id: string; product_name: string; unit_cost: number }>();
  for (const item of opts.po.items || []) {
    if (!item.product_id) continue;
    const productId = String(item.product_id);
    const unitCost = Number(item.unit_cost);
    const key = poLineKey(productId, unitCost);
    if (!catalog.has(key)) {
      catalog.set(key, { product_id: productId, product_name: item.product_name || '', unit_cost: unitCost });
    }
  }

  const requestedByKey = new Map<string, number>();
  const built: Array<{ product_id: string; product_name: string; quantity: number; unit_price: number; tax_percent: number }> = [];
  for (const req of opts.requested) {
    const qty = Number(req.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new CreditMemoFromPoError('Return quantity must be a positive whole number');
    }
    const productId = String(req.product_id);
    const productKeys = [...catalog.keys()].filter((key) => key.startsWith(`${productId}:`));
    let match = req.unit_price != null ? catalog.get(poLineKey(productId, Number(req.unit_price))) : undefined;
    if (!match && productKeys.length === 1) match = catalog.get(productKeys[0]);
    if (!match) throw new CreditMemoFromPoError('An item is not on that purchase order at that cost');
    const key = poLineKey(match.product_id, match.unit_cost);
    requestedByKey.set(key, (requestedByKey.get(key) || 0) + qty);
    const remaining = Math.max(0, (received.get(key) || 0) - (credited.get(key) || 0));
    if ((requestedByKey.get(key) || 0) > remaining) {
      throw new CreditMemoFromPoError(`Cannot return more than ${remaining} remaining of ${match.product_name || 'that item'}`);
    }
    built.push({
      product_id: match.product_id,
      product_name: match.product_name,
      quantity: qty,
      unit_price: match.unit_cost,
      tax_percent: 0,
    });
  }
  if (!built.length) throw new CreditMemoFromPoError('Select at least one item to return');
  return { items: built };
}

export async function loadVendorPosForCredit(vendorId: string) {
  if (!mongoose.Types.ObjectId.isValid(vendorId)) {
    throw new CreditMemoFromPoError('Invalid supplier', 400);
  }
  const vid = new mongoose.Types.ObjectId(vendorId);
  const pos = await PurchaseOrder.find({
    vendor_id: vid,
    status: { $in: ['partial', 'received'] },
  })
    .sort({ received_at: -1, created_at: -1 })
    .limit(200)
    .lean();

  const poIds = pos.map((p) => p._id);
  const memos = poIds.length
    ? await CreditMemo.find({
        type: 'VENDOR',
        vendor_id: vid,
        reference_purchase_order_id: { $in: poIds },
        status: { $in: ['DRAFT', ...CREDIT_MEMO_BALANCE_STATUSES] },
      }).lean()
    : [];
  const memosByPo = new Map<string, typeof memos>();
  for (const memo of memos) {
    const poId = memo.reference_purchase_order_id ? String(memo.reference_purchase_order_id) : '';
    if (!poId) continue;
    const list = memosByPo.get(poId) || [];
    list.push(memo);
    memosByPo.set(poId, list);
  }

  return pos.map((po) => {
    const related = memosByPo.get(String(po._id)) || [];
    const received = receivedQtyByLineKey(po.items);
    const credited = creditedQtyByLineKey(related);
    const items = [...received.keys()].map((key) => {
      const productId = key.slice(0, key.lastIndexOf(':'));
      const costStr = key.slice(key.lastIndexOf(':') + 1);
      const source = (po.items || []).find(
        (item) => String(item.product_id) === productId && Number(item.unit_cost).toFixed(2) === costStr
      );
      const quantity_received = received.get(key) || 0;
      const quantity_credited = credited.get(key) || 0;
      return {
        product_id: productId,
        product_name: source?.product_name || '',
        quantity_received,
        quantity_credited,
        quantity_remaining: Math.max(0, quantity_received - quantity_credited),
        unit_cost: Number(costStr),
      };
    });
    return {
      id: String(po._id),
      po_number: po.po_number,
      status: po.status,
      created_at: po.created_at,
      received_at: po.received_at,
      total_amount: po.total_amount,
      items,
    };
  });
}

export async function buildValidatedVendorCreditItems(opts: {
  vendorId: string;
  purchaseOrderId: string;
  requested: Array<{ product_id: string; quantity: number; unit_price?: number }>;
  reason: string;
}) {
  if (!mongoose.Types.ObjectId.isValid(opts.purchaseOrderId)) {
    throw new CreditMemoFromPoError('Select a purchase order');
  }
  const po = await PurchaseOrder.findById(opts.purchaseOrderId).lean();
  if (!po) throw new CreditMemoFromPoError('Purchase order not found', 404);
  const existingMemos = await CreditMemo.find({
    type: 'VENDOR',
    vendor_id: opts.vendorId,
    reference_purchase_order_id: po._id,
    status: { $in: ['DRAFT', ...CREDIT_MEMO_BALANCE_STATUSES] },
  }).lean();
  const validated = validateVendorReturnLines({
    po,
    vendorId: opts.vendorId,
    existingMemos,
    requested: opts.requested,
  });
  return {
    items: validated.items,
    affects_inventory: shouldVendorCreditInventory(opts.reason),
    po_number: po.po_number,
  };
}
