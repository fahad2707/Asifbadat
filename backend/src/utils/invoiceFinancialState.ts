/**
 * Task 07B-02 — canonical invoice financial state.
 *
 * Composes existing helpers:
 *   - remainingInvoiceBalance / paymentStatusForAmounts (money rounding)
 *   - isReceivableInvoiceType / isOverdueReceivable (Task 05 document boundary)
 *
 * balance_due is derived and must never be persisted.
 */

import {
  DOCUMENT_TYPE_INVOICE,
  isOverdueReceivable,
  isReceivableInvoiceType,
} from './documentType';
import {
  formatMoney,
  PaymentApplicationError,
  paymentStatusForAmounts,
  remainingInvoiceBalance,
  roundMoney,
} from '../services/paymentApplication';

export type DerivedInvoicePaymentStatus = 'paid' | 'unpaid';

export type InvoiceFinancialInput = {
  invoice_type?: unknown;
  total_amount?: unknown;
  amount_paid?: unknown;
  due_date?: unknown;
};

export interface InvoiceFinancialState {
  total: number;
  amount_paid: number;
  balance_due: number;
  payment_status: DerivedInvoicePaymentStatus;
  overdue: boolean;
}

export function invoiceFinancialState(
  doc: InvoiceFinancialInput,
  now: Date = new Date()
): InvoiceFinancialState {
  const total = roundMoney(doc.total_amount);
  const amount_paid = roundMoney(doc.amount_paid);
  const balance_due = remainingInvoiceBalance(total, amount_paid);
  const payment_status = paymentStatusForAmounts(total, amount_paid);
  const overdue = isReceivableInvoiceType(doc.invoice_type) && isOverdueReceivable(doc, now);

  return { total, amount_paid, balance_due, payment_status, overdue };
}

/**
 * Mongo find() match for GET /invoices?unpaid_only=true.
 * Uses $expr so amount_paid is compared to total_amount (not a string literal).
 * Rounding matches roundMoney(..., 2). Quotations are excluded.
 */
export const derivedUnpaidReceivableMatch = {
  invoice_type: DOCUMENT_TYPE_INVOICE,
  $expr: {
    $lt: [
      { $round: [{ $ifNull: ['$amount_paid', 0] }, 2] },
      { $round: [{ $ifNull: ['$total_amount', 0] }, 2] },
    ],
  },
} as const;

/** Same derived unpaid rule as invoiceFinancialState, for list-filter tests. */
export function isUnpaidOnlyListEligible(doc: InvoiceFinancialInput): boolean {
  return isReceivableInvoiceType(doc.invoice_type)
    && invoiceFinancialState(doc).payment_status === 'unpaid';
}

/**
 * PUT /invoices/:id — receivable invoices cannot be edited into amount_paid > total.
 * Quotations are not AR; they skip this guard.
 * Does not write amount_paid. payment_status is derived from the proposed amounts.
 */
export function assertReceivableInvoiceEdit(doc: InvoiceFinancialInput): InvoiceFinancialState {
  const state = invoiceFinancialState(doc);
  if (isReceivableInvoiceType(doc.invoice_type) && state.amount_paid > state.total) {
    throw new PaymentApplicationError(
      `Cannot update invoice total below the amount already paid. Amount paid: ${formatMoney(state.amount_paid)}. New total: ${formatMoney(state.total)}.`
    );
  }
  return state;
}
