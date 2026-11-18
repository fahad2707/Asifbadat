/**
 * Isolated harness for product tobacco compliance create/update.
 * No Mongo writes. Product is stubbed.
 *
 * Run with:
 *     npx tsx --test src/routes/productsTobaccoCompliance.test.ts
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

const PRODUCT_A = '64c1c2d3e4f5a6b7c8d9e0a1';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: 'tobacco-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
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
  mock.method(TaxType, 'findById', () => ({
    select: () => ({ lean: async () => null }),
    lean: async () => null,
  }));
}

function stubGenerateId() {
  mock.method(Product, 'findOne', () => ({
    lean: async () => null,
  }));
}

function stubCreateSession() {
  mock.method(mongoose, 'startSession', async () => ({
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  }));
}

function firstCreateDoc(docs: unknown): Record<string, unknown> {
  return (Array.isArray(docs) ? docs[0] : docs) as Record<string, unknown>;
}

test('POST /api/products without tobacco fields defaults to unknown and does not set packs_per_stock_unit', async () => {
  stubTaxTypeLookup();
  stubGenerateId();
  stubCreateSession();
  let created: Record<string, unknown> | undefined;
  mock.method(Product, 'create', async (docs: unknown) => {
    created = firstCreateDoc(docs);
    return createdDoc(created);
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'Plain Widget', price: 9.99 });

  assert.equal(res.status, 201);
  assert.equal(created?.tobacco_class, 'unknown');
  assert.equal('packs_per_stock_unit' in (created || {}), false);
  assert.equal(created?.stock_quantity, 0);
});

test('POST /api/products can set a complete cigarette compliance profile', async () => {
  stubTaxTypeLookup();
  stubGenerateId();
  stubCreateSession();
  let created: Record<string, unknown> | undefined;
  mock.method(Product, 'create', async (docs: unknown) => {
    created = firstCreateDoc(docs);
    return createdDoc(created);
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({
      name: 'Marlboro Pack',
      price: 12,
      tobacco_class: 'cigarette',
      cigarette_pack_size: 20,
      stock_unit: 'pack',
      packs_per_stock_unit: 1,
    });

  assert.equal(res.status, 201);
  assert.equal(created?.tobacco_class, 'cigarette');
  assert.equal(created?.cigarette_pack_size, 20);
  assert.equal(created?.stock_unit, 'pack');
  assert.equal(created?.packs_per_stock_unit, 1);
});

test('POST /api/products rejects invalid tobacco_class', async () => {
  stubTaxTypeLookup();
  stubGenerateId();
  mock.method(Product, 'create', async () => {
    throw new Error('create must not run for invalid tobacco_class');
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'Bad Class', price: 1, tobacco_class: 'pipe_tobacco' });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /tobacco_class/);
});

test('POST /api/products accepts pack stock unit with packs_per_stock_unit = 1', async () => {
  stubTaxTypeLookup();
  stubGenerateId();
  stubCreateSession();
  let created: Record<string, unknown> | undefined;
  mock.method(Product, 'create', async (docs: unknown) => {
    created = firstCreateDoc(docs);
    return createdDoc(created);
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({
      name: 'Pack OK',
      price: 12,
      tobacco_class: 'cigarette',
      stock_unit: 'pack',
      packs_per_stock_unit: 1,
    });

  assert.equal(res.status, 201);
  assert.equal(created?.stock_unit, 'pack');
  assert.equal(created?.packs_per_stock_unit, 1);
});

test('POST /api/products rejects pack stock unit with packs_per_stock_unit = 10', async () => {
  stubTaxTypeLookup();
  stubGenerateId();
  mock.method(Product, 'create', async () => {
    throw new Error('create must not run for pack = 10');
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({
      name: 'Pack Bad',
      price: 12,
      tobacco_class: 'cigarette',
      stock_unit: 'pack',
      packs_per_stock_unit: 10,
    });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /must be 1/);
});

test('POST /api/products rejects carton without explicit packs_per_stock_unit', async () => {
  stubTaxTypeLookup();
  stubGenerateId();
  mock.method(Product, 'create', async () => {
    throw new Error('create must not run for carton without conversion');
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({
      name: 'Carton Incomplete',
      price: 12,
      tobacco_class: 'cigarette',
      stock_unit: 'carton',
    });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /explicit positive integer/);
});

test('POST /api/products rejects invalid cigarette_pack_size', async () => {
  stubTaxTypeLookup();
  stubGenerateId();
  mock.method(Product, 'create', async () => {
    throw new Error('create must not run for invalid pack size');
  });

  const res = await request(createApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'Bad Pack', price: 1, tobacco_class: 'cigarette', cigarette_pack_size: 10 });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /20 or 25/);
});

test('PUT /api/products/:id updates compliance profile without rewriting stock_quantity', async () => {
  const existing = {
    _id: PRODUCT_A,
    name: 'ABC',
    price: 4.99,
    stock_quantity: 40,
    product_id: '10001',
    tobacco_class: 'unknown',
  };
  mock.method(Product, 'findById', () => ({ lean: async () => existing }));
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
    .send({
      tobacco_class: 'cigarette',
      cigarette_pack_size: 25,
      stock_unit: 'carton',
      packs_per_stock_unit: 10,
      stock_quantity: 999,
    });

  assert.equal(res.status, 200);
  assert.equal(savedUpdate?.tobacco_class, 'cigarette');
  assert.equal(savedUpdate?.cigarette_pack_size, 25);
  assert.equal(savedUpdate?.stock_unit, 'carton');
  assert.equal(savedUpdate?.packs_per_stock_unit, 10);
  assert.equal(savedUpdate?.stock_quantity, undefined);
});

test('PUT /api/products/:id unsets packs_per_stock_unit instead of defaulting to 1', async () => {
  const existing = {
    _id: PRODUCT_A,
    name: 'ABC',
    price: 4.99,
    product_id: '10001',
    tobacco_class: 'cigarette',
    packs_per_stock_unit: 10,
  };
  mock.method(Product, 'findById', () => ({ lean: async () => existing }));
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
    .send({ packs_per_stock_unit: null });

  assert.equal(res.status, 200);
  const unset = (savedUpdate as { $unset?: Record<string, number> })?.$unset || {};
  assert.equal(unset.packs_per_stock_unit, 1);
  assert.equal(savedUpdate?.packs_per_stock_unit, undefined);
});

// --- Partial updates are validated against the merged (stored + incoming) profile ---

const EXISTING_CARTON_PRODUCT = {
  _id: PRODUCT_A,
  name: 'ABC Carton',
  price: 89.99,
  stock_quantity: 40,
  product_id: '10001',
  tobacco_class: 'cigarette',
  cigarette_pack_size: 20,
  stock_unit: 'carton',
  packs_per_stock_unit: 10,
};

/** Stubs the stored carton product and records every write the route attempts. */
function stubExistingCartonProduct() {
  mock.method(Product, 'findById', () => ({ lean: async () => EXISTING_CARTON_PRODUCT }));
  const updates: Record<string, unknown>[] = [];
  mock.method(Product, 'findByIdAndUpdate', async (_id: unknown, update: Record<string, unknown>) => {
    updates.push(update);
    const { _id: _ignored, ...existingFields } = EXISTING_CARTON_PRODUCT;
    return {
      _id: { toString: () => PRODUCT_A },
      toObject: () => ({ _id: PRODUCT_A, ...existingFields, ...update }),
      ...existingFields,
      ...update,
    };
  });
  return updates;
}

test('PUT /api/products/:id rejects switching a carton (factor 10) to pack without fixing the factor', async () => {
  const updates = stubExistingCartonProduct();

  const res = await request(createApp())
    .put(`/api/products/${PRODUCT_A}`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ stock_unit: 'pack' });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /packs_per_stock_unit must be 1/);
  assert.equal(updates.length, 0, 'nothing may be written when the merged profile is invalid');
});

test('PUT /api/products/:id rejects clearing packs_per_stock_unit while the product stays a carton', async () => {
  const updates = stubExistingCartonProduct();

  const res = await request(createApp())
    .put(`/api/products/${PRODUCT_A}`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ packs_per_stock_unit: null });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /explicit positive integer/);
  assert.equal(updates.length, 0, 'nothing may be written when the merged profile is invalid');
});

test('PUT /api/products/:id accepts a partial update that keeps the existing valid carton profile', async () => {
  const updates = stubExistingCartonProduct();

  const res = await request(createApp())
    .put(`/api/products/${PRODUCT_A}`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ name: 'ABC Carton Renamed', cigarette_pack_size: 25 });

  assert.equal(res.status, 200);
  assert.equal(updates.length, 1);
  const saved = updates[0];
  assert.equal(saved.name, 'ABC Carton Renamed');
  assert.equal(saved.cigarette_pack_size, 25);
  // The stored carton profile is left exactly as it was: not rewritten, not cleared.
  assert.equal('stock_unit' in saved, false);
  assert.equal('packs_per_stock_unit' in saved, false);
  assert.equal('$unset' in saved, false);
  assert.equal('stock_quantity' in saved, false);
  assert.equal(res.body.stock_unit, 'carton');
  assert.equal(res.body.packs_per_stock_unit, 10);
});
