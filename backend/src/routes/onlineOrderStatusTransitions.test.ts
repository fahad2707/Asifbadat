/**
 * Phase 2M-A — OnlineOrder status transition FSM + conditional claims.
 *
 * Isolated harness: no Mongo writes.
 *
 * Run with:
 *     npx tsx --test src/routes/onlineOrderStatusTransitions.test.ts
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
import Invoice from '../models/Invoice';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import { paymentApplication } from '../services/paymentApplication';

const ORDER_ID = '64b0000000000000000d0202';
const PRODUCT_A = '64b0000000000000000a0001';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, '2M-A tests must not open Mongo');
}

function adminToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET required');
  return jwt.sign({ adminId: '64b0000000000000000ad001', role: 'admin' }, secret, { expiresIn: '8h' });
}

async function putStatus(id: string, status: string) {
  return request(createApp())
    .put(`/api/online-orders/${id}/status`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ status });
}

type OrderDoc = {
  _id: { toString(): string };
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  items: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    price: number;
    subtotal: number;
  }>;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  payment_method: 'cod' | 'card';
  payment_status: string;
  status: string;
  status_history: Array<{ status: string; timestamp: Date }>;
  invoice_id?: mongoose.Types.ObjectId;
};

function makeOrder(overrides: Partial<OrderDoc> = {}): OrderDoc {
  return {
    _id: { toString: () => ORDER_ID },
    order_number: 'WEB-0100',
    customer_name: 'Pat Buyer',
    customer_phone: '5550100',
    customer_email: 'pat@example.com',
    address_line1: '1 Main',
    city: 'Plymouth Meeting',
    state: 'PA',
    zip: '19462',
    items: [
      {
        product_id: PRODUCT_A,
        product_name: 'Widget',
        quantity: 1,
        price: 10,
        subtotal: 10,
      },
    ],
    subtotal: 10,
    tax_amount: 0,
    total_amount: 10,
    payment_method: 'cod',
    payment_status: 'pending',
    status: 'confirmed',
    status_history: [{ status: 'confirmed', timestamp: new Date() }],
    ...overrides,
  };
}

function stubConditionalClaim(order: OrderDoc) {
  mock.method(OnlineOrder, 'findById', async () => order);
  mock.method(OnlineOrder, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    if (typeof filter.status === 'string' && order.status !== filter.status) return null;
    Object.assign(order, update.$set || {});
    if (update.$push && (update.$push as { status_history?: unknown }).status_history) {
      order.status_history.push(
        (update.$push as { status_history: { status: string; timestamp: Date } }).status_history
      );
    }
    return order;
  });
}

test('source enforces adjacency matrix and conditional claims (no document.save path)', () => {
  assertNoMongoConnection();
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const src = readFileSync(join(process.cwd(), 'src/routes/online-orders.ts'), 'utf8');
  assert.match(src, /ONLINE_ORDER_ALLOWED_TRANSITIONS/);
  assert.match(src, /Invalid status transition from/);
  const statusHandler = src.slice(src.indexOf("router.put('/:id/status'"));
  assert.match(statusHandler, /findOneAndUpdate/);
  assert.doesNotMatch(statusHandler, /await\s+\w+\.save\s*\(/);
  assert.match(src, /link-quotation/);
});

test('A — cancel is the only allowed status PUT', async () => {
  assertNoMongoConnection();
  const cases: Array<[string, string]> = [
    ['confirmed', 'cancelled'],
    ['quoted', 'cancelled'],
    ['packed', 'cancelled'],
    ['dispatched', 'cancelled'],
  ];
  for (const [from, to] of cases) {
    mock.restoreAll();
    const order = makeOrder({ status: from, status_history: [{ status: from, timestamp: new Date() }] });
    const historyBefore = order.status_history.length;
    stubConditionalClaim(order);
    mock.method(Invoice, 'create', async () => {
      throw new Error('must not invoice');
    });
    mock.method(paymentApplication, 'applyPaymentToInvoice', async () => {
      throw new Error('must not pay');
    });

    const res = await putStatus(ORDER_ID, to);
    assert.equal(res.status, 200, `${from}→${to}`);
    assert.equal(res.body.status, to);
    assert.equal(order.status, to);
    assert.equal(order.status_history.length, historyBefore + 1);
  }
});

test('A — packed / dispatched / delivered are rejected without invoicing', async () => {
  assertNoMongoConnection();
  const order = makeOrder({ status: 'confirmed' });
  mock.method(OnlineOrder, 'findById', async () => order);
  let invCreated = false;
  mock.method(Invoice, 'create', async () => {
    invCreated = true;
    return { _id: new mongoose.Types.ObjectId('64b0000000000000000d0303') };
  });
  const res = await putStatus(ORDER_ID, 'delivered');
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /quotations/i);
  assert.equal(invCreated, false);
  assert.equal(order.status, 'confirmed');
});

test('B — illegal skips fail', async () => {
  assertNoMongoConnection();
  for (const [from, to] of [
    ['confirmed', 'dispatched'],
    ['confirmed', 'delivered'],
    ['packed', 'delivered'],
  ] as const) {
    mock.restoreAll();
    const order = makeOrder({ status: from });
    mock.method(OnlineOrder, 'findById', async () => order);
    mock.method(OnlineOrder, 'findOneAndUpdate', async () => {
      throw new Error('must not claim illegal transition');
    });
    mock.method(Invoice, 'create', async () => {
      throw new Error('must not invoice');
    });
    const res = await putStatus(ORDER_ID, to);
    assert.equal(res.status, 400, `${from}→${to}`);
    assert.match(String(res.body.error), /quotations|Invalid status transition/i);
    assert.equal(order.status, from);
  }
});

test('C — backward transitions fail', async () => {
  assertNoMongoConnection();
  for (const [from, to] of [
    ['packed', 'confirmed'],
    ['dispatched', 'packed'],
    ['dispatched', 'confirmed'],
  ] as const) {
    mock.restoreAll();
    const order = makeOrder({ status: from });
    mock.method(OnlineOrder, 'findById', async () => order);
    mock.method(OnlineOrder, 'findOneAndUpdate', async () => {
      throw new Error('must not claim');
    });
    const res = await putStatus(ORDER_ID, to);
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /quotations|Invalid status transition/);
  }
});

test('D — terminal states reject all updates', async () => {
  assertNoMongoConnection();
  for (const [from, to] of [
    ['delivered', 'cancelled'],
    ['delivered', 'packed'],
    ['cancelled', 'confirmed'],
    ['cancelled', 'delivered'],
  ] as const) {
    mock.restoreAll();
    const order = makeOrder({ status: from });
    mock.method(OnlineOrder, 'findById', async () => order);
    mock.method(OnlineOrder, 'findOneAndUpdate', async () => {
      throw new Error('must not claim');
    });
    const res = await putStatus(ORDER_ID, to);
    assert.equal(res.status, 400);
    if (from === 'delivered') {
      assert.equal(res.body.error, 'Delivered orders cannot be modified');
    } else {
      assert.equal(res.body.error, 'Cancelled orders cannot be modified');
    }
  }
});

test('E — same-status updates fail without history growth', async () => {
  assertNoMongoConnection();
  for (const status of ['confirmed', 'packed', 'dispatched'] as const) {
    mock.restoreAll();
    const order = makeOrder({
      status,
      status_history: [{ status, timestamp: new Date() }],
    });
    const before = order.status_history.length;
    mock.method(OnlineOrder, 'findById', async () => order);
    mock.method(OnlineOrder, 'findOneAndUpdate', async () => {
      throw new Error('must not claim same-status');
    });
    const res = await putStatus(ORDER_ID, status);
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /quotations|Invalid status transition/i);
    assert.equal(order.status_history.length, before);
  }
});

test('F — cancel has no invoice/payment/stock effects', async () => {
  assertNoMongoConnection();
  const order = makeOrder({ status: 'dispatched' });
  let invoiceCalls = 0;
  let payCalls = 0;
  let stockCalls = 0;
  let movementCalls = 0;

  stubConditionalClaim(order);
  mock.method(Invoice, 'create', async () => {
    invoiceCalls += 1;
    throw new Error('no invoice on cancel');
  });
  mock.method(paymentApplication, 'applyPaymentToInvoice', async () => {
    payCalls += 1;
    throw new Error('no payment on cancel');
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    stockCalls += 1;
    return null;
  });
  const res = await putStatus(ORDER_ID, 'cancelled');
  assert.equal(res.status, 200);
  assert.equal(order.status, 'cancelled');
  assert.equal(invoiceCalls, 0);
  assert.equal(payCalls, 0);
  assert.equal(stockCalls, 0);
  assert.equal(movementCalls, 0);
});

test('G — PUT delivered never invoices even if the order is still dispatched', async () => {
  assertNoMongoConnection();
  const order = makeOrder({ status: 'dispatched' });
  mock.method(OnlineOrder, 'findById', async () => order);
  let invCreated = false;
  mock.method(Invoice, 'create', async () => {
    invCreated = true;
    return {};
  });
  mock.method(OnlineOrder, 'findOneAndUpdate', async () => {
    throw new Error('must not claim delivered');
  });
  const res = await putStatus(ORDER_ID, 'delivered');
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /quotations/i);
  assert.equal(invCreated, false);
  assert.equal(order.status, 'dispatched');
});

test('G — P0 race: delivery wins; later cancel cannot overwrite delivered', async () => {
  assertNoMongoConnection();
  const order = makeOrder({
    status: 'delivered',
    payment_status: 'paid',
    status_history: [
      { status: 'dispatched', timestamp: new Date() },
      { status: 'delivered', timestamp: new Date() },
    ],
  });
  mock.method(OnlineOrder, 'findById', async () => order);
  mock.method(OnlineOrder, 'findOneAndUpdate', async () => {
    throw new Error('cancel must not claim after delivered');
  });

  const res = await putStatus(ORDER_ID, 'cancelled');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Delivered orders cannot be modified');
  assert.equal(order.status, 'delivered');
});

test('G — concurrent claims: cancel claim loses if delivery already set delivered', async () => {
  assertNoMongoConnection();
  // Stale read still sees dispatched, but conditional cancel claim filters status:dispatched and loses.
  const order = makeOrder({ status: 'dispatched' });
  mock.method(OnlineOrder, 'findById', async () => order);
  mock.method(OnlineOrder, 'findOneAndUpdate', async (filter: Record<string, unknown>) => {
    assert.equal(filter.status, 'dispatched');
    // Simulate delivery won between read and cancel claim.
    order.status = 'delivered';
    return null;
  });

  const res = await putStatus(ORDER_ID, 'cancelled');
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /Order status changed|cannot transition/);
  assert.equal(order.status, 'delivered');
});

test('link-quotation marks the order quoted without invoicing', async () => {
  assertNoMongoConnection();
  const QUOTE_ID = '64b0000000000000000d0404';
  const order = makeOrder({ status: 'confirmed' });
  mock.method(Invoice, 'findById', () => ({
    select: () => ({
      lean: async () => ({ invoice_type: 'quotation', invoice_number: 'QTN#101' }),
    }),
  }));
  mock.method(OnlineOrder, 'findOneAndUpdate', async (_filter: unknown, update: Record<string, unknown>) => {
    Object.assign(order, update.$set || {});
    return order;
  });
  const res = await request(createApp())
    .post(`/api/online-orders/${ORDER_ID}/link-quotation`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ quotation_id: QUOTE_ID });
  assert.equal(res.status, 200);
  assert.equal(order.status, 'quoted');
  assert.equal(String((order as { quotation_id?: string }).quotation_id), QUOTE_ID);
});
