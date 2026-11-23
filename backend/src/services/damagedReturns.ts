import CreditMemo from '../modules/credit-memo/models/CreditMemo';

export type DamagedHold = 'waiting' | 'held' | 'returned';

export type DamagedCustomerLine = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  purchase_match?: string | null;
  purchase_rate?: number | null;
  purchase_vendor_id?: string | null;
  purchase_vendor_name?: string | null;
  purchase_po_id?: string | null;
  purchase_po_number?: string | null;
  purchase_unit_cost?: number | null;
};

export type DamagedCustomerMemo = {
  credit_memo_id: string;
  credit_memo_number: string;
  status: string;
  received_at?: Date | null;
  created_at: Date;
  customer_name: string;
  invoice_number: string | null;
  items: DamagedCustomerLine[];
};

export type DamagedSupplierMemo = {
  credit_memo_id: string;
  credit_memo_number: string;
  po_id: string | null;
  dispatched_at?: Date | null;
  items: Array<{ product_id: string; quantity: number }>;
};

export type DamagedReturnRow = {
  id: string;
  date: string | null;
  product_id: string;
  product_name: string;
  quantity: number;
  quantity_still_held: number;
  quantity_returned_to_supplier: number;
  customer_name: string;
  supplier_name: string | null;
  supplier_id: string | null;
  purchase_match: 'rate' | 'none' | null;
  purchase_rate: number | null;
  po_id: string | null;
  po_number: string | null;
  invoice_number: string | null;
  credit_memo_id: string;
  credit_memo_number: string;
  supplier_credit_memo_id: string | null;
  supplier_credit_memo_number: string | null;
  hold: DamagedHold;
};

type SupplierChunk = {
  quantity: number;
  credit_memo_id: string;
  credit_memo_number: string;
};

function poolKey(productId: string, poId: string | null): string | null {
  if (!productId || !poId) return null;
  return `${productId}:${poId}`;
}

function received(status: string): boolean {
  return status === 'ADJUSTED' || status === 'CLOSED';
}

/**
 * Customer damaged lines that are in stock are matched to later supplier
 * credits for the same product and the same purchase order, oldest first.
 * A supplier credit for a different purchase does not clear this row.
 */
export function buildDamagedReturnRows(
  customers: DamagedCustomerMemo[],
  suppliers: DamagedSupplierMemo[]
): DamagedReturnRow[] {
  const pools = new Map<string, SupplierChunk[]>();
  const supplierMemos = [...suppliers].sort(
    (a, b) => (a.dispatched_at?.getTime() || 0) - (b.dispatched_at?.getTime() || 0)
  );
  for (const memo of supplierMemos) {
    for (const item of memo.items) {
      const key = poolKey(item.product_id, memo.po_id);
      if (!key) continue;
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) continue;
      const bucket = pools.get(key) || [];
      bucket.push({
        quantity: qty,
        credit_memo_id: memo.credit_memo_id,
        credit_memo_number: memo.credit_memo_number,
      });
      pools.set(key, bucket);
    }
  }

  const rows: DamagedReturnRow[] = [];
  const ordered = [...customers].sort((a, b) => {
    const aAt = a.received_at?.getTime() || a.created_at.getTime();
    const bAt = b.received_at?.getTime() || b.created_at.getTime();
    return aAt - bAt;
  });

  for (const memo of ordered) {
    const inStock = received(memo.status);
    for (const item of memo.items) {
      const quantity = Number(item.quantity) || 0;
      let returned = 0;
      const supplierMemosUsed: string[] = [];
      let supplierMemoId: string | null = null;
      const key = poolKey(item.product_id, item.purchase_po_id || null);
      if (inStock && key && pools.has(key)) {
        const bucket = pools.get(key) || [];
        let need = quantity;
        while (need > 0 && bucket.length && bucket[0].quantity > 0) {
          const take = Math.min(need, bucket[0].quantity);
          bucket[0].quantity -= take;
          need -= take;
          returned += take;
          supplierMemoId = bucket[0].credit_memo_id;
          if (!supplierMemosUsed.includes(bucket[0].credit_memo_number)) {
            supplierMemosUsed.push(bucket[0].credit_memo_number);
          }
          if (bucket[0].quantity <= 0) bucket.shift();
        }
      }
      const stillHeld = inStock ? Math.max(0, quantity - returned) : 0;
      const hold: DamagedHold = !inStock ? 'waiting' : stillHeld > 0 ? 'held' : 'returned';
      const when = inStock ? memo.received_at || memo.created_at : memo.created_at;
      rows.push({
        id: `${memo.credit_memo_id}:${item.id}`,
        date: when ? when.toISOString() : null,
        product_id: item.product_id,
        product_name: item.product_name || 'Item',
        quantity,
        quantity_still_held: stillHeld,
        quantity_returned_to_supplier: inStock ? returned : 0,
        customer_name: memo.customer_name || 'Customer',
        supplier_name: item.purchase_match === 'rate' ? item.purchase_vendor_name || null : null,
        supplier_id: item.purchase_match === 'rate' ? item.purchase_vendor_id || null : null,
        purchase_match: item.purchase_match === 'rate' || item.purchase_match === 'none' ? item.purchase_match : null,
        purchase_rate: item.purchase_rate == null || !Number.isFinite(Number(item.purchase_rate)) ? null : Number(item.purchase_rate),
        po_id: item.purchase_po_id || null,
        po_number: item.purchase_match === 'rate' ? item.purchase_po_number || null : null,
        invoice_number: memo.invoice_number,
        credit_memo_id: memo.credit_memo_id,
        credit_memo_number: memo.credit_memo_number,
        supplier_credit_memo_id: returned > 0 ? supplierMemoId : null,
        supplier_credit_memo_number: supplierMemosUsed.length ? supplierMemosUsed.join(', ') : null,
        hold,
      });
    }
  }

  rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return rows;
}

/** Rows dated in the statement window, plus damaged stock still held by the period end. */
export function damagedRowsForStatement(
  rows: DamagedReturnRow[],
  periodStart: Date,
  periodEnd: Date
): DamagedReturnRow[] {
  const start = periodStart.getTime();
  const end = periodEnd.getTime();
  return rows.filter((row) => {
    const time = row.date ? new Date(row.date).getTime() : Number.NaN;
    const inPeriod = Number.isFinite(time) && time >= start && time <= end;
    const stillHeldByEnd = row.hold === 'held' && (!Number.isFinite(time) || time <= end);
    return inPeriod || stillHeldByEnd;
  });
}

export async function loadDamagedReturnRows(): Promise<DamagedReturnRow[]> {
  const [customerMemos, supplierMemos] = await Promise.all([
    CreditMemo.find({
      type: 'CUSTOMER',
      reason: 'DAMAGED',
      affects_inventory: true,
      status: { $in: ['APPROVED', 'ADJUSTED', 'CLOSED'] },
    })
      .populate('customer_id', 'name company')
      .populate('reference_invoice_id', 'invoice_number')
      .sort({ received_at: -1, created_at: -1 })
      .lean(),
    CreditMemo.find({
      type: 'VENDOR',
      reason: 'DAMAGED',
      affects_inventory: true,
      status: { $in: ['ADJUSTED', 'CLOSED'] },
    })
      .select('credit_memo_number reference_purchase_order_id dispatched_at items')
      .lean(),
  ]);

  return buildDamagedReturnRows(
    customerMemos.map((memo) => {
      const customer = memo.customer_id as { name?: string; company?: string } | null;
      const invoice = memo.reference_invoice_id as { invoice_number?: string } | null;
      const name = [customer?.name, customer?.company].filter(Boolean).join(' · ');
      return {
        credit_memo_id: String(memo._id),
        credit_memo_number: memo.credit_memo_number,
        status: memo.status,
        received_at: memo.received_at || null,
        created_at: memo.created_at,
        customer_name: name || 'Customer',
        invoice_number: invoice?.invoice_number || null,
        items: (memo.items || []).map((item) => ({
          id: String(item._id),
          product_id: String(item.product_id),
          product_name: item.product_name || 'Item',
          quantity: Number(item.quantity) || 0,
          purchase_match: item.purchase_match || null,
          purchase_rate: item.purchase_rate ?? null,
          purchase_vendor_id: item.purchase_vendor_id ? String(item.purchase_vendor_id) : null,
          purchase_vendor_name: item.purchase_vendor_name || null,
          purchase_po_id: item.purchase_po_id ? String(item.purchase_po_id) : null,
          purchase_po_number: item.purchase_po_number || null,
          purchase_unit_cost: item.purchase_unit_cost ?? null,
        })),
      };
    }),
    supplierMemos.map((memo) => ({
      credit_memo_id: String(memo._id),
      credit_memo_number: memo.credit_memo_number,
      po_id: memo.reference_purchase_order_id ? String(memo.reference_purchase_order_id) : null,
      dispatched_at: memo.dispatched_at || null,
      items: (memo.items || []).map((item) => ({
        product_id: String(item.product_id),
        quantity: Number(item.quantity) || 0,
      })),
    }))
  );
}
