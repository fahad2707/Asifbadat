/**
 * Admin bulk remove: POST /api/admin/website-signup-applications/bulk-delete
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/websiteSignupApplicationDelete.test.ts
 */
import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import WebsiteSignupApplication from '../models/WebsiteSignupApplication';
import Customer from '../models/Customer';
import User from '../models/User';

const APP_A = '64b0000000000000000b0001';
const APP_B = '64b0000000000000000b0002';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(
    mongoose.connection.readyState,
    0,
    'website-signup delete tests must not open a MongoDB connection'
  );
}

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available');
  return jwt.sign({ adminId: '64b0000000000000000d0001', role: 'admin' }, secret, { expiresIn: '8h' });
}

function userTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available');
  return jwt.sign({ userId: '64b0000000000000000a0001', phone: '5550100' }, secret, { expiresIn: '8h' });
}

test('unauthenticated bulk delete is rejected', async () => {
  assertNoMongoConnection();
  const res = await request(createApp())
    .post('/api/admin/website-signup-applications/bulk-delete')
    .send({ ids: [APP_A] });
  assert.equal(res.status, 401);
});

test('storefront user cannot bulk delete', async () => {
  assertNoMongoConnection();
  const res = await request(createApp())
    .post('/api/admin/website-signup-applications/bulk-delete')
    .set('Authorization', `Bearer ${userTestToken()}`)
    .send({ ids: [APP_A] });
  assert.equal(res.status, 403);
});

test('admin bulk delete marks applications removed and does not touch customers or users', async () => {
  assertNoMongoConnection();
  const updates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  mock.method(WebsiteSignupApplication, 'updateMany', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    updates.push({ filter, update });
    return { modifiedCount: 2 };
  });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not update customers');
  });
  mock.method(Customer, 'deleteOne', async () => {
    throw new Error('must not delete customers');
  });
  mock.method(User, 'deleteOne', async () => {
    throw new Error('must not delete users');
  });

  const res = await request(createApp())
    .post('/api/admin/website-signup-applications/bulk-delete')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ ids: [APP_A, APP_B, APP_A, 'not-an-id'] });

  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, 2);
  assert.equal(updates.length, 1);
  const ids = (updates[0].filter._id as { $in: mongoose.Types.ObjectId[] }).$in.map(String);
  assert.deepEqual(ids, [APP_A, APP_B]);
  assert.ok((updates[0].update.$set as { removed_at: Date }).removed_at instanceof Date);
});

test('empty ids are rejected', async () => {
  assertNoMongoConnection();
  const res = await request(createApp())
    .post('/api/admin/website-signup-applications/bulk-delete')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ ids: [] });
  assert.equal(res.status, 400);
});
