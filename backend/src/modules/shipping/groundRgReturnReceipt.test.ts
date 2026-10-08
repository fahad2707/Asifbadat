/**
 * Phase 2N-A — GROUND_RG mark-return-received hardening.
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/modules/shipping/groundRgReturnReceipt.test.ts
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
import { aggregateReturnInventoryQuantities } from './services/shipmentService';

const SHIPMENT_ID = '64b0000000000000000d0101';
const PRODUCT_A = '64b0000000000000000c0001';
const PRODUCT_B = '64b0000000000000000c0002';
const ADMIN_ID = '64b0000000000000000a0001';
const CUSTOMER_ID = '64b0000000000000000e0001';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, '2N-A tests must not open Mongo');
}

function adminToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET required');
  return jwt.sign({ adminId: ADMIN_ID, role: 'admin' }, secret, { expiresIn: '8h' });
}

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
};

function makeShipment(overrides: Partial<ShipmentDoc> = {}): ShipmentDoc {
  return {
    _id: { toString: () => SHIPMENT_ID },
    shipment_number: 'RG-2NA',
    shipment_type: 'GROUND_RG',
    status: 'IN_TRANSIT',
    items: [{ product_id: PRODUCT_A, product_name: 'Widget', quantity: 12 }],
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

async function markReturnReceived(body: Record<string, unknown> = {}) {
  return request(createApp())
    .post(`/api/shipments/${SHIPMENT_ID}/mark-return-received`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send(body);
}

function stubReturnHarness(opts: {
  shipment: ShipmentDoc;
  stock?: Record<string, number>;
  products?: Record<string, { product_type?: string; stock_quantity?: number } | null>;
  claimFails?: boolean;
  claimFailsAfterFirst?: boolean;
  failOnProductId?: string;
}) {
  const session = createFakeSession();
  const committed = { value: false };
  const stockSnapshot = { ...(opts.stock || { [PRODUCT_A]: 400 }) };
  const stock: Record<string, number> = { ...stockSnapshot };
  const shipment = opts.shipment;
  const statusSnapshot = shipment.status;
  const products = { ...(opts.products || {}) };
  const productUpdates: Array<{ id: string; delta: number }> = [];
  const movements: Array<Record<string, unknown>> = [];
  const claims: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const creditMemos: unknown[] = [];
  let claimCount = 0;

  const restore = () => {
    if (committed.value) return;
    for (const k of Object.keys(stock)) delete stock[k];
    Object.assign(stock, stockSnapshot);
    productUpdates.length = 0;
    movements.length = 0;
    creditMemos.length = 0;
    shipment.status = statusSnapshot;
    delete shipment.delivered_date;
  };

  session.abortTransaction = mock.fn(async () => {
    restore();
  });
  session.commitTransaction = mock.fn(async () => {
    committed.value = true;
  });

  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Shipment, 'findById', () => thenableFindById(shipment));

  mock.method(Shipment, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    claims.push({ filter, update });
    claimCount += 1;
    if (opts.claimFails) return null;
    if (opts.claimFailsAfterFirst && claimCount > 1) return null;
    if (shipment.shipment_type !== 'GROUND_RG') return null;
    if (shipment.status === 'DELIVERED' || shipment.status === 'RETURNED') return null;
    if (filter.shipment_type && filter.shipment_type !== shipment.shipment_type) return null;
    Object.assign(shipment, update.$set || {});
    return shipment;
  });

  mock.method(Product, 'findById', (id: unknown) => {
    const key = String(id);
    const configured = opts.products && Object.prototype.hasOwnProperty.call(opts.products, key)
      ? opts.products[key]
      : { product_type: 'inventory', stock_quantity: stock[key] ?? 0 };
    const doc =
      configured == null
        ? null
        : {
            _id: key,
            product_type: configured.product_type || 'inventory',
            stock_quantity: stock[key] ?? configured.stock_quantity ?? 0,
          };
    return {
      session: async () => doc,
      then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve(doc).then(onFulfilled, onRejected);
      },
    };
  });

  mock.method(Product, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    const key = String(filter._id);
    if (opts.failOnProductId && key === opts.failOnProductId) {
      throw new Error('forced product update failure');
    }
    const delta = Number((update.$inc as { stock_quantity?: number } | undefined)?.stock_quantity || 0);
    stock[key] = Number(stock[key] || 0) + delta;
    productUpdates.push({ id: key, delta });
    return { _id: key, stock_quantity: stock[key] };
  });

  // createStockMovement ultimately calls StockMovement.create — capture canonical fields there.
  mock.method(StockMovement, 'create', async (docs: unknown, options?: unknown) => {
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    movements.push({ ...doc, __options: options });
    return [doc];
  });

  mock.method(CreditMemo, 'create', async (docs: unknown) => {
    const doc = Array.isArray(docs) ? docs[0] : docs;
    creditMemos.push(doc);
    return [{ _id: { toString: () => '64b0000000000000000f0001' }, ...((doc as object) || {}) }];
  });

  return { session, shipment, stock, productUpdates, movements, claims, creditMemos, committed };
}

test('aggregateReturnInventoryQuantities sums duplicates and rejects invalid qty', () => {
  assertNoMongoConnection();
  const map = aggregateReturnInventoryQuantities([
    { product_id: PRODUCT_A, quantity: 5 },
    { product_id: PRODUCT_A, quantity: 3 },
    { product_id: PRODUCT_B, quantity: 2 },
  ]);
  assert.equal(map.get(PRODUCT_A), 8);
  assert.equal(map.get(PRODUCT_B), 2);
  assert.throws(() => aggregateReturnInventoryQuantities([{ product_id: PRODUCT_A, quantity: 0 }]));
  assert.throws(() => aggregateReturnInventoryQuantities([{ product_id: PRODUCT_A, quantity: -1 }]));
});

test('A — happy path: stock +12, one SHIPMENT_IN with before/delta/after, RETURNED', async () => {
  assertNoMongoConnection();
  const h = stubReturnHarness({
    shipment: makeShipment(),
    stock: { [PRODUCT_A]: 400 },
  });

  const res = await markReturnReceived({ auto_create_credit_memo: false });

  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 412);
  assert.equal(h.productUpdates.length, 1);
  assert.equal(h.productUpdates[0].delta, 12);
  assert.equal(h.movements.length, 1);
  assert.equal(h.movements[0].movement_type, StockMovementType.SHIPMENT_IN);
  assert.equal(h.movements[0].quantity_before, 400);
  assert.equal(h.movements[0].quantity_change, 12);
  assert.equal(h.movements[0].quantity_after, 412);
  assert.equal(h.movements[0].reference_type, 'Shipment');
  assert.ok(h.movements[0].__options && (h.movements[0].__options as { session?: unknown }).session);
  assert.equal(h.shipment.status, 'RETURNED');
  assert.equal(h.claims.length, 1);
  assert.equal(h.claims[0].filter.shipment_type, 'GROUND_RG');
  assert.deepEqual((h.claims[0].filter.status as { $nin: string[] }).$nin, ['DELIVERED', 'RETURNED']);
  assert.equal(h.session.commitTransaction.mock.callCount(), 1);
});

test('B — missing Product fails with no stock/movement/RETURNED', async () => {
  assertNoMongoConnection();
  const h = stubReturnHarness({
    shipment: makeShipment(),
    stock: { [PRODUCT_A]: 400 },
    products: { [PRODUCT_A]: null },
  });

  const res = await markReturnReceived();

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /Product not found/i);
  assert.equal(h.stock[PRODUCT_A], 400);
  assert.equal(h.productUpdates.length, 0);
  assert.equal(h.movements.length, 0);
  assert.equal(h.shipment.status, 'IN_TRANSIT');
  assert.equal(h.committed.value, false);
  assert.ok(h.session.abortTransaction.mock.callCount() >= 1);
});

test('C — duplicate product IDs aggregate to one update and one movement each', async () => {
  assertNoMongoConnection();
  const h = stubReturnHarness({
    shipment: makeShipment({
      items: [
        { product_id: PRODUCT_A, product_name: 'A', quantity: 5 },
        { product_id: PRODUCT_A, product_name: 'A', quantity: 3 },
        { product_id: PRODUCT_B, product_name: 'B', quantity: 2 },
      ],
    }),
    stock: { [PRODUCT_A]: 100, [PRODUCT_B]: 50 },
  });

  const res = await markReturnReceived();

  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 108);
  assert.equal(h.stock[PRODUCT_B], 52);
  assert.equal(h.productUpdates.length, 2);
  assert.equal(h.movements.length, 2);
  const movA = h.movements.find((m) => String(m.product_id) === PRODUCT_A)!;
  const movB = h.movements.find((m) => String(m.product_id) === PRODUCT_B)!;
  assert.equal(movA.quantity_change, 8);
  assert.equal(movA.quantity_before, 100);
  assert.equal(movA.quantity_after, 108);
  assert.equal(movB.quantity_change, 2);
  assert.equal(h.shipment.items.length, 3); // persisted lines unchanged
});

test('D — zero and negative quantities rejected with no side effects', async () => {
  assertNoMongoConnection();
  for (const qty of [0, -3]) {
    mock.restoreAll();
    const h = stubReturnHarness({
      shipment: makeShipment({ items: [{ product_id: PRODUCT_A, quantity: qty }] }),
      stock: { [PRODUCT_A]: 400 },
    });
    const res = await markReturnReceived();
    assert.equal(res.status, 400, `qty=${qty}`);
    assert.match(String(res.body.error), /positive integer/i);
    assert.equal(h.stock[PRODUCT_A], 400);
    assert.equal(h.movements.length, 0);
    assert.equal(h.claims.length, 0);
    assert.equal(h.shipment.status, 'IN_TRANSIT');
  }
});

test('E — concurrent receipt: second claim fails; stock applied once', async () => {
  assertNoMongoConnection();
  const h = stubReturnHarness({
    shipment: makeShipment(),
    stock: { [PRODUCT_A]: 400 },
    claimFailsAfterFirst: true,
  });

  const first = await markReturnReceived();
  assert.equal(first.status, 200);
  assert.equal(h.stock[PRODUCT_A], 412);
  assert.equal(h.movements.length, 1);

  // Second call: shipment already RETURNED from first claim → early "Already processed"
  // Also covers claim-loser path when status still looks open:
  h.shipment.status = 'IN_TRANSIT';
  const second = await markReturnReceived();
  assert.equal(second.status, 400);
  assert.equal(second.body.error, 'Already processed');
  assert.equal(h.stock[PRODUCT_A], 412);
  assert.equal(h.movements.length, 1);
});

test('F — failure after first product rolls back earlier stock and claim', async () => {
  assertNoMongoConnection();
  const h = stubReturnHarness({
    shipment: makeShipment({
      items: [
        { product_id: PRODUCT_A, quantity: 5 },
        { product_id: PRODUCT_B, quantity: 2 },
      ],
    }),
    stock: { [PRODUCT_A]: 100, [PRODUCT_B]: 50 },
    failOnProductId: PRODUCT_B,
  });

  const res = await markReturnReceived();

  assert.equal(res.status, 500);
  assert.equal(h.stock[PRODUCT_A], 100);
  assert.equal(h.stock[PRODUCT_B], 50);
  assert.equal(h.movements.length, 0);
  assert.equal(h.creditMemos.length, 0);
  assert.equal(h.shipment.status, 'IN_TRANSIT');
  assert.equal(h.committed.value, false);
});

test('G — auto_create_credit_memo remains atomic with successful receipt', async () => {
  assertNoMongoConnection();
  const h = stubReturnHarness({
    shipment: makeShipment(),
    stock: { [PRODUCT_A]: 400 },
  });

  const res = await markReturnReceived({
    auto_create_credit_memo: true,
    customer_id: CUSTOMER_ID,
  });

  assert.equal(res.status, 200);
  assert.ok(res.body.credit_memo_id);
  assert.equal(h.creditMemos.length, 1);
  assert.equal((h.creditMemos[0] as { affects_inventory?: boolean }).affects_inventory, false);
  assert.equal(h.shipment.status, 'RETURNED');
  assert.equal(h.stock[PRODUCT_A], 412);
});

test('source uses createStockMovement and conditional claim; no raw StockMovement.create', () => {
  assertNoMongoConnection();
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const src = readFileSync(join(process.cwd(), 'src/modules/shipping/services/shipmentService.ts'), 'utf8');
  assert.match(src, /createStockMovement/);
  assert.match(src, /StockMovementType\.SHIPMENT_IN/);
  assert.match(src, /findOneAndUpdate/);
  assert.match(src, /\$nin:\s*\[\s*'DELIVERED',\s*'RETURNED'\s*\]/);
  assert.equal(src.includes('StockMovement.create'), false);
});
