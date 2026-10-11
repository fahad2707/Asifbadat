/**
 * Phase 2G.1-C — OnlineOrder create is gated to approved storefront customers.
 *
 * Isolated harness: no Mongo writes.
 *
 * Run with:
 *     npx tsx --test src/routes/onlineOrderCreate.test.ts
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
import Product from '../models/Product';
import User from '../models/User';
import Customer from '../models/Customer';
import RFQ from '../models/RFQ';
import {
  ACCOUNT_STATUS_APPROVED,
  ACCOUNT_STATUS_PENDING,
  ACCOUNT_STATUS_REJECTED,
} from '../utils/customerAccount';

const PRODUCT_ID = '64c1c2d3e4f5a6b7c8d9e0a1';
const USER_ID = '64b0000000000000000a0001';
const OTHER_USER_ID = '64b0000000000000000a0002';
const CUSTOMER_ID = '64b0000000000000000c0001';
const OTHER_CUSTOMER_ID = '64b0000000000000000c0002';
const ORDER_ID = '64b0000000000000000d0001';
const HISTORICAL_ID = '64b0000000000000000d0099';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(
    mongoose.connection.readyState,
    0,
    '2G.1-C tests must not open a MongoDB connection',
  );
}

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '2g1c-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function userTestToken(userId = USER_ID, extra: Record<string, unknown> = {}): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real user JWT');
  return jwt.sign({ userId, phone: '5550100', ...extra }, secret, { expiresIn: '8h' });
}

function expiredUserToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real user JWT');
  return jwt.sign({ userId: USER_ID, phone: '5550100' }, secret, { expiresIn: '-1s' });
}

const catalogProduct = {
  _id: PRODUCT_ID,
  name: 'Order Widget',
  price: 50,
  tax_rate: 10,
  is_active: true,
};

const placeBody = {
  checkout_submission_id: 'create-test-submission-0001',
  customer_name: 'Pat Buyer',
  customer_email: 'pat@example.com',
  customer_phone: '5550100',
  address_line1: '1 Main St',
  city: 'Plymouth Meeting',
  state: 'PA',
  zip: '19462',
  payment_method: 'cod' as const,
  items: [{ product_id: PRODUCT_ID, quantity: 2, price: 0.01 }],
};

function stubUserCustomer(accountStatus: string | undefined | null) {
  mock.method(User, 'findById', (id: unknown) => {
    const doc = String(id) === USER_ID ? { _id: USER_ID } : null;
    return {
      select: () => ({ lean: async () => doc }),
      lean: async () => doc,
    };
  });
  mock.method(Customer, 'findOne', () => ({
    select: () => ({
      lean: async () =>
        accountStatus == null
          ? null
          : { _id: CUSTOMER_ID, user_id: USER_ID, account_status: accountStatus },
    }),
  }));
}

function stubCreateDeps() {
  mock.method(Product, 'findById', (id: unknown) => ({
    lean: async () => (String(id) === PRODUCT_ID ? catalogProduct : null),
  }));
  mock.method(OnlineOrder, 'findOne', () => ({
    sort: () => ({ lean: async () => null }),
    lean: async () => null,
  }));
}

function postOrder(token?: string, body: Record<string, unknown> = placeBody) {
  const req = request(createApp()).post('/api/online-orders').send(body);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

test('1 — guest POST /api/online-orders → 401', async () => {
  assertNoMongoConnection();
  mock.method(OnlineOrder, 'create', async () => {
    throw new Error('must not create');
  });
  const res = await postOrder();
  assert.equal(res.status, 401);
});

test('2 — invalid JWT → 401', async () => {
  assertNoMongoConnection();
  mock.method(OnlineOrder, 'create', async () => {
    throw new Error('must not create');
  });
  const res = await postOrder('not-a-valid-jwt');
  assert.equal(res.status, 401);
});

test('3 — expired JWT → 401', async () => {
  assertNoMongoConnection();
  mock.method(OnlineOrder, 'create', async () => {
    throw new Error('must not create');
  });
  const res = await postOrder(expiredUserToken());
  assert.equal(res.status, 401);
});

test('4 — unapproved User → 403', async () => {
  assertNoMongoConnection();
  stubUserCustomer(ACCOUNT_STATUS_PENDING);
  mock.method(OnlineOrder, 'create', async () => {
    throw new Error('must not create');
  });
  const res = await postOrder(userTestToken(USER_ID, { account_status: 'approved' }));
  assert.equal(res.status, 403);
});

test('4b — rejected User → 403', async () => {
  assertNoMongoConnection();
  stubUserCustomer(ACCOUNT_STATUS_REJECTED);
  mock.method(OnlineOrder, 'create', async () => {
    throw new Error('must not create');
  });
  const res = await postOrder(userTestToken());
  assert.equal(res.status, 403);
});

test('5/7/8/12/13/14 — approved User → 201, server identity and Product.price', async () => {
  assertNoMongoConnection();
  stubUserCustomer(ACCOUNT_STATUS_APPROVED);
  stubCreateDeps();
  let created: Record<string, unknown> | undefined;
  mock.method(OnlineOrder, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return {
      toObject: () => ({ _id: { toString: () => ORDER_ID }, ...doc }),
    };
  });

  const res = await postOrder(userTestToken(), {
    ...placeBody,
    user_id: OTHER_USER_ID,
    customer_id: OTHER_CUSTOMER_ID,
    account_status: 'approved',
    subtotal: 1,
    tax_amount: 1,
    total_amount: 1,
    items: [{ product_id: PRODUCT_ID, quantity: 2, price: 0.01 }],
  });

  assert.equal(res.status, 201);
  assert.ok(created);
  assert.equal(String(created.user_id), USER_ID);
  assert.notEqual(String(created.user_id), OTHER_USER_ID);
  assert.equal(String(created.customer_id), CUSTOMER_ID);
  assert.notEqual(String(created.customer_id), OTHER_CUSTOMER_ID);
  const items = created.items as Array<{ price: number; subtotal: number; quantity: number }>;
  assert.equal(items[0].price, 50);
  assert.equal(items[0].subtotal, 100);
  assert.equal(created.subtotal, 100);
  assert.equal(created.tax_amount, 10);
  assert.equal(created.total_amount, 110);
  assert.equal(res.body.total_amount, 110);
});

test('6 — admin JWT is rejected as a storefront customer', async () => {
  assertNoMongoConnection();
  mock.method(OnlineOrder, 'create', async () => {
    throw new Error('must not create');
  });
  const res = await postOrder(adminTestToken());
  assert.ok(res.status === 401 || res.status === 403);
  assert.notEqual(res.status, 201);
});

test('9/10/11 — client identity and account_status cannot impersonate or bypass', async () => {
  assertNoMongoConnection();
  stubUserCustomer(ACCOUNT_STATUS_PENDING);
  mock.method(OnlineOrder, 'create', async () => {
    throw new Error('must not create for unapproved');
  });
  const res = await postOrder(userTestToken(), {
    ...placeBody,
    user_id: OTHER_USER_ID,
    customer_id: OTHER_CUSTOMER_ID,
    account_status: 'approved',
  });
  assert.equal(res.status, 403);
});

test('15 — POST /api/rfq still works without authentication', async () => {
  assertNoMongoConnection();
  let created: Record<string, unknown> | undefined;
  mock.method(RFQ, 'findOne', () => ({ lean: async () => null }));
  mock.method(RFQ, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return {
      _id: { toString: () => '64b0000000000000000f0001' },
      ...doc,
      created_at: new Date(),
    };
  });

  const res = await request(createApp())
    .post('/api/rfq')
    .send({
      customer_name: 'Guest Buyer',
      customer_phone: '5550199',
      items: [{ product_name: 'Quote Widget', quantity: 3 }],
    });

  assert.equal(res.status, 201);
  assert.ok(created);
  assert.equal(created.customer_name, 'Guest Buyer');
});

test('16 — admin OnlineOrder status endpoint remains functional', async () => {
  assertNoMongoConnection();
  const order = {
    _id: { toString: () => ORDER_ID },
    order_number: 'WEB-0001',
    status: 'confirmed',
    status_history: [] as Array<{ status: string; timestamp: Date }>,
  };
  mock.method(OnlineOrder, 'findById', async () => order);
  mock.method(OnlineOrder, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    assert.equal(filter.status, 'confirmed');
    Object.assign(order, update.$set || {});
    if (update.$push && (update.$push as { status_history?: unknown }).status_history) {
      order.status_history.push(
        (update.$push as { status_history: { status: string; timestamp: Date } }).status_history
      );
    }
    return order;
  });

  const res = await request(createApp())
    .put(`/api/online-orders/${ORDER_ID}/status`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ status: 'packed' });

  assert.equal(res.status, 200);
  assert.equal(order.status, 'packed');
  assert.equal(res.body.status, 'packed');
});

test('17 — historical OnlineOrder without identity fields remains readable', async () => {
  assertNoMongoConnection();
  const historical = {
    _id: { toString: () => HISTORICAL_ID },
    order_number: 'WEB-0009',
    customer_name: 'Legacy Guest',
    customer_email: 'legacy@example.com',
    customer_phone: '5550100',
    address_line1: '9 Old St',
    city: 'Plymouth Meeting',
    state: 'PA',
    zip: '19462',
    items: [{ product_name: 'Old Item', quantity: 1, price: 12, subtotal: 12 }],
    subtotal: 12,
    tax_amount: 0,
    total_amount: 12,
    payment_method: 'cod',
    payment_status: 'pending',
    status: 'confirmed',
    status_history: [],
    created_at: new Date('2025-01-01T00:00:00.000Z'),
  };
  mock.method(OnlineOrder, 'find', () => ({
    sort: () => ({ lean: async () => [historical] }),
  }));
  mock.method(OnlineOrder, 'findOne', () => ({
    sort: () => ({ lean: async () => historical }),
    lean: async () => historical,
  }));

  const list = await request(createApp())
    .get('/api/online-orders')
    .set('Authorization', `Bearer ${adminTestToken()}`);
  assert.equal(list.status, 200);
  assert.equal(list.body[0].order_number, 'WEB-0009');
  assert.equal('user_id' in list.body[0], false);
  assert.equal('customer_id' in list.body[0], false);

  const track = await request(createApp())
    .get('/api/online-orders/track/WEB-0009')
    .query({ email: 'legacy@example.com' });
  assert.equal(track.status, 200);
  assert.equal(track.body.order_number, 'WEB-0009');
  assert.equal(track.body.total_amount, 12);
});
