/**
 * TAX-01 — Product → TaxType assignment routes.
 * Isolated harness: no Mongo writes. Product / TaxType are stubbed.
 *
 * Run with:
 *     npx tsx --test src/routes/productsTaxType.test.ts
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
import TaxType from '../models/TaxType';

const GST_ID = '64b1c2d3e4f5a6b7c8d9e0f1';
const VAT_ID = '64b1c2d3e4f5a6b7c8d9e0f2';
const MISSING_TAX = '64b1c2d3e4f5a6b7c8d9e0aa';
const PRODUCT_A = '64c1c2d3e4f5a6b7c8d9e0a1';
const PRODUCT_B = '64c1c2d3e4f5a6b7c8d9e0a2';
const PRODUCT_C = '64c1c2d3e4f5a6b7c8d9e0a3';

const taxTypes: Record<string, { _id: string; name: string; rate: number; rate_type: string }> = {
  [GST_ID]: { _id: GST_ID, name: 'GST', rate: 18, rate_type: 'percent' },
  [VAT_ID]: { _id: VAT_ID, name: 'VAT', rate: 12, rate_type: 'percent' },
};

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: 'tax01-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'TAX-01 tests must not open a MongoDB connection');
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

function createdDoc(fields: Record<string, unknown>) {
  const _id = { toString: () => PRODUCT_A };
  return {
    _id,
    toObject: () => ({ _id, ...fields }),
    ...fields,
  };
}

afterEach(() => {
  mock.restoreAll();
});

function stubTaxTypeLookup() {
  mock.method(TaxType, 'findById', (id: unknown) => {
    const key = String(id);
    const doc = taxTypes[key];
    return {
      select: () => ({
        lean: async () => (doc ? { _id: doc._id } : null),
      }),
      lean: async () => doc || null,
    };
  });
}

function stubGenerateId() {
  mock.method(Product, 'findOne', () => ({
    lean: async () => null,
  }));
}

test('POST /api/products assigns a valid TaxType and leaves price/tax_rate as sent', async () => {
  assertNoMongoConnection();
  stubTaxTypeLookup();
  stubGenerateId();
  let created: Record<string, unknown> | undefined;
  mock.method(Product, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return createdDoc({
      name: doc.name,
      price: doc.price,
      tax_rate: doc.tax_rate,
      tax_type_id: doc.tax_type_id,
      product_id: '10001',
    });
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'Product ABC', price: 4.99, tax_rate: 0, tax_type_id: GST_ID });

  assert.equal(res.status, 201);
  assert.ok(created);
  assert.equal(created.price, 4.99);
  assert.equal(created.tax_rate, 0);
  assert.equal(String(created.tax_type_id), GST_ID);
});

test('POST /api/products stores explicit No Tax as null tax_type_id', async () => {
  assertNoMongoConnection();
  stubTaxTypeLookup();
  stubGenerateId();
  let created: Record<string, unknown> | undefined;
  mock.method(Product, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return createdDoc(doc);
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'No Tax Item', price: 1.99, tax_type_id: null });

  assert.equal(res.status, 201);
  assert.equal(created?.tax_type_id, null);
  assert.equal(created?.price, 1.99);
});

test('POST /api/products rejects a nonexistent TaxType', async () => {
  assertNoMongoConnection();
  stubTaxTypeLookup();
  stubGenerateId();
  mock.method(Product, 'create', async () => {
    throw new Error('create must not run for invalid TaxType');
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'Bad Tax', price: 4.99, tax_type_id: MISSING_TAX });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /Tax type not found|Invalid tax_type_id/);
});

test('PUT /api/products/:id changes TaxType and does not rewrite price', async () => {
  assertNoMongoConnection();
  stubTaxTypeLookup();
  const existing = { _id: PRODUCT_A, name: 'ABC', price: 4.99, tax_rate: 8.5, product_id: '10001' };
  mock.method(Product, 'findById', (id: unknown) => {
    if (String(id) !== PRODUCT_A) return { lean: async () => null };
    return {
      lean: async () => existing,
    };
  });
  let savedUpdate: Record<string, unknown> | undefined;
  mock.method(Product, 'findByIdAndUpdate', async (_id: unknown, update: Record<string, unknown>) => {
    savedUpdate = update;
    const { _id: _ignored, ...existingFields } = existing;
    return {
      _id: { toString: () => PRODUCT_A },
      toObject: () => ({ _id: PRODUCT_A, ...existingFields, ...update }),
      ...existingFields,
      ...update,
    };
  });

  const res = await request(createApp())
    .put(`/api/products/${PRODUCT_A}`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ tax_type_id: VAT_ID });

  assert.equal(res.status, 200);
  assert.equal(String(savedUpdate?.tax_type_id), VAT_ID);
  assert.equal(savedUpdate?.price, undefined);
  assert.equal(savedUpdate?.tax_rate, undefined);
});

test('POST /api/products/bulk-assign-tax-type updates only selected ids', async () => {
  assertNoMongoConnection();
  stubTaxTypeLookup();
  let filter: Record<string, unknown> | undefined;
  let update: Record<string, unknown> | undefined;
  mock.method(Product, 'countDocuments', async () => 2);
  mock.method(Product, 'updateMany', async (q: Record<string, unknown>, u: Record<string, unknown>) => {
    filter = q;
    update = u;
    return { modifiedCount: 2, matchedCount: 2 };
  });

  const res = await request(createApp())
    .post('/api/products/bulk-assign-tax-type')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ ids: [PRODUCT_A, PRODUCT_B], tax_type_id: GST_ID });

  assert.equal(res.status, 200);
  assert.equal(res.body.modified, 2);
  const selected = (filter?._id as { $in: unknown[] }).$in.map(String);
  assert.deepEqual(selected, [PRODUCT_A, PRODUCT_B]);
  assert.ok(!selected.includes(PRODUCT_C));
  const set = (update as { $set?: Record<string, unknown> }).$set || {};
  assert.equal(String(set.tax_type_id), GST_ID);
  assert.equal(set.price, undefined);
  assert.equal(set.tax_rate, undefined);
});

test('POST /api/products/bulk-assign-tax-type rejects an invalid TaxType', async () => {
  assertNoMongoConnection();
  stubTaxTypeLookup();
  mock.method(Product, 'updateMany', async () => {
    throw new Error('updateMany must not run for invalid TaxType');
  });

  const res = await request(createApp())
    .post('/api/products/bulk-assign-tax-type')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ ids: [PRODUCT_A], tax_type_id: MISSING_TAX });

  assert.equal(res.status, 400);
});

test('POST /api/products without tax_type_id leaves assignment unconfigured', async () => {
  assertNoMongoConnection();
  stubTaxTypeLookup();
  stubGenerateId();
  let created: Record<string, unknown> | undefined;
  mock.method(Product, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return createdDoc(doc);
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'Legacy Create', price: 9.99 });

  assert.equal(res.status, 201);
  assert.equal(Object.prototype.hasOwnProperty.call(created, 'tax_type_id'), false);
  assert.equal(created?.price, 9.99);
  assert.equal(created?.tax_rate, 0);
});
