/**
 * Admin invoice / quotation line tax.
 *
 * Product.price is tax-exclusive. Line tax is inherited from Product.tax_type_id
 * and snapshotted on the invoice line so later Product TaxType changes do not
 * rewrite history.
 *
 * percent: tax_amount = roundMoney(subtotal * rate / 100)
 * amount:  not implemented — existing invoice UI treats $N as document-level tax;
 *          per-unit vs per-line vs per-document is not defined for product lines.
 *
 * Customer.tax_exempt === true zeros tax on newly inherited lines and snapshots
 * tax_exempt on the line. Historical documents keep that snapshot.
 *
 * Does not read or write Product.price, Product.tax_rate, or Customer.tax_exempt.
 */

import mongoose from 'mongoose';
import { roundMoney } from '../services/paymentApplication';
import {
  formatTaxTypeLabel,
  hasExplicitTaxTypeField,
  summarizePopulatedTaxType,
} from './productTaxType';

export class InvoiceLineTaxError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceLineTaxError';
  }
}

export type InvoiceLineTaxSnapshot = {
  taxable: boolean;
  tax_type_id: mongoose.Types.ObjectId | null;
  tax_type_name: string | null;
  tax_rate_type?: 'percent' | 'amount' | null;
  tax_rate: number;
  tax_amount: number;
  tax_type_label: string;
  tax_exempt?: boolean;
  total: number;
};

export const CUSTOMER_EXEMPT_TAX_LABEL = 'Customer Exempt';

export type InvoiceLineRecord = {
  product_id?: mongoose.Types.ObjectId;
  product_name: string;
  category_name?: string;
  quantity: number;
  price: number;
  subtotal: number;
} & Partial<InvoiceLineTaxSnapshot>;

export function hasInvoiceLineTaxSnapshot(item: object): boolean {
  return Object.prototype.hasOwnProperty.call(item, 'taxable');
}

export function computePercentLineTax(subtotal: number, rate: number): number {
  return roundMoney((Number(subtotal) || 0) * ((Number(rate) || 0) / 100));
}

export function noTaxLineSnapshot(subtotal: number): InvoiceLineTaxSnapshot {
  const sub = roundMoney(subtotal);
  return {
    taxable: false,
    tax_type_id: null,
    tax_type_name: 'No Tax',
    tax_rate_type: undefined,
    tax_rate: 0,
    tax_amount: 0,
    tax_type_label: 'No Tax',
    total: sub,
  };
}

function objectIdOrUndefined(raw: unknown): mongoose.Types.ObjectId | undefined {
  if (!raw) return undefined;
  const id = typeof raw === 'string' ? raw : String((raw as { toString?: () => string }).toString?.() ?? raw);
  if (!/^[a-f0-9A-F]{24}$/.test(id)) return undefined;
  return new mongoose.Types.ObjectId(id);
}

export function applyCustomerExemption(snapshot: InvoiceLineTaxSnapshot, subtotal: number): InvoiceLineTaxSnapshot {
  const sub = roundMoney(subtotal);
  return {
    ...snapshot,
    taxable: false,
    tax_amount: 0,
    tax_type_label: CUSTOMER_EXEMPT_TAX_LABEL,
    tax_exempt: true,
    total: sub,
  };
}

export function inheritLineTaxFromProduct(
  product: { name?: string; tax_type_id?: unknown },
  subtotal: number,
  opts?: { customerExempt?: boolean }
): InvoiceLineTaxSnapshot {
  const name = String(product?.name || 'Product').trim() || 'Product';
  const sub = roundMoney(subtotal);
  if (!hasExplicitTaxTypeField(product)) {
    throw new InvoiceLineTaxError(
      `"${name}" has no configured tax type. Assign a tax type before invoicing.`
    );
  }
  if (product.tax_type_id == null) {
    const none = noTaxLineSnapshot(sub);
    return opts?.customerExempt ? applyCustomerExemption(none, sub) : none;
  }
  const summary = summarizePopulatedTaxType(product.tax_type_id);
  if (!summary || !summary.name) {
    throw new InvoiceLineTaxError(`"${name}" has an invalid or missing TaxType.`);
  }
  if (summary.rate_type === 'amount') {
    throw new InvoiceLineTaxError(
      `"${name}" uses a fixed-amount tax type (${formatTaxTypeLabel(summary)}). Fixed-amount invoice line tax is not supported.`
    );
  }
  const tax_amount = computePercentLineTax(sub, summary.rate);
  const assigned: InvoiceLineTaxSnapshot = {
    taxable: true,
    tax_type_id: new mongoose.Types.ObjectId(summary.id),
    tax_type_name: summary.name,
    tax_rate_type: 'percent',
    tax_rate: summary.rate,
    tax_amount,
    tax_type_label: formatTaxTypeLabel(summary),
    total: roundMoney(sub + tax_amount),
  };
  return opts?.customerExempt ? applyCustomerExemption(assigned, sub) : assigned;
}

export function applyLineTaxSnapshot(
  subtotal: number,
  raw: Record<string, unknown>
): InvoiceLineTaxSnapshot {
  const sub = roundMoney(subtotal);
  const tax_exempt = raw.tax_exempt === true;
  const taxable = !tax_exempt && raw.taxable === true;
  const rateType =
    raw.tax_rate_type === 'amount' ? 'amount' : raw.tax_rate_type === 'percent' ? 'percent' : null;
  if (taxable && rateType === 'amount') {
    throw new InvoiceLineTaxError('Fixed-amount invoice line tax is not supported.');
  }
  const rate = Number(raw.tax_rate) || 0;
  const tax_amount = taxable && rateType === 'percent' ? computePercentLineTax(sub, rate) : 0;
  const tax_type_id = objectIdOrUndefined(raw.tax_type_id) ?? null;
  const tax_type_name =
    raw.tax_type_name != null && String(raw.tax_type_name).trim() !== ''
      ? String(raw.tax_type_name)
      : taxable
        ? null
        : tax_exempt
          ? raw.tax_type_name != null
            ? String(raw.tax_type_name)
            : null
          : 'No Tax';
  const tax_type_label = tax_exempt
    ? CUSTOMER_EXEMPT_TAX_LABEL
    : typeof raw.tax_type_label === 'string' && raw.tax_type_label.trim()
      ? raw.tax_type_label
      : tax_type_name && rateType === 'percent'
        ? formatTaxTypeLabel({ name: tax_type_name, rate, rate_type: 'percent' })
        : tax_type_name || (taxable ? 'Tax' : 'No Tax');
  return {
    taxable,
    tax_type_id,
    tax_type_name,
    tax_rate_type: rateType,
    tax_rate: taxable || tax_exempt ? rate : 0,
    tax_amount,
    tax_type_label,
    tax_exempt,
    total: roundMoney(sub + tax_amount),
  };
}

function existingByProductId(existingItems: unknown[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of existingItems || []) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = rec.product_id ? String(rec.product_id) : '';
    if (id && !map.has(id)) map.set(id, rec);
  }
  return map;
}

export function mapInvoiceLine(
  raw: Record<string, unknown>,
  opts: {
    product?: { name?: string; tax_type_id?: unknown } | null;
    existing?: Record<string, unknown> | null;
    inheritFromProduct: boolean;
    customerExempt?: boolean;
  }
): InvoiceLineRecord {
  const quantity = Number(raw.quantity) || 0;
  const price = Number(raw.price) || 0;
  const subtotal =
    raw.subtotal != null && raw.subtotal !== ''
      ? Number(raw.subtotal) || 0
      : roundMoney(quantity * price);
  const product_id = objectIdOrUndefined(raw.product_id);
  const base: InvoiceLineRecord = {
    product_id,
    product_name: String(raw.product_name || opts.product?.name || ''),
    category_name: raw.category_name != null ? String(raw.category_name) : undefined,
    quantity,
    price,
    subtotal,
  };

  let tax: InvoiceLineTaxSnapshot | null = null;
  if (opts.inheritFromProduct && product_id) {
    if (!opts.product) {
      throw new InvoiceLineTaxError(
        `Product not found for invoice line "${base.product_name || product_id.toString()}".`
      );
    }
    tax = inheritLineTaxFromProduct(opts.product, subtotal, { customerExempt: opts.customerExempt === true });
  } else if (opts.existing && hasInvoiceLineTaxSnapshot(opts.existing)) {
    tax = applyLineTaxSnapshot(subtotal, opts.existing);
  } else if (hasInvoiceLineTaxSnapshot(raw)) {
    tax = applyLineTaxSnapshot(subtotal, raw);
  }

  return tax ? { ...base, ...tax } : base;
}

export function buildInvoiceLines(input: {
  items: Record<string, unknown>[];
  productsById: Map<string, { name?: string; tax_type_id?: unknown }>;
  existingItems?: unknown[];
  inheritFromProduct: boolean;
  customerExempt?: boolean;
}): { items: InvoiceLineRecord[]; usedLineTax: boolean } {
  const existing = existingByProductId(input.existingItems || []);
  const items = input.items.map((raw) => {
    const pid = raw.product_id ? String(raw.product_id) : '';
    const existingLine = pid ? existing.get(pid) || null : null;
    const isNewProductLine = Boolean(pid && !existingLine);
    return mapInvoiceLine(raw, {
      product: pid ? input.productsById.get(pid) || null : null,
      existing: existingLine,
      inheritFromProduct: input.inheritFromProduct && (input.existingItems == null || isNewProductLine),
      customerExempt: input.customerExempt === true,
    });
  });
  const usedLineTax = items.some((item) => hasInvoiceLineTaxSnapshot(item));
  return { items, usedLineTax };
}

export function invoiceTaxTotals(
  items: Array<{ subtotal?: number; tax_amount?: number }>,
  opts: { usedLineTax: boolean; fallbackTaxAmount?: number }
): { subtotal_amount: number; tax_amount: number; total_amount: number } {
  const subtotal_amount = roundMoney(items.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0));
  const tax_amount = opts.usedLineTax
    ? roundMoney(items.reduce((sum, item) => sum + (Number(item.tax_amount) || 0), 0))
    : roundMoney(opts.fallbackTaxAmount ?? 0);
  return {
    subtotal_amount,
    tax_amount,
    total_amount: roundMoney(subtotal_amount + tax_amount),
  };
}

export function copyInvoiceLineSnapshots(items: unknown[]): InvoiceLineRecord[] {
  return (items || []).map((raw) => {
    const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const quantity = Number(rec.quantity) || 0;
    const price = Number(rec.price) || 0;
    const subtotal = rec.subtotal != null ? Number(rec.subtotal) || 0 : roundMoney(quantity * price);
    const base: InvoiceLineRecord = {
      product_id: objectIdOrUndefined(rec.product_id),
      product_name: String(rec.product_name || ''),
      category_name: rec.category_name != null ? String(rec.category_name) : undefined,
      quantity,
      price,
      subtotal,
    };
    if (!hasInvoiceLineTaxSnapshot(rec)) return base;
    return { ...base, ...applyLineTaxSnapshot(subtotal, rec) };
  });
}
