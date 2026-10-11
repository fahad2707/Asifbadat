/**
 * GET /api/user/profile — account_approved + account_status.
 *
 * Isolated harness: no Mongo connection / writes.
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
import {
  ACCOUNT_STATUS_APPROVED,
  ACCOUNT_STATUS_PENDING,
  ACCOUNT_STATUS_REJECTED,
} from '../utils/customerAccount';

const USER_ID = '64b0000000000000000a0001';
const CUSTOMER_ID = '64b0000000000000000c0001';
const OTHER_CUSTOMER_ID = '64b0000000000000000c0002';

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

/**
 * Stub User + Customer.findOne({ user_id }).
 * When accountStatus is null, no linked Customer (unlinked / CRM collision case).
 */
function stubUserAndCustomer(
  accountStatus: string | null,
  opts?: { customerMissingStatus?: boolean; findFilters?: Array<Record<string, unknown>> }
) {
  mock.method(User, 'findById', (id: unknown) => {
    const match = String(id) === USER_ID;
    return {
      select: () => ({ lean: async () => (match ? { _id: USER_ID } : null) }),
      lean: async () => (match ? profileUser : null),
    };
  });
  mock.method(Customer, 'findOne', (filter: Record<string, unknown>) => {
    opts?.findFilters?.push(filter);
    return {
      select: () => ({
        lean: async () => {
          if (!accountStatus && !opts?.customerMissingStatus) return null;
          if (opts?.customerMissingStatus) {
            return { _id: CUSTOMER_ID, user_id: USER_ID };
          }
          return { _id: CUSTOMER_ID, user_id: USER_ID, account_status: accountStatus };
        },
      }),
    };
  });
}

test('18 — approved linked customer → account_approved true and account_status approved', async () => {
  assertNoMongoConnection();
  stubUserAndCustomer(ACCOUNT_STATUS_APPROVED);

  const res = await request(createApp())
    .get('/api/user/profile')
    .set('Authorization', `Bearer ${userTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.account_approved, true);
  assert.equal(res.body.account_status, ACCOUNT_STATUS_APPROVED);
  assert.equal(res.body.id, USER_ID);
  assert.equal(res.body.phone, '5550100');
  assert.equal(res.body.name, 'Pat Buyer');
  assert.equal(res.body.email, 'pat@example.com');
  assert.equal('customer_id' in res.body, false);
  assert.equal('matched_customer_ids' in res.body, false);
  assert.equal('review_note' in res.body, false);
});

test('19 — pending linked customer → account_status pending and account_approved false', async () => {
  assertNoMongoConnection();
  stubUserAndCustomer(ACCOUNT_STATUS_PENDING);

  const res = await request(createApp())
    .get('/api/user/profile')
    .set('Authorization', `Bearer ${userTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.account_approved, false);
  assert.equal(res.body.account_status, ACCOUNT_STATUS_PENDING);
});

test('19c — rejected linked customer → account_status rejected and account_approved false', async () => {
  assertNoMongoConnection();
  stubUserAndCustomer(ACCOUNT_STATUS_REJECTED);

  const res = await request(createApp())
    .get('/api/user/profile')
    .set('Authorization', `Bearer ${userTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.account_approved, false);
  assert.equal(res.body.account_status, ACCOUNT_STATUS_REJECTED);
});

test('19b — unknown / unlinked user → account_status null and account_approved false', async () => {
  assertNoMongoConnection();
  stubUserAndCustomer(null);

  const res = await request(createApp())
    .get('/api/user/profile')
    .set('Authorization', `Bearer ${userTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.account_approved, false);
  assert.equal(res.body.account_status, null);
});

test('unlinked CRM-collision applicant does not inherit matching Customer status', async () => {
  assertNoMongoConnection();
  // No Customer.user_id link for this User — email/phone CRM match must not be consulted.
  const findFilters: Array<Record<string, unknown>> = [];
  stubUserAndCustomer(null, { findFilters });

  const res = await request(createApp())
    .get('/api/user/profile')
    .set('Authorization', `Bearer ${userTestToken()}`)
    .query({ email: 'pat@example.com' });

  assert.equal(res.status, 200);
  assert.equal(res.body.account_status, null);
  assert.equal(res.body.account_approved, false);
  assert.ok(findFilters.length >= 1);
  for (const filter of findFilters) {
    assert.ok('user_id' in filter, 'lookup must use user_id binding');
    assert.equal('email' in filter, false);
    assert.equal('phone' in filter, false);
  }
  // Ensure we did not fabricate a linked approved CRM from a match id.
  assert.notEqual(res.body.account_status, ACCOUNT_STATUS_APPROVED);
  assert.notEqual(OTHER_CUSTOMER_ID, res.body.id);
});

test('linked Customer with missing account_status → null / not approved', async () => {
  assertNoMongoConnection();
  stubUserAndCustomer(null, { customerMissingStatus: true });

  const res = await request(createApp())
    .get('/api/user/profile')
    .set('Authorization', `Bearer ${userTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.account_status, null);
  assert.equal(res.body.account_approved, false);
});

test('unauthenticated profile access is rejected', async () => {
  assertNoMongoConnection();
  const res = await request(createApp()).get('/api/user/profile');
  assert.equal(res.status, 401);
});

test('client-supplied account_status query/body cannot override server status', async () => {
  assertNoMongoConnection();
  stubUserAndCustomer(ACCOUNT_STATUS_PENDING);

  const res = await request(createApp())
    .get('/api/user/profile')
    .set('Authorization', `Bearer ${userTestToken()}`)
    .query({ account_status: 'approved', account_approved: 'true' })
    .send({ account_status: 'approved', account_approved: true });

  assert.equal(res.status, 200);
  assert.equal(res.body.account_status, ACCOUNT_STATUS_PENDING);
  assert.equal(res.body.account_approved, false);
});
