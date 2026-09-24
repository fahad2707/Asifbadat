/**
 * Task 07D-02 — PUT /api/online-orders/:id/status delivered invoice/payment path.
 *
 * Isolated harness: no Mongo connection, no express_distributors_dev.
 *
 * Run with:
 *     npx tsx --test src/routes/onlineOrderDelivery.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import OnlineOrder from '../models/OnlineOrder';
import Invoice from '../models/Invoice';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import { PaymentApplicationError, paymentApplication } from '../services/paymentApplication';

const ORDER_ID = '64b0000000000000000d0202';
const INVOICE_ID = '64b0000000000000000d0303';

type OrderDoc = {
  _id: { toString(): string };
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  items: Array<{ product_id?: string; product_name: string; quantity: number; price: number; subtotal: number }>;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  payment_method: 'cod' | 'card';
  payment_status: string;
  status: string;
  status_history: Array<{ status: string; timestamp: Date }>;
  invoice_id?: { toString(): string };
  save: () => Promise<void>;
};

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07d02-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(
    mongoose.connection.readyState,
    0,
    'online-order delivery tests must not open a MongoDB connection'
  );
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

function makeOrder(overrides: Partial<OrderDoc> = {}): { order: OrderDoc; state: { saved: boolean } } {
  const state = { saved: false };
  const order: OrderDoc = {
    _id: { toString: () => ORDER_ID },
    order_number: 'WEB-0042',
    customer_name: 'Delivery Customer',
    customer_phone: '5550100',
    customer_email: 'delivery@example.com',
    address_line1: '1 Main St',
    city: 'Plymouth Meeting',
    state: 'PA',
    zip: '19462',
    items: [],
    subtotal: 80,
    tax_amount: 20,
    total_amount: 100,
    payment_method: 'cod',
    payment_status: 'pending',
    status: 'dispatched',
    status_history: [{ status: 'dispatched', timestamp: new Date() }],
    save: async () => {
      state.saved = true;
    },
    ...overrides,
  };
  return { order, state };
}

afterEach(() => {
  mock.restoreAll();
});

function stubInventoryNoops() {
  mock.method(Product, 'findById', async () => null);
  mock.method(Product, 'findByIdAndUpdate', async () => null);
  mock.method(StockMovement, 'create', async () => ({}));
}

async function putStatus(id: string, status: string) {
  return request(createApp())
    .put(`/api/online-orders/${id}/status`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ status });
}

test('delivery route uses applyPaymentToInvoice and does not fabricate a paid invoice', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/online-orders.ts'), 'utf8');
  assert.match(src, /applyPaymentToInvoice/);
  assert.match(src, /paymentApplication/);
  assert.equal(src.includes('amount_paid: order.total_amount'), false);
  assert.match(src, /amount_paid:\s*0/);
  assert.match(src, /payment_status:\s*'unpaid'/);
});

test('PUT delivered creates unpaid invoice then applies canonical payment', async () => {
  assertNoMongoConnection();

  const { order, state } = makeOrder();
  const created: Record<string, unknown>[] = [];
  const applied: Array<Record<string, unknown>> = [];
  const receipts: Array<{ invoice_num: string; amount_received: number }> = [];
  const invoice = {
    _id: { toString: () => INVOICE_ID },
    invoice_number: 'INV-WEB-0042',
    invoice_type: 'invoice',
    total_amount: 100,
    amount_paid: 0,
    payment_status: 'unpaid',
  };

  mock.method(OnlineOrder, 'findById', async () => order);
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => {
    created.push(doc);
    invoice.amount_paid = Number(doc.amount_paid) || 0;
    invoice.payment_status = String(doc.payment_status || 'unpaid');
    invoice.total_amount = Number(doc.total_amount) || 0;
    return invoice;
  });
  mock.method(Invoice, 'findByIdAndDelete', async () => {
    throw new Error('must not delete invoice on successful apply');
  });
  mock.method(paymentApplication, 'applyPaymentToInvoice', async (input: { invoiceId: string; amount: number }) => {
    applied.push(input as unknown as Record<string, unknown>);
    assert.equal(invoice.amount_paid, 0);
    assert.equal(invoice.payment_status, 'unpaid');
    invoice.amount_paid = input.amount;
    invoice.payment_status = 'paid';
    receipts.push({ invoice_num: invoice.invoice_number, amount_received: input.amount });
    return {
      invoice_id: INVOICE_ID,
      invoice_number: invoice.invoice_number,
      amount_applied: input.amount,
      amount_paid: invoice.amount_paid,
      remaining_balance: 0,
      payment_status: invoice.payment_status,
      receipt: { id: 'rcpt-1', trx_id: 'RTTEST', amount_received: input.amount, invoice_num: invoice.invoice_number },
    };
  });
  stubInventoryNoops();

  const res = await putStatus(ORDER_ID, 'delivered');

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'delivered');
  assert.equal(created.length, 1);
  assert.equal(created[0].invoice_type, 'invoice');
  assert.equal(created[0].amount_paid, 0);
  assert.equal(created[0].payment_status, 'unpaid');
  assert.equal(created[0].total_amount, 100);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].invoiceId, INVOICE_ID);
  assert.equal(applied[0].amount, 100);
  assert.equal(invoice.amount_paid, 100);
  assert.equal(invoice.payment_status, 'paid');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].invoice_num, 'INV-WEB-0042');
  assert.equal(receipts[0].amount_received, 100);
  assert.equal(order.status, 'delivered');
  assert.equal(order.invoice_id?.toString(), INVOICE_ID);
  assert.equal(order.payment_status, 'paid');
  assert.equal(state.saved, true);
});

test('PUT delivered rolls back new invoice when payment application fails', async () => {
  assertNoMongoConnection();

  const { order, state } = makeOrder();
  const deleted: string[] = [];
  const invoice = {
    _id: { toString: () => INVOICE_ID },
  };

  mock.method(OnlineOrder, 'findById', async () => order);
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => {
    assert.equal(doc.amount_paid, 0);
    assert.equal(doc.payment_status, 'unpaid');
    return invoice;
  });
  mock.method(Invoice, 'findByIdAndDelete', async (id: { toString(): string }) => {
    deleted.push(id.toString());
    return invoice;
  });
  mock.method(paymentApplication, 'applyPaymentToInvoice', async () => {
    throw new PaymentApplicationError('Payment amount must be greater than zero.');
  });
  stubInventoryNoops();

  const res = await putStatus(ORDER_ID, 'delivered');

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /greater than zero|Failed to apply payment|Payment amount/i);
  assert.deepEqual(deleted, [INVOICE_ID]);
  assert.equal(state.saved, false);
  assert.equal(order.status, 'dispatched');
  assert.equal(order.invoice_id, undefined);
  assert.equal(order.payment_status, 'pending');
});

test('PUT packed does not create an invoice or apply payment', async () => {
  assertNoMongoConnection();

  const { order, state } = makeOrder({ status: 'confirmed', payment_status: 'pending' });
  let created = false;
  let applied = false;

  mock.method(OnlineOrder, 'findById', async () => order);
  mock.method(Invoice, 'create', async () => {
    created = true;
    throw new Error('Invoice.create must not run for non-delivered status');
  });
  mock.method(paymentApplication, 'applyPaymentToInvoice', async () => {
    applied = true;
    throw new Error('applyPaymentToInvoice must not run for non-delivered status');
  });

  const res = await putStatus(ORDER_ID, 'packed');

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'packed');
  assert.equal(created, false);
  assert.equal(applied, false);
  assert.equal(order.status, 'packed');
  assert.equal(order.invoice_id, undefined);
  assert.equal(state.saved, true);
});
