/**
 * Summarise stored tax snapshots. This does not calculate a new rate and it
 * never produces a filing-ready total.
 */

import { classifyInvoiceDocument } from './sources';

export type StoredLine = {
  hasTaxableKey: boolean;
  taxable?: boolean;
  taxExempt?: boolean;
  subtotal?: unknown;
  taxAmount?: unknown;
};

export type StoredWholesaleInvoice = {
  id: string;
  invoiceNumber?: string;
  invoiceType?: unknown;
  source?: unknown;
  lines: StoredLine[];
  headerTax?: unknown;
};

export type StoredPosSale = {
  id: string;
  saleNumber?: string;
  headerTax?: unknown;
  lines: Array<{ tax?: unknown; price?: unknown; quantity?: unknown; discount?: unknown }>;
};

export type StoredOnlineOrder = {
  id: string;
  orderNumber?: string;
  headerTax?: unknown;
  lines: Array<{ taxRate?: unknown; subtotal?: unknown }>;
};

export type RecordedMetric =
  | { availability: 'recorded_preview'; cents: number }
  | { availability: 'unavailable'; reason: string };

export type SalesTaxPreviewSummary = {
  filingReady: false;
  postingAllowed: false;
  status: 'preview' | 'incomplete';
  taxable: RecordedMetric;
  exempt: RecordedMetric;
  nonTaxable: RecordedMetric;
  recordedTax: RecordedMetric;
  incompleteCount: number;
  excluded: { quotations: number; posSlips: number; legacyOrders: number; receipts: number; other: number };
  discrepancies: Array<{ id: string; reason: string }>;
  blockers: string[];
};

export function storedDollarsToCents(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round((amount + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function unavailable(reason: string): RecordedMetric {
  return { availability: 'unavailable', reason };
}

function asRecorded(metric: RecordedMetric): RecordedMetric {
  return metric.availability === 'recorded_preview' ? metric : { availability: 'recorded_preview', cents: 0 };
}

function add(metric: RecordedMetric, cents: number): RecordedMetric {
  if (metric.availability !== 'recorded_preview') return metric;
  return { availability: 'recorded_preview', cents: metric.cents + cents };
}

export function summarizeSalesTaxRecords(input: {
  invoices?: StoredWholesaleInvoice[];
  posSales?: StoredPosSale[];
  onlineOrders?: StoredOnlineOrder[];
  legacyOrderCount?: number;
  receiptCount?: number;
}): SalesTaxPreviewSummary {
  const summary: SalesTaxPreviewSummary = {
    filingReady: false,
    postingAllowed: false,
    status: 'preview',
    taxable: unavailable('no_complete_wholesale_tax_snapshots'),
    exempt: unavailable('no_complete_wholesale_tax_snapshots'),
    nonTaxable: unavailable('no_complete_wholesale_tax_snapshots'),
    recordedTax: unavailable('no_recorded_tax_snapshots'),
    incompleteCount: 0,
    excluded: {
      quotations: 0,
      posSlips: 0,
      legacyOrders: input.legacyOrderCount ?? 0,
      receipts: input.receiptCount ?? 0,
      other: 0,
    },
    discrepancies: [],
    blockers: [
      'jurisdiction_sourcing',
      'local_collection_duty',
      'rounding_method',
      'reporting_basis',
      'filing_frequency',
    ],
  };

  for (const invoice of input.invoices ?? []) {
    const decision = classifyInvoiceDocument({ invoice_type: invoice.invoiceType, source: invoice.source });
    if (decision.kind === 'quotation') {
      summary.excluded.quotations += 1;
      continue;
    }
    if (decision.kind === 'pos_slip') {
      summary.excluded.posSlips += 1;
      continue;
    }
    if (!decision.includeInTaxPreview) {
      summary.excluded.other += 1;
      summary.incompleteCount += 1;
      continue;
    }
    if (invoice.lines.length === 0 || invoice.lines.some((line) => !line.hasTaxableKey)) {
      summary.incompleteCount += 1;
      summary.discrepancies.push({ id: invoice.id, reason: 'wholesale_line_tax_snapshot_missing' });
      continue;
    }
    let lineTax = 0;
    for (const line of invoice.lines) {
      const subtotal = storedDollarsToCents(line.subtotal);
      const tax = storedDollarsToCents(line.taxAmount);
      if (subtotal == null || tax == null) {
        summary.incompleteCount += 1;
        summary.discrepancies.push({ id: invoice.id, reason: 'wholesale_amount_unreadable' });
        lineTax = Number.NaN;
        break;
      }
      lineTax += tax;
      if (line.taxExempt) summary.exempt = add(asRecorded(summary.exempt), subtotal);
      else if (line.taxable) summary.taxable = add(asRecorded(summary.taxable), subtotal);
      else summary.nonTaxable = add(asRecorded(summary.nonTaxable), subtotal);
    }
    if (!Number.isFinite(lineTax)) continue;
    const header = storedDollarsToCents(invoice.headerTax);
    if (header != null && header !== lineTax) {
      summary.discrepancies.push({ id: invoice.id, reason: 'header_tax_differs_from_line_snapshots' });
      summary.incompleteCount += 1;
      continue;
    }
    summary.recordedTax = add(asRecorded(summary.recordedTax), lineTax);
  }

  for (const sale of input.posSales ?? []) {
    const taxes = sale.lines.map((line) => storedDollarsToCents(line.tax));
    if (sale.lines.length === 0 || taxes.some((tax) => tax == null)) {
      summary.incompleteCount += 1;
      summary.discrepancies.push({ id: sale.id, reason: 'pos_line_tax_missing' });
      continue;
    }
    const lineTax = (taxes as number[]).reduce((sum, tax) => sum + tax, 0);
    const header = storedDollarsToCents(sale.headerTax);
    if (header != null && header !== lineTax) {
      summary.incompleteCount += 1;
      summary.discrepancies.push({ id: sale.id, reason: 'pos_header_tax_differs_from_lines' });
      continue;
    }
    summary.recordedTax = add(asRecorded(summary.recordedTax), lineTax);
  }

  for (const order of input.onlineOrders ?? []) {
    if (order.lines.length === 0 || order.lines.some((line) => line.taxRate == null)) {
      summary.incompleteCount += 1;
      summary.discrepancies.push({ id: order.id, reason: 'online_tax_rate_missing' });
      continue;
    }
    const header = storedDollarsToCents(order.headerTax);
    if (header == null) {
      summary.incompleteCount += 1;
      summary.discrepancies.push({ id: order.id, reason: 'online_tax_unreadable' });
      continue;
    }
    summary.recordedTax = add(asRecorded(summary.recordedTax), header);
    summary.discrepancies.push({ id: order.id, reason: 'online_jurisdiction_not_resolved' });
  }

  if (summary.incompleteCount > 0 || summary.excluded.legacyOrders > 0) summary.status = 'incomplete';
  if (summary.taxable.availability === 'unavailable') summary.status = 'incomplete';
  return summary;
}
