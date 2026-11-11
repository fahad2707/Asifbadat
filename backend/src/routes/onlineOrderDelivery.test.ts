/**
 * Website orders are quotations — PUT delivered must not invoice or take stock.
 *
 * Run with:
 *     npx tsx --test src/routes/onlineOrderDelivery.test.ts
 */
import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'path';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import OnlineOrder from '../models/OnlineOrder';
import Invoice from '../models/Invoice';
import Product from '../models/Product';
import { paymentApplication } from '../services/paymentApplication';

const ORDER_ID = '64b0000000000000000d0202';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '64b0000000000000000ad001', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'online-order delivery tests must not open a MongoDB connection');
}

afterEach(() => {
  mock.restoreAll();
});

async function putStatus(id: string, status: string) {
  return request(createApp())
    .put(`/api/online-orders/${id}/status`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ status });
}

test('source no longer auto-invoices or takes stock on delivered', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/online-orders.ts'), 'utf8');
  assert.match(src, /reviewed as quotations/);
  assert.equal(src.includes("source: 'ONLINE'"), false);
  assert.equal(src.includes('applyPaymentToInvoice'), false);
  assert.equal(src.includes('StockMovementType'), false);
});

test('PUT delivered does not create an invoice or change stock', async () => {
  assertNoMongoConnection();
  const order = {
    _id: { toString: () => ORDER_ID },
    status: 'dispatched',
    items: [],
  };
  mock.method(OnlineOrder, 'findById', async () => order);
  mock.method(OnlineOrder, 'findOneAndUpdate', async () => {
    throw new Error('must not claim delivered');
  });
  mock.method(Invoice, 'create', async () => {
    throw new Error('must not invoice');
  });
  mock.method(paymentApplication, 'applyPaymentToInvoice', async () => {
    throw new Error('must not pay');
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    throw new Error('must not change stock');
  });

  const res = await putStatus(ORDER_ID, 'delivered');
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /quotations/i);
  assert.equal(order.status, 'dispatched');
});

test('PUT packed from confirmed is rejected without invoice', async () => {
  assertNoMongoConnection();
  const order = { _id: { toString: () => ORDER_ID }, status: 'confirmed' };
  mock.method(OnlineOrder, 'findById', async () => order);
  mock.method(Invoice, 'create', async () => {
    throw new Error('must not invoice');
  });
  const res = await putStatus(ORDER_ID, 'packed');
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /quotations/i);
});
