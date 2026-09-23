/**
 * Task 07A — Receipt lifecycle financial consistency.
 *
 * Run with:
 *     npx tsx --test src/services/receiptLifecycle.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PaymentApplicationError,
  createPaymentApplicationService,
  isInvoiceAppliedReceipt,
  remainingInvoiceBalance,
  type InvoiceSnapshot,
  type PaymentApplicationStore,
  type ReceiptSnapshot,
} from './paymentApplication';

function memoryStore(seedInvoices: InvoiceSnapshot[], seedReceipts: ReceiptSnapshot[] = []) {
  const invoices = new Map(seedInvoices.map((i) => [i.id, { ...i }]));
  const receipts: ReceiptSnapshot[] = seedReceipts.map((r) => ({ ...r }));
  let receiptSeq = seedReceipts.length;
  let failNextAdjust = false;
  let failNextReceiptWrite = false;
  let failNextDelete = false;

  const store: PaymentApplicationStore & {
    invoices: Map<string, InvoiceSnapshot>;
    receipts: ReceiptSnapshot[];
    failNextAdjustOnce(): void;
    failNextReceiptWriteOnce(): void;
    failNextDeleteOnce(): void;
  } = {
    invoices,
    receipts,
    failNextAdjustOnce() {
      failNextAdjust = true;
    },
    failNextReceiptWriteOnce() {
      failNextReceiptWrite = true;
    },
    failNextDeleteOnce() {
      failNextDelete = true;
    },
    async findInvoiceById(id) {
      const inv = invoices.get(id);
      return inv ? { ...inv } : null;
    },
    async findInvoiceByNumber(num) {
      for (const inv of invoices.values()) {
        if (inv.invoice_number === num) return { ...inv };
      }
      return null;
    },
    async findReceiptById(id) {
      const r = receipts.find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async findReceiptByTrxId(trxId) {
      return receipts.find((r) => r.trx_id === trxId) || null;
    },
    async applyInvoicePayment(invoiceId, amount, paymentStatus) {
      return store.adjustInvoicePaid(invoiceId, amount, paymentStatus);
    },
    async adjustInvoicePaid(invoiceId, delta, paymentStatus) {
      if (failNextAdjust) {
        failNextAdjust = false;
        return null;
      }
      const inv = invoices.get(invoiceId);
      if (!inv) return null;
      const next = Math.round((inv.amount_paid + delta) * 100) / 100;
      if (next < 0 || next > remainingInvoiceBalance(inv.total_amount, 0)) return null;
      inv.amount_paid = next;
      inv.payment_status = paymentStatus;
      return { ...inv };
    },
    async createReceipt(doc) {
      if (failNextReceiptWrite) {
        failNextReceiptWrite = false;
        throw new Error('receipt write failed');
      }
      receiptSeq += 1;
      const receipt: ReceiptSnapshot = {
        id: `r${receiptSeq}`,
        trx_id: doc.trx_id,
        amount_received: doc.amount_received,
        invoice_num: doc.invoice_num,
      };
      receipts.push(receipt);
      return { ...receipt };
    },
    async updateReceipt(id, patch) {
      if (failNextReceiptWrite) {
        failNextReceiptWrite = false;
        return null;
      }
      const receipt = receipts.find((r) => r.id === id);
      if (!receipt) return null;
      if (patch.amount_received !== undefined) receipt.amount_received = patch.amount_received;
      if (patch.invoice_num !== undefined) receipt.invoice_num = patch.invoice_num;
      return { ...receipt };
    },
    async deleteReceiptById(id) {
      if (failNextDelete) {
        failNextDelete = false;
        return false;
      }
      const idx = receipts.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      receipts.splice(idx, 1);
      return true;
    },
  };

  return store;
}

const invoice: InvoiceSnapshot = {
  id: 'inv1',
  invoice_number: 'INV#T07',
  invoice_type: 'invoice',
  total_amount: 500,
  amount_paid: 0,
  payment_status: 'unpaid',
  customer_name: 'Test Customer',
};

const quotation: InvoiceSnapshot = {
  id: 'qtn1',
  invoice_number: 'QTN#002',
  invoice_type: 'quotation',
  total_amount: 16.99,
  amount_paid: 0,
  payment_status: 'unpaid',
};

test('standalone Receipt can still be created', () => {
  const receipts = readFileSync(join(process.cwd(), 'src/routes/receipts.ts'), 'utf8');
  assert.match(receipts, /A receipt with no invoice reference remains a standalone bank record/);
  assert.match(receipts, /invoice_num: ''/);
  assert.equal(isInvoiceAppliedReceipt({ invoice_num: '' }), false);
  assert.equal(isInvoiceAppliedReceipt({ invoice_num: 'INV#T07' }), true);
});

test('standalone Receipt update does not change invoice amount_paid', async () => {
  const store = memoryStore(
    [{ ...invoice }],
    [{ id: 'rs1', trx_id: 'RTSTAND', amount_received: 40, invoice_num: '' }]
  );
  const svc = createPaymentApplicationService(store);
  const result = await svc.updateReceiptLifecycle('rs1', { amount_received: 55 });
  assert.equal(result.receipt.amount_received, 55);
  assert.equal(store.invoices.get('inv1')?.amount_paid, 0);
  assert.equal(isInvoiceAppliedReceipt(result.receipt), false);
});

test('invoice-applied Receipt updates invoice payment amount', async () => {
  const store = memoryStore([{ ...invoice }]);
  const svc = createPaymentApplicationService(store);
  const applied = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 200 });
  assert.equal(store.invoices.get('inv1')?.amount_paid, 200);
  assert.equal(applied.receipt.invoice_num, 'INV#T07');
  assert.equal(store.receipts[0].amount_received, 200);
});

test('increase invoice-applied Receipt amount', async () => {
  const store = memoryStore([{ ...invoice }]);
  const svc = createPaymentApplicationService(store);
  const applied = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 100 });
  const updated = await svc.updateReceiptLifecycle(applied.receipt.id, { amount_received: 150 });
  assert.equal(updated.receipt.amount_received, 150);
  assert.equal(store.invoices.get('inv1')?.amount_paid, 150);
});

test('decrease invoice-applied Receipt amount', async () => {
  const store = memoryStore([{ ...invoice }]);
  const svc = createPaymentApplicationService(store);
  const applied = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 150 });
  const updated = await svc.updateReceiptLifecycle(applied.receipt.id, { amount_received: 100 });
  assert.equal(updated.receipt.amount_received, 100);
  assert.equal(store.invoices.get('inv1')?.amount_paid, 100);
  assert.equal(store.invoices.get('inv1')?.payment_status, 'unpaid');
});

test('reject update causing invoice overpayment', async () => {
  const store = memoryStore([{ ...invoice }]);
  const svc = createPaymentApplicationService(store);
  const applied = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 100 });
  await assert.rejects(
    () => svc.updateReceiptLifecycle(applied.receipt.id, { amount_received: 600 }),
    (err: unknown) => err instanceof PaymentApplicationError && /exceeds the remaining invoice balance/.test(err.message)
  );
  assert.equal(store.invoices.get('inv1')?.amount_paid, 100);
  assert.equal(store.receipts[0].amount_received, 100);
});

test('reject update causing negative invoice amount_paid', async () => {
  const store = memoryStore(
    [{ ...invoice, amount_paid: 20 }],
    [{ id: 'rhist', trx_id: 'RTHIST', amount_received: 80, invoice_num: 'INV#T07' }]
  );
  const svc = createPaymentApplicationService(store);
  await assert.rejects(
    () => svc.updateReceiptLifecycle('rhist', { amount_received: 10 }),
    (err: unknown) => err instanceof PaymentApplicationError && /cannot be negative/.test(err.message)
  );
  assert.equal(store.invoices.get('inv1')?.amount_paid, 20);
  assert.equal(store.receipts[0].amount_received, 80);
});

test('reject invoice reassignment', async () => {
  const store = memoryStore([
    { ...invoice },
    { ...invoice, id: 'inv2', invoice_number: 'INV#008' },
  ]);
  const svc = createPaymentApplicationService(store);
  const applied = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 50 });
  await assert.rejects(
    () => svc.updateReceiptLifecycle(applied.receipt.id, { invoice_num: 'INV#008' }),
    (err: unknown) => err instanceof PaymentApplicationError && /Cannot reassign/.test(err.message)
  );
  assert.equal(store.receipts[0].invoice_num, 'INV#T07');
  assert.equal(store.invoices.get('inv1')?.amount_paid, 50);
  assert.equal(store.invoices.get('inv2')?.amount_paid, 0);
});

test('reject update against missing invoice', async () => {
  const store = memoryStore(
    [],
    [{ id: 'rorph', trx_id: 'RTORPH', amount_received: 25, invoice_num: 'INV#GONE' }]
  );
  const svc = createPaymentApplicationService(store);
  await assert.rejects(
    () => svc.updateReceiptLifecycle('rorph', { amount_received: 30 }),
    (err: unknown) => err instanceof PaymentApplicationError && /was not found/.test(err.message)
  );
  assert.equal(store.receipts[0].amount_received, 25);
});

test('reject quotation payment Receipt update', async () => {
  const store = memoryStore(
    [{ ...quotation }],
    [{ id: 'rqtn', trx_id: 'RTQTN', amount_received: 16.99, invoice_num: 'QTN#002' }]
  );
  const svc = createPaymentApplicationService(store);
  await assert.rejects(
    () => svc.updateReceiptLifecycle('rqtn', { amount_received: 10 }),
    (err: unknown) => err instanceof PaymentApplicationError && /Quotations cannot receive payment/.test(err.message)
  );
  assert.equal(store.invoices.get('qtn1')?.amount_paid, 0);
  assert.equal(store.receipts[0].amount_received, 16.99);
});

test('delete invoice-applied Receipt reverses amount_paid', async () => {
  const store = memoryStore([{ ...invoice }]);
  const svc = createPaymentApplicationService(store);
  await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 200 });
  const second = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 100 });
  await svc.deleteReceiptLifecycle(second.receipt.id);
  assert.equal(store.invoices.get('inv1')?.amount_paid, 200);
  assert.equal(store.receipts.length, 1);
});

test('delete last payment changes invoice from paid to unpaid', async () => {
  const store = memoryStore([{ ...invoice }]);
  const svc = createPaymentApplicationService(store);
  const applied = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 500 });
  assert.equal(store.invoices.get('inv1')?.payment_status, 'paid');
  await svc.deleteReceiptLifecycle(applied.receipt.id);
  assert.equal(store.invoices.get('inv1')?.amount_paid, 0);
  assert.equal(store.invoices.get('inv1')?.payment_status, 'unpaid');
  assert.equal(store.receipts.length, 0);
});

test('reject deletion if referenced invoice is missing', async () => {
  const store = memoryStore(
    [],
    [{ id: 'rorph', trx_id: 'RTORPH', amount_received: 25, invoice_num: 'INV#GONE' }]
  );
  const svc = createPaymentApplicationService(store);
  await assert.rejects(
    () => svc.deleteReceiptLifecycle('rorph'),
    (err: unknown) => err instanceof PaymentApplicationError && /was not found/.test(err.message)
  );
  assert.equal(store.receipts.length, 1);
});

test('quotation Receipt cannot be treated as payment on delete', async () => {
  const store = memoryStore(
    [{ ...quotation, amount_paid: 16.99 }],
    [{ id: 'rqtn', trx_id: 'RTQTN', amount_received: 16.99, invoice_num: 'QTN#002' }]
  );
  const svc = createPaymentApplicationService(store);
  await assert.rejects(
    () => svc.deleteReceiptLifecycle('rqtn'),
    (err: unknown) => err instanceof PaymentApplicationError && /Quotations cannot receive payment/.test(err.message)
  );
  assert.equal(store.receipts.length, 1);
  assert.equal(store.invoices.get('qtn1')?.amount_paid, 16.99);
});

test('failed update does not leave a changed Receipt or Invoice.amount_paid', async () => {
  const store = memoryStore([{ ...invoice }]);
  const svc = createPaymentApplicationService(store);
  const applied = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 100 });
  store.failNextReceiptWriteOnce();
  await assert.rejects(() => svc.updateReceiptLifecycle(applied.receipt.id, { amount_received: 150 }));
  assert.equal(store.receipts[0].amount_received, 100);
  assert.equal(store.invoices.get('inv1')?.amount_paid, 100);
});

test('failed delete does not remove the Receipt or change amount_paid', async () => {
  const store = memoryStore([{ ...invoice }]);
  const svc = createPaymentApplicationService(store);
  const applied = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 100 });
  store.failNextDeleteOnce();
  await assert.rejects(() => svc.deleteReceiptLifecycle(applied.receipt.id));
  assert.equal(store.receipts.length, 1);
  assert.equal(store.invoices.get('inv1')?.amount_paid, 100);
});

test('receipt routes use the payment application lifecycle', () => {
  const receipts = readFileSync(join(process.cwd(), 'src/routes/receipts.ts'), 'utf8');
  assert.match(receipts, /updateReceiptLifecycle/);
  assert.match(receipts, /deleteReceiptLifecycle/);
  assert.equal(receipts.includes('findByIdAndUpdate'), false);
  assert.equal(receipts.includes('findByIdAndDelete'), false);
});
