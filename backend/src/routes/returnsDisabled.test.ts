/**
 * Task 07D-10A / 10E-01 — GET /api/returns stays read-only.
 * POST is now the Model A-safe return path (see posReturnAtomicity.test.ts).
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/returnsDisabled.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import Return from '../models/Return';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import Customer from '../models/Customer';
import POSSale from '../models/POSSale';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07d10a-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'returns disable tests must not open a MongoDB connection');
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

afterEach(() => {
  mock.restoreAll();
});

const unsafeBody = {
  sale_id: '64b0000000000000000a0a0a',
  items: [
    {
      product_id: '64b0000000000000000d0404',
      product_name: 'Retail Item',
      quantity: 1,
      price: 50,
      reason: 'customer_request',
    },
  ],
  reason: 'customer_request',
  refund_method: 'cash',
  store_credit_issued: 10,
  pos_customer_id: '64b0000000000000000c0c0c',
};

test('A — legacy POST body is rejected and performs no writes', async () => {
  assertNoMongoConnection();
  let returnCreates = 0;
  let productUpdates = 0;
  let movements = 0;
  let customerUpdates = 0;
  let saleLookups = 0;
  mock.method(Return, 'create', async () => {
    returnCreates += 1;
    throw new Error('Return.create must not run');
  });
  mock.method(Product, 'findByIdAndUpdate', async () => {
    productUpdates += 1;
    throw new Error('Product update must not run');
  });
  mock.method(StockMovement, 'create', async () => {
    movements += 1;
    throw new Error('StockMovement.create must not run');
  });
  mock.method(Customer, 'findByIdAndUpdate', async () => {
    customerUpdates += 1;
    throw new Error('Customer balance must not run');
  });
  mock.method(POSSale, 'findById', async () => {
    saleLookups += 1;
    throw new Error('POSSale.findById must not run for an invalid body');
  });

  const res = await request(createApp())
    .post('/api/returns')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(unsafeBody);

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.equal(returnCreates, 0);
  assert.equal(productUpdates, 0);
  assert.equal(movements, 0);
  assert.equal(customerUpdates, 0);
  assert.equal(saleLookups, 0);
});

test('B — GET /api/returns remains a read-only list', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'find', () => ({
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    lean: async () => [
      {
        _id: { toString: () => 'ret-1' },
        return_number: 'RET-1',
        sale_id: { toString: () => 'sale-1' },
        sale_number: 'POS-1',
        total_refund: 12,
        refund_method: 'cash',
        status: 'completed',
        created_at: new Date('2026-01-01'),
      },
    ],
  }));

  const res = await request(createApp())
    .get('/api/returns')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.returns.length, 1);
  assert.equal(res.body.returns[0].id, 'ret-1');
  assert.equal(res.body.returns[0].return_number, 'RET-1');
  assert.equal(res.body.returns[0].sale_number, 'POS-1');
});

test('C — unauthenticated POST and GET follow existing auth', async () => {
  assertNoMongoConnection();
  const post = await request(createApp()).post('/api/returns').send(unsafeBody);
  const get = await request(createApp()).get('/api/returns');

  assertNoMongoConnection();
  assert.equal(post.status, 401);
  assert.match(String(post.body.error), /authentication required/i);
  assert.equal(get.status, 401);
  assert.match(String(get.body.error), /authentication required/i);
});
