/**
 * Phase 3.1 — PO create/update reject duplicate product_id lines.
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/purchaseOrderDuplicateLines.test.ts
 */
import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import PurchaseOrder from '../models/PurchaseOrder';
import Product from '../models/Product';
import Vendor from '../models/Vendor';
import StockMovement from '../models/StockMovement';

const ADMIN_ID = '64b0000000000000000a0001';
const VENDOR_ID = '64b0000000000000000f0001';
const PO_ID = '64b0000000000000000b0001';
const PRODUCT_A = '64b0000000000000000c0001';
const PRODUCT_B = '64b0000000000000000c0002';
/** Same ObjectId as PRODUCT_A with uppercase hex — must still count as duplicate. */
const PRODUCT_A_ALT = '64B0000000000000000C0001';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: ADMIN_ID, role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'PO duplicate-line tests must not open a MongoDB connection');
}

afterEach(() => {
  mock.restoreAll();
});

function line(productId: string, qty = 10, cost = 2) {
  return {
    product_id: productId,
    product_name: productId === PRODUCT_B ? 'Oreo' : 'Lays Box',
    quantity_ordered: qty,
    unit_cost: cost,
  };
}

test('create PO with unique products succeeds and does not write stock movements', async () => {
  assertNoMongoConnection();
  let created = 0;
  let stockUpdates = 0;
  let movements = 0;
  let costUpdates = 0;

  mock.method(Vendor, 'findById', async () => ({ _id: VENDOR_ID, name: 'Acme' }));
  mock.method(PurchaseOrder, 'create', async (doc: Record<string, unknown>) => {
    created += 1;
    return {
      _id: PO_ID,
      ...doc,
      created_at: new Date(),
    };
  });
  mock.method(Product, 'findByIdAndUpdate', async () => {
    costUpdates += 1;
    return {};
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    stockUpdates += 1;
    throw new Error('stock must not change on PO create');
  });
  mock.method(StockMovement, 'create', async () => {
    movements += 1;
    throw new Error('StockMovement must not run on PO create');
  });

  const res = await request(createApp())
    .post('/api/purchase-orders')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({
      vendor_id: VENDOR_ID,
      items: [line(PRODUCT_A, 10), line(PRODUCT_B, 5)],
    });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created, 1);
  assert.equal(res.body.items.length, 2);
  assert.equal(stockUpdates, 0);
  assert.equal(movements, 0);
  assert.equal(costUpdates, 2);
});

test('create PO with duplicate product_id is rejected with no PO/stock/movement writes', async () => {
  assertNoMongoConnection();
  let created = 0;
  let vendorLookups = 0;
  let costUpdates = 0;
  let stockUpdates = 0;
  let movements = 0;

  mock.method(Vendor, 'findById', async () => {
    vendorLookups += 1;
    throw new Error('Vendor lookup must not run after duplicate rejection');
  });
  mock.method(PurchaseOrder, 'create', async () => {
    created += 1;
    throw new Error('PurchaseOrder.create must not run');
  });
  mock.method(Product, 'findByIdAndUpdate', async () => {
    costUpdates += 1;
    throw new Error('cost_price must not change');
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    stockUpdates += 1;
    throw new Error('stock must not change');
  });
  mock.method(StockMovement, 'create', async () => {
    movements += 1;
    throw new Error('StockMovement must not run');
  });

  const res = await request(createApp())
    .post('/api/purchase-orders')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({
      vendor_id: VENDOR_ID,
      items: [line(PRODUCT_A, 10), line(PRODUCT_A, 5)],
    });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /duplicate product/i);
  assert.equal(created, 0);
  assert.equal(vendorLookups, 0);
  assert.equal(costUpdates, 0);
  assert.equal(stockUpdates, 0);
  assert.equal(movements, 0);
});

test('create PO rejects equivalent ObjectId string forms as duplicates', async () => {
  assertNoMongoConnection();
  let created = 0;
  mock.method(PurchaseOrder, 'create', async () => {
    created += 1;
    throw new Error('PurchaseOrder.create must not run');
  });

  const res = await request(createApp())
    .post('/api/purchase-orders')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({
      vendor_id: VENDOR_ID,
      items: [line(PRODUCT_A, 10), line(PRODUCT_A_ALT, 5)],
    });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /duplicate product/i);
  assert.equal(created, 0);
});

test('update draft PO with unique products succeeds', async () => {
  assertNoMongoConnection();
  let saved = false;
  let costUpdates = 0;
  let movements = 0;

  const poDoc: {
    _id: string;
    status: string;
    items: unknown[];
    subtotal: number;
    tax_amount: number;
    total_amount: number;
    save: () => Promise<unknown>;
    toObject: () => Record<string, unknown>;
  } = {
    _id: PO_ID,
    status: 'draft',
    items: [],
    subtotal: 0,
    tax_amount: 0,
    total_amount: 0,
    save: async () => {
      saved = true;
      return poDoc;
    },
    toObject() {
      return {
        _id: poDoc._id,
        status: poDoc.status,
        items: poDoc.items,
        subtotal: poDoc.subtotal,
        tax_amount: poDoc.tax_amount,
        total_amount: poDoc.total_amount,
      };
    },
  };

  mock.method(PurchaseOrder, 'findById', async () => poDoc);
  mock.method(Product, 'findByIdAndUpdate', async () => {
    costUpdates += 1;
    return {};
  });
  mock.method(StockMovement, 'create', async () => {
    movements += 1;
    throw new Error('StockMovement must not run on PO update');
  });

  const res = await request(createApp())
    .put(`/api/purchase-orders/${PO_ID}`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({
      items: [line(PRODUCT_A, 8), line(PRODUCT_B, 3)],
    });

  assert.equal(res.status, 200);
  assert.equal(saved, true);
  assert.equal(poDoc.items.length, 2);
  assert.equal(costUpdates, 2);
  assert.equal(movements, 0);
});

test('update draft PO with duplicate product_id is rejected without save/stock/movement', async () => {
  assertNoMongoConnection();
  let saved = false;
  let costUpdates = 0;
  let stockUpdates = 0;
  let movements = 0;

  const poDoc: {
    _id: string;
    status: string;
    items: unknown[];
    subtotal: number;
    tax_amount: number;
    total_amount: number;
    save: () => Promise<unknown>;
    toObject: () => Record<string, unknown>;
  } = {
    _id: PO_ID,
    status: 'draft',
    items: [{ product_id: PRODUCT_A, quantity_ordered: 1, quantity_received: 0 }],
    subtotal: 2,
    tax_amount: 0,
    total_amount: 2,
    save: async () => {
      saved = true;
      return poDoc;
    },
    toObject() {
      return {
        _id: poDoc._id,
        status: poDoc.status,
        items: poDoc.items,
        subtotal: poDoc.subtotal,
        tax_amount: poDoc.tax_amount,
        total_amount: poDoc.total_amount,
      };
    },
  };

  mock.method(PurchaseOrder, 'findById', async () => poDoc);
  mock.method(Product, 'findByIdAndUpdate', async () => {
    costUpdates += 1;
    throw new Error('cost_price must not change');
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    stockUpdates += 1;
    throw new Error('stock must not change');
  });
  mock.method(StockMovement, 'create', async () => {
    movements += 1;
    throw new Error('StockMovement must not run');
  });

  const res = await request(createApp())
    .put(`/api/purchase-orders/${PO_ID}`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({
      items: [line(PRODUCT_A, 8), line(PRODUCT_A, 3)],
    });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /duplicate product/i);
  assert.equal(saved, false);
  assert.equal(poDoc.items.length, 1);
  assert.equal(costUpdates, 0);
  assert.equal(stockUpdates, 0);
  assert.equal(movements, 0);
});
