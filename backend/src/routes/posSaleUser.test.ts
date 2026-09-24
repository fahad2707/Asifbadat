/**
 * Task 07D-07 — POS User.create is transaction-safe and after tenders.
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/posSaleUser.test.ts
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

const PRODUCT_ID = '64b0000000000000000d0404';
const EXISTING_USER_ID = '64b0000000000000000e0505';
const NEW_USER_ID = '64b0000000000000000e0606';
const saleItems = [{ product_id: PRODUCT_ID, quantity: 1 }];

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07d07-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'POS user tests must not open a MongoDB connection');
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

function stubCatalog() {
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
  mock.method(Customer, 'findById', async () => null);
}

function stubTxnWrites(session: ReturnType<typeof createFakeSession>) {
  mock.method(Invoice, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => 'inv-user' }, ...doc, toObject: () => doc }];
  });
  mock.method(POSSale, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => 'sale-user' }, ...doc, toObject: () => doc }];
  });
  mock.method(Product, 'findOneAndUpdate', async () => ({}));
  mock.method(StockMovement, 'create', async () => [{}]);
}

async function postSale(body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/pos/sale')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

test('A — tender failure with a new phone does not create a User or start a session', async () => {
  assertNoMongoConnection();
  stubCatalog();
  mock.method(User, 'findOne', async () => null);

  let userCreated = false;
  let sessionStarted = false;
  let invoiceCreated = false;
  let saleCreated = false;
  mock.method(User, 'create', async () => {
    userCreated = true;
    throw new Error('User.create must not run after tender rejection');
  });
  mock.method(mongoose, 'startSession', async () => {
    sessionStarted = true;
    throw new Error('startSession must not run after tender rejection');
  });
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
    customer_phone: '5550001111',
  });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /must equal the sale total/i);
  assert.equal(userCreated, false);
  assert.equal(sessionStarted, false);
  assert.equal(invoiceCreated, false);
  assert.equal(saleCreated, false);
});

test('B — existing User is reused and User.create is not called', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubTxnWrites(session);

  mock.method(User, 'findOne', async () => ({ _id: { toString: () => EXISTING_USER_ID } }));
  mock.method(User, 'create', async () => {
    throw new Error('User.create must not run when findOne resolves a User');
  });

  let saleCustomerId: unknown;
  let spentArgs: unknown[] | undefined;
  mock.method(POSSale, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    saleCustomerId = doc.customer_id;
    return [{ _id: { toString: () => 'sale-existing' }, ...doc, toObject: () => doc }];
  });
  mock.method(User, 'findByIdAndUpdate', async (...args: unknown[]) => {
    spentArgs = args;
    return {};
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    customer_phone: '5550002222',
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(saleCustomerId, EXISTING_USER_ID);
  assert.equal(spentArgs?.[0], EXISTING_USER_ID);
  assert.equal((spentArgs?.[2] as { session?: unknown }).session, session);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
  assert.equal(session.abortTransaction.mock.callCount(), 0);
});

test('C — new User is created after tenders, inside the sale session', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubTxnWrites(session);

  mock.method(User, 'findOne', async () => null);

  let createArgs: unknown[] | undefined;
  mock.method(User, 'create', async (...args: unknown[]) => {
    createArgs = args;
    return [{ _id: { toString: () => NEW_USER_ID } }];
  });

  let saleCustomerId: unknown;
  let spentId: unknown;
  mock.method(POSSale, 'create', async (docs: unknown) => {
    const doc = firstDoc(docs);
    saleCustomerId = doc.customer_id;
    return [{ _id: { toString: () => 'sale-new' }, ...doc, toObject: () => doc }];
  });
  mock.method(User, 'findByIdAndUpdate', async (id: unknown) => {
    spentId = id;
    return {};
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    customer_phone: '5550003333',
    customer_name: 'Walk In',
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.ok(createArgs);
  assert.equal(Array.isArray(createArgs[0]), true);
  assert.equal(firstDoc(createArgs[0]).phone, '5550003333');
  assert.equal((createArgs[1] as { session?: unknown }).session, session);
  assert.equal(saleCustomerId, NEW_USER_ID);
  assert.equal(spentId, NEW_USER_ID);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
});

test('D — later transactional failure aborts after in-session User.create', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  mock.method(User, 'findOne', async () => null);

  let createSession: unknown;
  mock.method(User, 'create', async (_docs: unknown, options?: { session?: unknown }) => {
    createSession = options?.session;
    return [{ _id: { toString: () => NEW_USER_ID } }];
  });
  mock.method(Invoice, 'create', async () => {
    throw new Error('simulated Invoice.create failure after User.create');
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    customer_phone: '5550004444',
  });

  assertNoMongoConnection();
  assert.equal(res.status, 500);
  assert.equal(createSession, session);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(session.endSession.mock.callCount(), 1);
});
