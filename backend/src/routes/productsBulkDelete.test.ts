/**
 * POST /api/products/bulk-delete — remove from catalog table, keep invoice history.
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/productsBulkDelete.test.ts
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

const PRODUCT_A = '64c1c2d3e4f5a6b7c8d9e0a1';
const PRODUCT_B = '64c1c2d3e4f5a6b7c8d9e0a2';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'bulk-delete tests must not open MongoDB');
}

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available');
  return jwt.sign({ adminId: 'prod-del-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

test('admin bulk delete sets deleted_at and returns the modified count', async () => {
  assertNoMongoConnection();
  const calls: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  mock.method(Product, 'updateMany', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    calls.push({ filter, update });
    return { modifiedCount: 2 };
  });

  const res = await request(createApp())
    .post('/api/products/bulk-delete')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ ids: [PRODUCT_A, PRODUCT_B] });

  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, 2);
  assert.equal(calls.length, 1);
  const ids = (calls[0].filter._id as { $in: string[] }).$in;
  assert.deepEqual(ids, [PRODUCT_A, PRODUCT_B]);
  assert.ok((calls[0].update.$set as { deleted_at: Date }).deleted_at instanceof Date);
});
