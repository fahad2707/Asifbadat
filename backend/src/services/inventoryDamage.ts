import mongoose from 'mongoose';
import Product from '../models/Product';
import Vendor from '../models/Vendor';
import InventoryDamage from '../models/InventoryDamage';
import PurchaseOrder from '../models/PurchaseOrder';
import CreditMemo from '../modules/credit-memo/models/CreditMemo';
import { createStockMovement, StockMovementWriteError } from '../utils/createStockMovement';
import { StockMovementType } from '../shared/enums';
import { buildValidatedVendorCreditItems, CreditMemoFromPoError } from '../modules/credit-memo/services/creditMemoFromPurchaseOrder';
import { generateCreditMemoNumber } from '../modules/credit-memo/services/creditMemoService';

export class InventoryDamageError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'InventoryDamageError';
    this.status = status;
  }
}

function qty(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export async function markInventoryDamaged(input: {
  productId: string;
  quantity: number;
  vendorId: string;
  poId?: string;
  notes?: string;
  adminId?: string;
}) {
  const quantity = Math.trunc(Number(input.quantity));
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new InventoryDamageError('Enter a whole quantity of 1 or more');
  }
  if (!mongoose.Types.ObjectId.isValid(input.productId)) {
    throw new InventoryDamageError('Product not found', 404);
  }
  if (!mongoose.Types.ObjectId.isValid(input.vendorId)) {
    throw new InventoryDamageError('Choose a supplier');
  }

  const [product, vendor] = await Promise.all([
    Product.findById(input.productId),
    Vendor.findById(input.vendorId).select('name'),
  ]);
  if (!product) throw new InventoryDamageError('Product not found', 404);
  if (!vendor) throw new InventoryDamageError('Supplier not found', 404);

  const sellable = Number(product.stock_quantity) || 0;
  if (quantity > sellable) {
    throw new InventoryDamageError(`Only ${sellable} sellable units are on hand`);
  }

  const poQuery: Record<string, unknown> = {
    vendor_id: vendor._id,
    status: { $in: ['partial', 'received'] },
    'items.product_id': product._id,
  };
  if (input.poId) {
    if (!mongoose.Types.ObjectId.isValid(input.poId)) {
      throw new InventoryDamageError('Purchase order not found', 404);
    }
    poQuery._id = new mongoose.Types.ObjectId(input.poId);
  }
  const po = await PurchaseOrder.findOne(poQuery).sort({ received_at: -1, created_at: -1 });
  if (!po) {
    throw new InventoryDamageError('Receive a purchase of this product from that supplier first');
  }
  const line = (po.items || []).find((item) => String(item.product_id) === String(product._id));
  const unitCost = Number(line?.unit_cost ?? product.cost_price ?? 0) || 0;

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const updated = await Product.findOneAndUpdate(
      { _id: product._id, stock_quantity: { $gte: quantity } },
      { $inc: { stock_quantity: -quantity, damaged_quantity: quantity } },
      { session, new: true }
    );
    if (!updated) {
      throw new InventoryDamageError(`Only ${sellable} sellable units are on hand`);
    }
    const after = Number(updated.stock_quantity);
    await createStockMovement({
      session,
      productId: product._id,
      movementType: StockMovementType.ADJUSTMENT,
      quantityBefore: after + quantity,
      quantityChange: -quantity,
      quantityAfter: after,
      referenceType: 'inventory_damage',
      referenceId: po._id,
      referenceNumber: po.po_number,
      notes: input.notes || `Damaged · ${vendor.name}`,
      adminId: input.adminId && mongoose.Types.ObjectId.isValid(input.adminId) ? input.adminId : undefined,
    });
    const [row] = await InventoryDamage.create(
      [
        {
          product_id: product._id,
          product_name: product.name,
          quantity,
          unit_cost: unitCost,
          vendor_id: vendor._id,
          vendor_name: vendor.name,
          po_id: po._id,
          po_number: po.po_number,
          notes: input.notes,
          created_by: input.adminId && mongoose.Types.ObjectId.isValid(input.adminId) ? input.adminId : undefined,
        },
      ],
      { session }
    );
    await session.commitTransaction();
    return serializeDamage(row);
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof InventoryDamageError) throw error;
    if (error instanceof StockMovementWriteError) {
      throw new InventoryDamageError(error.message, error.status);
    }
    throw error;
  } finally {
    session.endSession();
  }
}

export function serializeDamage(row: {
  _id: { toString: () => string };
  product_id?: { toString: () => string };
  product_name?: string;
  quantity?: number;
  unit_cost?: number;
  vendor_id?: { toString: () => string };
  vendor_name?: string;
  po_id?: { toString: () => string };
  po_number?: string;
  credit_memo_id?: { toString: () => string };
  credit_memo_number?: string;
  notes?: string;
  created_at?: Date;
}) {
  const quantity = qty(row.quantity);
  const unit = qty(row.unit_cost);
  const credited = Boolean(row.credit_memo_id);
  return {
    id: String(row._id),
    source: 'warehouse' as const,
    date: row.created_at ? row.created_at.toISOString() : null,
    product_id: row.product_id ? String(row.product_id) : '',
    product_name: row.product_name || 'Item',
    quantity,
    quantity_still_held: credited ? 0 : quantity,
    quantity_returned_to_supplier: credited ? quantity : 0,
    unit_cost: unit,
    line_total: Math.round(quantity * unit * 100) / 100,
    customer_name: 'Warehouse',
    supplier_name: row.vendor_name || null,
    supplier_id: row.vendor_id ? String(row.vendor_id) : null,
    purchase_match: 'rate' as const,
    purchase_rate: unit,
    po_id: row.po_id ? String(row.po_id) : null,
    po_number: row.po_number || null,
    invoice_number: null,
    credit_memo_id: row.credit_memo_id ? String(row.credit_memo_id) : null,
    credit_memo_number: row.credit_memo_number || null,
    supplier_credit_memo_id: row.credit_memo_id ? String(row.credit_memo_id) : null,
    supplier_credit_memo_number: row.credit_memo_number || null,
    hold: credited ? ('returned' as const) : ('held' as const),
    notes: row.notes || '',
  };
}

export async function createVendorCreditsFromDamages(ids: string[], adminId?: string) {
  const objectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!objectIds.length) throw new InventoryDamageError('Select damaged rows');

  const rows = await InventoryDamage.find({
    _id: { $in: objectIds },
    credit_memo_id: { $in: [null, undefined] },
  });
  if (!rows.length) throw new InventoryDamageError('Those rows already have a supplier credit, or were not found');

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.po_id || !row.vendor_id) {
      throw new InventoryDamageError(`${row.product_name} is missing a supplier purchase`);
    }
    const key = `${String(row.vendor_id)}:${String(row.po_id)}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }

  const created: Array<{ id: string; credit_memo_number: string; vendor_id: string }> = [];
  for (const group of groups.values()) {
    const first = group[0];
    const merged = new Map<string, { product_id: string; quantity: number; unit_price: number; product_name: string }>();
    for (const row of group) {
      const pid = String(row.product_id);
      const cur = merged.get(pid) || {
        product_id: pid,
        quantity: 0,
        unit_price: qty(row.unit_cost),
        product_name: row.product_name,
      };
      cur.quantity += qty(row.quantity);
      merged.set(pid, cur);
    }
    const built = await buildValidatedVendorCreditItems({
      vendorId: String(first.vendor_id),
      purchaseOrderId: String(first.po_id),
      reason: 'DAMAGED',
      requested: [...merged.values()],
    });
    const items = built.items.map((i) => ({
      product_id: new mongoose.Types.ObjectId(String(i.product_id)),
      product_name: i.product_name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      tax_percent: 0,
      tax_amount: 0,
      total: Math.round(i.quantity * i.unit_price * 100) / 100,
      purchase_match: 'rate' as const,
      purchase_rate: i.unit_price,
      purchase_vendor_id: first.vendor_id,
      purchase_vendor_name: first.vendor_name,
      purchase_po_id: first.po_id,
      purchase_po_number: first.po_number,
      purchase_unit_cost: i.unit_price,
    }));
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const cm = await CreditMemo.create({
      credit_memo_number: await generateCreditMemoNumber('VENDOR'),
      type: 'VENDOR',
      reference_purchase_order_id: first.po_id,
      vendor_id: first.vendor_id,
      reason: 'DAMAGED',
      affects_inventory: built.affects_inventory,
      subtotal,
      tax_amount: 0,
      total_amount: subtotal,
      status: 'DRAFT',
      notes: `From warehouse damaged stock`,
      created_by: adminId && mongoose.Types.ObjectId.isValid(adminId) ? adminId : undefined,
      items,
    });
    await InventoryDamage.updateMany(
      { _id: { $in: group.map((r) => r._id) } },
      { $set: { credit_memo_id: cm._id, credit_memo_number: cm.credit_memo_number } }
    );
    created.push({
      id: cm._id.toString(),
      credit_memo_number: cm.credit_memo_number,
      vendor_id: String(first.vendor_id),
    });
  }
  return created;
}

export { CreditMemoFromPoError };
