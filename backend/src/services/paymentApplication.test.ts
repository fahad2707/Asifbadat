/**
 * Task 06 — payment application source of truth.
 *
 * Run with:
 *     npx tsx --test src/services/paymentApplication.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PaymentApplicationError,
  createPaymentApplicationService,
  remainingInvoiceBalance,
  validatePaymentAmount,
  type InvoiceSnapshot,
  type PaymentApplicationStore,
  type ReceiptSnapshot,
} from './paymentApplication';

function memoryStore(seed: InvoiceSnapshot[]) {
  const invoices = new Map(seed.map((i) => [i.id, { ...i }]));
  const receipts: ReceiptSnapshot[] = [];
  let receiptSeq = 0;
  let failNextApply = false;

  const store: PaymentApplicationStore & {
    invoices: Map<string, InvoiceSnapshot>;
    receipts: ReceiptSnapshot[];
    failNextApplyOnce(): void;
  } = {
    invoices,
    receipts,
    failNextApplyOnce() {
      failNextApply = true;
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
      return receipts.find((r) => r.id === id) || null;
    },
    async findReceiptByTrxId(trxId) {
      return receipts.find((r) => r.trx_id === trxId) || null;
    },
    async applyInvoicePayment(invoiceId, amount, paymentStatus) {
      return store.adjustInvoicePaid(invoiceId, amount, paymentStatus);
    },
    async adjustInvoicePaid(invoiceId, delta, paymentStatus) {
      if (failNextApply) {
        failNextApply = false;
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
      const receipt = receipts.find((r) => r.id === id);
      if (!receipt) return null;
      if (patch.amount_received !== undefined) receipt.amount_received = patch.amount_received;
      if (patch.invoice_num !== undefined) receipt.invoice_num = patch.invoice_num;
      if (patch.trx_id !== undefined) receipt.trx_id = patch.trx_id;
      if (patch.pmt_mode !== undefined) receipt.pmt_mode = patch.pmt_mode;
      if (patch.customer_name !== undefined) receipt.customer_name = patch.customer_name;
      return { ...receipt };
    },
    async deleteReceiptById(id) {
      const idx = receipts.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      receipts.splice(idx, 1);
      return true;
    },
  };

  return store;
}

const unpaidInvoice: InvoiceSnapshot = {
  id: 'inv1',
  invoice_number: 'INV#T06',
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
  customer_name: 'SUNOCO 511',
};

test('valid full payment updates amount_paid and marks paid', async () => {
  const store = memoryStore([{ ...unpaidInvoice }]);
  const svc = createPaymentApplicationService(store);
  const result = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 500 });
  assert.equal(result.amount_applied, 500);
  assert.equal(result.amount_paid, 500);
  assert.equal(result.remaining_balance, 0);
  assert.equal(result.payment_status, 'paid');
  assert.equal(store.invoices.get('inv1')?.amount_paid, 500);
});

test('valid partial payment leaves remaining balance', async () => {
  const store = memoryStore([{ ...unpaidInvoice }]);
  const svc = createPaymentApplicationService(store);
  const result = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 200 });
  assert.equal(result.amount_applied, 200);
  assert.equal(result.amount_paid, 200);
  assert.equal(result.remaining_balance, 300);
  assert.equal(result.payment_status, 'unpaid');
});

test('second partial payment accumulates on the invoice', async () => {
  const store = memoryStore([{ ...unpaidInvoice }]);
  const svc = createPaymentApplicationService(store);
  await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 200 });
  const second = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 150 });
  assert.equal(second.amount_paid, 350);
  assert.equal(second.remaining_balance, 150);
  assert.equal(second.payment_status, 'unpaid');
  assert.equal(store.receipts.length, 2);
});

test('final partial payment reaches zero balance', async () => {
  const store = memoryStore([{ ...unpaidInvoice, amount_paid: 350 }]);
  const svc = createPaymentApplicationService(store);
  const result = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 150 });
  assert.equal(result.amount_paid, 500);
  assert.equal(result.remaining_balance, 0);
  assert.equal(result.payment_status, 'paid');
});

test('overpayment is rejected', async () => {
  const store = memoryStore([{ ...unpaidInvoice, total_amount: 100 }]);
  const svc = createPaymentApplicationService(store);
  await assert.rejects(
    () => svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 125 }),
    (err: unknown) => {
      assert.ok(err instanceof PaymentApplicationError);
      assert.equal(err.status, 400);
      assert.match(err.message, /exceeds the remaining invoice balance/);
      assert.match(err.message, /\$100\.00/);
      assert.match(err.message, /\$125\.00/);
      return true;
    }
  );
});

test('zero payment is rejected', () => {
  assert.throws(
    () => validatePaymentAmount(0, 100),
    (err: unknown) => err instanceof PaymentApplicationError && /greater than zero/.test(err.message)
  );
});

test('negative payment is rejected', () => {
  assert.throws(
    () => validatePaymentAmount(-5, 100),
    (err: unknown) => err instanceof PaymentApplicationError && /greater than zero/.test(err.message)
  );
});

test('missing invoice is rejected', async () => {
  const store = memoryStore([]);
  const svc = createPaymentApplicationService(store);
  await assert.rejects(
    () => svc.applyPaymentToInvoice({ invoiceId: 'missing', amount: 10 }),
    (err: unknown) => err instanceof PaymentApplicationError && err.status === 404
  );
});

test('quotation payment is rejected', async () => {
  const store = memoryStore([{ ...quotation }]);
  const svc = createPaymentApplicationService(store);
  await assert.rejects(
    () => svc.applyPaymentToInvoice({ invoiceId: 'qtn1', amount: 16.99 }),
    (err: unknown) => {
      assert.ok(err instanceof PaymentApplicationError);
      assert.match(err.message, /Quotations cannot receive payment/);
      assert.match(err.message, /QTN#002/);
      return true;
    }
  );
});

test('successful payment creates corresponding receipt/payment record', async () => {
  const store = memoryStore([{ ...unpaidInvoice }]);
  const svc = createPaymentApplicationService(store);
  const result = await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 200 });
  assert.equal(store.receipts.length, 1);
  assert.equal(store.receipts[0].amount_received, 200);
  assert.equal(store.receipts[0].invoice_num, 'INV#T06');
  assert.equal(result.receipt.trx_id, store.receipts[0].trx_id);
});

test('successful payment updates Invoice.amount_paid', async () => {
  const store = memoryStore([{ ...unpaidInvoice, amount_paid: 50 }]);
  const svc = createPaymentApplicationService(store);
  await svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 25 });
  assert.equal(store.invoices.get('inv1')?.amount_paid, 75);
});

test('failed payment does not mutate Invoice.amount_paid', async () => {
  const store = memoryStore([{ ...unpaidInvoice }]);
  const svc = createPaymentApplicationService(store);
  await assert.rejects(() => svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 0 }));
  await assert.rejects(() => svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 600 }));
  assert.equal(store.invoices.get('inv1')?.amount_paid, 0);
});

test('failed overpayment does not create a receipt', async () => {
  const store = memoryStore([{ ...unpaidInvoice, total_amount: 100 }]);
  const svc = createPaymentApplicationService(store);
  await assert.rejects(() => svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 125 }));
  assert.equal(store.receipts.length, 0);
});

test('invoice update failure rolls back the receipt', async () => {
  const store = memoryStore([{ ...unpaidInvoice }]);
  store.failNextApplyOnce();
  const svc = createPaymentApplicationService(store);
  await assert.rejects(() => svc.applyPaymentToInvoice({ invoiceId: 'inv1', amount: 50 }));
  assert.equal(store.receipts.length, 0);
  assert.equal(store.invoices.get('inv1')?.amount_paid, 0);
});

test('batch quotation allocation rejects with no writes', async () => {
  const store = memoryStore([{ ...unpaidInvoice }, { ...quotation }]);
  const svc = createPaymentApplicationService(store);
  await assert.rejects(
    () => svc.applyCustomerPayment({
      allocations: [
        { invoice_id: 'inv1', amount: 10 },
        { invoice_id: 'qtn1', amount: 5 },
      ],
    }),
    (err: unknown) => err instanceof PaymentApplicationError && /QTN#002/.test((err as Error).message)
  );
  assert.equal(store.receipts.length, 0);
  assert.equal(store.invoices.get('inv1')?.amount_paid, 0);
});

test('existing invoice payment endpoint uses the central service', () => {
  const root = join(process.cwd(), 'src');
  const invoices = readFileSync(join(root, 'routes/invoices.ts'), 'utf8');
  const receipts = readFileSync(join(root, 'routes/receipts.ts'), 'utf8');
  assert.match(invoices, /applyCustomerPayment|paymentApplication/);
  assert.equal(invoices.includes('inv.amount_paid = paid'), false);
  assert.match(receipts, /applyPaymentToInvoice|paymentApplication/);
});
