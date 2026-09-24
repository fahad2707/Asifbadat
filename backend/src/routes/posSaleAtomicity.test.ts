/**
 * Task 07D-05 — POST /api/pos/sale transaction orchestration.
 *
 * Isolated harness: no Mongo connection. These tests prove session
 * propagation, commit, abort, and write ordering only. They do not
 * prove live MongoDB replica-set rollback.
 *
 * Run with:
 *     npx tsx --test src/routes/posSaleAtomicity.test.ts
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
const USER_ID = '64b0000000000000000e0505';
const saleItems = [{ product_id: PRODUCT_ID, quantity: 1 }];

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07d05-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'POS atomicity tests must not open a MongoDB connection');
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

function createOptions(args: unknown[]): { session?: unknown } | undefined {
  return args[1] as { session?: unknown } | undefined;
}

function stubCatalogReads(opts?: { withUser?: boolean }) {
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
  if (opts?.withUser) {
    mock.method(User, 'findOne', async () => ({ _id: { toString: () => USER_ID } }));
    mock.method(User, 'create', async () => {
      throw new Error('User.create must stay outside the sale transaction');
    });
  } else {
    mock.method(User, 'findOne', async () => null);
    mock.method(User, 'create', async () => ({ _id: { toString: () => USER_ID } }));
  }
}

function stubSuccessfulWrites(session: ReturnType<typeof createFakeSession>) {
  mock.method(Invoice, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    return [
      {
        _id: { toString: () => 'inv-pos-atomic' },
        ...doc,
        toObject: () => doc,
      },
    ];
  });
  mock.method(POSSale, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    return [
      {
        _id: { toString: () => 'sale-pos-atomic' },
        ...doc,
        toObject: () => doc,
      },
    ];
  });
  mock.method(Product, 'findByIdAndUpdate', async () => ({}));
  mock.method(StockMovement, 'create', async () => [{}]);
  mock.method(User, 'findByIdAndUpdate', async () => ({}));
}

async function postSale(body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/pos/sale')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

test('POS sale route still excludes Receipt and applyPaymentToInvoice', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/pos.ts'), 'utf8');
  assert.match(src, /startSession/);
  assert.match(src, /startTransaction/);
  assert.match(src, /commitTransaction/);
  assert.match(src, /abortTransaction/);
  assert.equal(src.includes('applyPaymentToInvoice'), false);
  assert.equal(src.includes('Receipt.create'), false);
});

test('A — successful tender starts a session and transaction', async () => {
  assertNoMongoConnection();
  stubCatalogReads();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(session.startTransaction.mock.callCount(), 1);
});

test('B — Invoice.create uses array form and the sale session', async () => {
  assertNoMongoConnection();
  stubCatalogReads();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let invoiceArgs: unknown[] | undefined;
  mock.method(Invoice, 'create', async (...args: unknown[]) => {
    invoiceArgs = args;
    const doc = firstDoc(args[0]);
    return [{ _id: { toString: () => 'inv-b' }, ...doc, toObject: () => doc }];
  });
  mock.method(POSSale, 'create', async (docs: unknown) => {
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => 'sale-b' }, ...doc, toObject: () => doc }];
  });
  mock.method(Product, 'findByIdAndUpdate', async () => ({}));
  mock.method(StockMovement, 'create', async () => [{}]);
  mock.method(User, 'findByIdAndUpdate', async () => ({}));

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.ok(invoiceArgs);
  assert.equal(Array.isArray(invoiceArgs[0]), true);
  assert.equal(createOptions(invoiceArgs)?.session, session);
  const invoice = firstDoc(invoiceArgs[0]);
  assert.equal(invoice.amount_paid, 100);
  assert.equal(invoice.payment_status, 'paid');
  assert.equal(invoice.invoice_type, 'pos');
});

test('C — POSSale.create uses array form, same session, and invoice_id from Invoice', async () => {
  assertNoMongoConnection();
  stubCatalogReads();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  const invoiceId = { toString: () => 'inv-c' };
  mock.method(Invoice, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    return [{ _id: invoiceId, ...doc, toObject: () => doc }];
  });

  let saleArgs: unknown[] | undefined;
  mock.method(POSSale, 'create', async (...args: unknown[]) => {
    saleArgs = args;
    const doc = firstDoc(args[0]);
    return [{ _id: { toString: () => 'sale-c' }, ...doc, toObject: () => doc }];
  });
  mock.method(Product, 'findByIdAndUpdate', async () => ({}));
  mock.method(StockMovement, 'create', async () => [{}]);
  mock.method(User, 'findByIdAndUpdate', async () => ({}));

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.ok(saleArgs);
  assert.equal(Array.isArray(saleArgs[0]), true);
  assert.equal(createOptions(saleArgs)?.session, session);
  assert.equal(firstDoc(saleArgs[0]).invoice_id, invoiceId);
});

test('D — Product stock update receives the same session', async () => {
  assertNoMongoConnection();
  stubCatalogReads();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  const productUpdateSessions: unknown[] = [];
  mock.method(Product, 'findByIdAndUpdate', async (...args: unknown[]) => {
    productUpdateSessions.push((args[2] as { session?: unknown } | undefined)?.session);
    return {};
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(productUpdateSessions.length, 1);
  assert.equal(productUpdateSessions[0], session);
});

test('E — StockMovement.create uses array form and the same session', async () => {
  assertNoMongoConnection();
  stubCatalogReads();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  let movementArgs: unknown[] | undefined;
  mock.method(StockMovement, 'create', async (...args: unknown[]) => {
    movementArgs = args;
    return [{}];
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.ok(movementArgs);
  assert.equal(Array.isArray(movementArgs[0]), true);
  assert.equal(createOptions(movementArgs)?.session, session);
  assert.equal(firstDoc(movementArgs[0]).reference_id?.toString(), 'sale-pos-atomic');
});

test('F — User total_spent update receives the same session when a User is resolved', async () => {
  assertNoMongoConnection();
  stubCatalogReads({ withUser: true });
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  let userUpdateArgs: unknown[] | undefined;
  mock.method(User, 'findByIdAndUpdate', async (...args: unknown[]) => {
    userUpdateArgs = args;
    return {};
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    customer_phone: '5551234567',
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.ok(userUpdateArgs);
  assert.equal(userUpdateArgs[0], USER_ID);
  assert.equal((userUpdateArgs[2] as { session?: unknown }).session, session);
});

test('G — success commits and ends the session before a 201', async () => {
  assertNoMongoConnection();
  stubCatalogReads();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
  assert.equal(session.abortTransaction.mock.callCount(), 0);
  assert.equal(session.endSession.mock.callCount(), 1);
});

test('H — POSSale.create failure aborts and skips later writes', async () => {
  assertNoMongoConnection();
  stubCatalogReads();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  mock.method(Invoice, 'create', async (docs: unknown) => {
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => 'inv-h' }, ...doc, toObject: () => doc }];
  });
  mock.method(POSSale, 'create', async () => {
    throw new Error('simulated POSSale.create failure');
  });

  let productUpdated = false;
  let movementCreated = false;
  let userUpdated = false;
  mock.method(Product, 'findByIdAndUpdate', async () => {
    productUpdated = true;
    return {};
  });
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
  assert.equal(res.status, 500);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(session.endSession.mock.callCount(), 1);
  assert.equal(productUpdated, false);
  assert.equal(movementCreated, false);
  assert.equal(userUpdated, false);
});

test('I — Product stock update failure aborts and skips subsequent writes', async () => {
  assertNoMongoConnection();
  stubCatalogReads();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  let movementCreated = false;
  let userUpdated = false;
  mock.method(Product, 'findByIdAndUpdate', async () => {
    throw new Error('simulated Product.findByIdAndUpdate failure');
  });
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
  assert.equal(res.status, 500);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(session.endSession.mock.callCount(), 1);
  assert.equal(movementCreated, false);
  assert.equal(userUpdated, false);
});

test('J — StockMovement.create failure aborts the transaction', async () => {
  assertNoMongoConnection();
  stubCatalogReads();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  let userUpdated = false;
  mock.method(StockMovement, 'create', async () => {
    throw new Error('simulated StockMovement.create failure');
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
  assert.equal(res.status, 500);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(session.endSession.mock.callCount(), 1);
  assert.equal(userUpdated, false);
});

test('K — User total_spent failure aborts rather than committing the sale', async () => {
  assertNoMongoConnection();
  stubCatalogReads({ withUser: true });
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  mock.method(User, 'findByIdAndUpdate', async () => {
    throw new Error('simulated User.findByIdAndUpdate failure');
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 100 },
    customer_phone: '5551234567',
  });

  assertNoMongoConnection();
  assert.equal(res.status, 500);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(session.endSession.mock.callCount(), 1);
});

test('tender rejection does not start a session', async () => {
  assertNoMongoConnection();
  stubCatalogReads();
  let sessionStarted = false;
  mock.method(mongoose, 'startSession', async () => {
    sessionStarted = true;
    throw new Error('startSession must not run after tender rejection');
  });
  mock.method(Invoice, 'create', async () => {
    throw new Error('Invoice.create must not run after tender rejection');
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 90 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.equal(sessionStarted, false);
});
