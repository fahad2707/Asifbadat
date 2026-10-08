/**
 * Phase 2L-A — GET /api/online-orders/my-orders customer isolation.
 *
 * Isolated harness: no Mongo writes.
 *
 * Run with:
 *     npx tsx --test src/routes/onlineOrderMyOrders.test.ts
 */
import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import OnlineOrder from '../models/OnlineOrder';

const USER_A = '64b0000000000000000a0001';
const USER_B = '64b0000000000000000a0002';
const ORDER_A1 = '64b0000000000000000d0001';
const ORDER_A2 = '64b0000000000000000d0002';
const ORDER_B1 = '64b0000000000000000d00b1';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(
    mongoose.connection.readyState,
    0,
    '2L-A my-orders tests must not open a MongoDB connection',
  );
}

function userTestToken(userId: string): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real user JWT');
  return jwt.sign({ userId, phone: '5550100' }, secret, { expiresIn: '8h' });
}

function getMyOrders(token?: string) {
  const req = request(createApp()).get('/api/online-orders/my-orders');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

const orderANewer = {
  _id: { toString: () => ORDER_A2 },
  order_number: 'WEB-0002',
  user_id: USER_A,
  customer_email: 'a@example.com',
  items: [{ product_name: 'Widget', quantity: 1, price: 10, subtotal: 10 }],
  subtotal: 10,
  tax_amount: 1,
  total_amount: 11,
  payment_method: 'cod',
  payment_status: 'pending',
  status: 'confirmed',
  status_history: [{ status: 'confirmed', timestamp: new Date('2026-04-02T12:00:00Z') }],
  created_at: new Date('2026-04-02T12:00:00Z'),
};

const orderAOlder = {
  _id: { toString: () => ORDER_A1 },
  order_number: 'WEB-0001',
  user_id: USER_A,
  customer_email: 'a@example.com',
  items: [{ product_name: 'Gadget', quantity: 2, price: 5, subtotal: 10 }],
  subtotal: 10,
  tax_amount: 0,
  total_amount: 10,
  payment_method: 'cod',
  payment_status: 'pending',
  status: 'delivered',
  status_history: [
    { status: 'confirmed', timestamp: new Date('2026-04-01T10:00:00Z') },
    { status: 'delivered', timestamp: new Date('2026-04-01T18:00:00Z') },
  ],
  created_at: new Date('2026-04-01T10:00:00Z'),
};

const orderB = {
  _id: { toString: () => ORDER_B1 },
  order_number: 'WEB-0099',
  user_id: USER_B,
  customer_email: 'b@example.com',
  items: [{ product_name: 'Secret', quantity: 99, price: 100, subtotal: 9900 }],
  subtotal: 9900,
  tax_amount: 0,
  total_amount: 9900,
  payment_method: 'cod',
  payment_status: 'pending',
  status: 'confirmed',
  status_history: [{ status: 'confirmed', timestamp: new Date('2026-04-03T12:00:00Z') }],
  created_at: new Date('2026-04-03T12:00:00Z'),
};

function stubFindForUser(userId: string, docs: typeof orderANewer[]) {
  mock.method(OnlineOrder, 'find', (filter: { user_id?: string }) => {
    assert.equal(filter.user_id, userId, 'query must scope by authenticated user_id only');
    assert.equal(
      Object.keys(filter).sort().join(','),
      'user_id',
      'my-orders must not accept extra client filters that broaden scope',
    );
    const mine = docs.filter((d) => d.user_id === userId);
    return {
      sort: (sortSpec: { created_at?: number }) => {
        assert.equal(sortSpec.created_at, -1, 'must sort newest first');
        const sorted = [...mine].sort(
          (a, b) => b.created_at.getTime() - a.created_at.getTime(),
        );
        return { lean: async () => sorted };
      },
    };
  });
}

test('unauthenticated GET /my-orders → 401', async () => {
  assertNoMongoConnection();
  mock.method(OnlineOrder, 'find', () => {
    throw new Error('must not query without auth');
  });
  const res = await getMyOrders();
  assert.equal(res.status, 401);
});

test('invalid JWT GET /my-orders → 401', async () => {
  assertNoMongoConnection();
  mock.method(OnlineOrder, 'find', () => {
    throw new Error('must not query with invalid token');
  });
  const res = await getMyOrders('not-a-valid-jwt');
  assert.equal(res.status, 401);
});

test('User A sees only A orders, newest first; never B', async () => {
  assertNoMongoConnection();
  stubFindForUser(USER_A, [orderAOlder, orderANewer, orderB]);
  const res = await getMyOrders(userTestToken(USER_A));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 2);
  assert.equal(res.body[0].order_number, 'WEB-0002');
  assert.equal(res.body[1].order_number, 'WEB-0001');
  assert.ok(!res.body.some((o: { order_number: string }) => o.order_number === 'WEB-0099'));
  assert.equal(res.body[0].status, 'confirmed');
  assert.equal(res.body[0].total_amount, 11);
  assert.equal(res.body[0].items[0].product_name, 'Widget');
  assert.ok(res.body[0].status_history?.length >= 1);
  assert.equal(res.body[0].customer_email, 'a@example.com');
});

test('User B sees only B orders', async () => {
  assertNoMongoConnection();
  stubFindForUser(USER_B, [orderAOlder, orderANewer, orderB]);
  const res = await getMyOrders(userTestToken(USER_B));
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].order_number, 'WEB-0099');
  assert.equal(res.body[0].id, ORDER_B1);
});

test('authenticated user with no OnlineOrders → empty array', async () => {
  assertNoMongoConnection();
  stubFindForUser(USER_A, []);
  const res = await getMyOrders(userTestToken(USER_A));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test('?user_id= query cannot broaden scope past JWT user', async () => {
  assertNoMongoConnection();
  stubFindForUser(USER_A, [orderANewer, orderB]);
  const res = await request(createApp())
    .get(`/api/online-orders/my-orders?user_id=${USER_B}`)
    .set('Authorization', `Bearer ${userTestToken(USER_A)}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].order_number, 'WEB-0002');
});
