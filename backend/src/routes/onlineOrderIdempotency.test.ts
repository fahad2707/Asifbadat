/**
 * Phase 2L-B — POST /api/online-orders checkout_submission_id idempotency.
 *
 * Isolated harness: no Mongo writes.
 *
 * Run with:
 *     npx tsx --test src/routes/onlineOrderIdempotency.test.ts
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
import { ACCOUNT_STATUS_APPROVED, ACCOUNT_STATUS_PENDING } from '../utils/customerAccount';

const PRODUCT_ID = '64c1c2d3e4f5a6b7c8d9e0a1';
const USER_A = '64b0000000000000000a0001';
const USER_B = '64b0000000000000000a0002';
const CUSTOMER_A = '64b0000000000000000c0001';
const CUSTOMER_B = '64b0000000000000000c0002';
const ORDER_A = '64b0000000000000000d0001';
const ORDER_B = '64b0000000000000000d0002';
const SUBMISSION = 'idempotency-submission-aaaa';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(
    mongoose.connection.readyState,
    0,
    '2L-B idempotency tests must not open a MongoDB connection',
  );
}

function userToken(userId: string): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET required');
  return jwt.sign({ userId, phone: '5550100' }, secret, { expiresIn: '8h' });
}

function adminToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET required');
  return jwt.sign({ adminId: '2lb-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

const catalogProduct = {
  _id: PRODUCT_ID,
  name: 'Order Widget',
  price: 50,
  tax_rate: 10,
  is_active: true,
};

function placeBody(overrides: Record<string, unknown> = {}) {
  return {
    checkout_submission_id: SUBMISSION,
    customer_name: 'Pat Buyer',
    customer_email: 'pat@example.com',
    customer_phone: '5550100',
    address_line1: '1 Main St',
    city: 'Plymouth Meeting',
    state: 'PA',
    zip: '19462',
    payment_method: 'cod' as const,
    items: [{ product_id: PRODUCT_ID, quantity: 2 }],
    ...overrides,
  };
}

function stubApproved(userId: string, customerId: string) {
  mock.method(User, 'findById', (id: unknown) => {
    const doc = String(id) === userId ? { _id: userId } : null;
    return {
      select: () => ({ lean: async () => doc }),
      lean: async () => doc,
    };
  });
  mock.method(Customer, 'findOne', (filter: { user_id?: string }) => ({
    select: () => ({
      lean: async () =>
        String(filter?.user_id) === userId
          ? { _id: customerId, user_id: userId, account_status: ACCOUNT_STATUS_APPROVED }
          : null,
    }),
  }));
}

function stubProduct() {
  mock.method(Product, 'findById', (id: unknown) => ({
    lean: async () => (String(id) === PRODUCT_ID ? catalogProduct : null),
  }));
}

function postOrder(token?: string, body: Record<string, unknown> = placeBody()) {
  const req = request(createApp()).post('/api/online-orders').send(body);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

function existingOrderDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => ORDER_A },
    order_number: 'WEB-0001',
    user_id: USER_A,
    customer_id: CUSTOMER_A,
    checkout_submission_id: SUBMISSION,
    customer_name: 'Pat Buyer',
    customer_email: 'pat@example.com',
    customer_phone: '5550100',
    address_line1: '1 Main St',
    city: 'Plymouth Meeting',
    state: 'PA',
    zip: '19462',
    items: [
      {
        product_id: PRODUCT_ID,
        product_name: 'Order Widget',
        quantity: 2,
        price: 50,
        tax_rate: 10,
        subtotal: 100,
      },
    ],
    subtotal: 100,
    tax_amount: 10,
    total_amount: 110,
    payment_method: 'cod',
    payment_status: 'pending',
    status: 'confirmed',
    ...overrides,
  };
}

test('schema defines optional checkout_submission_id + unique sparse compound index', () => {
  assertNoMongoConnection();
  const path = OnlineOrder.schema.path('checkout_submission_id') as {
    options?: { required?: boolean };
  };
  assert.ok(path);
  assert.notEqual(path.options?.required, true);

  const indexes = OnlineOrder.schema.indexes();
  const keyed = indexes.find((entry) => {
    const keys = entry[0] as Record<string, number>;
    return keys.user_id === 1 && keys.checkout_submission_id === 1;
  });
  assert.ok(keyed, 'unique sparse compound index must exist');
  assert.equal((keyed?.[1] as { unique?: boolean }).unique, true);
  assert.equal((keyed?.[1] as { sparse?: boolean }).sparse, true);
});

test('A — first submission creates one OnlineOrder with submission id', async () => {
  assertNoMongoConnection();
  stubApproved(USER_A, CUSTOMER_A);
  stubProduct();
  mock.method(OnlineOrder, 'findOne', () => ({
    lean: async () => null,
    sort: () => ({ lean: async () => null }),
  }));
  let createCount = 0;
  let created: Record<string, unknown> | undefined;
  mock.method(OnlineOrder, 'create', async (doc: Record<string, unknown>) => {
    createCount += 1;
    created = doc;
    return {
      toObject: () => ({ _id: { toString: () => ORDER_A }, ...doc }),
    };
  });

  const res = await postOrder(userToken(USER_A));
  assert.equal(res.status, 201);
  assert.equal(createCount, 1);
  assert.equal(created?.checkout_submission_id, SUBMISSION);
  assert.equal(String(created?.user_id), USER_A);
  assert.equal(res.body.order_number, created?.order_number);
  assert.equal(res.body.total_amount, 110);
  assert.equal(res.body.status, 'confirmed');
});

test('B — same submission retry returns existing order without second create', async () => {
  assertNoMongoConnection();
  stubApproved(USER_A, CUSTOMER_A);
  stubProduct();
  const existing = existingOrderDoc();
  mock.method(OnlineOrder, 'findOne', () => ({
    lean: async () => existing,
    sort: () => ({ lean: async () => null }),
  }));
  mock.method(OnlineOrder, 'create', async () => {
    throw new Error('must not create on replay');
  });

  const res = await postOrder(userToken(USER_A));
  assert.equal(res.status, 200);
  assert.equal(res.body.id, ORDER_A);
  assert.equal(res.body.order_number, 'WEB-0001');
  assert.equal(res.body.total_amount, 110);
  assert.equal(res.body.status, 'confirmed');
});

test('C — concurrent duplicate create catches E11000 and replays winner', async () => {
  assertNoMongoConnection();
  stubApproved(USER_A, CUSTOMER_A);
  stubProduct();
  const existing = existingOrderDoc();
  let findCalls = 0;
  mock.method(OnlineOrder, 'findOne', () => ({
    lean: async () => {
      findCalls += 1;
      // First lookup (pre-create) → miss; post-dup lookup → hit
      return findCalls === 1 ? null : existing;
    },
    sort: () => ({ lean: async () => null }),
  }));
  mock.method(OnlineOrder, 'create', async () => {
    throw Object.assign(new Error('E11000 duplicate key error index: checkout_submission_id_1'), {
      code: 11000,
      keyPattern: { user_id: 1, checkout_submission_id: 1 },
    });
  });

  const res = await postOrder(userToken(USER_A));
  assert.equal(res.status, 200);
  assert.equal(res.body.id, ORDER_A);
  assert.equal(res.body.order_number, 'WEB-0001');
});

test('D — different submission IDs create two orders', async () => {
  assertNoMongoConnection();
  stubApproved(USER_A, CUSTOMER_A);
  stubProduct();
  mock.method(OnlineOrder, 'findOne', () => ({
    lean: async () => null,
    sort: () => ({ lean: async () => null }),
  }));
  const createdIds: string[] = [];
  mock.method(OnlineOrder, 'create', async (doc: Record<string, unknown>) => {
    const id = `64b0000000000000000d00${createdIds.length + 1}1`;
    createdIds.push(String(doc.checkout_submission_id));
    return {
      toObject: () => ({
        _id: { toString: () => id },
        ...doc,
        order_number: `WEB-000${createdIds.length}`,
      }),
    };
  });

  const first = await postOrder(userToken(USER_A), placeBody({ checkout_submission_id: 'submission-one-aaaa' }));
  const second = await postOrder(userToken(USER_A), placeBody({ checkout_submission_id: 'submission-two-bbbb' }));
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.deepEqual(createdIds, ['submission-one-aaaa', 'submission-two-bbbb']);
  assert.notEqual(first.body.id, second.body.id);
});

test('E — same submission ID across users creates independent orders', async () => {
  assertNoMongoConnection();
  stubProduct();

  // Alternate User/Customer stubs based on JWT user via findById / findOne
  mock.method(User, 'findById', (id: unknown) => {
    const sid = String(id);
    const doc = sid === USER_A || sid === USER_B ? { _id: sid } : null;
    return {
      select: () => ({ lean: async () => doc }),
      lean: async () => doc,
    };
  });
  mock.method(Customer, 'findOne', (filter: { user_id?: string }) => ({
    select: () => ({
      lean: async () => {
        const uid = String(filter?.user_id);
        if (uid === USER_A) {
          return { _id: CUSTOMER_A, user_id: USER_A, account_status: ACCOUNT_STATUS_APPROVED };
        }
        if (uid === USER_B) {
          return { _id: CUSTOMER_B, user_id: USER_B, account_status: ACCOUNT_STATUS_APPROVED };
        }
        return null;
      },
    }),
  }));

  mock.method(OnlineOrder, 'findOne', (filter: { user_id?: string; checkout_submission_id?: string }) => ({
    lean: async () => null,
    sort: () => ({ lean: async () => null }),
  }));

  const owners: string[] = [];
  mock.method(OnlineOrder, 'create', async (doc: Record<string, unknown>) => {
    owners.push(String(doc.user_id));
    const id = String(doc.user_id) === USER_A ? ORDER_A : ORDER_B;
    return {
      toObject: () => ({
        _id: { toString: () => id },
        ...doc,
        order_number: String(doc.user_id) === USER_A ? 'WEB-0001' : 'WEB-0002',
      }),
    };
  });

  const a = await postOrder(userToken(USER_A));
  const b = await postOrder(userToken(USER_B));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.body.id, ORDER_A);
  assert.equal(b.body.id, ORDER_B);
  assert.deepEqual(owners, [USER_A, USER_B]);
});

test('F — missing / invalid JWT → 401; admin JWT not treated as customer create', async () => {
  assertNoMongoConnection();
  mock.method(OnlineOrder, 'create', async () => {
    throw new Error('must not create');
  });
  assert.equal((await postOrder()).status, 401);
  assert.equal((await postOrder('not-a-valid-jwt')).status, 401);
  const adminRes = await postOrder(adminToken());
  assert.ok(adminRes.status === 401 || adminRes.status === 403);
  assert.notEqual(adminRes.status, 201);
});

test('G — unapproved customer → 403', async () => {
  assertNoMongoConnection();
  mock.method(User, 'findById', () => ({
    select: () => ({ lean: async () => ({ _id: USER_A }) }),
    lean: async () => ({ _id: USER_A }),
  }));
  mock.method(Customer, 'findOne', () => ({
    select: () => ({
      lean: async () => ({
        _id: CUSTOMER_A,
        user_id: USER_A,
        account_status: ACCOUNT_STATUS_PENDING,
      }),
    }),
  }));
  mock.method(OnlineOrder, 'create', async () => {
    throw new Error('must not create');
  });
  const res = await postOrder(userToken(USER_A));
  assert.equal(res.status, 403);
});

test('H — historical OnlineOrder without checkout_submission_id remains readable', async () => {
  assertNoMongoConnection();
  const historical = {
    _id: { toString: () => '64b0000000000000000d0099' },
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
    lean: async () => historical,
  }));

  const list = await request(createApp())
    .get('/api/online-orders')
    .set('Authorization', `Bearer ${adminToken()}`);
  assert.equal(list.status, 200);
  assert.equal(list.body[0].order_number, 'WEB-0009');
  assert.equal('checkout_submission_id' in list.body[0], false);

  const track = await request(createApp())
    .get('/api/online-orders/track/WEB-0009')
    .query({ email: 'legacy@example.com' });
  assert.equal(track.status, 200);
  assert.equal(track.body.total_amount, 12);
});

test('I — fake body user_id does not change ownership', async () => {
  assertNoMongoConnection();
  stubApproved(USER_A, CUSTOMER_A);
  stubProduct();
  mock.method(OnlineOrder, 'findOne', () => ({
    lean: async () => null,
    sort: () => ({ lean: async () => null }),
  }));
  let created: Record<string, unknown> | undefined;
  mock.method(OnlineOrder, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return { toObject: () => ({ _id: { toString: () => ORDER_A }, ...doc }) };
  });

  const res = await postOrder(userToken(USER_A), placeBody({ user_id: USER_B }));
  assert.equal(res.status, 201);
  assert.equal(String(created?.user_id), USER_A);
  assert.notEqual(String(created?.user_id), USER_B);
});

test('J — same submission + materially different items → 409', async () => {
  assertNoMongoConnection();
  stubApproved(USER_A, CUSTOMER_A);
  stubProduct();
  mock.method(OnlineOrder, 'findOne', () => ({
    lean: async () => existingOrderDoc(),
    sort: () => ({ lean: async () => null }),
  }));
  mock.method(OnlineOrder, 'create', async () => {
    throw new Error('must not create on mismatch');
  });

  const res = await postOrder(
    userToken(USER_A),
    placeBody({ items: [{ product_id: PRODUCT_ID, quantity: 5 }] })
  );
  assert.equal(res.status, 409);
  assert.match(String(res.body.error), /different checkout/i);
});
