/**
 * Phase 2N — POST /api/orders create path is retired (410 Gone).
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/ordersRetiredCreate.test.ts
 */
import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import Order from '../models/Order';
import OrderItem from '../models/OrderItem';
import OrderStatusHistory from '../models/OrderStatusHistory';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import User from '../models/User';

const USER_ID = '64b0000000000000000a0001';
const PRODUCT_A = '64b0000000000000000c0001';

function userTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real user JWT');
  return jwt.sign({ userId: USER_ID, phone: '+15555550100' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'orders retirement tests must not open a MongoDB connection');
}

afterEach(() => {
  mock.restoreAll();
});

test('POST /api/orders returns 410 and performs no Order/inventory/loyalty writes', async () => {
  assertNoMongoConnection();
  let orderCreates = 0;
  let orderItemCreates = 0;
  let historyCreates = 0;
  let productLookups = 0;
  let productUpdates = 0;
  let movements = 0;
  let userUpdates = 0;

  mock.method(Order, 'create', async () => {
    orderCreates += 1;
    throw new Error('Order.create must not run');
  });
  mock.method(OrderItem, 'create', async () => {
    orderItemCreates += 1;
    throw new Error('OrderItem.create must not run');
  });
  mock.method(OrderStatusHistory, 'create', async () => {
    historyCreates += 1;
    throw new Error('OrderStatusHistory.create must not run');
  });
  mock.method(Product, 'findById', async () => {
    productLookups += 1;
    throw new Error('Product.findById must not run');
  });
  mock.method(Product, 'findByIdAndUpdate', async () => {
    productUpdates += 1;
    throw new Error('Product stock must not change');
  });
  mock.method(StockMovement, 'create', async () => {
    movements += 1;
    throw new Error('StockMovement.create must not run');
  });
  mock.method(User, 'findByIdAndUpdate', async () => {
    userUpdates += 1;
    throw new Error('User loyalty must not change');
  });

  const res = await request(createApp())
    .post('/api/orders')
    .set('Authorization', `Bearer ${userTestToken()}`)
    .send({
      items: [{ product_id: PRODUCT_A, quantity: 2 }],
    });

  assertNoMongoConnection();
  assert.equal(res.status, 410);
  assert.match(String(res.body.error), /no longer supported/i);
  assert.match(String(res.body.error), /online-orders/i);
  assert.equal(orderCreates, 0);
  assert.equal(orderItemCreates, 0);
  assert.equal(historyCreates, 0);
  assert.equal(productLookups, 0);
  assert.equal(productUpdates, 0);
  assert.equal(movements, 0);
  assert.equal(userUpdates, 0);
});

test('source: retired POST has no stock writer; generateOrderNumber helper removed', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/orders.ts'), 'utf8');
  assert.match(src, /status\(410\)/);
  assert.equal(src.includes('StockMovement.create'), false);
  assert.equal(src.includes('stock_quantity'), false);
  assert.equal(src.includes('generateOrderNumber'), false);
  assert.equal(src.includes("from '../models/Product'"), false);
  assert.equal(src.includes("from '../models/StockMovement'"), false);
  assert.equal(src.includes("from '../models/User'"), false);
});
