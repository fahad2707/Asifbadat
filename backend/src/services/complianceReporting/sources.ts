/**
 * Which existing records may appear in a sales-tax preview.
 * Quotations, POS slips, receipts, and legacy orders are never reconstructed
 * into tax. POSSale remains the only POS source.
 */

import { isPosSaleInvoiceType, isQuotationType, isReceivableInvoiceType } from '../../utils/documentType';

export type SalesTaxSourceKind =
  | 'wholesale_invoice'
  | 'quotation'
  | 'pos_slip'
  | 'pos_sale'
  | 'online_order'
  | 'legacy_order'
  | 'receipt'
  | 'unknown';

export type SourceDecision = {
  kind: SalesTaxSourceKind;
  includeInTaxPreview: boolean;
  reason: string;
};

export function classifyInvoiceDocument(doc: {
  invoice_type?: unknown;
  source?: unknown;
}): SourceDecision {
  if (isQuotationType(doc.invoice_type)) {
    return { kind: 'quotation', includeInTaxPreview: false, reason: 'quotations_are_not_sales' };
  }
  if (isPosSaleInvoiceType(doc.invoice_type)) {
    return { kind: 'pos_slip', includeInTaxPreview: false, reason: 'pos_slip_is_not_a_second_sale' };
  }
  if (isReceivableInvoiceType(doc.invoice_type) && doc.source === 'WHOLESALE') {
    return { kind: 'wholesale_invoice', includeInTaxPreview: true, reason: 'wholesale_invoice' };
  }
  if (isReceivableInvoiceType(doc.invoice_type)) {
    return {
      kind: 'unknown',
      includeInTaxPreview: false,
      reason: 'invoice_source_not_wholesale',
    };
  }
  return { kind: 'unknown', includeInTaxPreview: false, reason: 'unrecognised_invoice_type' };
}

export function classifyPosSale(): SourceDecision {
  return { kind: 'pos_sale', includeInTaxPreview: true, reason: 'pos_sale_is_authoritative' };
}

export function classifyOnlineOrder(): SourceDecision {
  return { kind: 'online_order', includeInTaxPreview: true, reason: 'online_order_is_authoritative' };
}

export function classifyLegacyOrder(): SourceDecision {
  return { kind: 'legacy_order', includeInTaxPreview: false, reason: 'legacy_order_has_no_tax_snapshot' };
}

export function classifyReceipt(): SourceDecision {
  return { kind: 'receipt', includeInTaxPreview: false, reason: 'receipts_are_not_sales' };
}
