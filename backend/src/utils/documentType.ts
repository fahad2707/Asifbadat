/**
 * Task 05 — document-type boundary.
 *
 * Quotations and invoices share the `invoices` collection. These helpers
 * make the distinction explicit so quotations cannot be treated as sales,
 * AR, inventory movements, or payment obligations.
 */

export const DOCUMENT_TYPE_INVOICE = 'invoice';
export const DOCUMENT_TYPE_QUOTATION = 'quotation';
/** POS/retail slips stored in the invoices collection. Not AR. */
export const POS_SALE_INVOICE_TYPES = ['pos', 'website', 'store_pickup'] as const;
export type PosSaleInvoiceType = (typeof POS_SALE_INVOICE_TYPES)[number];

export type DocumentTypeField = { invoice_type?: unknown };

export function isQuotationType(type: unknown): boolean {
  return type === DOCUMENT_TYPE_QUOTATION;
}

/** Only this type participates in AR / overdue / payment application. */
export function isReceivableInvoiceType(type: unknown): boolean {
  return type === DOCUMENT_TYPE_INVOICE;
}

/** POS checkout slips. Financially represented by POSSale, not the Invoice row. */
export function isPosSaleInvoiceType(type: unknown): boolean {
  return (POS_SALE_INVOICE_TYPES as readonly string[]).includes(String(type));
}

/** Inventory moves only for true invoices, never quotations. */
export function shouldAdjustInventoryForDocumentType(type: unknown): boolean {
  return isReceivableInvoiceType(type);
}

/** Mongo match: documents that may contribute to customer AR. */
export const receivableInvoiceMatch = { invoice_type: DOCUMENT_TYPE_INVOICE } as const;

/** Mongo match: Invoice rows that may count toward sales/revenue. */
export const nonQuotationMatch = { invoice_type: { $ne: DOCUMENT_TYPE_QUOTATION } } as const;

/** Wholesale invoice rows for dashboard revenue/COGS. Excludes quotations and POS slips. */
export const dashboardWholesaleInvoiceMatch = {
  invoice_type: DOCUMENT_TYPE_INVOICE,
} as const;

export function openDocumentBalance(totalAmount: unknown, amountPaid: unknown): number {
  return (Number(totalAmount) || 0) - (Number(amountPaid) || 0);
}

/** Open AR for one document. Quotations always contribute 0. */
export function receivableOpenBalance(doc: DocumentTypeField & {
  total_amount?: unknown;
  amount_paid?: unknown;
}): number {
  if (!isReceivableInvoiceType(doc.invoice_type)) return 0;
  const bal = openDocumentBalance(doc.total_amount, doc.amount_paid);
  return bal > 0 ? bal : 0;
}

export function isOverdueReceivable(
  doc: DocumentTypeField & { total_amount?: unknown; amount_paid?: unknown; due_date?: unknown },
  now: Date
): boolean {
  if (!isReceivableInvoiceType(doc.invoice_type)) return false;
  if (!doc.due_date) return false;
  const due = doc.due_date instanceof Date ? doc.due_date : new Date(String(doc.due_date));
  if (Number.isNaN(due.getTime())) return false;
  return due < now && openDocumentBalance(doc.total_amount, doc.amount_paid) > 0;
}

/** Sales/revenue contribution from an Invoice document. Quotations and POS slips are 0. */
export function saleAmountFromInvoiceDocument(doc: DocumentTypeField & { total_amount?: unknown }): number {
  if (isQuotationType(doc.invoice_type) || isPosSaleInvoiceType(doc.invoice_type)) return 0;
  return Number(doc.total_amount) || 0;
}

export function quotationPaymentRejection(quotationNumbers: string[]) {
  const listed = quotationNumbers.filter(Boolean).join(', ');
  return {
    error: listed
      ? `Quotations cannot receive payment: ${listed}`
      : 'Quotations cannot receive payment',
  };
}
