/**
 * Task 06 — payment application source of truth.
 *
 * One path applies money to an invoice:
 *   Receipt (journal) → Invoice.amount_paid → remaining balance
 *
 * Invoice.amount_paid is a cache. It must never increase without a Receipt.
 * A Receipt that names an invoice payment must go through this service.
 *
 * POS still bypasses this path (Task 07). Historical rows are not migrated.
 */

import mongoose from 'mongoose';
import Invoice from '../models/Invoice';
import Receipt from '../models/Receipt';
import {
  isQuotationType,
  isReceivableInvoiceType,
  quotationPaymentRejection,
} from '../utils/documentType';

export class PaymentApplicationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PaymentApplicationError';
    this.status = status;
  }
}

export function roundMoney(n: unknown): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function remainingInvoiceBalance(totalAmount: unknown, amountPaid: unknown): number {
  return roundMoney(roundMoney(totalAmount) - roundMoney(amountPaid));
}

export function paymentStatusForAmounts(totalAmount: unknown, amountPaid: unknown): 'paid' | 'unpaid' {
  return remainingInvoiceBalance(totalAmount, amountPaid) <= 0 ? 'paid' : 'unpaid';
}

export function formatMoney(n: number): string {
  return `$${roundMoney(n).toFixed(2)}`;
}

/** Shared amount rules. Throws PaymentApplicationError on invalid / overpay. */
export function validatePaymentAmount(amount: unknown, remaining: number): number {
  const payment = roundMoney(amount);
  if (!(payment > 0)) {
    throw new PaymentApplicationError('Payment amount must be greater than zero.');
  }
  if (payment > remaining) {
    throw new PaymentApplicationError(
      `Payment amount exceeds the remaining invoice balance. Remaining balance: ${formatMoney(remaining)}. Attempted payment: ${formatMoney(payment)}.`
    );
  }
  return payment;
}

export function generateReceiptTrxId(): string {
  return 'RT' + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).substring(2, 5).toUpperCase();
}

export interface InvoiceSnapshot {
  id: string;
  invoice_number: string;
  invoice_type?: string;
  total_amount: number;
  amount_paid: number;
  payment_status: string;
  customer_id?: string;
  customer_name?: string;
}

export interface ReceiptSnapshot {
  id: string;
  trx_id: string;
  amount_received: number;
  invoice_num?: string;
}

export interface ApplyPaymentInput {
  invoiceId?: string;
  invoiceNumber?: string;
  amount: number;
  paymentDate?: Date;
  paymentMethod?: string;
  bankAccountId?: string;
  trxId?: string;
  customerName?: string;
}

export interface AppliedPayment {
  invoice_id: string;
  invoice_number: string;
  amount_applied: number;
  amount_paid: number;
  remaining_balance: number;
  payment_status: string;
  receipt: ReceiptSnapshot;
}

export interface CustomerPaymentInput {
  allocations: { invoice_id: string; amount: number }[];
  amount_received?: number;
  payment_date?: Date;
  payment_method?: string;
  bank_account_id?: string;
  trx_id?: string;
}

export interface PaymentApplicationStore {
  findInvoiceById(id: string): Promise<InvoiceSnapshot | null>;
  findInvoiceByNumber(num: string): Promise<InvoiceSnapshot | null>;
  findReceiptByTrxId(trxId: string): Promise<{ trx_id: string } | null>;
  applyInvoicePayment(invoiceId: string, amount: number, paymentStatus: 'paid' | 'unpaid'): Promise<InvoiceSnapshot | null>;
  createReceipt(doc: {
    trx_id: string;
    trx_date: Date;
    customer_id?: string;
    customer_name: string;
    bank_account_id?: string;
    invoice_num: string;
    pmt_mode: string;
    amount_received: number;
  }): Promise<ReceiptSnapshot>;
  deleteReceiptById(id: string): Promise<void>;
}

function toInvoiceSnapshot(doc: any): InvoiceSnapshot {
  return {
    id: doc._id.toString(),
    invoice_number: doc.invoice_number,
    invoice_type: doc.invoice_type,
    total_amount: Number(doc.total_amount) || 0,
    amount_paid: Number(doc.amount_paid) || 0,
    payment_status: doc.payment_status || 'unpaid',
    customer_id: doc.customer_id ? String(doc.customer_id) : undefined,
    customer_name: doc.customer_name || undefined,
  };
}

export const mongoosePaymentStore: PaymentApplicationStore = {
  async findInvoiceById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await Invoice.findById(id).lean();
    return doc ? toInvoiceSnapshot(doc) : null;
  },
  async findInvoiceByNumber(num) {
    const doc = await Invoice.findOne({ invoice_number: num }).lean();
    return doc ? toInvoiceSnapshot(doc) : null;
  },
  async findReceiptByTrxId(trxId) {
    const doc = await Receipt.findOne({ trx_id: trxId }).select('trx_id').lean();
    return doc ? { trx_id: (doc as any).trx_id } : null;
  },
  async applyInvoicePayment(invoiceId, amount, paymentStatus) {
    const updated = await Invoice.findOneAndUpdate(
      {
        _id: invoiceId,
        $expr: {
          $lte: [
            amount,
            { $subtract: [{ $ifNull: ['$total_amount', 0] }, { $ifNull: ['$amount_paid', 0] }] },
          ],
        },
      },
      { $inc: { amount_paid: amount }, $set: { payment_status: paymentStatus } },
      { new: true }
    ).lean();
    return updated ? toInvoiceSnapshot(updated) : null;
  },
  async createReceipt(doc) {
    const created = await Receipt.create({
      trx_id: doc.trx_id,
      trx_date: doc.trx_date,
      customer_id: doc.customer_id || undefined,
      customer_name: doc.customer_name,
      invoice_num: doc.invoice_num,
      pmt_mode: doc.pmt_mode,
      amount_received: doc.amount_received,
      ...(doc.bank_account_id && mongoose.Types.ObjectId.isValid(doc.bank_account_id)
        ? { bank_account_id: doc.bank_account_id }
        : {}),
    });
    const r = created.toObject() as any;
    return {
      id: r._id.toString(),
      trx_id: r.trx_id,
      amount_received: r.amount_received,
      invoice_num: r.invoice_num,
    };
  },
  async deleteReceiptById(id) {
    await Receipt.findByIdAndDelete(id);
  },
};

function assertPayableInvoice(invoice: InvoiceSnapshot) {
  if (isQuotationType(invoice.invoice_type)) {
    throw new PaymentApplicationError(quotationPaymentRejection([invoice.invoice_number]).error);
  }
  if (!isReceivableInvoiceType(invoice.invoice_type)) {
    throw new PaymentApplicationError(
      `Only invoices can receive payment: ${invoice.invoice_number}`
    );
  }
}

export function createPaymentApplicationService(store: PaymentApplicationStore) {
  async function loadInvoice(input: ApplyPaymentInput): Promise<InvoiceSnapshot> {
    const invoice = input.invoiceId
      ? await store.findInvoiceById(input.invoiceId)
      : input.invoiceNumber
        ? await store.findInvoiceByNumber(String(input.invoiceNumber).trim())
        : null;
    if (!invoice) {
      throw new PaymentApplicationError('Invoice not found', 404);
    }
    return invoice;
  }

  /**
   * Apply one payment to one invoice.
   * Receipt is written first; amount_paid increases only after the journal exists.
   * If the invoice update fails, the Receipt is removed so the two cannot diverge.
   */
  async function applyPaymentToInvoice(input: ApplyPaymentInput): Promise<AppliedPayment> {
    const invoice = await loadInvoice(input);
    assertPayableInvoice(invoice);

    const remaining = remainingInvoiceBalance(invoice.total_amount, invoice.amount_paid);
    const amount = validatePaymentAmount(input.amount, remaining);

    const trxId = (input.trxId && String(input.trxId).trim()) || generateReceiptTrxId();
    if (input.trxId && String(input.trxId).trim()) {
      const existing = await store.findReceiptByTrxId(trxId);
      if (existing) {
        throw new PaymentApplicationError(`Receipt ${trxId} already exists.`, 409);
      }
    }

    const receipt = await store.createReceipt({
      trx_id: trxId,
      trx_date: input.paymentDate instanceof Date && !Number.isNaN(input.paymentDate.getTime())
        ? input.paymentDate
        : new Date(),
      customer_id: invoice.customer_id,
      customer_name: input.customerName || invoice.customer_name || 'Customer',
      bank_account_id: input.bankAccountId,
      invoice_num: invoice.invoice_number,
      pmt_mode: input.paymentMethod || 'Other',
      amount_received: amount,
    });

    const nextPaid = roundMoney(invoice.amount_paid + amount);
    const paymentStatus = paymentStatusForAmounts(invoice.total_amount, nextPaid);

    let updated: InvoiceSnapshot | null = null;
    try {
      updated = await store.applyInvoicePayment(invoice.id, amount, paymentStatus);
    } catch (err) {
      await store.deleteReceiptById(receipt.id);
      throw err;
    }

    if (!updated) {
      await store.deleteReceiptById(receipt.id);
      throw new PaymentApplicationError(
        `Payment amount exceeds the remaining invoice balance. Remaining balance: ${formatMoney(remaining)}. Attempted payment: ${formatMoney(amount)}.`
      );
    }

    return {
      invoice_id: updated.id,
      invoice_number: updated.invoice_number,
      amount_applied: amount,
      amount_paid: roundMoney(updated.amount_paid),
      remaining_balance: remainingInvoiceBalance(updated.total_amount, updated.amount_paid),
      payment_status: updated.payment_status,
      receipt,
    };
  }

  /**
   * Receive-payment batch: validate every allocation first, then apply each
   * through applyPaymentToInvoice. Zero-amount rows are ignored (UI sends them).
   * Any invalid allocation rejects the request with no writes.
   */
  async function applyCustomerPayment(input: CustomerPaymentInput): Promise<{
    applications: AppliedPayment[];
    trx_ids: string[];
  }> {
    if (!input.allocations || !Array.isArray(input.allocations) || input.allocations.length === 0) {
      throw new PaymentApplicationError('allocations (invoice_id, amount) required');
    }

    const positive: { invoice_id: string; amount: number }[] = [];
    for (const row of input.allocations) {
      const raw = Number(row?.amount);
      if (raw < 0) {
        throw new PaymentApplicationError('Payment amount must be greater than zero.');
      }
      if (!(raw > 0)) continue;
      if (!row.invoice_id || typeof row.invoice_id !== 'string') {
        throw new PaymentApplicationError('allocations (invoice_id, amount) required');
      }
      positive.push({ invoice_id: row.invoice_id, amount: raw });
    }
    if (positive.length === 0) {
      throw new PaymentApplicationError('Payment amount must be greater than zero.');
    }

    const quoted: string[] = [];
    for (const row of positive) {
      const invoice = await store.findInvoiceById(row.invoice_id);
      if (!invoice) {
        throw new PaymentApplicationError('Invoice not found', 404);
      }
      if (isQuotationType(invoice.invoice_type)) {
        quoted.push(invoice.invoice_number);
        continue;
      }
      if (!isReceivableInvoiceType(invoice.invoice_type)) {
        throw new PaymentApplicationError(`Only invoices can receive payment: ${invoice.invoice_number}`);
      }
      const remaining = remainingInvoiceBalance(invoice.total_amount, invoice.amount_paid);
      validatePaymentAmount(row.amount, remaining);
    }
    if (quoted.length > 0) {
      throw new PaymentApplicationError(quotationPaymentRejection(quoted).error);
    }

    const totalAlloc = roundMoney(positive.reduce((s, a) => s + roundMoney(a.amount), 0));
    if (input.amount_received != null && input.amount_received !== undefined && String(input.amount_received) !== '') {
      const received = roundMoney(input.amount_received);
      if (received > 0 && Math.abs(received - totalAlloc) > 0.009) {
        throw new PaymentApplicationError(
          `Amount received ${formatMoney(received)} does not match allocated total ${formatMoney(totalAlloc)}.`
        );
      }
    }

    const applications: AppliedPayment[] = [];
    for (const row of positive) {
      applications.push(
        await applyPaymentToInvoice({
          invoiceId: row.invoice_id,
          amount: row.amount,
          paymentDate: input.payment_date,
          paymentMethod: input.payment_method,
          bankAccountId: input.bank_account_id,
          trxId: positive.length === 1 ? input.trx_id : undefined,
        })
      );
    }

    return {
      applications,
      trx_ids: applications.map((a) => a.receipt.trx_id),
    };
  }

  return { applyPaymentToInvoice, applyCustomerPayment };
}

export const paymentApplication = createPaymentApplicationService(mongoosePaymentStore);

export function httpErrorFromPayment(err: unknown): { status: number; body: { error: string } } | null {
  if (err instanceof PaymentApplicationError) {
    return { status: err.status, body: { error: err.message } };
  }
  return null;
}
