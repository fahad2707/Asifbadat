import mongoose from 'mongoose';
import Invoice from '../../../models/Invoice';
import CreditMemo from '../models/CreditMemo';
import { DOCUMENT_TYPE_INVOICE } from '../../../utils/documentType';
import { CREDIT_MEMO_BALANCE_STATUSES } from './creditMemoBalances';

export class CreditMemoFromInvoiceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'CreditMemoFromInvoiceError';
    this.status = status;
  }
}

export type InvoiceSaleLine = {
  product_id?: unknown;
  product_name?: string;
  quantity?: unknown;
  price?: unknown;
  tax_rate?: unknown;
  tax_rate_type?: unknown;
  tax_amount?: unknown;
};

export type CreditAgainstInvoiceLine = {
  product_id?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
};

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

export function invoiceLineKey(productId: string, unitPrice: number): string {
  return `${productId}:${Number(unitPrice).toFixed(2)}`;
}

export function taxPercentFromInvoiceLine(item: InvoiceSaleLine): number {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.price) || 0;
  const base = qty * price;
  if (item.tax_rate_type === 'percent' && item.tax_rate != null && Number.isFinite(Number(item.tax_rate))) {
    return Math.max(0, Number(item.tax_rate));
  }
  if (base > 0 && item.tax_amount != null && Number.isFinite(Number(item.tax_amount))) {
    return Math.max(0, (Number(item.tax_amount) / base) * 100);
  }
  return 0;
}

export function soldQtyByLineKey(items: InvoiceSaleLine[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items || []) {
    if (item.product_id == null || item.product_id === '') continue;
    const productId = String(item.product_id);
    const price = Number(item.price);
    const qty = Number(item.quantity);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) continue;
    const key = invoiceLineKey(productId, price);
    map.set(key, (map.get(key) || 0) + qty);
  }
  return map;
}

export function creditedQtyByLineKey(memos: Array<{ items?: CreditAgainstInvoiceLine[] }> | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const memo of memos || []) {
    for (const item of memo.items || []) {
      if (item.product_id == null || item.product_id === '') continue;
      const productId = String(typeof item.product_id === 'object' && item.product_id && '_id' in (item.product_id as object)
        ? (item.product_id as { _id: unknown })._id
        : item.product_id);
      const qty = Number(item.quantity);
      const price = Number(item.unit_price);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price)) continue;
      const key = invoiceLineKey(productId, price);
      map.set(key, (map.get(key) || 0) + qty);
    }
  }
  return map;
}

export function remainingReturnQty(sold: number, credited: number): number {
  return Math.max(0, sold - credited);
}

export function invoiceTookStock(invoice: { inventory_applied?: unknown }): boolean {
  return invoice.inventory_applied !== false;
}

export function shouldCreditInventory(opts: {
  reason: string;
  invoice: { inventory_applied?: unknown };
}): boolean {
  if (!invoiceTookStock(opts.invoice)) return false;
  return opts.reason === 'RETURN' || opts.reason === 'DAMAGED';
}

export function validateCustomerReturnLines(opts: {
  invoice: { customer_id?: unknown; invoice_type?: unknown; items?: InvoiceSaleLine[] };
  customerId: string;
  existingMemos: Array<{ items?: CreditAgainstInvoiceLine[] }>;
  requested: Array<{ product_id: string; quantity: number; unit_price?: number }>;
}): {
  items: Array<{ product_id: string; product_name: string; quantity: number; unit_price: number; tax_percent: number }>;
} {
  if (opts.invoice.invoice_type && opts.invoice.invoice_type !== DOCUMENT_TYPE_INVOICE) {
    throw new CreditMemoFromInvoiceError('Only invoices can be credited this way');
  }
  const invoiceCustomer = partyId(opts.invoice.customer_id);
  if (invoiceCustomer && invoiceCustomer !== opts.customerId) {
    throw new CreditMemoFromInvoiceError('That invoice does not belong to this customer');
  }

  const sold = soldQtyByLineKey(opts.invoice.items);
  const credited = creditedQtyByLineKey(opts.existingMemos);
  const catalog = new Map<string, InvoiceSaleLine>();
  for (const item of opts.invoice.items || []) {
    if (item.product_id == null || item.product_id === '') continue;
    const key = invoiceLineKey(String(item.product_id), Number(item.price));
    if (!catalog.has(key)) catalog.set(key, item);
  }

  const requestedByKey = new Map<string, number>();
  const built: Array<{ product_id: string; product_name: string; quantity: number; unit_price: number; tax_percent: number }> = [];

  for (const req of opts.requested) {
    const qty = Number(req.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new CreditMemoFromInvoiceError('Return quantity must be a positive whole number');
    }
    const productId = String(req.product_id);
    const productKeys = [...catalog.keys()].filter((key) => key.startsWith(`${productId}:`));
    let invoiceMatch: InvoiceSaleLine | undefined;
    if (req.unit_price != null && Number.isFinite(Number(req.unit_price))) {
      invoiceMatch = catalog.get(invoiceLineKey(productId, Number(req.unit_price)));
    }
    if (!invoiceMatch && productKeys.length === 1) {
      invoiceMatch = catalog.get(productKeys[0]);
    }
    if (!invoiceMatch) {
      throw new CreditMemoFromInvoiceError('An item is not on that invoice at that sold price');
    }
    const unitPrice = Number(invoiceMatch.price);
    const key = invoiceLineKey(productId, unitPrice);
    requestedByKey.set(key, (requestedByKey.get(key) || 0) + qty);
    const remaining = remainingReturnQty(sold.get(key) || 0, credited.get(key) || 0);
    if ((requestedByKey.get(key) || 0) > remaining) {
      throw new CreditMemoFromInvoiceError(
        `Cannot return more than ${remaining} remaining of ${invoiceMatch.product_name || 'that item'}`
      );
    }
    built.push({
      product_id: productId,
      product_name: String(invoiceMatch.product_name || ''),
      quantity: qty,
      unit_price: unitPrice,
      tax_percent: taxPercentFromInvoiceLine(invoiceMatch),
    });
  }

  if (!built.length) {
    throw new CreditMemoFromInvoiceError('Select at least one item to return');
  }
  return { items: built };
}

export async function loadCustomerInvoicesForCredit(customerId: string) {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    throw new CreditMemoFromInvoiceError('Invalid customer', 400);
  }
  const cid = new mongoose.Types.ObjectId(customerId);
  const invoices = await Invoice.find({
    customer_id: cid,
    invoice_type: DOCUMENT_TYPE_INVOICE,
  })
    .sort({ invoice_date: -1, created_at: -1 })
    .limit(200)
    .lean();

  const invoiceIds = invoices.map((inv) => inv._id);
  const memos = invoiceIds.length
    ? await CreditMemo.find({
        type: 'CUSTOMER',
        customer_id: cid,
        reference_invoice_id: { $in: invoiceIds },
        status: { $in: ['DRAFT', ...CREDIT_MEMO_BALANCE_STATUSES] },
      }).lean()
    : [];

  const memosByInvoice = new Map<string, typeof memos>();
  for (const memo of memos) {
    const invId = memo.reference_invoice_id ? String(memo.reference_invoice_id) : '';
    if (!invId) continue;
    const list = memosByInvoice.get(invId) || [];
    list.push(memo);
    memosByInvoice.set(invId, list);
  }

  return invoices.map((inv) => {
    const invId = String(inv._id);
    const related = memosByInvoice.get(invId) || [];
    const sold = soldQtyByLineKey(inv.items as InvoiceSaleLine[]);
    const credited = creditedQtyByLineKey(related);
    const catalogKeys = [...sold.keys()];
    const items = catalogKeys.map((key) => {
      const [productId, priceStr] = [key.slice(0, key.lastIndexOf(':')), key.slice(key.lastIndexOf(':') + 1)];
      const source = (inv.items || []).find(
        (item: InvoiceSaleLine) =>
          String(item.product_id) === productId && Number(item.price).toFixed(2) === priceStr
      );
      const quantity_sold = sold.get(key) || 0;
      const quantity_credited = credited.get(key) || 0;
      return {
        product_id: productId,
        product_name: source?.product_name || '',
        quantity_sold,
        quantity_credited,
        quantity_remaining: remainingReturnQty(quantity_sold, quantity_credited),
        unit_price: Number(priceStr),
        tax_percent: source ? taxPercentFromInvoiceLine(source) : 0,
      };
    });
    return {
      id: invId,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      created_at: inv.created_at,
      total_amount: inv.total_amount,
      amount_paid: inv.amount_paid || 0,
      payment_status: inv.payment_status,
      inventory_applied: inv.inventory_applied,
      items,
    };
  });
}

export async function buildValidatedCustomerCreditItems(opts: {
  customerId: string;
  invoiceId: string;
  requested: Array<{ product_id: string; quantity: number; unit_price?: number }>;
  reason: string;
}) {
  if (!mongoose.Types.ObjectId.isValid(opts.invoiceId)) {
    throw new CreditMemoFromInvoiceError('Select an invoice');
  }
  const invoice = await Invoice.findById(opts.invoiceId).lean();
  if (!invoice) throw new CreditMemoFromInvoiceError('Invoice not found', 404);
  const existingMemos = await CreditMemo.find({
    type: 'CUSTOMER',
    customer_id: opts.customerId,
    reference_invoice_id: invoice._id,
    status: { $in: ['DRAFT', ...CREDIT_MEMO_BALANCE_STATUSES] },
  }).lean();
  const validated = validateCustomerReturnLines({
    invoice: invoice as { customer_id?: unknown; invoice_type?: unknown; items?: InvoiceSaleLine[] },
    customerId: opts.customerId,
    existingMemos,
    requested: opts.requested,
  });
  return {
    items: validated.items,
    affects_inventory: shouldCreditInventory({ reason: opts.reason, invoice }),
    invoice_number: (invoice as { invoice_number?: string }).invoice_number,
  };
}
