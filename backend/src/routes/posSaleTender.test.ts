/**
 * Task 07D-04 — POST /api/pos/sale tender validation via the route.
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/posSaleTender.test.ts
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
import Product from '../models/Product';
import Invoice from '../models/Invoice';
import POSSale from '../models/POSSale';
import StockMovement from '../models/StockMovement';
import User from '../models/User';
import Customer from '../models/Customer';

const PRODUCT_ID = '64b0000000000000000d0404';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07d04-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'POS tender tests must not open a MongoDB connection');
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

afterEach(() => {
  mock.restoreAll();
});

function stubCatalogProduct() {
  mock.method(Product, 'findById', async () => ({
    _id: { toString: () => PRODUCT_ID },
    name: 'Retail Item',
    price: 100,
    tax_rate: 0,
    is_active: true,
    product_type: 'inventory',
    stock_quantity: 10,
    committed_quantity: 0,
  }));
  mock.method(Product, 'findOneAndUpdate', async () => ({}));
  mock.method(StockMovement, 'create', async () => ({}));
  mock.method(User, 'findOne', async () => null);
  mock.method(User, 'create', async () => ({ _id: { toString: () => 'user-1' } }));
  mock.method(User, 'findByIdAndUpdate', async () => ({}));
  mock.method(Customer, 'findById', async () => null);
}

async function postSale(body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/pos/sale')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

const saleItems = [{ product_id: PRODUCT_ID, quantity: 1 }];

test('POS sale route uses tender validation and does not fabricate unpaid slip amounts', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/pos.ts'), 'utf8');
  assert.match(src, /normalizePosTenders/);
  assert.match(src, /amount_paid:\s*totalAmount/);
  assert.equal(src.includes('applyPaymentToInvoice'), false);
});

test('POST /pos/sale rejects non-split underpayment without creating a sale', async () => {
  assertNoMongoConnection();
  stubCatalogProduct();
  let invoiceCreated = false;
  let saleCreated = false;
  mock.method(Invoice, 'create', async () => {
    invoiceCreated = true;
    throw new Error('Invoice.create must not run after tender rejection');
  });
  mock.method(POSSale, 'create', async () => {
    saleCreated = true;
    throw new Error('POSSale.create must not run after tender rejection');
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 90 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /must equal the sale total/i);
  assert.equal(invoiceCreated, false);
  assert.equal(saleCreated, false);
});

test('POST /pos/sale rejects non-split overpayment without creating a sale', async () => {
  assertNoMongoConnection();
  stubCatalogProduct();
  let created = false;
  mock.method(Invoice, 'create', async () => {
    created = true;
    throw new Error('must not create');
  });
  mock.method(POSSale, 'create', async () => {
    created = true;
    throw new Error('must not create');
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 110 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.equal(created, false);
});

test('POST /pos/sale writes a settled POS slip and stores the POSSale tender', async () => {
  assertNoMongoConnection();
  stubCatalogProduct();
  const createdInvoices: Array<Record<string, unknown>> = [];
  const createdSales: Array<Record<string, unknown>> = [];
  const session = {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
  mock.method(mongoose, 'startSession', async () => session);

  mock.method(Invoice, 'create', async (docs: unknown) => {
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    createdInvoices.push(doc);
    return [{ _id: { toString: () => 'inv-pos-1' }, ...doc, toObject: () => doc }];
  });
  mock.method(POSSale, 'create', async (docs: unknown) => {
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    createdSales.push(doc);
    return [{ _id: { toString: () => 'sale-pos-1' }, ...doc, toObject: () => doc }];
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(createdInvoices.length, 1);
  assert.equal(createdInvoices[0].invoice_type, 'pos');
  assert.equal(createdInvoices[0].amount_paid, 100);
  assert.equal(createdInvoices[0].payment_status, 'paid');
  assert.equal(createdInvoices[0].total_amount, 100);
  assert.equal(createdSales.length, 1);
  assert.deepEqual(createdSales[0].payment_split, { cash: 100, card: 0, digital: 0 });
  assert.equal(createdSales[0].total_amount, 100);
});
