/**
 * Phase 2G.1-C — GET /api/user/profile account_approved flag.
 *
 * Isolated harness: no Mongo writes.
 *
 * Run with:
 *     npx tsx --test src/routes/userProfile.test.ts
 */
import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import User from '../models/User';
import Customer from '../models/Customer';
import { ACCOUNT_STATUS_APPROVED, ACCOUNT_STATUS_PENDING } from '../utils/customerAccount';

const USER_ID = '64b0000000000000000a0001';
const CUSTOMER_ID = '64b0000000000000000c0001';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(
    mongoose.connection.readyState,
    0,
    'profile tests must not open a MongoDB connection',
  );
}

function userTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real user JWT');
  return jwt.sign({ userId: USER_ID, phone: '5550100' }, secret, { expiresIn: '8h' });
}

const profileUser = {
  _id: { toString: () => USER_ID },
  phone: '5550100',
  name: 'Pat Buyer',
  email: 'pat@example.com',
  loyalty_points: 0,
  total_spent: 0,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
};

function stubUserAndCustomer(accountStatus: string | null) {
  mock.method(User, 'findById', (id: unknown) => {
    const match = String(id) === USER_ID;
    return {
      select: () => ({ lean: async () => (match ? { _id: USER_ID } : null) }),
      lean: async () => (match ? profileUser : null),
    };
  });
  mock.method(Customer, 'findOne', () => ({
    select: () => ({
      lean: async () =>
        accountStatus
          ? { _id: CUSTOMER_ID, user_id: USER_ID, account_status: accountStatus }
          : null,
    }),
  }));
}

test('18 — approved linked customer → account_approved true', async () => {
  assertNoMongoConnection();
  stubUserAndCustomer(ACCOUNT_STATUS_APPROVED);

  const res = await request(createApp())
    .get('/api/user/profile')
    .set('Authorization', `Bearer ${userTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.account_approved, true);
  assert.equal(res.body.id, USER_ID);
  assert.equal('customer_id' in res.body, false);
});

test('19 — unapproved user → account_approved false', async () => {
  assertNoMongoConnection();
  stubUserAndCustomer(ACCOUNT_STATUS_PENDING);

  const res = await request(createApp())
    .get('/api/user/profile')
    .set('Authorization', `Bearer ${userTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.account_approved, false);
});

test('19b — unknown / unlinked user → account_approved false', async () => {
  assertNoMongoConnection();
  stubUserAndCustomer(null);

  const res = await request(createApp())
    .get('/api/user/profile')
    .set('Authorization', `Bearer ${userTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.account_approved, false);
});
