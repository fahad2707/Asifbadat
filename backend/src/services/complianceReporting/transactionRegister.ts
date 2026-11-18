/**
 * Per-document compliance status for the sales-tax register.
 * Uses the same snapshot rules as the period summary. It does not calculate a
 * new rate and it does not treat a stored total as a taxable base.
 */

import { classifyInvoiceDocument } from './sources';
import {
  storedDollarsToCents,
  type StoredOnlineOrder,
  type StoredPosSale,
  type StoredWholesaleInvoice,
} from './salesTaxAggregate';

export type RegisterSource = 'wholesale' | 'pos' | 'online';
export type RegisterStatus = 'recorded' | 'incomplete' | 'discrepancy';

export type MoneyView =
  | { availability: 'recorded_preview'; cents: number }
  | { availability: 'unavailable'; reason: string };

export type RegisterDocument = {
  id: string;
  source: RegisterSource;
  number?: string | null;
  date?: string | null;
  customer?: string | null;
  storedTotal?: unknown;
  invoice?: StoredWholesaleInvoice;
  pos?: StoredPosSale;
  online?: StoredOnlineOrder;
};

export type RegisterRow = {
  id: string;
  source: RegisterSource;
  number: string;
  date: string | null;
  customer: string | null;
  storedTotal: MoneyView;
  recordedTax: MoneyView;
  taxableBase: MoneyView;
  jurisdictionStatus: 'not_resolved';
  complianceStatus: RegisterStatus;
  reasons: string[];
  filingReady: false;
  postingAllowed: false;
};

function unavailable(reason: string): MoneyView {
  return { availability: 'unavailable', reason };
}

function recorded(cents: number): MoneyView {
  return { availability: 'recorded_preview', cents };
}

function money(value: unknown, reason: string): MoneyView {
  const cents = storedDollarsToCents(value);
  return cents == null ? unavailable(reason) : recorded(cents);
}

export function assessRegisterDocument(doc: RegisterDocument): RegisterRow {
  const base = {
    id: doc.id,
    source: doc.source,
    number: doc.number || doc.id,
    date: doc.date || null,
    customer: doc.customer || null,
    storedTotal: money(doc.storedTotal, 'stored_total_missing'),
    jurisdictionStatus: 'not_resolved' as const,
    filingReady: false as const,
    postingAllowed: false as const,
  };

  if (doc.source === 'wholesale' && doc.invoice) return { ...base, ...assessWholesale(doc.invoice) };
  if (doc.source === 'pos' && doc.pos) return { ...base, ...assessPos(doc.pos) };
  if (doc.source === 'online' && doc.online) return { ...base, ...assessOnline(doc.online) };
  return {
    ...base,
    recordedTax: unavailable('source_snapshot_missing'),
    taxableBase: unavailable('source_snapshot_missing'),
    complianceStatus: 'incomplete',
    reasons: ['source_snapshot_missing'],
  };
}

function assessWholesale(invoice: StoredWholesaleInvoice): Pick<RegisterRow, 'recordedTax' | 'taxableBase' | 'complianceStatus' | 'reasons'> {
  const decision = classifyInvoiceDocument({ invoice_type: invoice.invoiceType, source: invoice.source });
  if (!decision.includeInTaxPreview) {
    return {
      recordedTax: unavailable(decision.reason),
      taxableBase: unavailable(decision.reason),
      complianceStatus: 'incomplete',
      reasons: [decision.reason],
    };
  }
  if (invoice.lines.length === 0 || invoice.lines.some((line) => !line.hasTaxableKey)) {
    return {
      recordedTax: unavailable('wholesale_line_tax_snapshot_missing'),
      taxableBase: unavailable('wholesale_line_tax_snapshot_missing'),
      complianceStatus: 'incomplete',
      reasons: ['wholesale_line_tax_snapshot_missing'],
    };
  }
  let taxable = 0;
  let exempt = 0;
  let nonTaxable = 0;
  let lineTax = 0;
  for (const line of invoice.lines) {
    const subtotal = storedDollarsToCents(line.subtotal);
    const tax = storedDollarsToCents(line.taxAmount);
    if (subtotal == null || tax == null) {
      return {
        recordedTax: unavailable('wholesale_amount_unreadable'),
        taxableBase: unavailable('wholesale_amount_unreadable'),
        complianceStatus: 'incomplete',
        reasons: ['wholesale_amount_unreadable'],
      };
    }
    lineTax += tax;
    if (line.taxExempt) exempt += subtotal;
    else if (line.taxable) taxable += subtotal;
    else nonTaxable += subtotal;
  }
  const header = storedDollarsToCents(invoice.headerTax);
  if (header != null && header !== lineTax) {
    return {
      recordedTax: unavailable('header_tax_differs_from_line_snapshots'),
      taxableBase: unavailable('header_tax_differs_from_line_snapshots'),
      complianceStatus: 'discrepancy',
      reasons: ['header_tax_differs_from_line_snapshots'],
    };
  }
  return {
    recordedTax: recorded(lineTax),
    taxableBase: recorded(taxable + exempt + nonTaxable),
    complianceStatus: 'recorded',
    reasons: [],
  };
}

function assessPos(sale: StoredPosSale): Pick<RegisterRow, 'recordedTax' | 'taxableBase' | 'complianceStatus' | 'reasons'> {
  const taxes = sale.lines.map((line) => storedDollarsToCents(line.tax));
  if (sale.lines.length === 0 || taxes.some((tax) => tax == null)) {
    return {
      recordedTax: unavailable('pos_line_tax_missing'),
      taxableBase: unavailable('pos_taxable_base_unavailable'),
      complianceStatus: 'incomplete',
      reasons: ['pos_line_tax_missing', 'pos_taxable_base_unavailable'],
    };
  }
  const lineTax = (taxes as number[]).reduce((sum, tax) => sum + tax, 0);
  const header = storedDollarsToCents(sale.headerTax);
  if (header != null && header !== lineTax) {
    return {
      recordedTax: unavailable('pos_header_tax_differs_from_lines'),
      taxableBase: unavailable('pos_taxable_base_unavailable'),
      complianceStatus: 'discrepancy',
      reasons: ['pos_header_tax_differs_from_lines', 'pos_taxable_base_unavailable'],
    };
  }
  return {
    recordedTax: recorded(lineTax),
    taxableBase: unavailable('pos_taxable_base_unavailable'),
    complianceStatus: 'incomplete',
    reasons: ['pos_taxable_base_unavailable'],
  };
}

function assessOnline(order: StoredOnlineOrder): Pick<RegisterRow, 'recordedTax' | 'taxableBase' | 'complianceStatus' | 'reasons'> {
  if (order.lines.length === 0 || order.lines.some((line) => line.taxRate == null)) {
    return {
      recordedTax: unavailable('online_tax_rate_missing'),
      taxableBase: unavailable('online_taxable_base_unavailable'),
      complianceStatus: 'incomplete',
      reasons: ['online_tax_rate_missing'],
    };
  }
  const header = storedDollarsToCents(order.headerTax);
  if (header == null) {
    return {
      recordedTax: unavailable('online_tax_unreadable'),
      taxableBase: unavailable('online_taxable_base_unavailable'),
      complianceStatus: 'incomplete',
      reasons: ['online_tax_unreadable'],
    };
  }
  return {
    recordedTax: recorded(header),
    taxableBase: unavailable('online_taxable_base_unavailable'),
    complianceStatus: 'incomplete',
    reasons: ['online_jurisdiction_not_resolved'],
  };
}

export function filterTransactionRegister(
  rows: RegisterRow[],
  query: { source?: string; status?: string; q?: string }
): RegisterRow[] {
  const source = query.source && query.source !== 'all' ? query.source : '';
  const status = query.status && query.status !== 'all' ? query.status : '';
  const q = (query.q || '').trim().toLowerCase();
  return rows.filter((row) => {
    if (source && row.source !== source) return false;
    if (status && row.complianceStatus !== status) return false;
    if (!q) return true;
    return row.number.toLowerCase().includes(q) || (row.customer || '').toLowerCase().includes(q);
  });
}

export function pageRows<T>(rows: T[], page: number, pageSize: number): { rows: T[]; page: number; pageSize: number; total: number } {
  const size = Math.min(Math.max(Number.isFinite(pageSize) ? pageSize : 50, 1), 50);
  const current = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const start = (current - 1) * size;
  return { rows: rows.slice(start, start + size), page: current, pageSize: size, total: rows.length };
}
