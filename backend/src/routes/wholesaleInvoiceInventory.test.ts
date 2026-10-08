/**
 * Phase 2D.2 — NEW WHOLESALE invoice inventory (atomic SALE movements).
 *
 * Isolated harness: no Mongo connection, no Atlas, no historical backfill.
 *
 * Run with:
 *     npx tsx --test src/routes/wholesaleInvoiceInventory.test.ts
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
import Invoice from '../models/Invoice';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import Customer from '../models/Customer';
import CustomerProductPrice from '../models/CustomerProductPrice';
import { DOCUMENT_TYPE_INVOICE, DOCUMENT_TYPE_QUOTATION } from '../utils/documentType';
import { StockMovementType } from '../shared/enums';
import {
  aggregateInvoiceInventoryQuantities,
  netStockChangesFromInvoiceItems,
  usesMigratedWholesaleInventory,
} from '../services/wholesaleInvoiceInventoryService';

const ADMIN_ID = '64b0000000000000000a0001';
const INVOICE_ID = '64b0000000000000000d0303';
const QUOTE_ID = '64b0000000000000000d0404';
const PRODUCT_A = '64b0000000000000000c0001';
const PRODUCT_B = '64b0000000000000000c0002';
const PRODUCT_C = '64b0000000000000000c0003';
const PRODUCT_SERVICE = '64b0000000000000000c0004';
const PRODUCT_NONINV = '64b0000000000000000c0005';
const PRODUCT_MISSING = '64b0000000000000000c00ff';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: ADMIN_ID, role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'wholesale invoice inventory tests must not open a MongoDB connection');
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

afterEach(() => {
  mock.restoreAll();
});

function line(productId: string, quantity: number, price = 10) {
  return {
    product_id: productId,
    product_name: `P-${productId.slice(-4)}`,
    quantity,
    price,
    subtotal: quantity * price,
  };
}

function taxProduct(id: string, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    name: `P-${id.slice(-4)}`,
    price: 10,
    stock_quantity: 50,
    product_type: 'inventory',
    tax_type_id: null,
    ...extra,
  };
}

function createdInvoice(fields: Record<string, unknown>) {
  const _id = { toString: () => INVOICE_ID };
  return {
    _id,
    toObject: () => ({ _id, ...fields }),
    ...fields,
  };
}

function firstCreateDoc(docs: unknown): Record<string, unknown> {
  return (Array.isArray(docs) ? docs[0] : docs) as Record<string, unknown>;
}

function stubInvoiceNumber() {
  mock.method(Invoice, 'find', () => ({
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    lean: async () => [],
  }));
}

function createFakeSession() {
  return {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
}

type HarnessOpts = {
  stock?: Record<string, number>;
  products?: Record<string, Record<string, unknown>>;
  createThrows?: boolean;
  movementThrows?: boolean;
  missingAtFindById?: string[];
  missingAtInc?: string[];
  invoiceClaim?: (filter: Record<string, unknown>) => Record<string, unknown> | null;
  quoteClaim?: (filter: Record<string, unknown>) => Record<string, unknown> | null;
};

function stubWholesaleHarness(opts: HarnessOpts = {}) {
  const session = createFakeSession();
  const stock: Record<string, number> = {
    [PRODUCT_A]: 50,
    [PRODUCT_B]: 20,
    [PRODUCT_C]: 10,
    [PRODUCT_SERVICE]: 99,
    [PRODUCT_NONINV]: 99,
    ...(opts.stock || {}),
  };
  const stockSnapshot = { ...stock };
  const products: Record<string, Record<string, unknown>> = {
    [PRODUCT_A]: taxProduct(PRODUCT_A),
    [PRODUCT_B]: taxProduct(PRODUCT_B),
    [PRODUCT_C]: taxProduct(PRODUCT_C),
    [PRODUCT_SERVICE]: taxProduct(PRODUCT_SERVICE, { product_type: 'service' }),
    [PRODUCT_NONINV]: taxProduct(PRODUCT_NONINV, { product_type: 'non_inventory' }),
    [PRODUCT_MISSING]: taxProduct(PRODUCT_MISSING, { name: 'Gone' }),
    ...(opts.products || {}),
  };

  const productUpdates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const movements: Array<{ doc: Record<string, unknown>; options: unknown }> = [];
  const invoiceCreates: Record<string, unknown>[] = [];
  const invoiceClaims: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const invoiceDeletes: unknown[] = [];
  const findByIdAndUpdateCalls: Array<{ id: unknown; update: unknown }> = [];
  let persistedInvoice: Record<string, unknown> | null = null;
  let committed = false;

  const restoreOnAbort = () => {
    if (committed) return;
    for (const key of Object.keys(stock)) delete stock[key];
    Object.assign(stock, stockSnapshot);
    persistedInvoice = null;
    movements.length = 0;
  };

  session.abortTransaction = mock.fn(async () => {
    restoreOnAbort();
  });
  session.commitTransaction = mock.fn(async () => {
    committed = true;
  });

  mock.method(mongoose, 'startSession', async () => session);

  mock.method(Product, 'find', () => ({
    populate() {
      return this;
    },
    lean: async () => Object.values(products),
  }));

  mock.method(Product, 'findById', (id: unknown) => {
    const key = String(id);
    if ((opts.missingAtFindById || []).includes(key)) {
      return {
        lean: async () => null,
        then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(null).then(onFulfilled, onRejected);
        },
      };
    }
    const row = products[key];
    const doc = row ? { ...row, stock_quantity: stock[key] } : null;
    return {
      lean: async () => doc,
      then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve(doc).then(onFulfilled, onRejected);
      },
    };
  });

  mock.method(Product, 'findByIdAndUpdate', async (id: unknown, update: unknown) => {
    findByIdAndUpdateCalls.push({ id, update });
    const key = String(id);
    const inc = Number((update as { $inc?: { stock_quantity?: number } }).$inc?.stock_quantity || 0);
    if (!(key in stock)) return null;
    stock[key] += inc;
    return { _id: key, stock_quantity: stock[key] };
  });

  mock.method(Product, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>, options: Record<string, unknown> = {}) => {
    productUpdates.push({ filter, update, options });
    const key = String(filter._id);
    if ((opts.missingAtInc || []).includes(key)) return null;
    if (!(key in stock) && !products[key]) return null;
    const delta = Number((update.$inc as { stock_quantity?: number } | undefined)?.stock_quantity || 0);
    stock[key] = Number(stock[key] || 0) + delta;
    return { _id: key, stock_quantity: stock[key], product_type: products[key]?.product_type };
  });

  mock.method(StockMovement, 'create', async (docs: unknown, options?: unknown) => {
    if (opts.movementThrows) throw new Error('movement write failed');
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    movements.push({ doc, options });
    return [doc];
  });

  mock.method(Invoice, 'create', async (docs: unknown, _options?: unknown) => {
    if (opts.createThrows) throw new Error('invoice create failed');
    const fields = firstCreateDoc(docs);
    invoiceCreates.push(fields);
    const inv = createdInvoice(fields);
    persistedInvoice = inv as unknown as Record<string, unknown>;
    return Array.isArray(docs) ? [inv] : inv;
  });

  mock.method(Invoice, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    invoiceClaims.push({ filter, update });
    if (opts.quoteClaim) return opts.quoteClaim(filter);
    if (opts.invoiceClaim) return opts.invoiceClaim(filter);
    return {
      _id: { toString: () => INVOICE_ID },
      invoice_number: 'INV#W2D2',
      __v: Number(filter.__v || 0) + 1,
      items: [],
      ...((update.$set as Record<string, unknown>) || {}),
    };
  });

  mock.method(Invoice, 'deleteOne', async (filter: unknown) => {
    invoiceDeletes.push(filter);
    persistedInvoice = null;
    return { deletedCount: 1 };
  });

  mock.method(CustomerProductPrice, 'bulkWrite', async () => ({ ok: 1 }));
  mock.method(Customer, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => ({ tax_exempt: false }),
  }));

  stubInvoiceNumber();

  return {
    session,
    stock,
    stockSnapshot,
    productUpdates,
    movements,
    invoiceCreates,
    invoiceClaims,
    invoiceDeletes,
    findByIdAndUpdateCalls,
    get persistedInvoice() {
      return persistedInvoice;
    },
  };
}

async function postInvoice(body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/invoices')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

async function putInvoice(id: string, body: Record<string, unknown>) {
  return request(createApp())
    .put(`/api/invoices/${id}`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

async function deleteInvoice(id: string) {
  return request(createApp())
    .delete(`/api/invoices/${id}`)
    .set('Authorization', `Bearer ${adminTestToken()}`);
}

async function convertQuote(id: string) {
  return request(createApp())
    .post(`/api/invoices/${id}/convert`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({});
}

function assertSaleMovement(
  movement: Record<string, unknown>,
  expected: { change: number; before: number; after: number; number?: string }
) {
  assert.equal(movement.movement_type, StockMovementType.SALE);
  assert.equal(movement.quantity_change, expected.change);
  assert.equal(movement.quantity_before, expected.before);
  assert.equal(movement.quantity_after, expected.after);
  assert.equal(Number(movement.quantity_after), Number(movement.quantity_before) + Number(movement.quantity_change));
  assert.equal(movement.reference_type, 'Invoice');
  assert.equal(String(movement.reference_id), INVOICE_ID);
  if (expected.number) assert.equal(movement.reference_number, expected.number);
}

function wholesaleInvoiceDoc(overrides: Record<string, unknown> = {}) {
  const items = (overrides.items as unknown[]) || [line(PRODUCT_A, 5)];
  const doc: Record<string, unknown> = {
    _id: { toString: () => INVOICE_ID },
    invoice_number: 'INV#W2D2',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    source: 'WHOLESALE',
    items,
    subtotal_amount: 50,
    tax_amount: 0,
    total_amount: 50,
    amount_paid: 0,
    payment_status: 'unpaid',
    __v: 0,
    get(key: string) {
      return doc[key];
    },
    save: async () => {
      (doc as { saved?: boolean }).saved = true;
    },
    toObject() {
      return {
        _id: doc._id,
        invoice_number: doc.invoice_number,
        payment_status: doc.payment_status,
        source: doc.source,
      };
    },
    ...overrides,
  };
  return doc;
}

test('routing helpers: only WHOLESALE invoice uses the migrated path', () => {
  assert.equal(usesMigratedWholesaleInventory({ source: 'WHOLESALE', invoice_type: 'invoice' }), true);
  assert.equal(usesMigratedWholesaleInventory({ source: 'WHOLESALE', invoice_type: 'quotation' }), false);
  assert.equal(usesMigratedWholesaleInventory({ source: 'ONLINE', invoice_type: 'invoice' }), false);
  assert.equal(usesMigratedWholesaleInventory({ source: 'POS', invoice_type: 'invoice' }), false);
  assert.equal(usesMigratedWholesaleInventory({ invoice_type: 'invoice' }), false);
  assert.equal(usesMigratedWholesaleInventory({ source: undefined, invoice_type: 'invoice' }), false);
});

test('duplicate invoice lines aggregate; net edit is oldQty - newQty', () => {
  const totals = aggregateInvoiceInventoryQuantities([
    { product_id: PRODUCT_A, quantity: 3 },
    { product_id: PRODUCT_A, quantity: 5 },
    { product_id: PRODUCT_B, quantity: 2 },
    { product_id: PRODUCT_C, quantity: 0 },
  ]);
  assert.equal(totals.get(PRODUCT_A), 8);
  assert.equal(totals.get(PRODUCT_B), 2);
  assert.equal(totals.has(PRODUCT_C), false);

  const net = netStockChangesFromInvoiceItems(
    [
      { product_id: PRODUCT_A, quantity: 10 },
      { product_id: PRODUCT_B, quantity: 5 },
      { product_id: PRODUCT_C, quantity: 5 },
    ],
    [
      { product_id: PRODUCT_A, quantity: 7 },
      { product_id: PRODUCT_B, quantity: 8 },
    ]
  );
  assert.equal(net.get(PRODUCT_A), 3);
  assert.equal(net.get(PRODUCT_B), -3);
  assert.equal(net.get(PRODUCT_C), 5);
});

test('1-4 CREATE deducts stock, one SALE per aggregated product, before/after/delta hold', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 50, [PRODUCT_B]: 20 } });
  const res = await postInvoice({
    invoice_number: 'INV#W2D2',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    items: [line(PRODUCT_A, 3), line(PRODUCT_A, 5), line(PRODUCT_B, 2)],
  });
  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(h.invoiceCreates[0].source, 'WHOLESALE');
  assert.equal(h.stock[PRODUCT_A], 42);
  assert.equal(h.stock[PRODUCT_B], 18);
  assert.equal(h.productUpdates.length, 2);
  assert.equal(h.movements.length, 2);
  for (const row of h.productUpdates) {
    assert.equal(row.options.session, h.session);
  }
  for (const row of h.movements) {
    assert.deepEqual(row.options, { session: h.session });
  }
  const byProduct = new Map(h.movements.map((m) => [String(m.doc.product_id), m.doc]));
  assertSaleMovement(byProduct.get(PRODUCT_A)!, { change: -8, before: 50, after: 42, number: 'INV#W2D2' });
  assertSaleMovement(byProduct.get(PRODUCT_B)!, { change: -2, before: 20, after: 18, number: 'INV#W2D2' });
  assert.equal(h.session.commitTransaction.mock.callCount(), 1);
  assert.equal(h.session.abortTransaction.mock.callCount(), 0);
});

test('5 CREATE missing Product aborts invoice and stock', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ missingAtFindById: [PRODUCT_MISSING] });
  const res = await postInvoice({
    invoice_number: 'INV#MISS',
    items: [line(PRODUCT_MISSING, 2)],
  });
  assert.equal(res.status, 404);
  assert.match(String(res.body.error), /Product not found/i);
  assert.equal(h.stock[PRODUCT_MISSING], undefined);
  assert.equal(h.movements.length, 0);
  assert.equal(h.persistedInvoice, null);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
  assert.equal(h.session.commitTransaction.mock.callCount(), 0);
});

test('6 CREATE movement failure rolls back Invoice + Product', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ movementThrows: true, stock: { [PRODUCT_A]: 50 } });
  const res = await postInvoice({
    invoice_number: 'INV#MOVEFAIL',
    items: [line(PRODUCT_A, 4)],
  });
  assert.equal(res.status, 500);
  assert.equal(h.stock[PRODUCT_A], 50);
  assert.equal(h.persistedInvoice, null);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
  assert.equal(h.session.commitTransaction.mock.callCount(), 0);
});

test('7 CREATE invoice failure leaves stock unchanged', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ createThrows: true, stock: { [PRODUCT_A]: 50 } });
  const res = await postInvoice({
    invoice_number: 'INV#CREATEFAIL',
    items: [line(PRODUCT_A, 4)],
  });
  assert.equal(res.status, 500);
  assert.equal(h.stock[PRODUCT_A], 50);
  assert.equal(h.productUpdates.length, 0);
  assert.equal(h.movements.length, 0);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
});

test('8 CREATE negative stock remains allowed', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 1 } });
  const res = await postInvoice({
    invoice_number: 'INV#NEG',
    items: [line(PRODUCT_A, 5)],
  });
  assert.equal(res.status, 201);
  assert.equal(h.stock[PRODUCT_A], -4);
  assertSaleMovement(h.movements[0].doc, { change: -5, before: 1, after: -4, number: 'INV#NEG' });
});

test('9 CREATE fractional inventory quantity => 400', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness();
  const res = await postInvoice({
    invoice_number: 'INV#FRAC',
    items: [line(PRODUCT_A, 1.5)],
  });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /whole number/i);
  assert.equal(h.stock[PRODUCT_A], 50);
  assert.equal(h.invoiceCreates.length, 0);
});

test('10 CREATE negative inventory quantity => 400', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness();
  const res = await postInvoice({
    invoice_number: 'INV#NEGQ',
    items: [line(PRODUCT_A, -2)],
  });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /cannot be negative/i);
  assert.equal(h.invoiceCreates.length, 0);
});

test('11-12 CREATE zero quantity and service/non_inventory are skipped', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness();
  const res = await postInvoice({
    invoice_number: 'INV#SKIP',
    items: [line(PRODUCT_A, 0), line(PRODUCT_SERVICE, 3), line(PRODUCT_NONINV, 2), line(PRODUCT_B, 1)],
  });
  assert.equal(res.status, 201);
  assert.equal(h.stock[PRODUCT_A], 50);
  assert.equal(h.stock[PRODUCT_SERVICE], 99);
  assert.equal(h.stock[PRODUCT_NONINV], 99);
  assert.equal(h.stock[PRODUCT_B], 19);
  assert.equal(h.movements.length, 1);
  assert.equal(String(h.movements[0].doc.product_id), PRODUCT_B);
});

test('13 CREATE duplicate product lines aggregate to one $inc and one SALE', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 30 } });
  const res = await postInvoice({
    invoice_number: 'INV#DUP',
    items: [line(PRODUCT_A, 3), line(PRODUCT_A, 5)],
  });
  assert.equal(res.status, 201);
  assert.equal(h.productUpdates.length, 1);
  assert.deepEqual(h.productUpdates[0].update, { $inc: { stock_quantity: -8 } });
  assert.equal(h.movements.length, 1);
  assert.equal(h.stock[PRODUCT_A], 22);
});

test('14 quotation gets WHOLESALE but no stock / no transaction inventory', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness();
  const res = await postInvoice({
    invoice_number: 'QTN#W2D2',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    items: [line(PRODUCT_A, 4)],
  });
  assert.equal(res.status, 201);
  assert.equal(h.invoiceCreates[0].source, 'WHOLESALE');
  assert.equal(h.invoiceCreates[0].invoice_type, DOCUMENT_TYPE_QUOTATION);
  assert.equal(h.stock[PRODUCT_A], 50);
  assert.equal(h.productUpdates.length, 0);
  assert.equal(h.movements.length, 0);
  assert.equal(h.session.startTransaction.mock.callCount(), 0);
});

test('15 EDIT quantity increase deducts only the net increase', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 40 } });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 5)] }));
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 8)] });
  assert.equal(res.status, 200);
  assert.deepEqual(h.productUpdates[0].update, { $inc: { stock_quantity: -3 } });
  assertSaleMovement(h.movements[0].doc, { change: -3, before: 40, after: 37, number: 'INV#W2D2' });
  assert.equal(h.movements.length, 1);
  assert.equal(h.session.commitTransaction.mock.callCount(), 1);
});

test('16 EDIT quantity decrease restores only the net decrease', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 40 } });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 10)] }));
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 7)] });
  assert.equal(res.status, 200);
  assert.deepEqual(h.productUpdates[0].update, { $inc: { stock_quantity: 3 } });
  assertSaleMovement(h.movements[0].doc, { change: 3, before: 40, after: 43, number: 'INV#W2D2' });
});

test('17 EDIT removed product restores stock', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 40, [PRODUCT_B]: 20 } });
  mock.method(Invoice, 'findById', async () =>
    wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 5), line(PRODUCT_B, 2)] })
  );
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_B, 2)] });
  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 45);
  assert.equal(h.stock[PRODUCT_B], 20);
  assert.equal(h.movements.length, 1);
  assertSaleMovement(h.movements[0].doc, { change: 5, before: 40, after: 45, number: 'INV#W2D2' });
});

test('18 EDIT added product deducts stock', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 40, [PRODUCT_B]: 20 } });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 5)] }));
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 5), line(PRODUCT_B, 3)] });
  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 40);
  assert.equal(h.stock[PRODUCT_B], 17);
  assert.equal(h.movements.length, 1);
  assert.equal(String(h.movements[0].doc.product_id), PRODUCT_B);
  assertSaleMovement(h.movements[0].doc, { change: -3, before: 20, after: 17, number: 'INV#W2D2' });
});

test('19 EDIT product replacement restores old and deducts new', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 40, [PRODUCT_B]: 20 } });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 4)] }));
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_B, 4)] });
  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 44);
  assert.equal(h.stock[PRODUCT_B], 16);
  assert.equal(h.movements.length, 2);
});

test('20 EDIT unchanged quantity creates no movement', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 40 } });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 5)] }));
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 5)] });
  assert.equal(res.status, 200);
  assert.equal(h.productUpdates.length, 0);
  assert.equal(h.movements.length, 0);
  assert.equal(h.stock[PRODUCT_A], 40);
});

test('21 EDIT duplicate lines aggregate before net difference', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 40 } });
  mock.method(Invoice, 'findById', async () =>
    wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 3), line(PRODUCT_A, 5)] })
  );
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 2), line(PRODUCT_A, 2)] });
  assert.equal(res.status, 200);
  assert.deepEqual(h.productUpdates[0].update, { $inc: { stock_quantity: 4 } });
  assert.equal(h.movements.length, 1);
});

test('22 EDIT missing Product aborts entire edit', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ missingAtFindById: [PRODUCT_A], stock: { [PRODUCT_A]: 40 } });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 5)] }));
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 8)] });
  assert.equal(res.status, 404);
  assert.equal(h.stock[PRODUCT_A], 40);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
  assert.equal(h.session.commitTransaction.mock.callCount(), 0);
});

test('23 EDIT movement failure rolls back stock and invoice update', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ movementThrows: true, stock: { [PRODUCT_A]: 40 } });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 5)] }));
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 8)] });
  assert.equal(res.status, 500);
  assert.equal(h.stock[PRODUCT_A], 40);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
});

test('24 EDIT __v conflict => 409 and stock unchanged', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({
    stock: { [PRODUCT_A]: 40 },
    invoiceClaim: () => null,
  });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 5)], __v: 3 }));
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 8)] });
  assert.equal(res.status, 409);
  assert.match(String(res.body.error), /updated by another request/i);
  assert.equal(h.stock[PRODUCT_A], 40);
  assert.equal(h.productUpdates.length, 0);
  assert.equal(h.invoiceClaims[0].filter.__v, 3);
});

test('25 header-only PUT does not touch stock', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness();
  const doc = wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 5)] });
  mock.method(Invoice, 'findById', async () => doc);
  const res = await putInvoice(INVOICE_ID, { customer_name: 'Header Only' });
  assert.equal(res.status, 200);
  assert.equal((doc as { saved?: boolean }).saved, true);
  assert.equal(h.productUpdates.length, 0);
  assert.equal(h.movements.length, 0);
  assert.equal(h.stock[PRODUCT_A], 50);
  assert.equal(h.session.startTransaction.mock.callCount(), 0);
});

test('26 ONLINE invoice PUT does not use wholesale inventory', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 50 } });
  const doc = wholesaleInvoiceDoc({
    source: 'ONLINE',
    items: [line(PRODUCT_A, 5)],
    invoice_number: 'INV-WEB-0042',
  });
  mock.method(Invoice, 'findById', async () => doc);
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 9)] });
  assert.equal(res.status, 200);
  assert.equal(h.productUpdates.length, 0);
  assert.equal(h.findByIdAndUpdateCalls.length, 0);
  assert.equal(h.movements.length, 0);
  assert.equal(h.stock[PRODUCT_A], 50);
  assert.equal((doc as { saved?: boolean }).saved, true);
});

test('27 POS PUT remains blocked', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness();
  mock.method(Invoice, 'findById', async () =>
    wholesaleInvoiceDoc({ invoice_type: 'pos', source: 'POS', items: [line(PRODUCT_A, 2)] })
  );
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 1)] });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /POS sales cannot be edited/i);
  assert.equal(h.productUpdates.length, 0);
});

test('28 legacy source-less PUT retains restore-all / deduct-all and skips missing products', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({
    stock: { [PRODUCT_A]: 40 },
    missingAtFindById: [PRODUCT_MISSING],
  });
  const doc = wholesaleInvoiceDoc({
    source: undefined,
    items: [line(PRODUCT_A, 5), line(PRODUCT_MISSING, 2)],
  });
  delete doc.source;
  mock.method(Invoice, 'findById', async () => doc);
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 8)] });
  assert.equal(res.status, 200);
  assert.equal((doc as { saved?: boolean }).saved, true);
  assert.equal(h.session.startTransaction.mock.callCount(), 0);
  assert.equal(h.movements.length, 0);
  assert.ok(h.findByIdAndUpdateCalls.length >= 2);
  assert.equal(h.stock[PRODUCT_A], 37);
});

test('29 paid invoice edit financial rules unchanged', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness();
  mock.method(Invoice, 'findById', async () =>
    wholesaleInvoiceDoc({
      items: [{ product_name: 'Line', quantity: 1, price: 100, subtotal: 100 }],
      total_amount: 100,
      amount_paid: 80,
      payment_status: 'paid',
    })
  );
  const res = await putInvoice(INVOICE_ID, {
    items: [{ product_name: 'Line', quantity: 1, price: 60, subtotal: 60 }],
  });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /already paid/i);
  assert.equal(h.session.startTransaction.mock.callCount(), 0);
  assert.equal(h.productUpdates.length, 0);
});

test('30-32 DELETE unpaid WHOLESALE restores stock with positive SALE before/after', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 42 } });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 8)] }));
  const res = await deleteInvoice(INVOICE_ID);
  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 50);
  assert.equal(h.invoiceDeletes.length, 1);
  assertSaleMovement(h.movements[0].doc, { change: 8, before: 42, after: 50, number: 'INV#W2D2' });
  assert.equal(h.productUpdates[0].options.session, h.session);
  assert.deepEqual(h.movements[0].options, { session: h.session });
  assert.equal(h.session.commitTransaction.mock.callCount(), 1);
});

test('33 DELETE missing Product aborts', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ missingAtFindById: [PRODUCT_A], stock: { [PRODUCT_A]: 42 } });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 8)] }));
  const res = await deleteInvoice(INVOICE_ID);
  assert.equal(res.status, 404);
  assert.equal(h.invoiceDeletes.length, 0);
  assert.equal(h.stock[PRODUCT_A], 42);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
});

test('34 DELETE movement failure rolls back restoration and deletion', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ movementThrows: true, stock: { [PRODUCT_A]: 42 } });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 8)] }));
  const res = await deleteInvoice(INVOICE_ID);
  assert.equal(res.status, 500);
  assert.equal(h.stock[PRODUCT_A], 42);
  assert.equal(h.invoiceDeletes.length, 0);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
});

test('35-36 DELETE paid / amount_paid > 0 remains blocked', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness();
  mock.method(Invoice, 'findById', async () =>
    wholesaleInvoiceDoc({ amount_paid: 10, payment_status: 'unpaid', total_amount: 50 })
  );
  const partial = await deleteInvoice(INVOICE_ID);
  assert.equal(partial.status, 400);
  assert.match(String(partial.body.error), /payments recorded/i);
  assert.equal(h.session.startTransaction.mock.callCount(), 0);
  assert.equal(h.invoiceDeletes.length, 0);

  mock.restoreAll();
  const h2 = stubWholesaleHarness();
  mock.method(Invoice, 'findById', async () =>
    wholesaleInvoiceDoc({ amount_paid: 50, payment_status: 'paid', total_amount: 50 })
  );
  const fullyPaid = await deleteInvoice(INVOICE_ID);
  assert.equal(fullyPaid.status, 400);
  assert.match(String(fullyPaid.body.error), /payments recorded/i);
  assert.equal(h2.session.startTransaction.mock.callCount(), 0);
  assert.equal(h2.invoiceDeletes.length, 0);
});

test('37 concurrent delete cannot restore twice', async () => {
  assertNoMongoConnection();
  let claimed = false;
  const h = stubWholesaleHarness({
    stock: { [PRODUCT_A]: 42 },
    invoiceClaim: (filter) => {
      if (claimed || Number(filter.__v) !== 0) return null;
      claimed = true;
      return {
        _id: { toString: () => INVOICE_ID },
        invoice_number: 'INV#W2D2',
        __v: 1,
        items: [line(PRODUCT_A, 8)],
      };
    },
  });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 8)] }));
  const first = await deleteInvoice(INVOICE_ID);
  const second = await deleteInvoice(INVOICE_ID);
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(h.stock[PRODUCT_A], 50);
  assert.equal(h.invoiceDeletes.length, 1);
  assert.equal(h.movements.length, 1);
});

test('38 concurrent payment cannot race through the migrated delete claim', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({
    stock: { [PRODUCT_A]: 42 },
    invoiceClaim: (filter) => {
      assert.ok(filter.$and);
      return null;
    },
  });
  mock.method(Invoice, 'findById', async () => wholesaleInvoiceDoc({ items: [line(PRODUCT_A, 8)] }));
  const res = await deleteInvoice(INVOICE_ID);
  assert.equal(res.status, 409);
  const claim = h.invoiceClaims[0].filter;
  assert.equal(String(claim._id), INVOICE_ID);
  assert.equal(claim.__v, 0);
  const serialized = JSON.stringify(claim);
  assert.match(serialized, /amount_paid/);
  assert.match(serialized, /payment_status/);
  assert.equal(h.stock[PRODUCT_A], 42);
  assert.equal(h.invoiceDeletes.length, 0);
});

test('39 ONLINE delete does not wholesale-restore', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({ stock: { [PRODUCT_A]: 42 } });
  mock.method(Invoice, 'findById', async () =>
    wholesaleInvoiceDoc({ source: 'ONLINE', items: [line(PRODUCT_A, 8)], invoice_number: 'INV-WEB-0042' })
  );
  const res = await deleteInvoice(INVOICE_ID);
  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 42);
  assert.equal(h.productUpdates.length, 0);
  assert.equal(h.findByIdAndUpdateCalls.length, 0);
  assert.equal(h.movements.length, 0);
  assert.equal(h.invoiceDeletes.length, 1);
  assert.equal(h.session.startTransaction.mock.callCount(), 0);
});

test('40 legacy delete retains restore, skip-missing, no movement, no transaction', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness({
    stock: { [PRODUCT_A]: 42 },
    missingAtFindById: [PRODUCT_MISSING],
  });
  const doc = wholesaleInvoiceDoc({
    items: [line(PRODUCT_A, 8), line(PRODUCT_MISSING, 2)],
  });
  delete doc.source;
  mock.method(Invoice, 'findById', async () => doc);
  const res = await deleteInvoice(INVOICE_ID);
  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 50);
  assert.equal(h.movements.length, 0);
  assert.equal(h.session.startTransaction.mock.callCount(), 0);
  assert.ok(h.findByIdAndUpdateCalls.some((call) => String(call.id) === PRODUCT_A));
});

test('41-44 CONVERT creates WHOLESALE invoice, deducts stock, SALE movement, marks quote', async () => {
  assertNoMongoConnection();
  const quote = {
    _id: { toString: () => QUOTE_ID },
    invoice_number: 'QTN#W2D2',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    items: [line(PRODUCT_A, 6)],
    tax_amount: 0,
    total_amount: 60,
    subtotal_amount: 60,
    shipping_type: '',
    source: undefined,
  };
  const h = stubWholesaleHarness({
    stock: { [PRODUCT_A]: 50 },
    quoteClaim: (_filter) => {
      quote.shipping_type = 'converted:INV#1';
      return quote;
    },
  });
  mock.method(Invoice, 'findById', async () => quote);
  const res = await convertQuote(QUOTE_ID);
  assert.equal(res.status, 201);
  assert.equal(h.invoiceCreates[0].source, 'WHOLESALE');
  assert.equal(h.invoiceCreates[0].invoice_type, DOCUMENT_TYPE_INVOICE);
  assert.equal((quote as { source?: unknown }).source, undefined);
  assert.match(String(quote.shipping_type), /^converted:/);
  assert.equal(h.stock[PRODUCT_A], 44);
  assertSaleMovement(h.movements[0].doc, { change: -6, before: 50, after: 44 });
  assert.equal(h.session.commitTransaction.mock.callCount(), 1);
});

test('45 CONVERT stock failure leaves quote unconverted', async () => {
  assertNoMongoConnection();
  const quote = {
    _id: { toString: () => QUOTE_ID },
    invoice_number: 'QTN#FAIL-STOCK',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    items: [line(PRODUCT_A, 6)],
    tax_amount: 0,
    total_amount: 60,
    subtotal_amount: 60,
    shipping_type: '',
  };
  const h = stubWholesaleHarness({
    stock: { [PRODUCT_A]: 50 },
    missingAtInc: [PRODUCT_A],
    quoteClaim: () => {
      quote.shipping_type = 'converted:INV#1';
      return quote;
    },
  });
  mock.method(Invoice, 'findById', async () => quote);
  const res = await convertQuote(QUOTE_ID);
  assert.equal(res.status, 404);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
  assert.equal(h.session.commitTransaction.mock.callCount(), 0);
  assert.equal(h.stock[PRODUCT_A], 50);
});

test('46 CONVERT movement failure leaves quote unconverted', async () => {
  assertNoMongoConnection();
  const quote = {
    _id: { toString: () => QUOTE_ID },
    invoice_number: 'QTN#FAIL-MOVE',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    items: [line(PRODUCT_A, 6)],
    tax_amount: 0,
    total_amount: 60,
    subtotal_amount: 60,
    shipping_type: '',
  };
  const h = stubWholesaleHarness({
    movementThrows: true,
    quoteClaim: () => quote,
  });
  mock.method(Invoice, 'findById', async () => quote);
  const res = await convertQuote(QUOTE_ID);
  assert.equal(res.status, 500);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
  assert.equal(h.stock[PRODUCT_A], 50);
});

test('47 CONVERT invoice creation failure leaves quote unconverted', async () => {
  assertNoMongoConnection();
  const quote = {
    _id: { toString: () => QUOTE_ID },
    invoice_number: 'QTN#FAIL-INV',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    items: [line(PRODUCT_A, 6)],
    tax_amount: 0,
    total_amount: 60,
    subtotal_amount: 60,
    shipping_type: '',
  };
  const h = stubWholesaleHarness({
    createThrows: true,
    quoteClaim: () => quote,
  });
  mock.method(Invoice, 'findById', async () => quote);
  const res = await convertQuote(QUOTE_ID);
  assert.equal(res.status, 500);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
  assert.equal(h.productUpdates.length, 0);
});

test('48 two concurrent conversions allow only one', async () => {
  assertNoMongoConnection();
  let claimed = false;
  const quote = {
    _id: { toString: () => QUOTE_ID },
    invoice_number: 'QTN#RACE',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    items: [line(PRODUCT_A, 2)],
    tax_amount: 0,
    total_amount: 20,
    subtotal_amount: 20,
    shipping_type: '',
  };
  const h = stubWholesaleHarness({
    stock: { [PRODUCT_A]: 50 },
    quoteClaim: () => {
      if (claimed) return null;
      claimed = true;
      quote.shipping_type = 'converted:INV#1';
      return quote;
    },
  });
  mock.method(Invoice, 'findById', async () => ({ ...quote, shipping_type: '' }));
  const first = await convertQuote(QUOTE_ID);
  const second = await convertQuote(QUOTE_ID);
  assert.equal(first.status, 201);
  assert.equal(second.status, 400);
  assert.equal(h.invoiceCreates.length, 1);
  assert.equal(h.stock[PRODUCT_A], 48);
  assert.equal(h.movements.length, 1);
});

test('49 already-converted quote cannot convert again', async () => {
  assertNoMongoConnection();
  const h = stubWholesaleHarness();
  mock.method(Invoice, 'findById', async () => ({
    _id: { toString: () => QUOTE_ID },
    invoice_number: 'QTN#DONE',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    items: [line(PRODUCT_A, 2)],
    shipping_type: 'converted:INV#99',
  }));
  const res = await convertQuote(QUOTE_ID);
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /already converted to INV#99/i);
  assert.equal(h.invoiceCreates.length, 0);
  assert.equal(h.stock[PRODUCT_A], 50);
});

test('50 converted invoice movement references the new Invoice', async () => {
  assertNoMongoConnection();
  const quote = {
    _id: { toString: () => QUOTE_ID },
    invoice_number: 'QTN#REF',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    items: [line(PRODUCT_A, 1)],
    tax_amount: 0,
    total_amount: 10,
    subtotal_amount: 10,
    shipping_type: '',
  };
  const h = stubWholesaleHarness({ quoteClaim: () => quote });
  mock.method(Invoice, 'findById', async () => quote);
  const res = await convertQuote(QUOTE_ID);
  assert.equal(res.status, 201);
  assert.equal(h.movements[0].doc.reference_type, 'Invoice');
  assert.equal(String(h.movements[0].doc.reference_id), INVOICE_ID);
  assert.notEqual(String(h.movements[0].doc.reference_id), QUOTE_ID);
});

test('51-59 isolation: no INV-WEB heuristic, no OnlineOrder lookup, no shipment/accounting drive-by', () => {
  const invoices = readFileSync(join(process.cwd(), 'src/routes/invoices.ts'), 'utf8');
  const service = readFileSync(join(process.cwd(), 'src/services/wholesaleInvoiceInventoryService.ts'), 'utf8');
  assert.equal(invoices.includes('INV-WEB-'), false);
  assert.equal(service.includes('INV-WEB-'), false);
  assert.equal(invoices.includes('OnlineOrder'), false);
  assert.equal(service.includes('OnlineOrder'), false);
  assert.equal(service.includes('StockMovement.create('), false);
  assert.match(service, /createStockMovement\(/);
  assert.match(service, /usesMigratedWholesaleInventory/);
  assert.match(invoices, /source !== 'ONLINE'/);
  assert.match(invoices, /createWholesaleInvoiceWithInventory/);
  assert.equal(service.includes('idempotency'), false);
  assert.equal(/stock_quantity\s*>=/.test(service), false);
  assert.equal(service.includes('Math.floor'), false);
  assert.equal(invoices.includes('Shipment'), false);
  assert.equal(service.includes('SHIPMENT_OUT'), false);
  assert.equal(service.includes('modules/shipping'), false);
});
