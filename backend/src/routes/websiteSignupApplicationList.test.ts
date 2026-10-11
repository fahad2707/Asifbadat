/**
 * Read-only admin list: GET /api/admin/website-signup-applications
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/websiteSignupApplicationList.test.ts
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

const USER_ID = '64b0000000000000000a0001';
const CUSTOMER_ID = '64b0000000000000000c0001';
const APP_PENDING = '64b0000000000000000b0001';
const APP_APPROVED = '64b0000000000000000b0002';
const APP_REJECTED = '64b0000000000000000b0003';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(
    mongoose.connection.readyState,
    0,
    'website-signup application list tests must not open a MongoDB connection'
  );
}

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: 'list-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function userTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real user JWT');
  return jwt.sign({ userId: USER_ID, phone: '5550100' }, secret, { expiresIn: '8h' });
}

function staffNonAdminToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available');
  return jwt.sign({ adminId: 'staff-1', role: 'staff' }, secret, { expiresIn: '8h' });
}

function sampleApp(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => APP_PENDING },
    user_id: new mongoose.Types.ObjectId(USER_ID),
    submitted_name: 'Dealer',
    submitted_email: 'dealer@example.com',
    submitted_phone: '5550199',
    status: 'pending',
    link_outcome: 'created',
    customer_id: new mongoose.Types.ObjectId(CUSTOMER_ID),
    matched_customer_ids: [],
    match_kind: 'none',
    created_at: new Date('2026-10-01T12:00:00.000Z'),
    updated_at: new Date('2026-10-01T12:00:00.000Z'),
    reviewed_by: undefined,
    reviewed_at: undefined,
    review_note: undefined,
    password_hash: 'must-not-leak',
    ...overrides,
  };
}

type FindCapture = {
  query?: Record<string, unknown>;
  sort?: unknown;
  skip?: number;
  limit?: number;
};

function stubList(opts: {
  rows?: Record<string, unknown>[];
  total?: number;
  capture?: FindCapture;
}) {
  const capture = opts.capture || {};
  mock.method(WebsiteSignupApplication, 'find', (q: Record<string, unknown>) => {
    capture.query = q;
    return {
      sort(s: unknown) {
        capture.sort = s;
        return this;
      },
      skip(n: number) {
        capture.skip = n;
        return this;
      },
      limit(n: number) {
        capture.limit = n;
        return this;
      },
      lean: async () => opts.rows ?? [],
    };
  });
  mock.method(WebsiteSignupApplication, 'countDocuments', async (q: Record<string, unknown>) => {
    assert.deepEqual(q, capture.query);
    return opts.total ?? (opts.rows ? opts.rows.length : 0);
  });
  return capture;
}

test('unauthenticated request is rejected', async () => {
  assertNoMongoConnection();
  const res = await request(createApp()).get('/api/admin/website-signup-applications');
  assert.equal(res.status, 401);
});

test('authenticated storefront user is rejected', async () => {
  assertNoMongoConnection();
  const res = await request(createApp())
    .get('/api/admin/website-signup-applications')
    .set('Authorization', `Bearer ${userTestToken()}`);
  assert.equal(res.status, 403);
});

test('JWT without admin role is rejected', async () => {
  assertNoMongoConnection();
  const res = await request(createApp())
    .get('/api/admin/website-signup-applications')
    .set('Authorization', `Bearer ${staffNonAdminToken()}`);
  assert.equal(res.status, 403);
});

test('admin can list applications', async () => {
  assertNoMongoConnection();
  const capture = stubList({
    rows: [sampleApp()],
    total: 1,
  });

  const res = await request(createApp())
    .get('/api/admin/website-signup-applications')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.applications.length, 1);
  assert.equal(res.body.applications[0].id, APP_PENDING);
  assert.equal(res.body.applications[0].user_id, USER_ID);
  assert.equal(res.body.applications[0].status, 'pending');
  assert.equal(res.body.applications[0].link_outcome, 'created');
  assert.equal(res.body.applications[0].match_kind, 'none');
  assert.equal(res.body.applications[0].customer_id, CUSTOMER_ID);
  assert.deepEqual(res.body.pagination, { page: 1, limit: 50, total: 1, totalPages: 1 });
  assert.deepEqual(capture.query, {});
  assert.deepEqual(capture.sort, { created_at: -1, _id: -1 });
});

test('empty collection returns empty paginated response', async () => {
  assertNoMongoConnection();
  stubList({ rows: [], total: 0 });

  const res = await request(createApp())
    .get('/api/admin/website-signup-applications')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.applications, []);
  assert.deepEqual(res.body.pagination, { page: 1, limit: 50, total: 0, totalPages: 0 });
});

test('filter pending returns only pending', async () => {
  assertNoMongoConnection();
  const capture = stubList({
    rows: [sampleApp({ status: 'pending' })],
    total: 1,
  });

  const res = await request(createApp())
    .get('/api/admin/website-signup-applications?status=pending')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.deepEqual(capture.query, { status: 'pending' });
  assert.equal(res.body.applications[0].status, 'pending');
});

test('filter approved returns only approved', async () => {
  assertNoMongoConnection();
  const capture = stubList({
    rows: [
      sampleApp({
        _id: { toString: () => APP_APPROVED },
        status: 'approved',
        reviewed_at: new Date('2026-10-02T00:00:00.000Z'),
        review_note: 'ok',
      }),
    ],
    total: 1,
  });

  const res = await request(createApp())
    .get('/api/admin/website-signup-applications?status=approved')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.deepEqual(capture.query, { status: 'approved' });
  assert.equal(res.body.applications[0].status, 'approved');
  assert.equal(res.body.applications[0].review_note, 'ok');
});

test('filter rejected returns only rejected', async () => {
  assertNoMongoConnection();
  const capture = stubList({
    rows: [sampleApp({ _id: { toString: () => APP_REJECTED }, status: 'rejected' })],
    total: 1,
  });

  const res = await request(createApp())
    .get('/api/admin/website-signup-applications?status=rejected')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.deepEqual(capture.query, { status: 'rejected' });
  assert.equal(res.body.applications[0].status, 'rejected');
});

test('invalid status is rejected', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'find', () => {
    throw new Error('must not query for invalid status');
  });

  const res = await request(createApp())
    .get('/api/admin/website-signup-applications?status=active')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /status/i);
});

test('pagination returns expected page and total', async () => {
  assertNoMongoConnection();
  const capture = stubList({
    rows: [sampleApp({ _id: { toString: () => APP_APPROVED } })],
    total: 3,
  });

  const res = await request(createApp())
    .get('/api/admin/website-signup-applications?page=2&limit=1')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(capture.skip, 1);
  assert.equal(capture.limit, 1);
  assert.deepEqual(res.body.pagination, { page: 2, limit: 1, total: 3, totalPages: 3 });
});

test('invalid pagination inputs are rejected', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'find', () => {
    throw new Error('must not query for invalid pagination');
  });

  const badPage = await request(createApp())
    .get('/api/admin/website-signup-applications?page=0')
    .set('Authorization', `Bearer ${adminTestToken()}`);
  assert.equal(badPage.status, 400);

  const badLimit = await request(createApp())
    .get('/api/admin/website-signup-applications?limit=abc')
    .set('Authorization', `Bearer ${adminTestToken()}`);
  assert.equal(badLimit.status, 400);
});

test('maximum page size is enforced', async () => {
  assertNoMongoConnection();
  const capture = stubList({ rows: [], total: 0 });

  const res = await request(createApp())
    .get('/api/admin/website-signup-applications?limit=500')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(capture.limit, 100);
  assert.equal(res.body.pagination.limit, 100);
});

test('results are ordered by created_at desc then _id desc', async () => {
  assertNoMongoConnection();
  const capture = stubList({ rows: [], total: 0 });

  const res = await request(createApp())
    .get('/api/admin/website-signup-applications')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.deepEqual(capture.sort, { created_at: -1, _id: -1 });
});

test('sensitive User and Customer fields are not returned', async () => {
  assertNoMongoConnection();
  stubList({
    rows: [
      sampleApp({
        password_hash: 'secret-hash',
        email_verification_token_hash: 'verify-secret',
        cost_price: 12.5,
        credit_limit: 99999,
      }),
    ],
    total: 1,
  });

  const res = await request(createApp())
    .get('/api/admin/website-signup-applications')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  const body = JSON.stringify(res.body);
  assert.equal(body.includes('password_hash'), false);
  assert.equal(body.includes('secret-hash'), false);
  assert.equal(body.includes('email_verification_token'), false);
  assert.equal(body.includes('verify-secret'), false);
  assert.equal(body.includes('cost_price'), false);
  assert.equal(body.includes('credit_limit'), false);
  assert.equal('user' in res.body.applications[0], false);
  assert.equal('customer' in res.body.applications[0], false);
});

test('listing does not modify application, User, or Customer records', async () => {
  assertNoMongoConnection();
  stubList({ rows: [sampleApp()], total: 1 });

  mock.method(WebsiteSignupApplication, 'updateOne', async () => {
    throw new Error('list must not update applications');
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', async () => {
    throw new Error('list must not update applications');
  });
  mock.method(WebsiteSignupApplication, 'create', async () => {
    throw new Error('list must not create applications');
  });
  mock.method(User, 'updateOne', async () => {
    throw new Error('list must not update users');
  });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('list must not update customers');
  });
  mock.method(Customer, 'findByIdAndUpdate', async () => {
    throw new Error('list must not update customers');
  });

  const res = await request(createApp())
    .get('/api/admin/website-signup-applications')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.applications.length, 1);
});

test('historical link metadata is returned without implying live authorization fields', async () => {
  assertNoMongoConnection();
  stubList({
    rows: [
      sampleApp({
        link_outcome: 'unlinked',
        match_kind: 'approved_crm',
        customer_id: undefined,
        matched_customer_ids: [new mongoose.Types.ObjectId(CUSTOMER_ID)],
        status: 'pending',
      }),
    ],
    total: 1,
  });

  const res = await request(createApp())
    .get('/api/admin/website-signup-applications')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  const app = res.body.applications[0];
  assert.equal(app.link_outcome, 'unlinked');
  assert.equal(app.match_kind, 'approved_crm');
  assert.deepEqual(app.matched_customer_ids, [CUSTOMER_ID]);
  assert.equal(app.customer_id, null);
  assert.equal(app.status, 'pending');
  assert.equal('account_status' in app, false);
  assert.equal('is_approved' in app, false);
  assert.equal('currently_linked' in app, false);
});
