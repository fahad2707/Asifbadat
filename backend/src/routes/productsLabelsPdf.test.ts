/**
 * Phase B3 — POST /api/products/labels/pdf
 *
 * Product.find is stubbed; barcode PDF generation uses real bwip-js + PDFKit.
 *
 * Run: npx tsx --test src/routes/productsLabelsPdf.test.ts
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

const ID_A = '64c1c2d3e4f5a6b7c8d9e0c1';
const ID_B = '64c1c2d3e4f5a6b7c8d9e0c2';
const ID_NO_SKU = '64c1c2d3e4f5a6b7c8d9e0c3';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0);
}

function adminToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret);
  return jwt.sign({ adminId: 'b3-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function userToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret);
  return jwt.sign({ userId: '64b0000000000000000a0001', phone: '5550100' }, secret, { expiresIn: '8h' });
}

function mockProducts(docs: Record<string, unknown>[]) {
  mock.method(Product, 'find', () => ({
    select: () => ({
      lean: async () => docs,
    }),
  }));
}

test('B3 route: PDF for products with SKUs; page count matches quantities', async () => {
  assertNoMongoConnection();
  mockProducts([
    { _id: { toString: () => ID_A }, name: 'Widget', sku: 'EDI-48217', product_id: '48217' },
    { _id: { toString: () => ID_B }, name: 'Gadget', sku: '012345678905', product_id: '99001' },
  ]);

  const res = await request(createApp())
    .post('/api/products/labels/pdf')
    .set('Authorization', `Bearer ${adminToken()}`)
    .buffer(true)
    .parse((incoming, cb) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
      incoming.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .send({
      items: [
        { product_id: ID_A, quantity: 2 },
        { product_id: ID_B, quantity: 1 },
      ],
    });

  assert.equal(res.status, 200);
  assert.match(String(res.headers['content-type'] || ''), /pdf/i);
  const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
  assert.equal(buf.subarray(0, 4).toString('utf8'), '%PDF');
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  assert.equal(pages, 3);
  assertNoMongoConnection();
});

test('B3 route: missing SKU returns 400 without inventing a code', async () => {
  assertNoMongoConnection();
  mockProducts([{ _id: { toString: () => ID_NO_SKU }, name: 'No Sku', sku: '', product_id: '11111' }]);

  const res = await request(createApp())
    .post('/api/products/labels/pdf')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ items: [{ product_id: ID_NO_SKU, quantity: 1 }] });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error || ''), /no SKU/i);
  assertNoMongoConnection();
});

test('B3 route: missing product returns 404', async () => {
  assertNoMongoConnection();
  mockProducts([]);
  const res = await request(createApp())
    .post('/api/products/labels/pdf')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ items: [{ product_id: ID_A, quantity: 1 }] });
  assert.equal(res.status, 404);
  assertNoMongoConnection();
});

test('B3 route: rejects bad quantities', async () => {
  assertNoMongoConnection();
  const res = await request(createApp())
    .post('/api/products/labels/pdf')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ items: [{ product_id: ID_A, quantity: 0 }] });
  assert.equal(res.status, 400);
  assertNoMongoConnection();
});

test('B3 route: non-admin denied', async () => {
  assertNoMongoConnection();
  const res = await request(createApp())
    .post('/api/products/labels/pdf')
    .set('Authorization', `Bearer ${userToken()}`)
    .send({ items: [{ product_id: ID_A, quantity: 1 }] });
  assert.ok(res.status === 401 || res.status === 403);
  assertNoMongoConnection();
});

test('B3 route: unauthenticated denied', async () => {
  assertNoMongoConnection();
  const res = await request(createApp())
    .post('/api/products/labels/pdf')
    .send({ items: [{ product_id: ID_A, quantity: 1 }] });
  assert.ok(res.status === 401 || res.status === 403);
  assertNoMongoConnection();
});
