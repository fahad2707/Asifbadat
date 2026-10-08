/**
 * Phase 2F — product create opening stock + PUT catalog stock lock.
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/productsOpeningStock.test.ts
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
import TaxType from '../models/TaxType';
import AuditLog from '../models/AuditLog';
import { StockMovementType } from '../shared/enums';
import {
  OPENING_STOCK_REASON,
  OPENING_STOCK_REFERENCE_TYPE,
  shouldWriteOpeningStockMovement,
} from '../utils/openingStockMovement';

const PRODUCT_ID = '64b0000000000000000c0001';
const ADMIN_ID = '64b0000000000000000a0001';

afterEach(() => {
  mock.restoreAll();
});

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: ADMIN_ID, role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'Phase 2F product tests must not open a MongoDB connection');
}

function firstCreateDoc(docs: unknown): Record<string, unknown> {
  return (Array.isArray(docs) ? docs[0] : docs) as Record<string, unknown>;
}

function createdDoc(fields: Record<string, unknown>) {
  const _id = { toString: () => PRODUCT_ID };
  return {
    _id,
    toObject: () => ({ _id, ...fields }),
    ...fields,
  };
}

function stubTaxAndId() {
  mock.method(TaxType, 'findById', () => ({
    select: () => ({ lean: async () => null }),
    lean: async () => null,
  }));
  mock.method(Product, 'findOne', () => ({
    lean: async () => null,
  }));
}

function createFakeSession() {
  return {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
}

test('opening movement predicate skips zero qty and non-inventory types', () => {
  assert.equal(shouldWriteOpeningStockMovement('inventory', 10), true);
  assert.equal(shouldWriteOpeningStockMovement('inventory', 0), false);
  assert.equal(shouldWriteOpeningStockMovement(undefined, -3), true);
  assert.equal(shouldWriteOpeningStockMovement('service', 10), false);
  assert.equal(shouldWriteOpeningStockMovement('non_inventory', 10), false);
});

test('A — inventory create qty 10 writes one ADJUSTMENT opening movement', async () => {
  assertNoMongoConnection();
  stubTaxAndId();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let created: Record<string, unknown> | undefined;
  mock.method(Product, 'create', async (docs: unknown) => {
    created = firstCreateDoc(docs);
    return createdDoc({ ...created, _id: { toString: () => PRODUCT_ID } });
  });

  const movements: Array<{ doc: Record<string, unknown>; options: unknown }> = [];
  mock.method(StockMovement, 'create', async (docs: unknown, options?: unknown) => {
    const doc = firstCreateDoc(docs);
    movements.push({ doc, options });
    return [doc];
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'Opening Widget', price: 4.99, stock_quantity: 10 });

  assert.equal(res.status, 201);
  assert.equal(created?.stock_quantity, 10);
  assert.equal(created?.product_type, 'inventory');
  assert.equal(movements.length, 1);
  const movement = movements[0].doc;
  assert.equal(movement.movement_type, StockMovementType.ADJUSTMENT);
  assert.equal(movement.quantity_before, 0);
  assert.equal(movement.quantity_change, 10);
  assert.equal(movement.quantity_after, 10);
  assert.equal(movement.reference_type, OPENING_STOCK_REFERENCE_TYPE);
  assert.equal(String(movement.reference_id), PRODUCT_ID);
  assert.equal(String(movement.product_id), PRODUCT_ID);
  assert.equal(movement.reason, OPENING_STOCK_REASON);
  assert.deepEqual(movements[0].options, { session });
  assert.equal((session.commitTransaction as { mock: { calls: unknown[] } }).mock.calls.length, 1);
  assert.equal((session.abortTransaction as { mock: { calls: unknown[] } }).mock.calls.length, 0);
});

test('B — inventory create qty 0 writes stock 0 and no movement', async () => {
  assertNoMongoConnection();
  stubTaxAndId();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let created: Record<string, unknown> | undefined;
  mock.method(Product, 'create', async (docs: unknown) => {
    created = firstCreateDoc(docs);
    return createdDoc(created);
  });
  mock.method(StockMovement, 'create', async () => {
    throw new Error('StockMovement.create must not run for zero opening qty');
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'Zero Stock', price: 1.99, stock_quantity: 0 });

  assert.equal(res.status, 201);
  assert.equal(created?.stock_quantity, 0);
});

test('C — service/non_inventory create with qty writes no opening movement', async () => {
  assertNoMongoConnection();
  stubTaxAndId();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  mock.method(Product, 'create', async (docs: unknown) => createdDoc(firstCreateDoc(docs)));
  mock.method(StockMovement, 'create', async () => {
    throw new Error('StockMovement.create must not run for service/non_inventory');
  });

  const service = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'Delivery Fee', price: 5, product_type: 'service', stock_quantity: 10 });
  assert.equal(service.status, 201);

  const nonInventory = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'Bag Fee', price: 0.25, product_type: 'non_inventory', stock_quantity: 10 });
  assert.equal(nonInventory.status, 201);
});

test('D — PUT stock_quantity 80 leaves existing on-hand 50 and writes no movement', async () => {
  assertNoMongoConnection();
  const existing = {
    _id: PRODUCT_ID,
    name: 'Widget',
    price: 4.99,
    stock_quantity: 50,
    product_id: '10001',
    product_type: 'inventory',
  };
  mock.method(Product, 'findById', () => ({
    lean: async () => existing,
  }));
  let savedUpdate: Record<string, unknown> | undefined;
  mock.method(Product, 'findByIdAndUpdate', async (_id: unknown, update: Record<string, unknown>) => {
    savedUpdate = update;
    return {
      ...existing,
      ...update,
      _id: { toString: () => PRODUCT_ID },
      toObject: () => ({ ...existing, ...update, stock_quantity: existing.stock_quantity }),
      stock_quantity: existing.stock_quantity,
    };
  });
  mock.method(StockMovement, 'create', async () => {
    throw new Error('StockMovement.create must not run for catalog PUT');
  });

  const res = await request(createApp())
    .put(`/api/products/${PRODUCT_ID}`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ stock_quantity: 80, name: 'Widget' });

  assert.equal(res.status, 200);
  assert.equal(Object.prototype.hasOwnProperty.call(savedUpdate || {}, 'stock_quantity'), false);
  assert.equal(res.body.stock_quantity, 50);
});

test('E — PUT name/price only updates catalog fields and leaves stock 50', async () => {
  assertNoMongoConnection();
  const existing = {
    _id: PRODUCT_ID,
    name: 'Widget',
    price: 4.99,
    stock_quantity: 50,
    product_id: '10001',
    product_type: 'inventory',
  };
  mock.method(Product, 'findById', () => ({
    lean: async () => existing,
  }));
  let savedUpdate: Record<string, unknown> | undefined;
  mock.method(Product, 'findByIdAndUpdate', async (_id: unknown, update: Record<string, unknown>) => {
    savedUpdate = update;
    return {
      ...existing,
      ...update,
      _id: { toString: () => PRODUCT_ID },
      toObject: () => ({
        ...existing,
        name: update.name,
        price: update.price,
        stock_quantity: existing.stock_quantity,
      }),
      stock_quantity: existing.stock_quantity,
    };
  });
  mock.method(AuditLog, 'create', async () => ({}));
  mock.method(StockMovement, 'create', async () => {
    throw new Error('StockMovement.create must not run for catalog PUT');
  });

  const res = await request(createApp())
    .put(`/api/products/${PRODUCT_ID}`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'Widget Plus', price: 6.49 });

  assert.equal(res.status, 200);
  assert.equal(savedUpdate?.name, 'Widget Plus');
  assert.equal(savedUpdate?.price, 6.49);
  assert.equal(Object.prototype.hasOwnProperty.call(savedUpdate || {}, 'stock_quantity'), false);
  assert.equal(res.body.stock_quantity, 50);
});

test('J — opening movement failure aborts and leaves no product', async () => {
  assertNoMongoConnection();
  stubTaxAndId();
  let persisted: Record<string, unknown> | null = null;
  let committed = false;
  const session = {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {
      committed = true;
    }),
    abortTransaction: mock.fn(async () => {
      if (!committed) persisted = null;
    }),
    endSession: mock.fn(),
  };
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Product, 'create', async (docs: unknown) => {
    persisted = firstCreateDoc(docs);
    return createdDoc(persisted);
  });
  mock.method(StockMovement, 'create', async () => {
    throw new Error('simulated opening movement failure');
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'Rollback Widget', price: 3, stock_quantity: 10 });

  assert.equal(res.status, 500);
  assert.equal(persisted, null);
  assert.equal(committed, false);
  assert.equal((session.abortTransaction as { mock: { calls: unknown[] } }).mock.calls.length, 1);
  assert.equal((session.commitTransaction as { mock: { calls: unknown[] } }).mock.calls.length, 0);
});
