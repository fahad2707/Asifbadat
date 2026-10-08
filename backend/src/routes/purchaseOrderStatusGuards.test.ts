/**
 * Phase 3.2 — Purchase Order status transition guards.
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/purchaseOrderStatusGuards.test.ts
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
import StockMovement from '../models/StockMovement';
import LedgerEntry from '../models/LedgerEntry';

const ADMIN_ID = '64b0000000000000000a0001';
const PO_ID = '64b0000000000000000b0001';
const PRODUCT_A = '64b0000000000000000c0001';
const PRODUCT_B = '64b0000000000000000c0002';
const LINE_A = '64b0000000000000000e0001';
const LINE_B = '64b0000000000000000e0002';
const VENDOR_ID = '64b0000000000000000f0001';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: ADMIN_ID, role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'PO status guard tests must not open a MongoDB connection');
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

type InventorySpies = {
  stockUpdates: number;
  movements: number;
};

function stubInventoryNoOp(): InventorySpies {
  const spies: InventorySpies = { stockUpdates: 0, movements: 0 };
  mock.method(Product, 'findOneAndUpdate', async () => {
    spies.stockUpdates += 1;
    throw new Error('stock must not change');
  });
  mock.method(Product, 'findByIdAndUpdate', async () => {
    spies.stockUpdates += 1;
    throw new Error('stock must not change');
  });
  mock.method(StockMovement, 'create', async () => {
    spies.movements += 1;
    throw new Error('StockMovement must not run');
  });
  return spies;
}

function stubSendOrCancel(opts: {
  currentStatus: string;
  conditionalMatch: boolean;
}) {
  const spies = stubInventoryNoOp();
  let updatedDoc: { _id: string; status: string } | null = null;

  mock.method(PurchaseOrder, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    if (!opts.conditionalMatch) return null;
    const nextStatus = (update.$set as { status?: string } | undefined)?.status;
    updatedDoc = { _id: PO_ID, status: String(nextStatus || opts.currentStatus) };
    return updatedDoc;
  });
  mock.method(PurchaseOrder, 'findById', async () => {
    if (!opts.conditionalMatch) {
      return { _id: PO_ID, status: opts.currentStatus };
    }
    return null;
  });

  return { spies, getUpdated: () => updatedDoc };
}

async function postSend() {
  return request(createApp())
    .post(`/api/purchase-orders/${PO_ID}/send`)
    .set('Authorization', `Bearer ${adminTestToken()}`);
}

async function postCancel() {
  return request(createApp())
    .post(`/api/purchase-orders/${PO_ID}/cancel`)
    .set('Authorization', `Bearer ${adminTestToken()}`);
}

async function postReceive(body: Record<string, unknown>, status: string, items?: Array<Record<string, unknown>>) {
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  type PoLine = {
    _id: string;
    product_id: string;
    product_name: string;
    quantity_ordered: number;
    quantity_received: number;
  };
  const poItems: PoLine[] = (items as PoLine[] | undefined) || [
    {
      _id: LINE_A,
      product_id: PRODUCT_A,
      product_name: 'Lays Box',
      quantity_ordered: 100,
      quantity_received: 0,
    },
  ];
  const po = {
    _id: PO_ID,
    po_number: 'P12345',
    vendor_id: VENDOR_ID,
    status,
    total_amount: 250,
    items: poItems,
  };

  mock.method(PurchaseOrder, 'findById', async () => po);

  const poUpdates: unknown[] = [];
  let latestItems = poItems.map((line) => ({ ...line }));
  mock.method(PurchaseOrder, 'findOneAndUpdate', async (_filter: unknown, update: Record<string, unknown>, options: Record<string, unknown>) => {
    poUpdates.push({ update, options });
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
      ...po,
      items: latestItems.map((line) => ({ ...line })),
      ...(update.$set || {}),
    };
  });

  const stock: Record<string, number> = { [PRODUCT_A]: 48, [PRODUCT_B]: 10 };
  const productUpdates: unknown[] = [];
  mock.method(Product, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    productUpdates.push({ filter, update });
    const productId = String(filter._id);
    const qty = Number((update.$inc as { stock_quantity?: number } | undefined)?.stock_quantity || 0);
    if (!(productId in stock)) return null;
    stock[productId] += qty;
    return { _id: productId, stock_quantity: stock[productId] };
  });

  const movements: unknown[] = [];
  mock.method(StockMovement, 'create', async (docs: unknown) => {
    const doc = Array.isArray(docs) ? docs[0] : docs;
    movements.push(doc);
    return [doc];
  });
  mock.method(LedgerEntry, 'insertMany', async () => []);

  const res = await request(createApp())
    .post(`/api/purchase-orders/${PO_ID}/receive`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);

  return { res, session, poUpdates, productUpdates, movements, stock };
}

// --- SEND ---

test('send: draft → sent PASS with no stock/movement', async () => {
  assertNoMongoConnection();
  const { spies } = stubSendOrCancel({ currentStatus: 'draft', conditionalMatch: true });
  const res = await postSend();
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'sent');
  assert.equal(spies.stockUpdates, 0);
  assert.equal(spies.movements, 0);
});

test('send: sent → sent REJECT with no stock/movement', async () => {
  assertNoMongoConnection();
  const { spies } = stubSendOrCancel({ currentStatus: 'sent', conditionalMatch: false });
  const res = await postSend();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /only draft/i);
  assert.equal(spies.stockUpdates, 0);
  assert.equal(spies.movements, 0);
});

test('send: partial → sent REJECT', async () => {
  assertNoMongoConnection();
  stubSendOrCancel({ currentStatus: 'partial', conditionalMatch: false });
  const res = await postSend();
  assert.equal(res.status, 400);
});

test('send: received → sent REJECT', async () => {
  assertNoMongoConnection();
  stubSendOrCancel({ currentStatus: 'received', conditionalMatch: false });
  const res = await postSend();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /only draft/i);
});

test('send: cancelled → sent REJECT', async () => {
  assertNoMongoConnection();
  stubSendOrCancel({ currentStatus: 'cancelled', conditionalMatch: false });
  const res = await postSend();
  assert.equal(res.status, 400);
});

// --- CANCEL ---

test('cancel: draft → cancelled PASS with no stock/movement', async () => {
  assertNoMongoConnection();
  const { spies } = stubSendOrCancel({ currentStatus: 'draft', conditionalMatch: true });
  const res = await postCancel();
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'cancelled');
  assert.equal(spies.stockUpdates, 0);
  assert.equal(spies.movements, 0);
});

test('cancel: sent → cancelled PASS with no stock/movement', async () => {
  assertNoMongoConnection();
  const { spies } = stubSendOrCancel({ currentStatus: 'sent', conditionalMatch: true });
  const res = await postCancel();
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'cancelled');
  assert.equal(spies.stockUpdates, 0);
  assert.equal(spies.movements, 0);
});

test('cancel: partial → cancelled PASS with no stock/movement', async () => {
  assertNoMongoConnection();
  const { spies } = stubSendOrCancel({ currentStatus: 'partial', conditionalMatch: true });
  const res = await postCancel();
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'cancelled');
  assert.equal(spies.stockUpdates, 0);
  assert.equal(spies.movements, 0);
});

test('cancel: received → cancelled REJECT with no stock/movement', async () => {
  assertNoMongoConnection();
  const { spies } = stubSendOrCancel({ currentStatus: 'received', conditionalMatch: false });
  const res = await postCancel();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /received.*cannot be cancelled/i);
  assert.equal(spies.stockUpdates, 0);
  assert.equal(spies.movements, 0);
});

test('cancel: cancelled → cancelled REJECT', async () => {
  assertNoMongoConnection();
  stubSendOrCancel({ currentStatus: 'cancelled', conditionalMatch: false });
  const res = await postCancel();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /cannot be cancelled/i);
});

test('received PO cannot transition back to sent or cancelled', async () => {
  assertNoMongoConnection();
  stubSendOrCancel({ currentStatus: 'received', conditionalMatch: false });
  const sendRes = await postSend();
  assert.equal(sendRes.status, 400);

  mock.restoreAll();
  stubSendOrCancel({ currentStatus: 'received', conditionalMatch: false });
  const cancelRes = await postCancel();
  assert.equal(cancelRes.status, 400);
  assert.match(String(cancelRes.body.error), /received.*cannot be cancelled/i);
});

// --- RECEIVE STATUS ---

test('receive: draft → partial PASS', async () => {
  assertNoMongoConnection();
  const { res, movements } = await postReceive(
    { items: [{ product_id: PRODUCT_A, quantity_received: 20 }] },
    'draft'
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'partial');
  assert.equal(movements.length, 1);
});

test('receive: draft → received PASS', async () => {
  assertNoMongoConnection();
  const { res, movements } = await postReceive(
    { items: [{ product_id: PRODUCT_A, quantity_received: 20 }] },
    'draft',
    [
      {
        _id: LINE_A,
        product_id: PRODUCT_A,
        product_name: 'Lays Box',
        quantity_ordered: 20,
        quantity_received: 0,
      },
    ]
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'received');
  assert.equal(movements.length, 1);
});

test('receive: sent → partial PASS', async () => {
  assertNoMongoConnection();
  const { res } = await postReceive(
    { items: [{ product_id: PRODUCT_A, quantity_received: 20 }] },
    'sent'
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'partial');
});

test('receive: sent → received PASS', async () => {
  assertNoMongoConnection();
  const { res } = await postReceive(
    { items: [{ product_id: PRODUCT_A, quantity_received: 20 }] },
    'sent',
    [
      {
        _id: LINE_A,
        product_id: PRODUCT_A,
        product_name: 'Lays Box',
        quantity_ordered: 20,
        quantity_received: 0,
      },
    ]
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'received');
});

test('receive: partial → partial PASS', async () => {
  assertNoMongoConnection();
  const { res } = await postReceive(
    { items: [{ product_id: PRODUCT_A, quantity_received: 10 }] },
    'partial',
    [
      {
        _id: LINE_A,
        product_id: PRODUCT_A,
        product_name: 'Lays Box',
        quantity_ordered: 100,
        quantity_received: 40,
      },
    ]
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'partial');
});

test('receive: partial → received PASS', async () => {
  assertNoMongoConnection();
  const { res } = await postReceive(
    { items: [{ product_id: PRODUCT_A, quantity_received: 20 }] },
    'partial',
    [
      {
        _id: LINE_A,
        product_id: PRODUCT_A,
        product_name: 'Lays Box',
        quantity_ordered: 100,
        quantity_received: 80,
      },
    ]
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'received');
});

test('receive: received → receive REJECT with no stock/movement', async () => {
  assertNoMongoConnection();
  const { res, productUpdates, movements, session } = await postReceive(
    { items: [{ product_id: PRODUCT_A, quantity_received: 20 }] },
    'received',
    [
      {
        _id: LINE_A,
        product_id: PRODUCT_A,
        product_name: 'Lays Box',
        quantity_ordered: 100,
        quantity_received: 80,
      },
    ]
  );
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /already received/i);
  assert.equal(productUpdates.length, 0);
  assert.equal(movements.length, 0);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
});

test('receive: cancelled → receive REJECT', async () => {
  assertNoMongoConnection();
  const { res, productUpdates, movements } = await postReceive(
    { items: [{ product_id: PRODUCT_A, quantity_received: 20 }] },
    'cancelled'
  );
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /cancelled/i);
  assert.equal(productUpdates.length, 0);
  assert.equal(movements.length, 0);
});

test('receive multi-product from sent still works under status guards', async () => {
  assertNoMongoConnection();
  const { res, movements } = await postReceive(
    {
      items: [
        { product_id: PRODUCT_A, quantity_received: 10 },
        { product_id: PRODUCT_B, quantity_received: 5 },
      ],
    },
    'sent',
    [
      {
        _id: LINE_A,
        product_id: PRODUCT_A,
        product_name: 'Lays Box',
        quantity_ordered: 100,
        quantity_received: 0,
      },
      {
        _id: LINE_B,
        product_id: PRODUCT_B,
        product_name: 'Oreo',
        quantity_ordered: 50,
        quantity_received: 0,
      },
    ]
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'partial');
  assert.equal(movements.length, 2);
});
