/**
 * Phase 2J — POST /api/inventory/adjust atomic delta path.
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/inventoryAdjust.test.ts
 */
import '../load-env';
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
import StockMovement from '../models/StockMovement';
import AuditLog from '../models/AuditLog';
import { StockMovementType } from '../shared/enums';

const PRODUCT_A = '64b0000000000000000c0a01';
const MISSING = '64b0000000000000000c0a99';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '64b0000000000000000ad0a1', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'adjust tests must not open a MongoDB connection');
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

async function postAdjust(body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/inventory/adjust')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

type Harness = {
  session: ReturnType<typeof createFakeSession>;
  stock: { value: number };
  updates: Array<{ update: Record<string, unknown>; options?: unknown }>;
  movements: Array<{ doc: Record<string, unknown>; options: unknown }>;
  audits: unknown[];
  committed: { value: boolean };
};

function stubProduct(stock = 100, opts?: { movementThrows?: boolean }): Harness {
  const product = {
    _id: PRODUCT_A,
    name: 'Widget',
    stock_quantity: stock,
    cost_price: 10,
    price: 20,
  };
  const stockBox = { value: stock };
  const stockSnapshot = stock;
  const updates: Harness['updates'] = [];
  const movements: Harness['movements'] = [];
  const audits: unknown[] = [];
  const committed = { value: false };
  const session = createFakeSession();

  session.abortTransaction = mock.fn(async () => {
    if (!committed.value) {
      stockBox.value = stockSnapshot;
      movements.length = 0;
    }
  });
  session.commitTransaction = mock.fn(async () => {
    committed.value = true;
  });

  mock.method(mongoose, 'startSession', async () => session);

  mock.method(Product, 'findById', async (id: unknown) => {
    if (String(id) !== PRODUCT_A) return null;
    return { ...product, stock_quantity: stockBox.value };
  });

  mock.method(Product, 'findByIdAndUpdate', async (id: unknown, update: Record<string, unknown>, options?: unknown) => {
    if (String(id) !== PRODUCT_A) return null;
    updates.push({ update, options });
    const inc = Number((update.$inc as { stock_quantity?: number } | undefined)?.stock_quantity || 0);
    const set = (update.$set as Record<string, unknown> | undefined) || {};
    if (update.$inc || update.$set) {
      stockBox.value = stockBox.value + inc;
      if (set.cost_price !== undefined) product.cost_price = Number(set.cost_price);
      if (set.price !== undefined) product.price = Number(set.price);
    } else {
      if (typeof update.stock_quantity === 'number') stockBox.value = Number(update.stock_quantity);
      if (update.cost_price !== undefined) product.cost_price = Number(update.cost_price);
      if (update.price !== undefined) product.price = Number(update.price);
    }
    product.stock_quantity = stockBox.value;
    return { ...product, stock_quantity: stockBox.value };
  });

  mock.method(StockMovement, 'create', async (docs: unknown, options?: unknown) => {
    if (opts?.movementThrows) throw new Error('movement write failed');
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    movements.push({ doc, options });
    return [doc];
  });

  mock.method(AuditLog, 'create', async (doc: unknown) => {
    audits.push(doc);
    return doc;
  });

  return { session, stock: stockBox, updates, movements, audits, committed };
}

test('source contract: adjust uses $inc and createStockMovement ADJUSTMENT', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/inventory.ts'), 'utf8');
  assert.match(src, /quantity_change: z\.coerce\.number\(\)\.int\(\)/);
  assert.match(src, /\$inc:\s*\{\s*stock_quantity:\s*quantity_change\s*\}/);
  assert.match(src, /createStockMovement/);
  assert.match(src, /StockMovementType\.ADJUSTMENT/);
  assert.equal(src.includes("movement_type: 'adjustment'"), false);
  assert.equal(src.includes('const newQty = oldQty + quantity_change'), false);
  assert.match(src, /router\.post\('\/physical-count'/);
});

test('A — positive delta 100 + 10 = 110 with canonical ADJUSTMENT before/after', async () => {
  assertNoMongoConnection();
  const h = stubProduct(100);
  const res = await postAdjust({ product_id: PRODUCT_A, quantity_change: 10, notes: 'Found stock' });

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.stock_quantity, 110);
  assert.match(String(res.body.message), /Stock adjusted by \+10/);
  assert.equal(h.stock.value, 110);
  assert.equal(h.committed.value, true);
  assert.equal(h.movements.length, 1);
  const m = h.movements[0].doc;
  assert.equal(m.movement_type, StockMovementType.ADJUSTMENT);
  assert.equal(m.quantity_before, 100);
  assert.equal(m.quantity_change, 10);
  assert.equal(m.quantity_after, 110);
  assert.equal(m.notes, 'Found stock');
  assert.deepEqual(h.updates[0].update.$inc, { stock_quantity: 10 });
  assert.equal((h.updates[0].options as { session?: unknown })?.session, h.session);
  assert.deepEqual(h.movements[0].options, { session: h.session });
  assert.equal(h.audits.length, 1);
});

test('B — negative delta 100 - 10 = 90', async () => {
  assertNoMongoConnection();
  const h = stubProduct(100);
  const res = await postAdjust({ product_id: PRODUCT_A, quantity_change: -10 });

  assert.equal(res.status, 200);
  assert.equal(res.body.stock_quantity, 90);
  assert.equal(h.stock.value, 90);
  assert.equal(h.movements[0].doc.movement_type, StockMovementType.ADJUSTMENT);
  assert.equal(h.movements[0].doc.quantity_before, 100);
  assert.equal(h.movements[0].doc.quantity_change, -10);
  assert.equal(h.movements[0].doc.quantity_after, 90);
});

test('C — zero quantity + price/cost updates without StockMovement or inventory txn', async () => {
  assertNoMongoConnection();
  const h = stubProduct(100);
  mock.method(mongoose, 'startSession', async () => {
    throw new Error('startSession must not run for price-only adjust');
  });

  const res = await postAdjust({ product_id: PRODUCT_A, quantity_change: 0, cost_price: 12, price: 20 });

  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'Prices updated');
  assert.equal(res.body.stock_quantity, 100);
  assert.equal(res.body.cost_price, 12);
  assert.equal(h.movements.length, 0);
  assert.equal(h.stock.value, 100);
  assert.ok(h.updates.some((u) => u.update.$set || u.update.cost_price !== undefined));
});

test('D — nothing to update → 400', async () => {
  assertNoMongoConnection();
  stubProduct(100);
  mock.method(mongoose, 'startSession', async () => {
    throw new Error('startSession must not run');
  });

  const res = await postAdjust({ product_id: PRODUCT_A, quantity_change: 0 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Nothing to update');
});

test('E — missing product → 404', async () => {
  assertNoMongoConnection();
  mock.method(Product, 'findById', async () => null);
  mock.method(mongoose, 'startSession', async () => {
    throw new Error('startSession must not run');
  });

  const res = await postAdjust({ product_id: MISSING, quantity_change: 1 });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Product not found');
});

test('F — movement failure aborts; Product stock unchanged; no committed movement', async () => {
  assertNoMongoConnection();
  const h = stubProduct(100, { movementThrows: true });
  const res = await postAdjust({ product_id: PRODUCT_A, quantity_change: 10 });

  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'Failed to adjust stock');
  assert.equal(h.stock.value, 100);
  assert.equal(h.movements.length, 0);
  assert.equal(h.committed.value, false);
  assert.ok(h.session.abortTransaction.mock.callCount() >= 1);
  assert.equal(h.audits.length, 0);
});

test('G — implementation uses $inc (concurrent deltas compose; no stale absolute $set)', async () => {
  assertNoMongoConnection();
  const h = stubProduct(100);

  const a = await postAdjust({ product_id: PRODUCT_A, quantity_change: 5 });
  assert.equal(a.status, 200);
  assert.equal(h.stock.value, 105);

  // Second adjust on same harness continues from 105 — both deltas preserved
  const b = await postAdjust({ product_id: PRODUCT_A, quantity_change: 5 });
  assert.equal(b.status, 200);
  assert.equal(h.stock.value, 110);
  assert.equal(h.updates.length, 2);
  assert.deepEqual(h.updates[0].update.$inc, { stock_quantity: 5 });
  assert.deepEqual(h.updates[1].update.$inc, { stock_quantity: 5 });
  assert.equal(Object.prototype.hasOwnProperty.call(h.updates[0].update, 'stock_quantity'), false);
  assert.equal(h.movements.length, 2);
  assert.equal(h.movements[0].doc.quantity_before, 100);
  assert.equal(h.movements[0].doc.quantity_after, 105);
  assert.equal(h.movements[1].doc.quantity_before, 105);
  assert.equal(h.movements[1].doc.quantity_after, 110);
});

test('combined qty + price still writes one ADJUSTMENT and updates prices in the same Product write', async () => {
  assertNoMongoConnection();
  const h = stubProduct(50);
  const res = await postAdjust({
    product_id: PRODUCT_A,
    quantity_change: 3,
    cost_price: 8,
    price: 15,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.stock_quantity, 53);
  assert.equal(res.body.cost_price, 8);
  assert.equal(res.body.price, 15);
  assert.deepEqual(h.updates[0].update.$inc, { stock_quantity: 3 });
  assert.deepEqual(h.updates[0].update.$set, { cost_price: 8, price: 15 });
  assert.equal(h.movements.length, 1);
  assert.equal(h.movements[0].doc.quantity_change, 3);
});
