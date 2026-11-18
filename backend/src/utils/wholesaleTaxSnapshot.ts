/**
 * Version 1 wholesale tax snapshot.
 *
 * Classifies the line tax amount the existing invoice calculator already stored.
 * It does not choose a rate, apply a certificate, or replace roundMoney.
 */

import { roundMoney } from '../services/paymentApplication';
import { hasInvoiceLineTaxSnapshot } from './invoiceLineTax';
import { hasExplicitTaxTypeField, summarizePopulatedTaxType } from './productTaxType';

export const WHOLESALE_TAX_SNAPSHOT_VERSION = 1 as const;

export const TAX_DECISION_NOT_CONFIRMED = 'Tax decision not confirmed';

export const STANDING_INCOMPLETE_REASONS = [
  'sourcing_rule_missing',
  'rounding_method_unconfirmed',
  'freight_tax_treatment_unconfirmed',
] as const;

export type WholesaleMoneyDecision =
  | 'confirmed_taxable'
  | 'confirmed_non_taxable'
  | 'customer_flag_zeroed'
  | 'incomplete';

export type WholesaleTaxSnapshotV1 = {
  version: 1;
  captured_at: string;
  role: 'estimate' | 'transaction';
  source: 'wholesale_invoice';
  document_type: 'quotation' | 'invoice';
  capture_event: 'create' | 'line_added' | 'quotation_conversion';
  reporting: 'excluded' | 'preview_only';
  reporting_reason: 'quotations_are_not_sales' | 'tax_reporting_incomplete';
  reporting_status: 'incomplete';
  incomplete_reasons: string[];
  money_decision: WholesaleMoneyDecision;
  posted_tax_cents: number;
  zero_confirmed: boolean;
  quantity: number;
  unit_price_cents: number;
  line_amount_cents: number;
  taxable_base_cents: number;
  discount_treatment: 'not_applied_by_wholesale_route';
  tax_type: {
    id: string | null;
    name: string | null;
    rate_type: 'percent' | 'amount' | null;
  };
  rate_percent_points: number | null;
  customer_tax_exempt_flag: boolean;
  certificate_decision: 'not_consulted';
  certificate: null;
  jurisdiction_status: 'incomplete';
  jurisdiction_reason: 'sourcing_rule_missing';
  freight: 'unconfirmed';
  rounding: 'unconfirmed';
  system_helper: 'paymentApplication.roundMoney';
  estimate_document_id?: string;
  product_reread: false;
};

export type WholesaleTaxReconciliation = 'header_exceeds_lines' | 'lines_match';

type ProductClass =
  | { kind: 'missing' }
  | { kind: 'explicit_no_tax' }
  | { kind: 'unreadable'; id: string | null }
  | { kind: 'amount'; id: string; name: string }
  | { kind: 'percent'; id: string; name: string; rate: number };

export function postedTaxCentsFromLine(taxAmount: unknown): number {
  return Math.round(roundMoney(taxAmount) * 100);
}

function dollarsToCents(amount: unknown): number {
  return Math.round(roundMoney(amount) * 100);
}

function classifyProduct(product: object | null | undefined): ProductClass {
  if (!product || !hasExplicitTaxTypeField(product)) return { kind: 'missing' };
  const idValue = (product as { tax_type_id?: unknown }).tax_type_id;
  if (idValue == null) return { kind: 'explicit_no_tax' };
  const summary = summarizePopulatedTaxType(idValue);
  if (!summary || !summary.name.trim()) {
    return { kind: 'unreadable', id: summary?.id || (typeof idValue === 'string' ? idValue : null) };
  }
  if (summary.rate_type === 'amount') return { kind: 'amount', id: summary.id, name: summary.name };
  return { kind: 'percent', id: summary.id, name: summary.name, rate: summary.rate };
}

function snapshotShell(input: {
  capturedAt: Date;
  role: 'estimate' | 'transaction';
  documentType: 'quotation' | 'invoice';
  captureEvent: WholesaleTaxSnapshotV1['capture_event'];
  line: { quantity?: unknown; price?: unknown; subtotal?: unknown; tax_amount?: unknown };
  moneyDecision: WholesaleMoneyDecision;
  incompleteReasons: string[];
  taxType: WholesaleTaxSnapshotV1['tax_type'];
  ratePercentPoints: number | null;
  customerExempt: boolean;
  estimateDocumentId?: string;
}): WholesaleTaxSnapshotV1 {
  const quotation = input.documentType === 'quotation' || input.role === 'estimate';
  const snapshot: WholesaleTaxSnapshotV1 = {
    version: WHOLESALE_TAX_SNAPSHOT_VERSION,
    captured_at: input.capturedAt.toISOString(),
    role: quotation ? 'estimate' : 'transaction',
    source: 'wholesale_invoice',
    document_type: quotation ? 'quotation' : 'invoice',
    capture_event: input.captureEvent,
    reporting: quotation ? 'excluded' : 'preview_only',
    reporting_reason: quotation ? 'quotations_are_not_sales' : 'tax_reporting_incomplete',
    reporting_status: 'incomplete',
    incomplete_reasons: input.incompleteReasons,
    money_decision: input.moneyDecision,
    posted_tax_cents: postedTaxCentsFromLine(input.line.tax_amount),
    zero_confirmed: input.moneyDecision === 'confirmed_non_taxable',
    quantity: Number(input.line.quantity) || 0,
    unit_price_cents: dollarsToCents(input.line.price),
    line_amount_cents: dollarsToCents(input.line.subtotal),
    taxable_base_cents: dollarsToCents(input.line.subtotal),
    discount_treatment: 'not_applied_by_wholesale_route',
    tax_type: input.taxType,
    rate_percent_points: input.ratePercentPoints,
    customer_tax_exempt_flag: input.customerExempt === true,
    certificate_decision: 'not_consulted',
    certificate: null,
    jurisdiction_status: 'incomplete',
    jurisdiction_reason: 'sourcing_rule_missing',
    freight: 'unconfirmed',
    rounding: 'unconfirmed',
    system_helper: 'paymentApplication.roundMoney',
    product_reread: false,
  };
  if (input.estimateDocumentId) snapshot.estimate_document_id = input.estimateDocumentId;
  return snapshot;
}

export function buildWholesaleTaxSnapshot(input: {
  line: { quantity?: unknown; price?: unknown; subtotal?: unknown; tax_amount?: unknown };
  product: object | null | undefined;
  customerExempt: boolean;
  documentType: 'quotation' | 'invoice';
  captureEvent: 'create' | 'line_added';
  capturedAt?: Date;
}): WholesaleTaxSnapshotV1 {
  const product = classifyProduct(input.product);
  const reasons = [...STANDING_INCOMPLETE_REASONS] as string[];
  let moneyDecision: WholesaleMoneyDecision;
  let taxType: WholesaleTaxSnapshotV1['tax_type'] = { id: null, name: null, rate_type: null };
  let rate: number | null = null;

  if (product.kind === 'percent') {
    moneyDecision = 'confirmed_taxable';
    taxType = { id: product.id, name: product.name, rate_type: 'percent' };
    rate = product.rate;
  } else if (product.kind === 'explicit_no_tax') {
    moneyDecision = 'confirmed_non_taxable';
  } else if (product.kind === 'missing') {
    moneyDecision = 'incomplete';
    reasons.unshift('tax_assignment_missing');
  } else if (product.kind === 'unreadable') {
    moneyDecision = 'incomplete';
    reasons.unshift('tax_type_unreadable');
    taxType = { id: product.id, name: null, rate_type: null };
  } else {
    moneyDecision = 'incomplete';
    reasons.unshift('fixed_amount_tax_undefined');
    taxType = { id: product.id, name: product.name, rate_type: 'amount' };
  }

  if (input.customerExempt === true) moneyDecision = 'customer_flag_zeroed';

  return snapshotShell({
    capturedAt: input.capturedAt ?? new Date(),
    role: input.documentType === 'quotation' ? 'estimate' : 'transaction',
    documentType: input.documentType,
    captureEvent: input.captureEvent,
    line: input.line,
    moneyDecision,
    incompleteReasons: reasons,
    taxType,
    ratePercentPoints: rate,
    customerExempt: input.customerExempt === true,
  });
}

function isSnapshotV1(value: unknown): value is WholesaleTaxSnapshotV1 {
  return Boolean(value) && typeof value === 'object' && (value as { version?: unknown }).version === 1;
}

export function readWholesaleTaxSnapshot(item: unknown): WholesaleTaxSnapshotV1 | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as { _doc?: { tax_snapshot?: unknown }; tax_snapshot?: unknown };
  const raw = record._doc && typeof record._doc === 'object' ? record._doc.tax_snapshot : record.tax_snapshot;
  return isSnapshotV1(raw) ? raw : null;
}

function withLineAmounts(snapshot: WholesaleTaxSnapshotV1, line: { quantity?: unknown; price?: unknown; subtotal?: unknown; tax_amount?: unknown }): WholesaleTaxSnapshotV1 {
  return {
    ...snapshot,
    incomplete_reasons: [...snapshot.incomplete_reasons],
    tax_type: { ...snapshot.tax_type },
    quantity: Number(line.quantity) || 0,
    unit_price_cents: dollarsToCents(line.price),
    line_amount_cents: dollarsToCents(line.subtotal),
    taxable_base_cents: dollarsToCents(line.subtotal),
    posted_tax_cents: postedTaxCentsFromLine(line.tax_amount),
    product_reread: false,
  };
}

export function refreshWholesaleTaxSnapshot(
  snapshot: WholesaleTaxSnapshotV1,
  line: { quantity?: unknown; price?: unknown; subtotal?: unknown; tax_amount?: unknown }
): WholesaleTaxSnapshotV1 {
  return withLineAmounts(snapshot, line);
}

export function convertQuotationTaxSnapshot(
  snapshot: WholesaleTaxSnapshotV1,
  line: { quantity?: unknown; price?: unknown; subtotal?: unknown; tax_amount?: unknown },
  estimateDocumentId: string,
  capturedAt?: Date
): WholesaleTaxSnapshotV1 {
  const refreshed = withLineAmounts(snapshot, line);
  return {
    ...refreshed,
    captured_at: (capturedAt ?? new Date()).toISOString(),
    role: 'transaction',
    document_type: 'invoice',
    capture_event: 'quotation_conversion',
    reporting: 'preview_only',
    reporting_reason: 'tax_reporting_incomplete',
    estimate_document_id: estimateDocumentId,
    product_reread: false,
    money_decision: snapshot.money_decision,
    zero_confirmed: snapshot.zero_confirmed,
    incomplete_reasons: [...snapshot.incomplete_reasons],
    tax_type: { ...snapshot.tax_type },
    rate_percent_points: snapshot.rate_percent_points,
    customer_tax_exempt_flag: snapshot.customer_tax_exempt_flag,
    certificate_decision: 'not_consulted',
    certificate: null,
  };
}

function productIdOf(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const id = (item as { product_id?: unknown }).product_id;
  return id ? String(id) : '';
}

function existingByProductId(existingItems: unknown[]): Map<string, { snapshot: WholesaleTaxSnapshotV1 | null }> {
  const map = new Map<string, { snapshot: WholesaleTaxSnapshotV1 | null }>();
  for (const item of existingItems || []) {
    const id = productIdOf(item);
    if (!id || map.has(id)) continue;
    map.set(id, { snapshot: readWholesaleTaxSnapshot(item) });
  }
  return map;
}

export function taxReconciliationForSnapshots(
  items: Array<{ tax_snapshot?: unknown; tax_amount?: unknown }>,
  documentTax: unknown
): WholesaleTaxReconciliation | undefined {
  if (!items.some((item) => isSnapshotV1(item.tax_snapshot))) return undefined;
  const lineTax = roundMoney(items.reduce((sum, item) => sum + (Number(item.tax_amount) || 0), 0));
  return roundMoney(documentTax) > lineTax ? 'header_exceeds_lines' : 'lines_match';
}

export function attachWholesaleTaxSnapshots<T extends {
  product_id?: unknown;
  quantity?: unknown;
  price?: unknown;
  subtotal?: unknown;
  tax_amount?: unknown;
}>(input: {
  mode: 'create' | 'edit' | 'convert';
  items: T[];
  existingItems?: unknown[];
  productsById?: ReadonlyMap<string, object>;
  customerExempt?: boolean;
  documentType: 'quotation' | 'invoice';
  documentTax: unknown;
  estimateDocumentId?: string;
  capturedAt?: Date;
}): { items: Array<T & { tax_snapshot?: WholesaleTaxSnapshotV1 }>; tax_reconciliation?: WholesaleTaxReconciliation } {
  const capturedAt = input.capturedAt ?? new Date();
  const products = input.productsById ?? new Map<string, object>();
  const existing = existingByProductId(input.existingItems || []);

  const items = input.items.map((item, index) => {
    if (!hasInvoiceLineTaxSnapshot(item)) return item;

    if (input.mode === 'convert') {
      const source = (input.existingItems || [])[index];
      const previous = readWholesaleTaxSnapshot(source);
      if (!previous || !input.estimateDocumentId) return item;
      return {
        ...item,
        tax_snapshot: convertQuotationTaxSnapshot(previous, item, input.estimateDocumentId, capturedAt),
      };
    }

    if (input.mode === 'edit') {
      const previous = existing.get(productIdOf(item));
      if (previous?.snapshot) {
        return { ...item, tax_snapshot: refreshWholesaleTaxSnapshot(previous.snapshot, item) };
      }
      if (previous) return item;
    }

    const product = products.get(productIdOf(item)) ?? null;
    return {
      ...item,
      tax_snapshot: buildWholesaleTaxSnapshot({
        line: item,
        product,
        customerExempt: input.customerExempt === true,
        documentType: input.documentType,
        captureEvent: input.mode === 'edit' ? 'line_added' : 'create',
        capturedAt,
      }),
    };
  });

  return {
    items,
    tax_reconciliation: taxReconciliationForSnapshots(items, input.documentTax),
  };
}
