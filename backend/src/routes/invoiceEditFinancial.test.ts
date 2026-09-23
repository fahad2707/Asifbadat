/**
 * Task 07B-04 — PUT /api/invoices/:id financial invariant via the route harness.
 *
 * Run with:
 *     npx tsx --test src/routes/invoiceEditFinancial.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import Invoice from '../models/Invoice';
import { DOCUMENT_TYPE_INVOICE } from '../utils/documentType';

type InvoiceDoc = {
  _id: { toString(): string };
  invoice_number: string;
  invoice_type: string;
  customer_id?: unknown;
  items: Array<{ product_name: string; quantity: number; price: number; subtotal: number }>;
  total_amount: number;
  subtotal_amount: number;
  tax_amount: number;
  amount_paid: number;
  payment_status: string;
  invoice_date?: Date;
  save: () => Promise<void>;
  toObject: () => Record<string, unknown>;
};

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07b04-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(
    mongoose.connection.readyState,
    0,
    'invoice edit tests must not open a MongoDB connection'
  );
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

function makeInvoiceDoc(input: {
  id: string;
  total_amount: number;
  amount_paid: number;
  payment_status: string;
}): { doc: InvoiceDoc; state: { saved: boolean } } {
  const state = { saved: false };
  const doc: InvoiceDoc = {
    _id: { toString: () => input.id },
    invoice_number: `INV#${input.id}`,
    invoice_type: DOCUMENT_TYPE_INVOICE,
    items: [{ product_name: 'Line', quantity: 1, price: input.total_amount, subtotal: input.total_amount }],
    total_amount: input.total_amount,
    subtotal_amount: input.total_amount,
    tax_amount: 0,
    amount_paid: input.amount_paid,
    payment_status: input.payment_status,
    save: async () => {
      state.saved = true;
    },
    toObject() {
      return {
        _id: doc._id,
        invoice_number: doc.invoice_number,
        payment_status: doc.payment_status,
        total_amount: doc.total_amount,
        amount_paid: doc.amount_paid,
      };
    },
  };
  return { doc, state };
}

function lineTotal(total: number) {
  return {
    items: [{ product_name: 'Line', quantity: 1, price: total, subtotal: total }],
    tax_amount: 0,
  };
}

afterEach(() => {
  mock.restoreAll();
});

async function putInvoice(id: string, body: Record<string, unknown>) {
  return request(createApp())
    .put(`/api/invoices/${id}`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

test('PUT unpaid 100/0 to total 120 remains unpaid', async () => {
  assertNoMongoConnection();
  const { doc, state } = makeInvoiceDoc({
    id: 'edit-a',
    total_amount: 100,
    amount_paid: 0,
    payment_status: 'unpaid',
  });
  mock.method(Invoice, 'findById', async () => doc);

  const res = await putInvoice('edit-a', lineTotal(120));
  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(state.saved, true);
  assert.equal(doc.total_amount, 120);
  assert.equal(doc.amount_paid, 0);
  assert.equal(doc.payment_status, 'unpaid');
  assert.equal(res.body.payment_status, 'unpaid');
});

test('PUT partial 100/40 to total 120 stays unpaid and keeps amount_paid', async () => {
  assertNoMongoConnection();
  const { doc, state } = makeInvoiceDoc({
    id: 'edit-b',
    total_amount: 100,
    amount_paid: 40,
    payment_status: 'unpaid',
  });
  mock.method(Invoice, 'findById', async () => doc);

  const res = await putInvoice('edit-b', lineTotal(120));
  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(state.saved, true);
  assert.equal(doc.total_amount, 120);
  assert.equal(doc.amount_paid, 40);
  assert.equal(doc.payment_status, 'unpaid');
});

test('PUT fully paid 100/100 to total 120 becomes unpaid', async () => {
  assertNoMongoConnection();
  const { doc, state } = makeInvoiceDoc({
    id: 'edit-c',
    total_amount: 100,
    amount_paid: 100,
    payment_status: 'paid',
  });
  mock.method(Invoice, 'findById', async () => doc);

  const res = await putInvoice('edit-c', lineTotal(120));
  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(state.saved, true);
  assert.equal(doc.total_amount, 120);
  assert.equal(doc.amount_paid, 100);
  assert.equal(doc.payment_status, 'unpaid');
  assert.equal(res.body.payment_status, 'unpaid');
});

test('PUT 100/80 to total 60 is rejected and does not mutate the invoice', async () => {
  assertNoMongoConnection();
  const snapshot = {
    total_amount: 100,
    amount_paid: 80,
    payment_status: 'paid',
    items: [{ product_name: 'Line', quantity: 1, price: 100, subtotal: 100 }],
  };
  const { doc, state } = makeInvoiceDoc({
    id: 'edit-d',
    total_amount: 100,
    amount_paid: 80,
    payment_status: 'paid',
  });
  mock.method(Invoice, 'findById', async () => doc);

  const res = await putInvoice('edit-d', lineTotal(60));
  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /already paid/i);
  assert.equal(state.saved, false);
  assert.equal(doc.total_amount, snapshot.total_amount);
  assert.equal(doc.amount_paid, snapshot.amount_paid);
  assert.equal(doc.payment_status, snapshot.payment_status);
  assert.deepEqual(doc.items, snapshot.items);
});
