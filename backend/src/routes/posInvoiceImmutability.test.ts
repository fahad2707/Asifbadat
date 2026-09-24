/**
 * Task 07D-09 — completed POS sale documents are immutable via Invoice PUT.
 *
 * Isolated harness: no Mongo connection.
 *
 * POSSale has no edit/delete routes. Invoice has no delete route.
 * This file covers the existing mutation path: PUT /api/invoices/:id.
 *
 * Run with:
 *     npx tsx --test src/routes/posInvoiceImmutability.test.ts
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
import Invoice from '../models/Invoice';
import Product from '../models/Product';
import POSSale from '../models/POSSale';
import StockMovement from '../models/StockMovement';
import User from '../models/User';
import { DOCUMENT_TYPE_INVOICE } from '../utils/documentType';

type InvoiceDoc = {
  _id: { toString(): string };
  invoice_number: string;
  invoice_type: string;
  items: Array<{ product_name: string; quantity: number; price: number; subtotal: number }>;
  total_amount: number;
  subtotal_amount: number;
  tax_amount: number;
  amount_paid: number;
  payment_status: string;
  customer_name?: string;
  save: () => Promise<void>;
  toObject: () => Record<string, unknown>;
};

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07d09-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'POS invoice immutability tests must not open a MongoDB connection');
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

afterEach(() => {
  mock.restoreAll();
});

function makeInvoiceDoc(input: {
  id: string;
  invoice_type: string;
  total_amount: number;
  amount_paid?: number;
  customer_name?: string;
}): { doc: InvoiceDoc; state: { saved: boolean } } {
  const state = { saved: false };
  const doc: InvoiceDoc = {
    _id: { toString: () => input.id },
    invoice_number: `INV#${input.id}`,
    invoice_type: input.invoice_type,
    items: [{ product_name: 'Line', quantity: 10, price: 10, subtotal: input.total_amount }],
    total_amount: input.total_amount,
    subtotal_amount: input.total_amount,
    tax_amount: 0,
    amount_paid: input.amount_paid ?? input.total_amount,
    payment_status: 'paid',
    customer_name: input.customer_name,
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

async function putInvoice(id: string, body: Record<string, unknown>) {
  return request(createApp())
    .put(`/api/invoices/${id}`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

test('PUT route rejects POS sale invoice types before save', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/invoices.ts'), 'utf8');
  const putAt = src.indexOf("router.put('/:id'");
  const guardAt = src.indexOf('isPosSaleInvoiceType(invoice.invoice_type)', putAt);
  const saveAt = src.indexOf('await invoice.save()', putAt);
  assert.ok(putAt >= 0);
  assert.ok(guardAt > putAt && saveAt > guardAt);
  const posSrc = readFileSync(join(process.cwd(), 'src/routes/pos.ts'), 'utf8');
  assert.equal(posSrc.includes("router.put("), false);
  assert.equal(posSrc.includes("router.delete("), false);
  assert.equal(src.includes("router.delete("), false);
});

test('C — PUT of a POS invoice is rejected and mutates nothing', async () => {
  assertNoMongoConnection();
  const snapshot = {
    total_amount: 100,
    items: [{ product_name: 'Line', quantity: 10, price: 10, subtotal: 100 }],
    customer_name: 'Walk In',
  };
  const { doc, state } = makeInvoiceDoc({
    id: 'pos-slip-1',
    invoice_type: 'pos',
    total_amount: 100,
    customer_name: 'Walk In',
  });
  mock.method(Invoice, 'findById', async () => doc);

  let stockWrites = 0;
  let movements = 0;
  let spentUpdates = 0;
  let saleUpdates = 0;
  mock.method(Product, 'findByIdAndUpdate', async () => {
    stockWrites += 1;
    throw new Error('stock must not change for a POS invoice edit');
  });
  mock.method(StockMovement, 'create', async () => {
    movements += 1;
    throw new Error('StockMovement must not run for a POS invoice edit');
  });
  mock.method(User, 'findByIdAndUpdate', async () => {
    spentUpdates += 1;
    throw new Error('total_spent must not change for a POS invoice edit');
  });
  mock.method(POSSale, 'findByIdAndUpdate', async () => {
    saleUpdates += 1;
    throw new Error('POSSale must not change for a POS invoice edit');
  });

  const res = await putInvoice('pos-slip-1', {
    customer_name: 'Changed',
    items: [{ product_name: 'Line', quantity: 5, price: 16, subtotal: 80 }],
    tax_amount: 0,
  });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /cannot be edited/i);
  assert.equal(state.saved, false);
  assert.equal(doc.total_amount, snapshot.total_amount);
  assert.deepEqual(doc.items, snapshot.items);
  assert.equal(doc.customer_name, snapshot.customer_name);
  assert.equal(stockWrites, 0);
  assert.equal(movements, 0);
  assert.equal(spentUpdates, 0);
  assert.equal(saleUpdates, 0);
});

test('C — website and store_pickup slips are also rejected', async () => {
  assertNoMongoConnection();
  for (const invoice_type of ['website', 'store_pickup'] as const) {
    const { doc, state } = makeInvoiceDoc({
      id: `slip-${invoice_type}`,
      invoice_type,
      total_amount: 50,
    });
    mock.restoreAll();
    mock.method(Invoice, 'findById', async () => doc);
    const res = await putInvoice(`slip-${invoice_type}`, {
      items: [{ product_name: 'Line', quantity: 1, price: 1, subtotal: 1 }],
      tax_amount: 0,
    });
    assert.equal(res.status, 400);
    assert.equal(state.saved, false);
    assert.equal(doc.total_amount, 50);
  }
  assertNoMongoConnection();
});

test('E — wholesale invoice PUT keeps existing edit behavior', async () => {
  assertNoMongoConnection();
  const { doc, state } = makeInvoiceDoc({
    id: 'wholesale-1',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 0,
  });
  doc.payment_status = 'unpaid';
  mock.method(Invoice, 'findById', async () => doc);

  const res = await putInvoice('wholesale-1', {
    items: [{ product_name: 'Line', quantity: 1, price: 120, subtotal: 120 }],
    tax_amount: 0,
  });

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(state.saved, true);
  assert.equal(doc.total_amount, 120);
  assert.equal(doc.amount_paid, 0);
});
