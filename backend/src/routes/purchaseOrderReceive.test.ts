/**
 * Phase 2B PO receiving — isolated harness, no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/purchaseOrderReceive.test.ts
 */
import '../load-env';
import fs from 'fs';
import path from 'path';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import PurchaseOrder from '../models/PurchaseOrder';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import LedgerEntry from '../models/LedgerEntry';
import { StockMovementType, LedgerReferenceType } from '../shared/enums';

const PO_ID = '64b0000000000000000b0001';
const PRODUCT_A = '64b0000000000000000c0001';
const PRODUCT_B = '64b0000000000000000c0002';
const MISSING = '64b0000000000000000c0099';
const LINE_A = '64b0000000000000000e0001';
const LINE_B = '64b0000000000000000e0002';
const VENDOR_ID = '64b0000000000000000f0001';
const ADMIN_ID = '64b0000000000000000a0001';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: ADMIN_ID, role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'PO receive tests must not open a MongoDB connection');
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

type PoLine = {
  _id: string;
  product_id: string;
  product_name: string;
  quantity_ordered: number;
  quantity_received: number;
};

function makePo(overrides: Record<string, unknown> = {}) {
  const items: PoLine[] = (overrides.items as PoLine[] | undefined) || [
    {
      _id: LINE_A,
      product_id: PRODUCT_A,
      product_name: 'Lays Box',
      quantity_ordered: 100,
      quantity_received: 0,
    },
  ];
  return {
    _id: PO_ID,
    po_number: 'P12345',
    vendor_id: VENDOR_ID,
    status: 'sent',
    total_amount: 250,
    received_at: undefined,
    ...overrides,
    items,
  };
}

async function postReceive(body: Record<string, unknown>, poId = PO_ID) {
  return request(createApp())
    .post(`/api/purchase-orders/${poId}/receive`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

function stubReceive(opts: {
  po: ReturnType<typeof makePo>;
  claimReturnsNull?: boolean;
  productUpdate?: (productId: string, qty: number) => { stock_quantity: number } | null;
  movementThrows?: boolean;
  poClaimThrows?: boolean;
  stock?: Record<string, number>;
}) {
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  mock.method(PurchaseOrder, 'findById', async () => opts.po);

  const poUpdates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown>; options: Record<string, unknown> }> = [];
  let latestItems = (opts.po.items as PoLine[]).map((line) => ({ ...line }));
  mock.method(PurchaseOrder, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>, options: Record<string, unknown>) => {
    poUpdates.push({ filter, update, options });
    if (opts.poClaimThrows && update.$inc) {
      throw new Error('PO claim failed');
    }
    if (opts.claimReturnsNull && update.$inc) return null;

    if (update.$inc) {
      for (const [key, qty] of Object.entries(update.$inc as Record<string, number>)) {
        const match = key.match(/^items\.\$\[l(\d+)\]\.quantity_received$/);
        if (!match) continue;
        const index = Number(match[1]);
        const arrayFilters = (options.arrayFilters || []) as Array<Record<string, unknown>>;
        const lineId = String(arrayFilters[index]?.[`l${index}._id`] || '');
        const line = latestItems.find((row) => row._id === lineId);
        if (line) line.quantity_received += Number(qty);
      }
    }
    return {
      ...opts.po,
      items: latestItems.map((line) => ({ ...line })),
      ...(update.$set || {}),
    };
  });

  const stock = opts.stock || { [PRODUCT_A]: 48, [PRODUCT_B]: 10 };
  const productUpdates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown>; options: Record<string, unknown> }> = [];
  mock.method(Product, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>, options: Record<string, unknown>) => {
    productUpdates.push({ filter, update, options });
    const productId = String(filter._id);
    const qty = Number((update.$inc as { stock_quantity?: number } | undefined)?.stock_quantity || 0);
    if (opts.productUpdate) return opts.productUpdate(productId, qty);
    if (!(productId in stock)) return null;
    stock[productId] += qty;
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

  return { session, poUpdates, productUpdates, movements, ledgerCalls, stock };
}

test('single-line success: 48 → +20 → 68 with PURCHASE movement and session', async () => {
  assertNoMongoConnection();
  const { session, poUpdates, productUpdates, movements, ledgerCalls } = stubReceive({
    po: makePo(),
  });

  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 20 }],
  });

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'partial');
  assert.equal(res.body.items[0].quantity_received, 20);

  const claim = poUpdates.find((call) => call.update.$inc);
  assert.ok(claim);
  assert.deepEqual((claim.filter.status as { $in?: string[] }).$in, ['draft', 'sent', 'partial']);
  assert.equal((claim.update.$inc as Record<string, number>)['items.$[l0].quantity_received'], 20);
  assert.equal(claim.options.session, session);
  const remainingCap = (claim.options.arrayFilters as Array<Record<string, unknown>>)[0]['l0.quantity_received'] as { $lte: number };
  assert.equal(remainingCap.$lte, 80);

  assert.deepEqual(productUpdates[0].update, { $inc: { stock_quantity: 20 } });
  assert.equal(productUpdates[0].options.session, session);

  assert.equal(movements.length, 1);
  const movement = movements[0].doc;
  assert.equal(movement.movement_type, StockMovementType.PURCHASE);
  assert.notEqual(movement.movement_type, 'purchase');
  assert.equal(movement.quantity_before, 48);
  assert.equal(movement.quantity_change, 20);
  assert.equal(movement.quantity_after, 68);
  assert.equal(Number(movement.quantity_before) + Number(movement.quantity_change), Number(movement.quantity_after));
  assert.equal(String(movement.reference_id), PO_ID);
  assert.equal(movement.reference_number, 'P12345');
  assert.equal(movement.reference_type, 'purchase_order');
  assert.equal(movement.reason, undefined);
  assert.equal(movement.notes, undefined);
  assert.equal(String(movement.admin_id), ADMIN_ID);
  assert.deepEqual(movements[0].options, { session });

  assert.equal(ledgerCalls.length, 0);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
  assert.equal(session.abortTransaction.mock.callCount(), 0);
});

test('multi-line success claims both products, writes two movements, commits once', async () => {
  assertNoMongoConnection();
  const { session, productUpdates, movements } = stubReceive({
    po: makePo({
      items: [
        { _id: LINE_A, product_id: PRODUCT_A, product_name: 'Lays Box', quantity_ordered: 100, quantity_received: 0 },
        { _id: LINE_B, product_id: PRODUCT_B, product_name: 'Oreo', quantity_ordered: 50, quantity_received: 0 },
      ],
    }),
  });

  const res = await postReceive({
    items: [
      { product_id: PRODUCT_A, quantity_received: 70 },
      { product_id: PRODUCT_B, quantity_received: 30 },
    ],
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'partial');
  assert.equal(productUpdates.length, 2);
  assert.equal(movements.length, 2);
  assert.equal(movements[0].doc.movement_type, 'PURCHASE');
  assert.equal(movements[1].doc.movement_type, 'PURCHASE');
  assert.equal(session.commitTransaction.mock.callCount(), 1);
  assert.equal(session.abortTransaction.mock.callCount(), 0);
});

test('over-receive is rejected with no stock, movement, or committed PO change', async () => {
  assertNoMongoConnection();
  const { session, poUpdates, productUpdates, movements } = stubReceive({
    po: makePo({
      items: [
        { _id: LINE_A, product_id: PRODUCT_A, product_name: 'Lays Box', quantity_ordered: 100, quantity_received: 90 },
      ],
    }),
  });

  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 20 }],
  });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /remaining/i);
  assert.equal(poUpdates.length, 0);
  assert.equal(productUpdates.length, 0);
  assert.equal(movements.length, 0);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
});

test('multi-line over-receive of one product rejects the entire request', async () => {
  assertNoMongoConnection();
  const { session, productUpdates, movements, poUpdates } = stubReceive({
    po: makePo({
      items: [
        { _id: LINE_A, product_id: PRODUCT_A, product_name: 'Lays Box', quantity_ordered: 70, quantity_received: 0 },
        { _id: LINE_B, product_id: PRODUCT_B, product_name: 'Oreo', quantity_ordered: 10, quantity_received: 0 },
      ],
    }),
  });

  const res = await postReceive({
    items: [
      { product_id: PRODUCT_A, quantity_received: 70 },
      { product_id: PRODUCT_B, quantity_received: 30 },
    ],
  });

  assert.equal(res.status, 400);
  assert.equal(poUpdates.length, 0);
  assert.equal(productUpdates.length, 0);
  assert.equal(movements.length, 0);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
});

test('concurrent claim failure aborts without stock or movement', async () => {
  assertNoMongoConnection();
  const { session, productUpdates, movements } = stubReceive({
    po: makePo(),
    claimReturnsNull: true,
  });

  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 70 }],
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'RECEIVE_CONFLICT');
  assert.equal(productUpdates.length, 0);
  assert.equal(movements.length, 0);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
});

test('missing Product during stock update aborts PO claim and movement', async () => {
  assertNoMongoConnection();
  const { session, movements } = stubReceive({
    po: makePo(),
    productUpdate: () => null,
  });

  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 20 }],
  });

  assert.equal(res.status, 404);
  assert.match(String(res.body.error), /Product not found/);
  assert.equal(movements.length, 0);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
});

test('StockMovement failure aborts Product and PO changes', async () => {
  assertNoMongoConnection();
  const { session } = stubReceive({
    po: makePo(),
    movementThrows: true,
  });

  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 20 }],
  });

  assert.equal(res.status, 500);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
});

test('PO claim failure aborts without stock or movement', async () => {
  assertNoMongoConnection();
  const { session, productUpdates, movements } = stubReceive({
    po: makePo(),
    poClaimThrows: true,
  });

  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 20 }],
  });

  assert.equal(res.status, 500);
  assert.equal(productUpdates.length, 0);
  assert.equal(movements.length, 0);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
});

test('full receive with total_amount > 0 posts vendor ledger on the same session', async () => {
  assertNoMongoConnection();
  const { session, ledgerCalls } = stubReceive({
    po: makePo({
      total_amount: 250,
      items: [
        { _id: LINE_A, product_id: PRODUCT_A, product_name: 'Lays Box', quantity_ordered: 20, quantity_received: 0 },
      ],
    }),
  });

  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 20 }],
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'received');
  assert.ok(res.body.items);
  assert.equal(ledgerCalls.length, 1);
  assert.equal((ledgerCalls[0].options as { session?: unknown }).session, session);
  const docs = ledgerCalls[0].docs as Array<Record<string, unknown>>;
  assert.equal(docs[0].account_type, 'VENDOR');
  assert.equal(docs[0].debit, 250);
  assert.equal(docs[0].credit, 0);
  assert.equal(docs[0].reference_type, LedgerReferenceType.PURCHASE_ORDER);
  assert.equal(String(docs[0].reference_id), PO_ID);
  assert.equal(docs[1].account_type, 'PURCHASE');
  assert.equal(docs[1].debit, 0);
  assert.equal(docs[1].credit, 250);
});

test('partial receive does not post vendor ledger', async () => {
  assertNoMongoConnection();
  const { ledgerCalls } = stubReceive({ po: makePo() });

  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 20 }],
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'partial');
  assert.equal(ledgerCalls.length, 0);
});

test('anomalous received status with remaining qty cannot receive again', async () => {
  assertNoMongoConnection();
  const { session, poUpdates, productUpdates, movements, ledgerCalls } = stubReceive({
    po: makePo({
      status: 'received',
      received_at: new Date('2026-09-01T00:00:00Z'),
      items: [
        { _id: LINE_A, product_id: PRODUCT_A, product_name: 'Lays Box', quantity_ordered: 100, quantity_received: 80 },
      ],
    }),
  });

  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 20 }],
  });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /already received/i);
  assert.equal(poUpdates.length, 0);
  assert.equal(productUpdates.length, 0);
  assert.equal(movements.length, 0);
  assert.equal(ledgerCalls.length, 0);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
});

test('fully received sets status received and received_at; partial does not set received_at', async () => {
  assertNoMongoConnection();
  const full = stubReceive({
    po: makePo({
      items: [
        { _id: LINE_A, product_id: PRODUCT_A, product_name: 'Lays Box', quantity_ordered: 20, quantity_received: 0 },
      ],
    }),
  });
  const fullRes = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 20 }],
  });
  assert.equal(fullRes.status, 200);
  assert.equal(fullRes.body.status, 'received');
  const fullStatus = full.poUpdates.find((call) => call.update.$set)?.update.$set as { received_at?: Date; status?: string };
  assert.equal(fullStatus.status, 'received');
  assert.ok(fullStatus.received_at instanceof Date);

  mock.restoreAll();
  const partial = stubReceive({ po: makePo() });
  const partialRes = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 20 }],
  });
  assert.equal(partialRes.status, 200);
  assert.equal(partialRes.body.status, 'partial');
  const partialStatus = partial.poUpdates.find((call) => call.update.$set)?.update.$set as { received_at?: Date; status?: string };
  assert.equal(partialStatus.status, 'partial');
  assert.equal(partialStatus.received_at, undefined);
});

test('cancelled PO is rejected with no writes', async () => {
  assertNoMongoConnection();
  const { session, poUpdates, productUpdates, movements } = stubReceive({
    po: makePo({ status: 'cancelled' }),
  });

  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 20 }],
  });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /cancelled/i);
  assert.equal(poUpdates.length, 0);
  assert.equal(productUpdates.length, 0);
  assert.equal(movements.length, 0);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
});

test('unknown positive product_id is rejected', async () => {
  assertNoMongoConnection();
  const { session, poUpdates, productUpdates } = stubReceive({ po: makePo() });

  const res = await postReceive({
    items: [{ product_id: MISSING, quantity_received: 5 }],
  });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /not on this purchase order/i);
  assert.equal(poUpdates.length, 0);
  assert.equal(productUpdates.length, 0);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
});

test('zero-quantity lines are ignored while positive lines are received', async () => {
  assertNoMongoConnection();
  const { movements } = stubReceive({
    po: makePo({
      items: [
        { _id: LINE_A, product_id: PRODUCT_A, product_name: 'Lays Box', quantity_ordered: 100, quantity_received: 0 },
        { _id: LINE_B, product_id: PRODUCT_B, product_name: 'Oreo', quantity_ordered: 50, quantity_received: 0 },
      ],
    }),
  });

  const res = await postReceive({
    items: [
      { product_id: PRODUCT_A, quantity_received: 20 },
      { product_id: PRODUCT_B, quantity_received: 0 },
    ],
  });

  assert.equal(res.status, 200);
  assert.equal(movements.length, 1);
  assert.equal(String(movements[0].doc.product_id), PRODUCT_A);
});

test('duplicate product_id entries are summed before the claim', async () => {
  assertNoMongoConnection();
  const { poUpdates, movements } = stubReceive({ po: makePo() });

  const res = await postReceive({
    items: [
      { product_id: PRODUCT_A, quantity_received: 10 },
      { product_id: PRODUCT_A, quantity_received: 5 },
    ],
  });

  assert.equal(res.status, 200);
  const claim = poUpdates.find((call) => call.update.$inc);
  assert.equal((claim?.update.$inc as Record<string, number>)['items.$[l0].quantity_received'], 15);
  assert.equal(movements[0].doc.quantity_change, 15);
});

test('all-zero / no-op request is rejected without starting a transaction', async () => {
  assertNoMongoConnection();
  const session = createFakeSession();
  const start = mock.method(mongoose, 'startSession', async () => session);

  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 0 }],
  });

  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /nothing to receive/i);
  assert.equal(start.mock.callCount(), 0);
  assert.equal(session.abortTransaction.mock.callCount(), 0);
});

test('negative quantity is rejected', async () => {
  assertNoMongoConnection();
  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: -1 }],
  });
  assert.equal(res.status, 400);
});

test('non-integer quantity is rejected', async () => {
  assertNoMongoConnection();
  const res = await postReceive({
    items: [{ product_id: PRODUCT_A, quantity_received: 20.5 }],
  });
  assert.equal(res.status, 400);
});

test('new receive path uses createStockMovement and does not call StockMovement.create directly', () => {
  const serviceSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/services/purchaseOrderReceiveService.ts'),
    'utf8'
  );
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'src/routes/purchase-orders.ts'), 'utf8');
  assert.match(serviceSrc, /createStockMovement\(/);
  assert.match(serviceSrc, /StockMovementType\.PURCHASE/);
  assert.equal(serviceSrc.includes('StockMovement.create'), false);
  assert.equal(routeSrc.includes('StockMovement.create'), false);
  assert.equal(serviceSrc.includes('Math.min'), false);
  assert.match(serviceSrc, /arrayFilters/);
});
