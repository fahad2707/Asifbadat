/**
 * Phase 2N-C1 — Harden legacy/source-less invoice inventory mutations.
 *
 * Run with:
 *     npx tsx --test src/routes/legacyInvoiceInventory.test.ts
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
import { DOCUMENT_TYPE_INVOICE } from '../utils/documentType';
import { StockMovementType } from '../shared/enums';
import { usesMigratedWholesaleInventory } from '../services/wholesaleInvoiceInventoryService';

const ADMIN_ID = '64b0000000000000000a0001';
const INVOICE_ID = '64b0000000000000000d0303';
const PRODUCT_A = '64b0000000000000000c0001';
const PRODUCT_B = '64b0000000000000000c0002';
const PRODUCT_MISSING = '64b0000000000000000c00ff';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: ADMIN_ID, role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'legacy invoice inventory tests must not open a MongoDB connection');
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
  movementThrows?: boolean;
  missingAtFindById?: string[];
  missingAtInc?: string[];
  invoiceClaim?: (filter: Record<string, unknown>) => Record<string, unknown> | null;
};

function stubLegacyHarness(opts: HarnessOpts = {}) {
  const session = createFakeSession();
  const stock: Record<string, number> = {
    [PRODUCT_A]: 48,
    [PRODUCT_B]: 20,
    ...(opts.stock || {}),
  };
  const stockSnapshot = { ...stock };
  const products: Record<string, Record<string, unknown>> = {
    [PRODUCT_A]: taxProduct(PRODUCT_A),
    [PRODUCT_B]: taxProduct(PRODUCT_B),
    [PRODUCT_MISSING]: taxProduct(PRODUCT_MISSING, { name: 'Gone' }),
  };

  const productUpdates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const movements: Array<{ doc: Record<string, unknown>; options: unknown }> = [];
  const invoiceClaims: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const invoiceDeletes: unknown[] = [];
  const findByIdAndUpdateCalls: Array<{ id: unknown; update: unknown }> = [];
  let committed = false;

  const restoreOnAbort = () => {
    if (committed) return;
    for (const key of Object.keys(stock)) delete stock[key];
    Object.assign(stock, stockSnapshot);
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

  mock.method(Invoice, 'findOneAndUpdate', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    invoiceClaims.push({ filter, update });
    if (opts.invoiceClaim) return opts.invoiceClaim(filter);
    return {
      _id: { toString: () => INVOICE_ID },
      invoice_number: 'INV#LEGACY',
      __v: Number(filter.__v || 0) + 1,
      items: [],
      ...((update.$set as Record<string, unknown>) || {}),
    };
  });

  mock.method(Invoice, 'deleteOne', async (filter: unknown) => {
    invoiceDeletes.push(filter);
    return { deletedCount: 1 };
  });

  mock.method(CustomerProductPrice, 'bulkWrite', async () => ({ ok: 1 }));
  mock.method(Customer, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => ({ tax_exempt: false }),
  }));

  return {
    session,
    stock,
    productUpdates,
    movements,
    invoiceClaims,
    invoiceDeletes,
    findByIdAndUpdateCalls,
  };
}

function legacyInvoiceDoc(overrides: Record<string, unknown> = {}) {
  const items = (overrides.items as unknown[]) || [line(PRODUCT_A, 10)];
  const doc: Record<string, unknown> = {
    _id: { toString: () => INVOICE_ID },
    invoice_number: 'INV#LEGACY',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    items,
    subtotal_amount: 100,
    tax_amount: 0,
    total_amount: 100,
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
  // Explicit source-less: do not set source unless overrides provide it.
  if (!Object.prototype.hasOwnProperty.call(overrides, 'source')) {
    delete doc.source;
  }
  return doc;
}

function assertSaleMovement(
  movement: Record<string, unknown>,
  expected: { change: number; before: number; after: number }
) {
  assert.equal(movement.movement_type, StockMovementType.SALE);
  assert.equal(movement.quantity_change, expected.change);
  assert.equal(movement.quantity_before, expected.before);
  assert.equal(movement.quantity_after, expected.after);
  assert.equal(Number(movement.quantity_after), Number(movement.quantity_before) + Number(movement.quantity_change));
  assert.equal(movement.reference_type, 'Invoice');
  assert.equal(String(movement.reference_id), INVOICE_ID);
  assert.equal(movement.reference_number, 'INV#LEGACY');
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

test('A — legacy edit reduces sold qty (10→7): stock +3, one SALE movement', async () => {
  // Matches prior restore-then-deduct net and wholesale netStockChanges (old - new).
  assertNoMongoConnection();
  const h = stubLegacyHarness({ stock: { [PRODUCT_A]: 48 } });
  mock.method(Invoice, 'findById', async () => legacyInvoiceDoc({ items: [line(PRODUCT_A, 10)] }));
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 7)] });
  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 51);
  assert.equal(h.movements.length, 1);
  assertSaleMovement(h.movements[0].doc, { change: 3, before: 48, after: 51 });
  assert.deepEqual(h.productUpdates[0].update, { $inc: { stock_quantity: 3 } });
  assert.equal(h.session.commitTransaction.mock.callCount(), 1);
  assert.equal(h.findByIdAndUpdateCalls.length, 0);
});

test('B — legacy edit increases sold qty (7→10): stock -3, one SALE movement', async () => {
  assertNoMongoConnection();
  const h = stubLegacyHarness({ stock: { [PRODUCT_A]: 48 } });
  mock.method(Invoice, 'findById', async () => legacyInvoiceDoc({ items: [line(PRODUCT_A, 7)] }));
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 10)] });
  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 45);
  assert.equal(h.movements.length, 1);
  assertSaleMovement(h.movements[0].doc, { change: -3, before: 48, after: 45 });
  assert.equal(h.session.commitTransaction.mock.callCount(), 1);
});

test('C — legacy invoice delete restores stock', async () => {
  assertNoMongoConnection();
  const h = stubLegacyHarness({ stock: { [PRODUCT_A]: 48 } });
  mock.method(Invoice, 'findById', async () => legacyInvoiceDoc({ items: [line(PRODUCT_A, 10)] }));
  const res = await deleteInvoice(INVOICE_ID);
  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 58);
  assert.equal(h.movements.length, 1);
  assertSaleMovement(h.movements[0].doc, { change: 10, before: 48, after: 58 });
  assert.equal(h.invoiceDeletes.length, 1);
  assert.equal(h.session.commitTransaction.mock.callCount(), 1);
});

test('D — duplicate product lines aggregate to one movement', async () => {
  assertNoMongoConnection();
  const h = stubLegacyHarness({ stock: { [PRODUCT_A]: 48, [PRODUCT_B]: 20 } });
  mock.method(Invoice, 'findById', async () =>
    legacyInvoiceDoc({ items: [line(PRODUCT_A, 5), line(PRODUCT_A, 3), line(PRODUCT_B, 2)] })
  );
  const res = await putInvoice(INVOICE_ID, {
    items: [line(PRODUCT_A, 2), line(PRODUCT_A, 2), line(PRODUCT_B, 5)],
  });
  // old A=8 → new A=4: +4; old B=2 → new B=5: -3
  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 52);
  assert.equal(h.stock[PRODUCT_B], 17);
  assert.equal(h.movements.length, 2);
  const byProduct = new Map(h.movements.map((m) => [String(m.doc.product_id), m.doc]));
  assertSaleMovement(byProduct.get(PRODUCT_A)!, { change: 4, before: 48, after: 52 });
  assertSaleMovement(byProduct.get(PRODUCT_B)!, { change: -3, before: 20, after: 17 });
});

test('E — movement failure rolls back Product stock and invoice claim', async () => {
  assertNoMongoConnection();
  const h = stubLegacyHarness({ stock: { [PRODUCT_A]: 48 }, movementThrows: true });
  mock.method(Invoice, 'findById', async () => legacyInvoiceDoc({ items: [line(PRODUCT_A, 10)] }));
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 7)] });
  assert.equal(res.status, 500);
  assert.equal(h.stock[PRODUCT_A], 48);
  assert.equal(h.movements.length, 0);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
  assert.equal(h.session.commitTransaction.mock.callCount(), 0);
});

test('F — Product update failure rolls back with no StockMovement', async () => {
  assertNoMongoConnection();
  const h = stubLegacyHarness({
    stock: { [PRODUCT_A]: 48 },
    missingAtInc: [PRODUCT_A],
  });
  mock.method(Invoice, 'findById', async () => legacyInvoiceDoc({ items: [line(PRODUCT_A, 10)] }));
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 7)] });
  assert.equal(res.status, 404);
  assert.equal(h.stock[PRODUCT_A], 48);
  assert.equal(h.movements.length, 0);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
});

test('G — concurrent/duplicate edit applies inventory once', async () => {
  assertNoMongoConnection();
  let claimed = false;
  const h = stubLegacyHarness({
    stock: { [PRODUCT_A]: 48 },
    invoiceClaim: (filter) => {
      if (claimed || Number(filter.__v) !== 0) return null;
      claimed = true;
      return {
        _id: { toString: () => INVOICE_ID },
        invoice_number: 'INV#LEGACY',
        __v: 1,
        items: [line(PRODUCT_A, 7)],
      };
    },
  });
  mock.method(Invoice, 'findById', async () => legacyInvoiceDoc({ items: [line(PRODUCT_A, 10)] }));
  const first = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 7)] });
  const second = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 7)] });
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(h.stock[PRODUCT_A], 51);
  assert.equal(h.movements.length, 1);
});

test('H — repeated delete restores inventory only once', async () => {
  assertNoMongoConnection();
  let claimed = false;
  const h = stubLegacyHarness({
    stock: { [PRODUCT_A]: 48 },
    invoiceClaim: (filter) => {
      if (claimed || Number(filter.__v) !== 0) return null;
      claimed = true;
      return {
        _id: { toString: () => INVOICE_ID },
        invoice_number: 'INV#LEGACY',
        __v: 1,
        items: [line(PRODUCT_A, 10)],
      };
    },
  });
  mock.method(Invoice, 'findById', async () => legacyInvoiceDoc({ items: [line(PRODUCT_A, 10)] }));
  const first = await deleteInvoice(INVOICE_ID);
  const second = await deleteInvoice(INVOICE_ID);
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(h.stock[PRODUCT_A], 58);
  assert.equal(h.movements.length, 1);
  assert.equal(h.invoiceDeletes.length, 1);
});

test('I — source-less uses atomic path; WHOLESALE routing helper unchanged; ONLINE skipped', async () => {
  assert.equal(usesMigratedWholesaleInventory({ invoice_type: 'invoice' }), false);
  assert.equal(usesMigratedWholesaleInventory({ source: 'WHOLESALE', invoice_type: 'invoice' }), true);

  assertNoMongoConnection();
  const h = stubLegacyHarness({ stock: { [PRODUCT_A]: 48 } });
  mock.method(Invoice, 'findById', async () =>
    legacyInvoiceDoc({ source: 'ONLINE', items: [line(PRODUCT_A, 10)], invoice_number: 'INV-WEB-1' })
  );
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 7)] });
  assert.equal(res.status, 200);
  assert.equal(h.stock[PRODUCT_A], 48);
  assert.equal(h.movements.length, 0);
  assert.equal(h.session.startTransaction.mock.callCount(), 0);
  assert.equal(h.productUpdates.length, 0);

  const src = readFileSync(join(process.cwd(), 'src/routes/invoices.ts'), 'utf8');
  assert.match(src, /usesAtomicInvoiceInventoryPath/);
  assert.match(src, /applyWholesaleInvoiceEditInventory/);
  assert.match(src, /deleteWholesaleInvoiceWithInventory/);
  assert.equal(src.includes('findByIdAndUpdate(item.product_id, { $inc: { stock_quantity:'), false);
});

test('missing Product on legacy edit aborts with no stock change', async () => {
  assertNoMongoConnection();
  const h = stubLegacyHarness({
    stock: { [PRODUCT_A]: 48 },
    missingAtFindById: [PRODUCT_MISSING],
  });
  mock.method(Invoice, 'findById', async () =>
    legacyInvoiceDoc({ items: [line(PRODUCT_A, 5), line(PRODUCT_MISSING, 2)] })
  );
  const res = await putInvoice(INVOICE_ID, { items: [line(PRODUCT_A, 8)] });
  assert.equal(res.status, 404);
  assert.equal(h.stock[PRODUCT_A], 48);
  assert.equal(h.movements.length, 0);
  assert.equal(h.session.abortTransaction.mock.callCount(), 1);
});
