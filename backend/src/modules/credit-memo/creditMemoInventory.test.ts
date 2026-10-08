/**
 * Phase 2C credit memo inventory — isolated harness, no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/modules/credit-memo/creditMemoInventory.test.ts
 */
import '../../load-env';
import fs from 'fs';
import path from 'path';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../server';
import CreditMemo from './models/CreditMemo';
import Product from '../../models/Product';
import Customer from '../../models/Customer';
import StockMovement from '../../models/StockMovement';
import LedgerEntry from '../../models/LedgerEntry';
import { StockMovementType } from '../../shared/enums';

const CM_ID = '64b0000000000000000d0001';
const PRODUCT_A = '64b0000000000000000c0001';
const PRODUCT_B = '64b0000000000000000c0002';
const CUSTOMER_ID = '64b0000000000000000e0001';
const VENDOR_ID = '64b0000000000000000f0001';
const ADMIN_ID = '64b0000000000000000a0001';
const SHIPMENT_ID = '64b0000000000000000s0001';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: ADMIN_ID, role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'credit memo inventory tests must not open a MongoDB connection');
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

type CmDoc = {
  _id: string;
  credit_memo_number: string;
  type: 'VENDOR' | 'CUSTOMER';
  status: string;
  affects_inventory: boolean;
  total_amount: number;
  vendor_id?: string;
  customer_id?: string;
  approved_at?: Date;
  reference_shipment_id?: string;
  items: Array<{ product_id: string; quantity: number; product_name: string }>;
};

function makeCm(overrides: Partial<CmDoc> = {}): CmDoc {
  return {
    _id: CM_ID,
    credit_memo_number: 'CM-1004',
    type: 'CUSTOMER',
    status: 'DRAFT',
    affects_inventory: true,
    total_amount: 40,
    customer_id: CUSTOMER_ID,
    items: [{ product_id: PRODUCT_A, quantity: 2, product_name: 'Lays Box' }],
    ...overrides,
  };
}

function thenableFindById(doc: CmDoc | null) {
  const query = {
    session: async () => doc,
    then: (resolve: (v: CmDoc | null) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(doc).then(resolve, reject),
  };
  return query;
}

async function postApprove(id = CM_ID) {
  return request(createApp())
    .post(`/api/credit-memos/${id}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({});
}

async function postCancel(id = CM_ID) {
  return request(createApp())
    .post(`/api/credit-memos/${id}/cancel`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({});
}

async function deleteCm(id = CM_ID) {
  return request(createApp())
    .delete(`/api/credit-memos/${id}`)
    .set('Authorization', `Bearer ${adminTestToken()}`);
}

function stubApprove(opts: {
  cm: CmDoc;
  stock?: Record<string, number>;
  productUpdate?: (productId: string, delta: number) => { stock_quantity: number } | null;
  movementThrows?: boolean;
  claim?: (filter: Record<string, unknown>) => Record<string, unknown> | null;
}) {
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(CreditMemo, 'findById', () => thenableFindById(opts.cm));

  const claims: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  mock.method(CreditMemo, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    claims.push({ filter, update });
    if (opts.claim) return opts.claim(filter);
    if (filter.status !== 'DRAFT') return null;
    return {
      ...opts.cm,
      status: 'APPROVED',
      ...((update.$set as Record<string, unknown>) || {}),
    };
  });

  const statusUpdates: Array<{ id: unknown; update: Record<string, unknown> }> = [];
  mock.method(CreditMemo, 'findByIdAndUpdate', async (id: unknown, update: Record<string, unknown>) => {
    statusUpdates.push({ id, update });
    return { ...opts.cm, ...update };
  });

  const stock = opts.stock || { [PRODUCT_A]: 58, [PRODUCT_B]: 10 };
  const productUpdates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown>; options: Record<string, unknown> }> = [];
  mock.method(Product, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>, options: Record<string, unknown>) => {
    productUpdates.push({ filter, update, options });
    const productId = String(filter._id);
    const delta = Number((update.$inc as { stock_quantity?: number } | undefined)?.stock_quantity || 0);
    if (opts.productUpdate) return opts.productUpdate(productId, delta);
    if (!(productId in stock)) return null;
    stock[productId] += delta;
    return { _id: productId, stock_quantity: stock[productId] };
  });

  const movements: Array<{ doc: Record<string, unknown>; options: unknown }> = [];
  mock.method(StockMovement, 'create', async (docs: unknown, options?: unknown) => {
    if (opts.movementThrows) throw new Error('movement write failed');
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    movements.push({ doc, options });
    return [doc];
  });

  const ledgerCalls: Array<{ docs: unknown; options: unknown }> = [];
  mock.method(LedgerEntry, 'insertMany', async (docs: unknown, options?: unknown) => {
    ledgerCalls.push({ docs, options });
    return docs;
  });

  mock.method(Customer, 'findByIdAndUpdate', async () => ({ _id: CUSTOMER_ID }));

  return { session, productUpdates, movements, ledgerCalls, statusUpdates, stock, claims };
}

test('customer physical CM approval increases stock and writes CREDIT_MEMO +qty with before/after', async () => {
  assertNoMongoConnection();
  const { session, productUpdates, movements, ledgerCalls } = stubApprove({
    cm: makeCm({ type: 'CUSTOMER', affects_inventory: true }),
    stock: { [PRODUCT_A]: 58 },
  });

  const res = await postApprove();

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.deepEqual(productUpdates[0].update, { $inc: { stock_quantity: 2 } });
  assert.equal(productUpdates[0].options.session, session);
  assert.equal(movements.length, 1);
  const movement = movements[0].doc;
  assert.equal(movement.movement_type, StockMovementType.CREDIT_MEMO);
  assert.equal(movement.quantity_change, 2);
  assert.equal(movement.quantity_before, 58);
  assert.equal(movement.quantity_after, 60);
  assert.equal(Number(movement.quantity_before) + Number(movement.quantity_change), Number(movement.quantity_after));
  assert.equal(movement.reference_type, 'CreditMemo');
  assert.equal(String(movement.reference_id), CM_ID);
  assert.equal(movement.reference_number, 'CM-1004');
  assert.deepEqual(movements[0].options, { session });
  assert.equal(ledgerCalls.length, 1);
  assert.equal((ledgerCalls[0].options as { session?: unknown }).session, session);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
  assert.equal(session.abortTransaction.mock.callCount(), 0);
});

test('customer financial-only CM does not change stock or create a movement', async () => {
  assertNoMongoConnection();
  const { session, productUpdates, movements } = stubApprove({
    cm: makeCm({ type: 'CUSTOMER', affects_inventory: false }),
  });

  const res = await postApprove();

  assert.equal(res.status, 200);
  assert.equal(productUpdates.length, 0);
  assert.equal(movements.length, 0);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
});

test('vendor physical CM approval decreases stock and writes CREDIT_MEMO -qty with before/after', async () => {
  assertNoMongoConnection();
  const { session, productUpdates, movements } = stubApprove({
    cm: makeCm({
      type: 'VENDOR',
      customer_id: undefined,
      vendor_id: VENDOR_ID,
      affects_inventory: true,
      items: [{ product_id: PRODUCT_A, quantity: 5, product_name: 'Lays Box' }],
    }),
    stock: { [PRODUCT_A]: 50 },
  });

  const res = await postApprove();

  assert.equal(res.status, 200);
  assert.deepEqual(productUpdates[0].update, { $inc: { stock_quantity: -5 } });
  assert.equal(productUpdates[0].options.session, session);
  const movement = movements[0].doc;
  assert.equal(movement.movement_type, StockMovementType.CREDIT_MEMO);
  assert.equal(movement.quantity_change, -5);
  assert.equal(movement.quantity_before, 50);
  assert.equal(movement.quantity_after, 45);
  assert.equal(Number(movement.quantity_before) + Number(movement.quantity_change), Number(movement.quantity_after));
  assert.equal(movement.reference_type, 'CreditMemo');
  assert.equal(String(movement.reference_id), CM_ID);
  assert.equal(movement.reference_number, 'CM-1004');
});

test('vendor financial-only CM does not change stock or create a movement', async () => {
  assertNoMongoConnection();
  const { productUpdates, movements } = stubApprove({
    cm: makeCm({
      type: 'VENDOR',
      customer_id: undefined,
      vendor_id: VENDOR_ID,
      affects_inventory: false,
    }),
  });

  const res = await postApprove();

  assert.equal(res.status, 200);
  assert.equal(productUpdates.length, 0);
  assert.equal(movements.length, 0);
});

test('missing Product aborts approval with no movement and no committed financial posting', async () => {
  assertNoMongoConnection();
  const { session, movements, statusUpdates } = stubApprove({
    cm: makeCm({ type: 'CUSTOMER', affects_inventory: true }),
    productUpdate: () => null,
  });

  const res = await postApprove();

  assert.equal(res.status, 404);
  assert.match(String(res.body.error), /Product not found/);
  assert.equal(movements.length, 0);
  assert.equal(statusUpdates.length, 0);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
});

test('movement create failure aborts stock and financial posting; CM stays DRAFT', async () => {
  assertNoMongoConnection();
  const { session, statusUpdates } = stubApprove({
    cm: makeCm({ type: 'CUSTOMER', affects_inventory: true }),
    movementThrows: true,
  });

  const res = await postApprove();

  assert.equal(res.status, 500);
  assert.equal(statusUpdates.length, 0);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
});

test('multi-line physical CM writes a movement per line with correct before/delta/after', async () => {
  assertNoMongoConnection();
  const { movements, session } = stubApprove({
    cm: makeCm({
      type: 'CUSTOMER',
      affects_inventory: true,
      items: [
        { product_id: PRODUCT_A, quantity: 2, product_name: 'Lays Box' },
        { product_id: PRODUCT_B, quantity: 1, product_name: 'Oreo' },
      ],
    }),
    stock: { [PRODUCT_A]: 58, [PRODUCT_B]: 10 },
  });

  const res = await postApprove();

  assert.equal(res.status, 200);
  assert.equal(movements.length, 2);
  assert.equal(movements[0].doc.quantity_before, 58);
  assert.equal(movements[0].doc.quantity_change, 2);
  assert.equal(movements[0].doc.quantity_after, 60);
  assert.equal(movements[1].doc.quantity_before, 10);
  assert.equal(movements[1].doc.quantity_change, 1);
  assert.equal(movements[1].doc.quantity_after, 11);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
});

test('shipment-generated CM with affects_inventory=false stays inventory-neutral on approve', async () => {
  assertNoMongoConnection();
  const { productUpdates, movements } = stubApprove({
    cm: makeCm({
      type: 'CUSTOMER',
      affects_inventory: false,
      reference_shipment_id: SHIPMENT_ID,
    }),
  });

  const res = await postApprove();

  assert.equal(res.status, 200);
  assert.equal(productUpdates.length, 0);
  assert.equal(movements.length, 0);
});

function stubCancelSideEffects() {
  let statusWritten: string | null = null;
  let findOneAndUpdateFilter: Record<string, unknown> | null = null;
  let productTouched = false;
  let movementCreated = false;
  let ledgerTouched = false;
  let customerBalanceTouched = false;

  mock.method(CreditMemo, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: { $set?: { status?: string }; status?: string }) => {
    findOneAndUpdateFilter = filter;
    statusWritten = update.$set?.status ?? update.status ?? null;
    return { status: 'CANCELLED' };
  });
  mock.method(CreditMemo, 'findByIdAndUpdate', async (_id: unknown, update: { status?: string }) => {
    statusWritten = update.status ?? null;
    return { status: update.status };
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    productTouched = true;
    return { stock_quantity: 1 };
  });
  mock.method(StockMovement, 'create', async () => {
    movementCreated = true;
    return [{}];
  });
  mock.method(LedgerEntry, 'insertMany', async () => {
    ledgerTouched = true;
    return [];
  });
  mock.method(Customer, 'findByIdAndUpdate', async () => {
    customerBalanceTouched = true;
    return {};
  });

  return {
    get statusWritten() {
      return statusWritten;
    },
    get findOneAndUpdateFilter() {
      return findOneAndUpdateFilter;
    },
    get productTouched() {
      return productTouched;
    },
    get movementCreated() {
      return movementCreated;
    },
    get ledgerTouched() {
      return ledgerTouched;
    },
    get customerBalanceTouched() {
      return customerBalanceTouched;
    },
  };
}

test('DRAFT credit memo can still be cancelled', async () => {
  assertNoMongoConnection();
  mock.method(CreditMemo, 'findById', async () => makeCm({ status: 'DRAFT' }));
  const side = stubCancelSideEffects();

  const res = await postCancel();

  assert.equal(res.status, 200);
  assert.equal(side.statusWritten, 'CANCELLED');
  assert.equal(side.findOneAndUpdateFilter?.status, 'DRAFT');
  assert.equal(side.productTouched, false);
  assert.equal(side.movementCreated, false);
  assert.equal(side.ledgerTouched, false);
  assert.equal(side.customerBalanceTouched, false);
});

test('APPROVED financial-only credit memo cannot be cancelled', async () => {
  assertNoMongoConnection();
  mock.method(CreditMemo, 'findById', async () =>
    makeCm({
      type: 'CUSTOMER',
      status: 'APPROVED',
      affects_inventory: false,
      approved_at: new Date('2026-09-25T00:00:00Z'),
    })
  );
  const side = stubCancelSideEffects();

  const res = await postCancel();

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /cannot be cancelled/i);
  assert.equal(side.statusWritten, null);
  assert.equal(side.productTouched, false);
  assert.equal(side.movementCreated, false);
  assert.equal(side.ledgerTouched, false);
  assert.equal(side.customerBalanceTouched, false);
});

test('APPROVED physical customer credit memo cannot be cancelled', async () => {
  assertNoMongoConnection();
  mock.method(CreditMemo, 'findById', async () =>
    makeCm({
      type: 'CUSTOMER',
      status: 'APPROVED',
      affects_inventory: true,
      approved_at: new Date('2026-09-25T00:00:00Z'),
    })
  );
  const side = stubCancelSideEffects();

  const res = await postCancel();

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /cannot be cancelled/i);
  assert.equal(side.statusWritten, null);
  assert.equal(side.productTouched, false);
  assert.equal(side.movementCreated, false);
  assert.equal(side.ledgerTouched, false);
  assert.equal(side.customerBalanceTouched, false);
});

test('APPROVED physical vendor credit memo cannot be cancelled', async () => {
  assertNoMongoConnection();
  mock.method(CreditMemo, 'findById', async () =>
    makeCm({
      type: 'VENDOR',
      status: 'APPROVED',
      affects_inventory: true,
      vendor_id: VENDOR_ID,
      customer_id: undefined,
      approved_at: new Date('2026-09-25T00:00:00Z'),
    })
  );
  const side = stubCancelSideEffects();

  const res = await postCancel();

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /cannot be cancelled/i);
  assert.equal(side.statusWritten, null);
  assert.equal(side.productTouched, false);
  assert.equal(side.movementCreated, false);
  assert.equal(side.ledgerTouched, false);
});

test('cancel race: DRAFT claim loses to concurrent approve and rejects without side effects', async () => {
  assertNoMongoConnection();
  let finds = 0;
  mock.method(CreditMemo, 'findById', async () => {
    finds += 1;
    if (finds === 1) return makeCm({ status: 'DRAFT', affects_inventory: true });
    return makeCm({
      status: 'APPROVED',
      affects_inventory: true,
      approved_at: new Date('2026-09-25T00:00:00Z'),
    });
  });
  mock.method(CreditMemo, 'findOneAndUpdate', async () => null);
  let statusWritten: string | null = null;
  mock.method(CreditMemo, 'findByIdAndUpdate', async (_id: unknown, update: { status?: string }) => {
    statusWritten = update.status ?? null;
    return { status: update.status };
  });
  let productTouched = false;
  mock.method(Product, 'findOneAndUpdate', async () => {
    productTouched = true;
    return { stock_quantity: 1 };
  });
  let movementCreated = false;
  mock.method(StockMovement, 'create', async () => {
    movementCreated = true;
    return [{}];
  });

  const res = await postCancel();

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /cannot be cancelled/i);
  assert.equal(statusWritten, null);
  assert.equal(productTouched, false);
  assert.equal(movementCreated, false);
});

test('approved then cancelled CM cannot be hard-deleted', async () => {
  assertNoMongoConnection();
  mock.method(CreditMemo, 'findById', async () =>
    makeCm({
      status: 'CANCELLED',
      approved_at: new Date('2026-09-25T00:00:00Z'),
    })
  );
  let deleted = false;
  mock.method(CreditMemo, 'deleteOne', async () => {
    deleted = true;
    return { deletedCount: 1 };
  });

  const res = await deleteCm();

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /approved and cannot be deleted/i);
  assert.equal(deleted, false);
});

test('draft cancelled CM remains hard-deletable', async () => {
  assertNoMongoConnection();
  mock.method(CreditMemo, 'findById', async () => makeCm({ status: 'CANCELLED', approved_at: undefined }));
  let deleted = false;
  mock.method(CreditMemo, 'deleteOne', async () => {
    deleted = true;
    return { deletedCount: 1 };
  });

  const res = await deleteCm();

  assert.equal(res.status, 200);
  assert.equal(deleted, true);
});

test('concurrent approve claims once: second request does not apply inventory', async () => {
  assertNoMongoConnection();
  let claimed = false;
  const h = stubApprove({
    cm: makeCm({ type: 'CUSTOMER', affects_inventory: true }),
    stock: { [PRODUCT_A]: 58 },
    claim: (filter) => {
      assert.equal(filter.status, 'DRAFT');
      if (claimed) return null;
      claimed = true;
      return {
        ...makeCm({ type: 'CUSTOMER', affects_inventory: true }),
        status: 'APPROVED',
      };
    },
  });

  const first = await postApprove();
  const second = await postApprove();

  assert.equal(first.status, 200);
  assert.equal(second.status, 400);
  assert.match(String(second.body.error), /Only draft/i);
  assert.equal(h.movements.length, 1);
  assert.equal(h.productUpdates.length, 1);
  assert.equal(h.stock[PRODUCT_A], 60);
  assert.equal(h.claims.length, 2);
  assert.equal(h.session.commitTransaction.mock.callCount(), 1);
});

test('credit memo inventory path uses createStockMovement and never StockMovement.create directly', () => {
  const serviceSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/modules/credit-memo/services/creditMemoService.ts'),
    'utf8'
  );
  const shipmentSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/modules/shipping/services/shipmentService.ts'),
    'utf8'
  );
  assert.match(serviceSrc, /createStockMovement\(/);
  assert.match(serviceSrc, /StockMovementType\.CREDIT_MEMO/);
  assert.match(serviceSrc, /status: 'DRAFT'/);
  assert.equal(serviceSrc.includes('StockMovement.create'), false);
  assert.match(shipmentSrc, /affects_inventory:\s*false/);
  assert.match(shipmentSrc, /SHIPMENT_IN/);
});
