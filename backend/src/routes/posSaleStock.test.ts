/**
 * Task 07D-06 — POST /api/pos/sale conditional stock decrement.
 *
 * Isolated harness: no Mongo connection. Does not prove live replica-set
 * concurrency; it proves the route uses the availability filter and aborts
 * when findOneAndUpdate matches nothing.
 *
 * Run with:
 *     npx tsx --test src/routes/posSaleStock.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
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
import { posStockDecrementFilter } from '../utils/posStock';

const PRODUCT_ID = '64b0000000000000000d0404';
const saleItems = [{ product_id: PRODUCT_ID, quantity: 1 }];

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07d06-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'POS stock tests must not open a MongoDB connection');
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

afterEach(() => {
  mock.restoreAll();
});

function createFakeSession() {
  return {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
}

function firstDoc(docs: unknown): Record<string, unknown> {
  if (Array.isArray(docs)) return docs[0] as Record<string, unknown>;
  return docs as Record<string, unknown>;
}

function stubCatalog(opts?: { stock?: number; committed?: number; name?: string }) {
  mock.method(Product, 'findById', async () => ({
    _id: { toString: () => PRODUCT_ID },
    name: opts?.name ?? 'Retail Item',
    price: 100,
    tax_rate: 0,
    is_active: true,
    product_type: 'inventory',
    stock_quantity: opts?.stock ?? 10,
    committed_quantity: opts?.committed ?? 0,
  }));
  mock.method(Customer, 'findById', async () => null);
  mock.method(User, 'findOne', async () => null);
  mock.method(User, 'create', async () => ({ _id: { toString: () => 'user-1' } }));
  mock.method(User, 'findByIdAndUpdate', async () => ({}));
}

function stubSaleDocs() {
  mock.method(Invoice, 'create', async (docs: unknown) => {
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => 'inv-stock' }, ...doc, toObject: () => doc }];
  });
  mock.method(POSSale, 'create', async (docs: unknown) => {
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => 'sale-stock' }, ...doc, toObject: () => doc }];
  });
}

async function postSale(body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/pos/sale')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

test('pre-transaction insufficient stock is 400 and does not start a session', async () => {
  assertNoMongoConnection();
  stubCatalog({ stock: 2, committed: 0 });
  let sessionStarted = false;
  mock.method(mongoose, 'startSession', async () => {
    sessionStarted = true;
    throw new Error('startSession must not run when the pre-check fails');
  });
  mock.method(Invoice, 'create', async () => {
    throw new Error('Invoice.create must not run when the pre-check fails');
  });

  const res = await postSale({
    items: [{ product_id: PRODUCT_ID, quantity: 7 }],
    payment_method: 'cash',
    payment_split: { cash: 700 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /Insufficient stock/i);
  assert.equal(sessionStarted, false);
});

test('pre-transaction check uses stock_quantity minus committed_quantity', async () => {
  assertNoMongoConnection();
  stubCatalog({ stock: 10, committed: 4, name: 'Reserved Item' });
  let sessionStarted = false;
  mock.method(mongoose, 'startSession', async () => {
    sessionStarted = true;
    throw new Error('startSession must not run when committed stock is insufficient');
  });

  const res = await postSale({
    items: [{ product_id: PRODUCT_ID, quantity: 7 }],
    payment_method: 'cash',
    payment_split: { cash: 700 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /Insufficient stock for Reserved Item/i);
  assert.match(String(res.body.error), /Available: 6/);
  assert.equal(sessionStarted, false);
});

test('transactional decrement uses availability filter, $inc, and the sale session', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSaleDocs();

  let updateArgs: unknown[] | undefined;
  mock.method(Product, 'findOneAndUpdate', async (...args: unknown[]) => {
    updateArgs = args;
    return { _id: PRODUCT_ID };
  });
  mock.method(StockMovement, 'create', async () => [{}]);

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.ok(updateArgs);
  const filter = updateArgs[0] as ReturnType<typeof posStockDecrementFilter>;
  assert.equal(String(filter._id), PRODUCT_ID);
  assert.deepEqual(filter.$expr, posStockDecrementFilter(PRODUCT_ID, 1).$expr);
  assert.deepEqual(updateArgs[1], { $inc: { stock_quantity: -1 } });
  assert.equal((updateArgs[2] as { session?: unknown }).session, session);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
});

test('null decrement aborts, skips StockMovement, and returns 400', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSaleDocs();

  mock.method(Product, 'findOneAndUpdate', async () => null);

  let movementCreated = false;
  let userUpdated = false;
  mock.method(StockMovement, 'create', async () => {
    movementCreated = true;
    return [{}];
  });
  mock.method(User, 'findByIdAndUpdate', async () => {
    userUpdated = true;
    return {};
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /Insufficient stock/i);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(session.endSession.mock.callCount(), 1);
  assert.equal(movementCreated, false);
  assert.equal(userUpdated, false);
});
