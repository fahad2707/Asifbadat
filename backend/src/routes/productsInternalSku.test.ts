/**
 * Phase B2 — POST /api/products/:id/generate-internal-sku
 *
 * Isolated harness: Product model methods are stubbed. No live Mongo writes.
 * Concurrent/duplicate-key behavior is simulated via mocks only — these tests
 * do not prove a real MongoDB race guarantee.
 *
 * Run: npx tsx --test src/routes/productsInternalSku.test.ts
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

const PRODUCT_OID = '64c1c2d3e4f5a6b7c8d9e0b2';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'B2 tests must not open a MongoDB connection');
}

function adminToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET required');
  return jwt.sign({ adminId: 'b2-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function userToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET required');
  return jwt.sign({ userId: '64b0000000000000000a0001', phone: '5550100' }, secret, { expiresIn: '8h' });
}

function leanDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => PRODUCT_OID },
    product_id: '48217',
    sku: undefined,
    barcode: undefined,
    plu: undefined,
    stock_quantity: 42,
    price: 19.99,
    ...overrides,
  };
}

function chainFindById(result: unknown) {
  return {
    select: () => ({
      lean: async () => result,
    }),
  };
}

function chainFindOneAndUpdate(result: unknown) {
  return {
    select: () => ({
      lean: async () => result,
    }),
  };
}

test('B2: generates EDI-<product_id> when sku is missing', async () => {
  assertNoMongoConnection();
  const before = leanDoc({ sku: undefined });
  const after = leanDoc({ sku: 'EDI-48217' });
  mock.method(Product, 'findById', () => chainFindById(before));
  mock.method(Product, 'findOneAndUpdate', (_filter: unknown, update: Record<string, unknown>) => {
    const set = (update as { $set?: Record<string, unknown> }).$set || {};
    assert.equal(set.sku, 'EDI-48217');
    assert.equal('barcode' in set, false);
    assert.equal('plu' in set, false);
    assert.equal('product_id' in set, false);
    assert.equal('stock_quantity' in set, false);
    assert.equal('price' in set, false);
    return chainFindOneAndUpdate(after);
  });

  const res = await request(createApp())
    .post(`/api/products/${PRODUCT_OID}/generate-internal-sku`)
    .set('Authorization', `Bearer ${adminToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.sku, 'EDI-48217');
  assert.equal(res.body.product_id, '48217');
  assert.equal(res.body.created, true);
  assertNoMongoConnection();
});

test('B2: existing manufacturer SKU is preserved (idempotent no overwrite)', async () => {
  assertNoMongoConnection();
  const withSku = leanDoc({ sku: '012345678905' });
  let updateCalls = 0;
  mock.method(Product, 'findById', () => chainFindById(withSku));
  mock.method(Product, 'findOneAndUpdate', () => {
    updateCalls += 1;
    return chainFindOneAndUpdate(null);
  });

  const res = await request(createApp())
    .post(`/api/products/${PRODUCT_OID}/generate-internal-sku`)
    .set('Authorization', `Bearer ${adminToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.sku, '012345678905');
  assert.equal(res.body.created, false);
  assert.equal(updateCalls, 0);
  assert.match(String(res.body.message || ''), /preserved/i);
  assertNoMongoConnection();
});

test('B2: repeated generation is idempotent when internal SKU already set', async () => {
  assertNoMongoConnection();
  mock.method(Product, 'findById', () => chainFindById(leanDoc({ sku: 'EDI-48217' })));

  const res = await request(createApp())
    .post(`/api/products/${PRODUCT_OID}/generate-internal-sku`)
    .set('Authorization', `Bearer ${adminToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.sku, 'EDI-48217');
  assert.equal(res.body.created, false);
  assertNoMongoConnection();
});

test('B2: missing product returns 404', async () => {
  assertNoMongoConnection();
  mock.method(Product, 'findById', () => chainFindById(null));

  const res = await request(createApp())
    .post(`/api/products/${PRODUCT_OID}/generate-internal-sku`)
    .set('Authorization', `Bearer ${adminToken()}`);

  assert.equal(res.status, 404);
  assert.match(String(res.body.error || ''), /not found/i);
  assertNoMongoConnection();
});

test('B2: invalid product id returns 400', async () => {
  assertNoMongoConnection();
  const res = await request(createApp())
    .post('/api/products/not-a-valid-oid/generate-internal-sku')
    .set('Authorization', `Bearer ${adminToken()}`);
  assert.equal(res.status, 400);
  assertNoMongoConnection();
});

test('B2: non-admin is denied', async () => {
  assertNoMongoConnection();
  const res = await request(createApp())
    .post(`/api/products/${PRODUCT_OID}/generate-internal-sku`)
    .set('Authorization', `Bearer ${userToken()}`);
  assert.ok(res.status === 401 || res.status === 403);
  assertNoMongoConnection();
});

test('B2: unauthenticated is denied', async () => {
  assertNoMongoConnection();
  const res = await request(createApp()).post(`/api/products/${PRODUCT_OID}/generate-internal-sku`);
  assert.ok(res.status === 401 || res.status === 403);
  assertNoMongoConnection();
});

test('B2: concurrent race — peer assigned SKU first (mock-only, not a live Mongo guarantee)', async () => {
  assertNoMongoConnection();
  let findByIdCount = 0;
  mock.method(Product, 'findById', () => {
    findByIdCount += 1;
    if (findByIdCount === 1) return chainFindById(leanDoc({ sku: undefined }));
    return chainFindById(leanDoc({ sku: 'EDI-48217' }));
  });
  mock.method(Product, 'findOneAndUpdate', () => chainFindOneAndUpdate(null));

  const res = await request(createApp())
    .post(`/api/products/${PRODUCT_OID}/generate-internal-sku`)
    .set('Authorization', `Bearer ${adminToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.sku, 'EDI-48217');
  assert.equal(res.body.created, false);
  assertNoMongoConnection();
});

test('B2: duplicate-key conflict when another product owns EDI-<id> (mock-only)', async () => {
  assertNoMongoConnection();
  let findByIdCount = 0;
  mock.method(Product, 'findById', () => {
    findByIdCount += 1;
    return chainFindById(leanDoc({ sku: undefined }));
  });
  mock.method(Product, 'findOneAndUpdate', () => {
    const err: Error & { code?: number } = new Error('E11000 duplicate key');
    err.code = 11000;
    throw err;
  });

  const res = await request(createApp())
    .post(`/api/products/${PRODUCT_OID}/generate-internal-sku`)
    .set('Authorization', `Bearer ${adminToken()}`);

  assert.equal(res.status, 409);
  assert.match(String(res.body.error || ''), /already in use/i);
  assert.ok(findByIdCount >= 2);
  assertNoMongoConnection();
});
