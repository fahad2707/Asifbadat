/**
 * Phase 1 physical count — isolated harness, no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/physicalCount.test.ts
 */
import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import { StockMovementType } from '../shared/enums';

const PRODUCT_A = '64b0000000000000000c0001';
const PRODUCT_B = '64b0000000000000000c0002';
const MISSING = '64b0000000000000000c0099';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: 'count-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'physical count tests must not open a MongoDB connection');
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

const catalog: Record<string, { name: string; stock_quantity: number }> = {
  [PRODUCT_A]: { name: 'Lays Box', stock_quantity: 48 },
  [PRODUCT_B]: { name: 'Oreo', stock_quantity: 48 },
};

function stubCatalog() {
  mock.method(Product, 'findById', async (id: unknown) => {
    const key = String(id);
    const row = catalog[key];
    if (!row) return null;
    return { _id: key, name: row.name, stock_quantity: row.stock_quantity };
  });
}

async function postCount(body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/inventory/physical-count')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

test('48 → 50 writes +2, final 50, and a PHYSICAL_COUNT movement with before/after', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(StockMovement, 'findOne', async () => null);

  let updateArgs: unknown[] | undefined;
  mock.method(Product, 'findOneAndUpdate', async (...args: unknown[]) => {
    updateArgs = args;
    return { _id: PRODUCT_A, stock_quantity: 50 };
  });

  let movementDocs: Record<string, unknown> | undefined;
  mock.method(StockMovement, 'create', async (docs: unknown) => {
    movementDocs = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    return [{}];
  });

  const res = await postCount({
    product_id: PRODUCT_A,
    counted_quantity: 50,
    reason: 'PHYSICAL_COUNT',
    notes: 'Warehouse recount',
  });

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.lines[0].quantity_before, 48);
  assert.equal(res.body.lines[0].quantity_delta, 2);
  assert.equal(res.body.lines[0].quantity_after, 50);
  assert.equal(res.body.lines[0].changed, true);
  assert.match(String(res.body.reference_number), /^ADJ-\d{8}-0001$/);
  assert.deepEqual(updateArgs?.[1], { $inc: { stock_quantity: 2 } });
  assert.equal((updateArgs?.[2] as { session?: unknown }).session, session);
  assert.equal(movementDocs?.movement_type, StockMovementType.PHYSICAL_COUNT);
  assert.equal(movementDocs?.quantity_before, 48);
  assert.equal(movementDocs?.quantity_change, 2);
  assert.equal(movementDocs?.quantity_after, 50);
  assert.equal(movementDocs?.reason, 'PHYSICAL_COUNT');
  assert.equal(movementDocs?.notes, 'Warehouse recount');
  assert.equal(session.commitTransaction.mock.callCount(), 1);
  assert.equal(session.abortTransaction.mock.callCount(), 0);
});

test('48 → 45 writes -3, final 45', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(StockMovement, 'findOne', async () => null);
  mock.method(Product, 'findOneAndUpdate', async () => ({ _id: PRODUCT_A, stock_quantity: 45 }));
  mock.method(StockMovement, 'create', async () => [{}]);

  const res = await postCount({ product_id: PRODUCT_A, counted_quantity: 45 });

  assert.equal(res.status, 200);
  assert.equal(res.body.lines[0].quantity_before, 48);
  assert.equal(res.body.lines[0].quantity_delta, -3);
  assert.equal(res.body.lines[0].quantity_after, 45);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
});

test('48 → 48 is a successful no-op with no stock mutation or movement', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let updated = false;
  let movementCreated = false;
  mock.method(Product, 'findOneAndUpdate', async () => {
    updated = true;
    return { stock_quantity: 48 };
  });
  mock.method(StockMovement, 'create', async () => {
    movementCreated = true;
    return [{}];
  });
  mock.method(StockMovement, 'findOne', async () => {
    throw new Error('number generation must not run for an all-noop count');
  });

  const res = await postCount({ product_id: PRODUCT_A, counted_quantity: 48 });

  assert.equal(res.status, 200);
  assert.equal(res.body.reference_number, null);
  assert.equal(res.body.lines[0].changed, false);
  assert.equal(res.body.lines[0].quantity_delta, 0);
  assert.equal(updated, false);
  assert.equal(movementCreated, false);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
});

test('missing product is 404 and does not update stock', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  let updated = false;
  mock.method(Product, 'findOneAndUpdate', async () => {
    updated = true;
    return {};
  });

  const res = await postCount({ product_id: MISSING, counted_quantity: 50 });

  assert.equal(res.status, 404);
  assert.equal(updated, false);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
});

test('negative counted quantity is rejected', async () => {
  assertNoMongoConnection();
  const res = await postCount({ product_id: PRODUCT_A, counted_quantity: -1 });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /negative/i);
});

test('non-numeric counted quantity is rejected', async () => {
  assertNoMongoConnection();
  const res = await postCount({ product_id: PRODUCT_A, counted_quantity: 'fifty' });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /number/i);
});

test('decimal counted quantity is rejected (stock is whole units)', async () => {
  assertNoMongoConnection();
  const res = await postCount({ product_id: PRODUCT_A, counted_quantity: 50.5 });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /whole number/i);
});

test('movement create failure aborts and does not commit stock', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(StockMovement, 'findOne', async () => null);
  mock.method(Product, 'findOneAndUpdate', async () => ({ _id: PRODUCT_A, stock_quantity: 50 }));
  mock.method(StockMovement, 'create', async () => {
    throw new Error('movement write failed');
  });

  const res = await postCount({ product_id: PRODUCT_A, counted_quantity: 50 });

  assert.equal(res.status, 500);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
});

test('stock update failure does not persist a movement', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(StockMovement, 'findOne', async () => null);
  mock.method(Product, 'findOneAndUpdate', async () => null);
  let movementCreated = false;
  mock.method(StockMovement, 'create', async () => {
    movementCreated = true;
    return [{}];
  });

  const res = await postCount({ product_id: PRODUCT_A, counted_quantity: 50 });

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'STOCK_CONFLICT');
  assert.equal(movementCreated, false);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
});

test('expected 48 vs actual 46 is 409 and skips stock update', async () => {
  assertNoMongoConnection();
  mock.method(Product, 'findById', async () => ({
    _id: PRODUCT_A,
    name: 'Lays Box',
    stock_quantity: 46,
  }));
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  let updated = false;
  mock.method(Product, 'findOneAndUpdate', async () => {
    updated = true;
    return { stock_quantity: 50 };
  });
  let movementCreated = false;
  mock.method(StockMovement, 'create', async () => {
    movementCreated = true;
    return [{}];
  });

  const res = await postCount({
    product_id: PRODUCT_A,
    counted_quantity: 50,
    expected_current_quantity: 48,
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'STOCK_CONFLICT');
  assert.equal(res.body.actual_current_quantity, 46);
  assert.equal(res.body.expected_current_quantity, 48);
  assert.equal(updated, false);
  assert.equal(movementCreated, false);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
});

test('multi-line batch is all-or-nothing: one missing product aborts the rest', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  let updated = false;
  mock.method(Product, 'findOneAndUpdate', async () => {
    updated = true;
    return { stock_quantity: 50 };
  });

  const res = await postCount({
    lines: [
      { product_id: PRODUCT_A, counted_quantity: 50, expected_current_quantity: 48 },
      { product_id: MISSING, counted_quantity: 45, expected_current_quantity: 48 },
    ],
    notes: 'October warehouse recount',
  });

  assert.equal(res.status, 404);
  assert.equal(updated, false);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
});

test('multi-line success posts both movements then commits once', async () => {
  assertNoMongoConnection();
  stubCatalog();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(StockMovement, 'findOne', async () => null);
  mock.method(Product, 'findOneAndUpdate', async (_filter: unknown, update: { $inc?: { stock_quantity?: number } }) => {
    const inc = update.$inc?.stock_quantity ?? 0;
    return { stock_quantity: 48 + inc };
  });
  const created: Record<string, unknown>[] = [];
  mock.method(StockMovement, 'create', async (docs: unknown) => {
    created.push(Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>));
    return [{}];
  });

  const res = await postCount({
    lines: [
      { product_id: PRODUCT_A, counted_quantity: 50, expected_current_quantity: 48 },
      { product_id: PRODUCT_B, counted_quantity: 45, expected_current_quantity: 48 },
    ],
    reason: 'PHYSICAL_COUNT',
    notes: 'October warehouse recount',
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.lines.length, 2);
  assert.equal(res.body.lines[0].quantity_delta, 2);
  assert.equal(res.body.lines[1].quantity_delta, -3);
  assert.equal(created.length, 2);
  assert.equal(created[0].reference_number, created[1].reference_number);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
});

test('POST /inventory/adjust is still a delta endpoint (source contract)', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const src = readFileSync(join(process.cwd(), 'src/routes/inventory.ts'), 'utf8');
  assert.match(src, /quantity_change: z\.coerce\.number\(\)\.int\(\)/);
  assert.match(src, /const newQty = oldQty \+ quantity_change/);
  assert.match(src, /router\.post\('\/physical-count'/);
});
