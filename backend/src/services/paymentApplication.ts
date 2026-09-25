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
  pmt_mode?: string;
  customer_name?: string;
}

/** Invoice-applied iff invoice_num is a non-empty string. Schema has no invoice_id. */
export function isInvoiceAppliedReceipt(receipt: { invoice_num?: unknown }): boolean {
  return Boolean(String(receipt.invoice_num ?? '').trim());
}

export function receiptInvoiceNumber(receipt: { invoice_num?: unknown }): string {
  return String(receipt.invoice_num ?? '').trim();
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
  notes?: string;
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
  notes?: string;
}

export interface ReceiptPatch {
  amount_received?: number;
  invoice_num?: string;
  trx_id?: string;
  trx_date?: Date;
  customer_name?: string;
  pmt_mode?: string;
  bank_account_id?: string | null;
  customer_id?: string | null;
  state?: string;
  city?: string;
  so_id?: string;
  so_balance?: number;
}

export interface PaymentApplicationStore {
  findInvoiceById(id: string): Promise<InvoiceSnapshot | null>;
  findInvoiceByNumber(num: string): Promise<InvoiceSnapshot | null>;
  findReceiptById(id: string): Promise<ReceiptSnapshot | null>;
  findReceiptByTrxId(trxId: string): Promise<{ trx_id: string } | null>;
  applyInvoicePayment(invoiceId: string, amount: number, paymentStatus: 'paid' | 'unpaid'): Promise<InvoiceSnapshot | null>;
  adjustInvoicePaid(invoiceId: string, delta: number, paymentStatus: 'paid' | 'unpaid'): Promise<InvoiceSnapshot | null>;
  createReceipt(doc: {
    trx_id: string;
    trx_date: Date;
    customer_id?: string;
    customer_name: string;
    bank_account_id?: string;
    invoice_num: string;
    pmt_mode: string;
    amount_received: number;
    so_id?: string;
  }): Promise<ReceiptSnapshot>;
  updateReceipt(id: string, patch: ReceiptPatch): Promise<ReceiptSnapshot | null>;
  deleteReceiptById(id: string): Promise<boolean>;
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

function toReceiptSnapshot(doc: any): ReceiptSnapshot {
  return {
    id: doc._id.toString(),
    trx_id: doc.trx_id,
    amount_received: Number(doc.amount_received) || 0,
    invoice_num: doc.invoice_num || '',
    pmt_mode: doc.pmt_mode,
    customer_name: doc.customer_name,
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
  async findReceiptById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await Receipt.findById(id).lean();
    return doc ? toReceiptSnapshot(doc) : null;
  },
  async findReceiptByTrxId(trxId) {
    const doc = await Receipt.findOne({ trx_id: trxId }).select('trx_id').lean();
    return doc ? { trx_id: (doc as any).trx_id } : null;
  },
  async applyInvoicePayment(invoiceId, amount, paymentStatus) {
    return mongoosePaymentStore.adjustInvoicePaid(invoiceId, amount, paymentStatus);
  },
  async adjustInvoicePaid(invoiceId, delta, paymentStatus) {
    const updated = await Invoice.findOneAndUpdate(
      {
        _id: invoiceId,
        $expr: {
          $and: [
            { $gte: [{ $add: [{ $ifNull: ['$amount_paid', 0] }, delta] }, 0] },
            {
              $lte: [
                { $add: [{ $ifNull: ['$amount_paid', 0] }, delta] },
                { $ifNull: ['$total_amount', 0] },
              ],
            },
          ],
        },
      },
      { $inc: { amount_paid: delta }, $set: { payment_status: paymentStatus } },
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
      ...(doc.so_id ? { so_id: doc.so_id } : {}),
      ...(doc.bank_account_id && mongoose.Types.ObjectId.isValid(doc.bank_account_id)
        ? { bank_account_id: doc.bank_account_id, state: 'deposited', city: doc.trx_date.toISOString() }
        : { state: 'pending' }),
    });
    const r = created.toObject() as any;
    return toReceiptSnapshot(r);
  },
  async updateReceipt(id, patch) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const $set: Record<string, unknown> = {};
    if (patch.amount_received !== undefined) $set.amount_received = patch.amount_received;
    if (patch.invoice_num !== undefined) $set.invoice_num = patch.invoice_num;
    if (patch.trx_id !== undefined) $set.trx_id = patch.trx_id;
    if (patch.trx_date !== undefined) $set.trx_date = patch.trx_date;
    if (patch.customer_name !== undefined) $set.customer_name = patch.customer_name;
    if (patch.pmt_mode !== undefined) $set.pmt_mode = patch.pmt_mode;
    if (patch.bank_account_id !== undefined) {
      $set.bank_account_id =
        patch.bank_account_id && mongoose.Types.ObjectId.isValid(patch.bank_account_id)
          ? patch.bank_account_id
          : null;
    }
    if (patch.customer_id !== undefined) {
      $set.customer_id =
        patch.customer_id && mongoose.Types.ObjectId.isValid(patch.customer_id) ? patch.customer_id : null;
    }
    if (patch.state !== undefined) $set.state = patch.state;
    if (patch.city !== undefined) $set.city = patch.city;
    if (patch.so_id !== undefined) $set.so_id = patch.so_id;
    if (patch.so_balance !== undefined) $set.so_balance = patch.so_balance;
    const updated = await Receipt.findByIdAndUpdate(id, { $set }, { new: true }).lean();
    return updated ? toReceiptSnapshot(updated) : null;
  },
  async deleteReceiptById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return false;
    const deleted = await Receipt.findByIdAndDelete(id);
    return Boolean(deleted);
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

    const note = input.notes ? String(input.notes).trim() : '';
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
      ...(note ? { so_id: note } : {}),
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
          notes: input.notes,
        })
      );
    }

    return {
      applications,
      trx_ids: applications.map((a) => a.receipt.trx_id),
    };
  }

  async function loadAppliedInvoice(receipt: ReceiptSnapshot): Promise<InvoiceSnapshot> {
    const number = receiptInvoiceNumber(receipt);
    const invoice = await store.findInvoiceByNumber(number);
    if (!invoice) {
      throw new PaymentApplicationError(
        `Cannot modify an invoice-applied receipt without updating its invoice payment. Invoice ${number} was not found.`,
        400
      );
    }
    if (isQuotationType(invoice.invoice_type)) {
      throw new PaymentApplicationError(quotationPaymentRejection([invoice.invoice_number]).error);
    }
    if (!isReceivableInvoiceType(invoice.invoice_type)) {
      throw new PaymentApplicationError(`Only invoices can receive payment: ${invoice.invoice_number}`);
    }
    return invoice;
  }

  function rejectReassignment(currentNum: string, nextRef?: string) {
    if (nextRef === undefined) return;
    const next = String(nextRef).trim();
    if (next !== currentNum) {
      throw new PaymentApplicationError('Cannot reassign an invoice payment receipt to another invoice.');
    }
  }

  function nonFinancialPatch(patch: ReceiptPatch): ReceiptPatch {
    const out: ReceiptPatch = {};
    if (patch.trx_date !== undefined) out.trx_date = patch.trx_date;
    if (patch.trx_id !== undefined) out.trx_id = patch.trx_id;
    if (patch.customer_name !== undefined) out.customer_name = patch.customer_name;
    if (patch.pmt_mode !== undefined) out.pmt_mode = patch.pmt_mode;
    if (patch.bank_account_id !== undefined) out.bank_account_id = patch.bank_account_id;
    if (patch.customer_id !== undefined) out.customer_id = patch.customer_id;
    if (patch.state !== undefined) out.state = patch.state;
    if (patch.city !== undefined) out.city = patch.city;
    if (patch.so_id !== undefined) out.so_id = patch.so_id;
    if (patch.so_balance !== undefined) out.so_balance = patch.so_balance;
    return out;
  }

  /**
   * PUT /receipts/:id
   * Standalone receipts update in place (no invoice writes).
   * Invoice-applied receipts adjust Invoice.amount_paid by the amount delta.
   * Reassignment of invoice_num is rejected.
   */
  async function updateReceiptLifecycle(receiptId: string, patch: ReceiptPatch): Promise<{
    receipt: ReceiptSnapshot;
    invoice?: InvoiceSnapshot;
  }> {
    const receipt = await store.findReceiptById(receiptId);
    if (!receipt) {
      throw new PaymentApplicationError('Receipt not found', 404);
    }

    const incomingInvoiceRef =
      patch.invoice_num !== undefined ? String(patch.invoice_num).trim() : undefined;

    if (!isInvoiceAppliedReceipt(receipt)) {
      if (incomingInvoiceRef) {
        throw new PaymentApplicationError('Cannot reassign an invoice payment receipt to another invoice.');
      }
      const updated = await store.updateReceipt(receiptId, {
        ...nonFinancialPatch(patch),
        ...(patch.amount_received !== undefined ? { amount_received: roundMoney(patch.amount_received) } : {}),
        invoice_num: '',
      });
      if (!updated) {
        throw new PaymentApplicationError('Receipt not found', 404);
      }
      return { receipt: updated };
    }

    rejectReassignment(receiptInvoiceNumber(receipt), incomingInvoiceRef);

    const invoice = await loadAppliedInvoice(receipt);
    const cosmetic = nonFinancialPatch(patch);

    if (patch.amount_received === undefined) {
      const updated = await store.updateReceipt(receiptId, cosmetic);
      if (!updated) {
        throw new PaymentApplicationError('Receipt not found', 404);
      }
      return { receipt: updated, invoice };
    }

    const newAmount = roundMoney(patch.amount_received);
    if (!(newAmount > 0)) {
      throw new PaymentApplicationError('Payment amount must be greater than zero.');
    }

    const oldAmount = roundMoney(receipt.amount_received);
    const delta = roundMoney(newAmount - oldAmount);
    if (delta === 0) {
      const updated = await store.updateReceipt(receiptId, { ...cosmetic, amount_received: newAmount });
      if (!updated) {
        throw new PaymentApplicationError('Receipt not found', 404);
      }
      return { receipt: updated, invoice };
    }

    const nextPaid = roundMoney(invoice.amount_paid + delta);
    if (nextPaid < 0) {
      throw new PaymentApplicationError(
        `Cannot modify an invoice-applied receipt without updating its invoice payment. Invoice amount_paid cannot be negative.`
      );
    }
    if (nextPaid > roundMoney(invoice.total_amount)) {
      throw new PaymentApplicationError(
        `Payment amount exceeds the remaining invoice balance. Remaining balance: ${formatMoney(remainingInvoiceBalance(invoice.total_amount, invoice.amount_paid))}. Attempted payment: ${formatMoney(newAmount)}.`
      );
    }

    const paymentStatus = paymentStatusForAmounts(invoice.total_amount, nextPaid);
    const adjusted = await store.adjustInvoicePaid(invoice.id, delta, paymentStatus);
    if (!adjusted) {
      throw new PaymentApplicationError(
        'Cannot modify an invoice-applied receipt without updating its invoice payment.'
      );
    }

    let updatedReceipt: ReceiptSnapshot | null = null;
    try {
      updatedReceipt = await store.updateReceipt(receiptId, {
        ...cosmetic,
        amount_received: newAmount,
        invoice_num: receiptInvoiceNumber(receipt),
      });
    } catch (err) {
      await store.adjustInvoicePaid(invoice.id, -delta, paymentStatusForAmounts(invoice.total_amount, invoice.amount_paid));
      throw err;
    }

    if (!updatedReceipt) {
      await store.adjustInvoicePaid(invoice.id, -delta, paymentStatusForAmounts(invoice.total_amount, invoice.amount_paid));
      throw new PaymentApplicationError('Receipt not found', 404);
    }

    return { receipt: updatedReceipt, invoice: adjusted };
  }

  /**
   * DELETE /receipts/:id
   * Standalone: delete only.
   * Invoice-applied: reverse amount_paid, then delete. If delete fails, re-apply the amount.
   */
  async function deleteReceiptLifecycle(receiptId: string): Promise<{ deleted: true; invoice?: InvoiceSnapshot }> {
    const receipt = await store.findReceiptById(receiptId);
    if (!receipt) {
      throw new PaymentApplicationError('Receipt not found', 404);
    }

    if (!isInvoiceAppliedReceipt(receipt)) {
      const deleted = await store.deleteReceiptById(receiptId);
      if (!deleted) {
        throw new PaymentApplicationError('Receipt not found', 404);
      }
      return { deleted: true };
    }

    const invoice = await loadAppliedInvoice(receipt);
    const amount = roundMoney(receipt.amount_received);
    if (roundMoney(invoice.amount_paid) < amount) {
      throw new PaymentApplicationError(
        'Cannot modify an invoice-applied receipt without updating its invoice payment. Invoice amount_paid is less than this receipt.'
      );
    }

    const nextPaid = roundMoney(invoice.amount_paid - amount);
    const paymentStatus = paymentStatusForAmounts(invoice.total_amount, nextPaid);
    const adjusted = await store.adjustInvoicePaid(invoice.id, -amount, paymentStatus);
    if (!adjusted) {
      throw new PaymentApplicationError(
        'Cannot modify an invoice-applied receipt without updating its invoice payment.'
      );
    }

    let deleted = false;
    try {
      deleted = await store.deleteReceiptById(receiptId);
    } catch (err) {
      await store.adjustInvoicePaid(invoice.id, amount, paymentStatusForAmounts(invoice.total_amount, invoice.amount_paid));
      throw err;
    }

    if (!deleted) {
      await store.adjustInvoicePaid(invoice.id, amount, paymentStatusForAmounts(invoice.total_amount, invoice.amount_paid));
      throw new PaymentApplicationError('Receipt not found', 404);
    }

    return { deleted: true, invoice: adjusted };
  }

  return {
    applyPaymentToInvoice,
    applyCustomerPayment,
    updateReceiptLifecycle,
    deleteReceiptLifecycle,
  };
}

export const paymentApplication = createPaymentApplicationService(mongoosePaymentStore);

export function httpErrorFromPayment(err: unknown): { status: number; body: { error: string } } | null {
  if (err instanceof PaymentApplicationError) {
    return { status: err.status, body: { error: err.message } };
  }
  return null;
}
