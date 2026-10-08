/**
 * Phase 2E — GROUND mark-delivered is logistics only (no SHIPMENT_OUT).
 * GROUND_RG return-received still writes SHIPMENT_IN.
 *
 * Isolated harness: no Mongo connection, no Atlas.
 *
 * Run with:
 *     npx tsx --test src/modules/shipping/shipmentInventory.test.ts
 */
import '../../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../server';
import Shipment from './models/Shipment';
import Product from '../../models/Product';
import StockMovement from '../../models/StockMovement';
import CreditMemo from '../credit-memo/models/CreditMemo';
import { StockMovementType } from '../../shared/enums';

const SHIPMENT_ID = '64b0000000000000000d0101';
const PRODUCT_A = '64b0000000000000000c0001';
const ADMIN_ID = '64b0000000000000000a0001';
const CUSTOMER_ID = '64b0000000000000000e0001';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: ADMIN_ID, role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'shipment inventory tests must not open a MongoDB connection');
}

afterEach(() => {
  mock.restoreAll();
});

function createFakeSession() {
  return {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
}

type ShipmentDoc = {
  _id: { toString(): string };
  shipment_number: string;
  shipment_type: 'GROUND' | 'GROUND_RG';
  status: string;
  items: Array<{ product_id: string; product_name?: string; quantity: number }>;
  delivered_date?: Date;
  proof_of_delivery_url?: string;
};

function makeShipment(overrides: Partial<ShipmentDoc> = {}): ShipmentDoc {
  return {
    _id: { toString: () => SHIPMENT_ID },
    shipment_number: 'SH-2E',
    shipment_type: 'GROUND',
    status: 'IN_TRANSIT',
    items: [{ product_id: PRODUCT_A, product_name: 'Widget', quantity: 100 }],
    ...overrides,
  };
}

function thenableFindById(doc: ShipmentDoc | null) {
  return {
    session: async () => doc,
    then: (resolve: (v: ShipmentDoc | null) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(doc).then(resolve, reject),
  };
}

async function markDelivered(id = SHIPMENT_ID, body: Record<string, unknown> = {}) {
  return request(createApp())
    .post(`/api/shipments/${id}/mark-delivered`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

async function markReturnReceived(id = SHIPMENT_ID, body: Record<string, unknown> = {}) {
  return request(createApp())
    .post(`/api/shipments/${id}/mark-return-received`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

function stubShipmentOps(opts: {
  shipment: ShipmentDoc;
  stock?: Record<string, number>;
}) {
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  const shipment = opts.shipment;
  mock.method(Shipment, 'findById', () => thenableFindById(shipment));

  const statusUpdates: Array<{ id: unknown; update: Record<string, unknown> }> = [];
  mock.method(Shipment, 'findByIdAndUpdate', async (id: unknown, update: Record<string, unknown>) => {
    statusUpdates.push({ id, update });
    Object.assign(shipment, update);
    return shipment;
  });
  mock.method(Shipment, 'findOneAndUpdate', async (_filter: unknown, update: Record<string, unknown>) => {
    statusUpdates.push({ id: shipment._id, update: (update.$set as Record<string, unknown>) || update });
    Object.assign(shipment, update.$set || update);
    return shipment;
  });

  const stock: Record<string, number> = { [PRODUCT_A]: 500, ...(opts.stock || {}) };
  const productUpdates: Array<{ id: unknown; update: Record<string, unknown>; options?: unknown }> = [];
  mock.method(Product, 'findById', (id: unknown) => {
    const key = String(id);
    const doc = { _id: key, product_type: 'inventory', stock_quantity: stock[key] ?? 0 };
    return {
      session: async () => doc,
      then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve(doc).then(onFulfilled, onRejected);
      },
    };
  });
  mock.method(Product, 'findByIdAndUpdate', async (id: unknown, update: Record<string, unknown>, options?: unknown) => {
    productUpdates.push({ id, update, options });
    const key = String(id);
    const delta = Number((update.$inc as { stock_quantity?: number } | undefined)?.stock_quantity || 0);
    stock[key] = Number(stock[key] || 0) + delta;
    return { _id: key, stock_quantity: stock[key] };
  });
  mock.method(Product, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>, options?: unknown) => {
    const id = filter._id;
    productUpdates.push({ id, update, options });
    const key = String(id);
    const delta = Number((update.$inc as { stock_quantity?: number } | undefined)?.stock_quantity || 0);
    stock[key] = Number(stock[key] || 0) + delta;
    return { _id: key, stock_quantity: stock[key] };
  });

  const movements: Array<{ doc: Record<string, unknown>; options: unknown }> = [];
  mock.method(StockMovement, 'create', async (docs: unknown, options?: unknown) => {
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    movements.push({ doc, options });
    return [doc];
  });

  mock.method(CreditMemo, 'create', async (docs: unknown) => [Array.isArray(docs) ? docs[0] : docs]);

  return { session, shipment, stock, productUpdates, movements, statusUpdates };
}

test('A — GROUND mark-delivered does not deduct stock and writes no SHIPMENT_OUT', async () => {
  assertNoMongoConnection();
  const h = stubShipmentOps({
    shipment: makeShipment({ items: [{ product_id: PRODUCT_A, quantity: 100 }] }),
    stock: { [PRODUCT_A]: 500 },
  });

  const res = await markDelivered(SHIPMENT_ID, { proof_of_delivery_url: 'https://pod.example/a' });

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 500);
  assert.equal(h.productUpdates.length, 0);
  assert.equal(h.movements.length, 0);
  assert.equal(
    h.movements.some((m) => m.doc.movement_type === StockMovementType.SHIPMENT_OUT),
    false
  );
  assert.equal(h.shipment.status, 'DELIVERED');
});

test('B — wholesale invoice SALE then GROUND delivery does not deduct a second time', async () => {
  assertNoMongoConnection();
  // On-hand after WHOLESALE invoice SALE -100 from 500.
  const h = stubShipmentOps({
    shipment: makeShipment({ items: [{ product_id: PRODUCT_A, quantity: 100 }] }),
    stock: { [PRODUCT_A]: 400 },
  });

  const res = await markDelivered();

  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 400);
  assert.equal(h.productUpdates.length, 0);
  assert.equal(h.movements.length, 0);
});

test('C — partial GROUND shipment does not write SHIPMENT_OUT', async () => {
  assertNoMongoConnection();
  const h = stubShipmentOps({
    shipment: makeShipment({ items: [{ product_id: PRODUCT_A, quantity: 40 }] }),
    stock: { [PRODUCT_A]: 400 },
  });

  const res = await markDelivered();

  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 400);
  assert.equal(h.movements.length, 0);
  assert.equal(h.productUpdates.length, 0);
});

test('D — ONLINE-adjusted stock is not deducted again on GROUND delivery', async () => {
  assertNoMongoConnection();
  // On-hand after existing online-delivery stock deduction of 100 from 500.
  const h = stubShipmentOps({
    shipment: makeShipment({
      items: [{ product_id: PRODUCT_A, quantity: 100 }],
    }),
    stock: { [PRODUCT_A]: 400 },
  });

  const res = await markDelivered();

  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 400);
  assert.equal(h.productUpdates.length, 0);
  assert.equal(h.movements.length, 0);
});

test('E — GROUND delivery still sets DELIVERED, delivered_date, and POD', async () => {
  assertNoMongoConnection();
  const h = stubShipmentOps({ shipment: makeShipment() });

  const res = await markDelivered(SHIPMENT_ID, { proof_of_delivery_url: 'https://pod.example/e' });

  assert.equal(res.status, 200);
  assert.equal(h.shipment.status, 'DELIVERED');
  assert.ok(h.shipment.delivered_date instanceof Date);
  assert.equal(h.shipment.proof_of_delivery_url, 'https://pod.example/e');
  assert.equal(h.statusUpdates.length, 1);
  assert.equal(h.statusUpdates[0].update.status, 'DELIVERED');
  assert.equal(h.statusUpdates[0].update.proof_of_delivery_url, 'https://pod.example/e');
  assert.equal(h.session.commitTransaction.mock.callCount(), 1);
  assert.equal(h.session.abortTransaction.mock.callCount(), 0);
});

test('F — GROUND_RG mark-return-received still increases stock and writes SHIPMENT_IN', async () => {
  assertNoMongoConnection();
  const h = stubShipmentOps({
    shipment: makeShipment({
      shipment_type: 'GROUND_RG',
      shipment_number: 'RG-2E',
      status: 'IN_TRANSIT',
      items: [{ product_id: PRODUCT_A, product_name: 'Widget', quantity: 12 }],
    }),
    stock: { [PRODUCT_A]: 400 },
  });

  const res = await markReturnReceived(SHIPMENT_ID, {
    auto_create_credit_memo: false,
    customer_id: CUSTOMER_ID,
  });

  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 412);
  assert.equal(h.productUpdates.length, 1);
  assert.deepEqual(h.productUpdates[0].update, { $inc: { stock_quantity: 12 } });
  assert.equal(h.movements.length, 1);
  assert.equal(h.movements[0].doc.movement_type, StockMovementType.SHIPMENT_IN);
  assert.equal(h.movements[0].doc.quantity_change, 12);
  assert.equal(h.movements[0].doc.quantity_before, 400);
  assert.equal(h.movements[0].doc.quantity_after, 412);
  assert.equal(h.shipment.status, 'RETURNED');
});

test('G — already-delivered GROUND shipment is rejected and does not touch stock', async () => {
  assertNoMongoConnection();
  const h = stubShipmentOps({
    shipment: makeShipment({ status: 'DELIVERED' }),
    stock: { [PRODUCT_A]: 400 },
  });

  const res = await markDelivered();

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Already delivered');
  assert.equal(h.stock[PRODUCT_A], 400);
  assert.equal(h.productUpdates.length, 0);
  assert.equal(h.movements.length, 0);
  assert.equal(h.statusUpdates.length, 0);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
  assert.equal(h.session.commitTransaction.mock.callCount(), 0);
});
