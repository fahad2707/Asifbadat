/**
 * Task 07D-08 — POST /api/pos/sale idempotency.
 *
 * Isolated harness: no Mongo connection. These tests prove request
 * propagation, unique+sparse index definition, duplicate-key handling,
 * and that replay does not repeat financial/inventory writes.
 *
 * They do NOT prove a live MongoDB replica-set race. Concurrent
 * transaction uniqueness requires a replica set.
 *
 * Run with:
 *     npx tsx --test src/routes/posSaleIdempotency.test.ts
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
const EXISTING_USER_ID = '64b0000000000000000e0505';
const NEW_USER_ID = '64b0000000000000000e0606';
const ORIGINAL_SALE_ID = '64b0000000000000000a0a0a';
const ORIGINAL_INVOICE_ID = '64b0000000000000000b0b0b';
const saleItems = [{ product_id: PRODUCT_ID, quantity: 1 }];
const KEY = '11111111-1111-4111-8111-111111111111';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07d08-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'POS idempotency tests must not open a MongoDB connection');
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

function stubSuccessfulWrites(session: ReturnType<typeof createFakeSession>) {
  mock.method(Invoice, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => 'inv-new' }, ...doc, toObject: () => doc }];
  });
  mock.method(POSSale, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => 'sale-new' }, ...doc, toObject: () => doc }];
  });
  mock.method(Product, 'findOneAndUpdate', async () => ({}));
  mock.method(StockMovement, 'create', async () => [{}]);
  mock.method(User, 'findByIdAndUpdate', async () => ({}));
}

async function postSale(body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/pos/sale')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

test('schema defines optional unique+sparse idempotency_key', () => {
  const path = POSSale.schema.path('idempotency_key') as { options?: { unique?: boolean; sparse?: boolean; required?: boolean } };
  assert.ok(path);
  assert.equal(path.options?.unique, true);
  assert.equal(path.options?.sparse, true);
  assert.notEqual(path.options?.required, true);
  const indexes = POSSale.schema.indexes();
  const keyed = indexes.find((entry) => (entry[0] as { idempotency_key?: number }).idempotency_key === 1);
  assert.ok(keyed, 'unique sparse index must be registered on idempotency_key');
  assert.equal((keyed?.[1] as { unique?: boolean }).unique, true);
  assert.equal((keyed?.[1] as { sparse?: boolean }).sparse, true);
});

test('route uses unique insert plus committed-sale replay, not find-then-create as the guarantee', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/pos.ts'), 'utf8');
  assert.match(src, /idempotency_key:\s*idempotencyKey/);
  assert.match(src, /isIdempotencyDuplicateKey/);
  assert.match(src, /waitForCommittedKeyedSale/);
  assert.match(src, /POSSale\.create/);
});

test('A — missing key keeps current POS create behavior', async () => {
  assertNoMongoConnection();
  stubCatalog();
  mock.method(User, 'findOne', async () => null);
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  let keyedLookup = false;
  mock.method(POSSale, 'findOne', async () => {
    keyedLookup = true;
    return null;
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(res.body.sale.id, 'sale-new');
  assert.equal(res.body.invoice.id, 'inv-new');
  assert.equal(keyedLookup, false);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
});

test('B — first request with a new key stores it and commits', async () => {
  assertNoMongoConnection();
  stubCatalog();
  mock.method(User, 'findOne', async () => null);
  mock.method(POSSale, 'findOne', async () => null);
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let storedKey: unknown;
  mock.method(Invoice, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => 'inv-keyed' }, ...doc, toObject: () => doc }];
  });
  mock.method(POSSale, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    storedKey = doc.idempotency_key;
    return [{ _id: { toString: () => 'sale-keyed' }, ...doc, toObject: () => doc }];
  });
  mock.method(Product, 'findOneAndUpdate', async () => ({}));
  mock.method(StockMovement, 'create', async () => [{}]);
  mock.method(User, 'findByIdAndUpdate', async () => ({}));

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    idempotency_key: KEY,
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(storedKey, KEY);
  assert.equal(res.body.sale.idempotency_key, KEY);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
  assert.equal(session.abortTransaction.mock.callCount(), 0);
});

test('C — completed retry returns original sale and invoice without writes', async () => {
  assertNoMongoConnection();
  stubCatalog();
  mock.method(User, 'findOne', async () => null);

  let saleCreates = 0;
  let invoiceCreates = 0;
  let stockDecs = 0;
  let movements = 0;
  let spentUpdates = 0;
  let sessions = 0;

  mock.method(POSSale, 'findOne', async () => ({
    _id: ORIGINAL_SALE_ID,
    invoice_id: ORIGINAL_INVOICE_ID,
    idempotency_key: KEY,
    sale_number: 'POS-ORIGINAL',
  }));
  mock.method(Invoice, 'findById', async () => ({
    _id: ORIGINAL_INVOICE_ID,
    invoice_number: 'INV-ORIGINAL',
  }));
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run for a committed replay');
  });
  mock.method(Invoice, 'create', async () => {
    invoiceCreates += 1;
    throw new Error('Invoice.create must not run for a committed replay');
  });
  mock.method(POSSale, 'create', async () => {
    saleCreates += 1;
    throw new Error('POSSale.create must not run for a committed replay');
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    stockDecs += 1;
    throw new Error('stock decrement must not run for a committed replay');
  });
  mock.method(StockMovement, 'create', async () => {
    movements += 1;
    throw new Error('StockMovement must not run for a committed replay');
  });
  mock.method(User, 'create', async () => {
    throw new Error('User.create must not run for a committed replay');
  });
  mock.method(User, 'findByIdAndUpdate', async () => {
    spentUpdates += 1;
    throw new Error('total_spent must not run for a committed replay');
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    idempotency_key: KEY,
  });

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.sale.id, ORIGINAL_SALE_ID);
  assert.equal(res.body.invoice.id, ORIGINAL_INVOICE_ID);
  assert.equal(saleCreates, 0);
  assert.equal(invoiceCreates, 0);
  assert.equal(stockDecs, 0);
  assert.equal(movements, 0);
  assert.equal(spentUpdates, 0);
  assert.equal(sessions, 0);
});

test('D — duplicate-key loser does not create a second sale (unique constraint)', async () => {
  assertNoMongoConnection();
  stubCatalog();
  mock.method(User, 'findOne', async () => null);
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let saleLookups = 0;
  mock.method(POSSale, 'findOne', async () => {
    saleLookups += 1;
    if (saleLookups === 1) return null;
    return {
      _id: ORIGINAL_SALE_ID,
      invoice_id: ORIGINAL_INVOICE_ID,
      idempotency_key: KEY,
    };
  });
  mock.method(Invoice, 'findById', async () => ({
    _id: ORIGINAL_INVOICE_ID,
    invoice_number: 'INV-ORIGINAL',
  }));

  let saleCreates = 0;
  mock.method(Invoice, 'create', async () => [{ _id: { toString: () => 'inv-loser' } }]);
  mock.method(POSSale, 'create', async () => {
    saleCreates += 1;
    const err = Object.assign(new Error('E11000 duplicate key error collection: possales index: idempotency_key_1'), {
      code: 11000,
      keyPattern: { idempotency_key: 1 },
    });
    throw err;
  });

  let stockDecs = 0;
  let movements = 0;
  let spentUpdates = 0;
  mock.method(Product, 'findOneAndUpdate', async () => {
    stockDecs += 1;
    return {};
  });
  mock.method(StockMovement, 'create', async () => {
    movements += 1;
    return [{}];
  });
  mock.method(User, 'findByIdAndUpdate', async () => {
    spentUpdates += 1;
    return {};
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    idempotency_key: KEY,
  });

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.sale.id, ORIGINAL_SALE_ID);
  assert.equal(res.body.invoice.id, ORIGINAL_INVOICE_ID);
  assert.equal(saleCreates, 1);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(stockDecs, 0);
  assert.equal(movements, 0);
  assert.equal(spentUpdates, 0);
});

test('E — aborted transaction does not permanently reserve the key', async () => {
  assertNoMongoConnection();
  stubCatalog();
  mock.method(User, 'findOne', async () => null);
  mock.method(POSSale, 'findOne', async () => null);

  const session1 = createFakeSession();
  const session2 = createFakeSession();
  let sessionCalls = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessionCalls += 1;
    return sessionCalls === 1 ? session1 : session2;
  });

  let invoiceCreates = 0;
  mock.method(Invoice, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    invoiceCreates += 1;
    if (invoiceCreates === 1) {
      throw new Error('simulated Invoice.create failure');
    }
    assert.equal(options?.session, session2);
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => 'inv-retry' }, ...doc, toObject: () => doc }];
  });

  let saleCreates = 0;
  mock.method(POSSale, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    saleCreates += 1;
    assert.equal(options?.session, session2);
    const doc = firstDoc(docs);
    assert.equal(doc.idempotency_key, KEY);
    return [{ _id: { toString: () => 'sale-retry' }, ...doc, toObject: () => doc }];
  });
  mock.method(Product, 'findOneAndUpdate', async () => ({}));
  mock.method(StockMovement, 'create', async () => [{}]);
  mock.method(User, 'findByIdAndUpdate', async () => ({}));

  const first = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    idempotency_key: KEY,
  });
  const second = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    idempotency_key: KEY,
  });

  assertNoMongoConnection();
  assert.equal(first.status, 500);
  assert.equal(session1.abortTransaction.mock.callCount(), 1);
  assert.equal(session1.commitTransaction.mock.callCount(), 0);
  assert.equal(saleCreates, 1);
  assert.equal(second.status, 201);
  assert.equal(second.body.sale.id, 'sale-retry');
  assert.equal(session2.commitTransaction.mock.callCount(), 1);
});

test('F — invalid tender with a key is 400 and creates nothing', async () => {
  assertNoMongoConnection();
  stubCatalog();
  mock.method(User, 'findOne', async () => null);

  let userCreated = false;
  let saleCreated = false;
  let invoiceCreated = false;
  mock.method(User, 'create', async () => {
    userCreated = true;
    throw new Error('User.create must not run after tender rejection');
  });
  mock.method(Invoice, 'create', async () => {
    invoiceCreated = true;
    throw new Error('Invoice.create must not run after tender rejection');
  });
  mock.method(POSSale, 'create', async () => {
    saleCreated = true;
    throw new Error('POSSale.create must not run after tender rejection');
  });
  mock.method(mongoose, 'startSession', async () => {
    throw new Error('startSession must not run after tender rejection');
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 90 },
    customer_phone: '5550001111',
    idempotency_key: KEY,
  });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.equal(userCreated, false);
  assert.equal(saleCreated, false);
  assert.equal(invoiceCreated, false);
});

test('G — existing User + keyed sale reuses that User', async () => {
  assertNoMongoConnection();
  stubCatalog();
  mock.method(POSSale, 'findOne', async () => null);
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  mock.method(User, 'findOne', async () => ({ _id: { toString: () => EXISTING_USER_ID } }));
  mock.method(User, 'create', async () => {
    throw new Error('User.create must not run when findOne resolves a User');
  });

  let saleCustomerId: unknown;
  mock.method(POSSale, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    saleCustomerId = doc.customer_id;
    assert.equal(doc.idempotency_key, KEY);
    return [{ _id: { toString: () => 'sale-existing' }, ...doc, toObject: () => doc }];
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    customer_phone: '5550002222',
    idempotency_key: KEY,
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(saleCustomerId, EXISTING_USER_ID);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
});

test('H — new User + keyed sale creates User inside the transaction', async () => {
  assertNoMongoConnection();
  stubCatalog();
  mock.method(POSSale, 'findOne', async () => null);
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  mock.method(User, 'findOne', async () => null);
  let createArgs: unknown[] | undefined;
  mock.method(User, 'create', async (...args: unknown[]) => {
    createArgs = args;
    return [{ _id: { toString: () => NEW_USER_ID } }];
  });

  let saleCustomerId: unknown;
  mock.method(POSSale, 'create', async (docs: unknown) => {
    const doc = firstDoc(docs);
    saleCustomerId = doc.customer_id;
    assert.equal(doc.idempotency_key, KEY);
    return [{ _id: { toString: () => 'sale-new-user' }, ...doc, toObject: () => doc }];
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    customer_phone: '5550003333',
    customer_name: 'Walk In',
    idempotency_key: KEY,
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.ok(createArgs);
  assert.equal((createArgs[1] as { session?: unknown }).session, session);
  assert.equal(saleCustomerId, NEW_USER_ID);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
});

test('rejects object/array idempotency_key', async () => {
  assertNoMongoConnection();
  stubCatalog();
  mock.method(User, 'findOne', async () => null);

  const asObject = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    idempotency_key: { nested: true },
  });
  const asArray = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    idempotency_key: ['k'],
  });

  assertNoMongoConnection();
  assert.equal(asObject.status, 400);
  assert.equal(asArray.status, 400);
});
