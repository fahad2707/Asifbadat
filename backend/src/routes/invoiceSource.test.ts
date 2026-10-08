/**
 * Phase 2D.1 — Invoice.source provenance discriminator.
 *
 * Isolated harness: no Mongo connection, no Atlas, no historical backfill.
 *
 * Run with:
 *     npx tsx --test src/routes/invoiceSource.test.ts
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
import OnlineOrder from '../models/OnlineOrder';
import StockMovement from '../models/StockMovement';
import { DOCUMENT_TYPE_INVOICE, DOCUMENT_TYPE_QUOTATION } from '../utils/documentType';
import { paymentApplication } from '../services/paymentApplication';

const ORDER_ID = '64b0000000000000000d0202';
const INVOICE_ID = '64b0000000000000000d0303';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '2d1-source-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'source tests must not open a MongoDB connection');
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

afterEach(() => {
  mock.restoreAll();
});

function createdInvoice(fields: Record<string, unknown>) {
  const _id = { toString: () => '64b0000000000000000a00aa' };
  return {
    _id,
    toObject: () => ({ _id, ...fields }),
    ...fields,
  };
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

function firstCreateDoc(docs: unknown): Record<string, unknown> {
  return (Array.isArray(docs) ? docs[0] : docs) as Record<string, unknown>;
}

function stubMigratedInvoiceWrite() {
  mock.method(mongoose, 'startSession', async () => ({
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    endSession() {},
  }));
  mock.method(Product, 'findOneAndUpdate', async () => {
    throw new Error('unexpected Product.findOneAndUpdate in source-discriminator test');
  });
  mock.method(StockMovement, 'create', async (docs: unknown) => [Array.isArray(docs) ? docs[0] : docs]);
}

async function postInvoice(body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/invoices')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

function line() {
  return { product_name: 'Widget', quantity: 1, price: 10, subtotal: 10 };
}

test('schema: source has no default and is not required', () => {
  const path = Invoice.schema.path('source') as mongoose.SchemaType & {
    options?: { default?: unknown; required?: unknown; enum?: unknown };
    isRequired?: boolean;
  };
  assert.ok(path);
  assert.equal(path.options?.default, undefined);
  assert.equal(Boolean(path.isRequired), false);
  assert.deepEqual(path.options?.enum, ['WHOLESALE', 'ONLINE', 'POS']);

  const doc = new Invoice({ invoice_number: 'INV#LEGACY-SRC', total_amount: 10 });
  assert.equal(doc.source, undefined);
  assert.equal(doc.get('source'), undefined);
});

test('A — POST wholesale invoice persists source WHOLESALE', async () => {
  assertNoMongoConnection();
  stubInvoiceNumber();
  stubMigratedInvoiceWrite();
  let created: Record<string, unknown> | undefined;
  mock.method(Invoice, 'create', async (docs: unknown) => {
    created = firstCreateDoc(docs);
    const inv = createdInvoice(created);
    return Array.isArray(docs) ? [inv] : inv;
  });

  const res = await postInvoice({
    invoice_number: 'INV#SRC-A',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    items: [line()],
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.source, 'WHOLESALE');
  assert.equal(created?.invoice_type, DOCUMENT_TYPE_INVOICE);
  assert.equal(res.body.source, 'WHOLESALE');
});

test('B — client cannot spoof source ONLINE on POST /invoices', async () => {
  assertNoMongoConnection();
  stubInvoiceNumber();
  stubMigratedInvoiceWrite();
  let created: Record<string, unknown> | undefined;
  mock.method(Invoice, 'create', async (docs: unknown) => {
    created = firstCreateDoc(docs);
    const inv = createdInvoice(created);
    return Array.isArray(docs) ? [inv] : inv;
  });

  const res = await postInvoice({
    invoice_number: 'INV#SRC-B',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    source: 'ONLINE',
    items: [line()],
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.source, 'WHOLESALE');
  assert.equal(res.body.source, 'WHOLESALE');
});

test('C — POST quotation is WHOLESALE and does not deduct stock', async () => {
  assertNoMongoConnection();
  stubInvoiceNumber();
  mock.method(Product, 'findByIdAndUpdate', async () => {
    throw new Error('quotations must not adjust inventory');
  });
  let created: Record<string, unknown> | undefined;
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return createdInvoice(doc);
  });

  const res = await postInvoice({
    invoice_number: 'QTN#SRC-C',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    items: [line()],
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.source, 'WHOLESALE');
  assert.equal(created?.invoice_type, DOCUMENT_TYPE_QUOTATION);
});

test('D — convert assigns WHOLESALE on the new invoice and does not backfill the quote', async () => {
  assertNoMongoConnection();
  stubInvoiceNumber();
  stubMigratedInvoiceWrite();
  const quote = {
    _id: { toString: () => '64b0000000000000000a00cc' },
    invoice_number: 'QTN#SRC-D',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    items: [line()],
    tax_amount: 0,
    total_amount: 10,
    subtotal_amount: 10,
    shipping_type: '',
    save: async () => {},
  };
  mock.method(Invoice, 'findById', async () => quote);
  mock.method(Invoice, 'findOneAndUpdate', async (_filter: unknown, update: { $set?: Record<string, unknown> }) => {
    Object.assign(quote, update.$set || {});
    return quote;
  });
  let created: Record<string, unknown> | undefined;
  mock.method(Invoice, 'create', async (docs: unknown) => {
    created = firstCreateDoc(docs);
    const inv = createdInvoice(created);
    return Array.isArray(docs) ? [inv] : inv;
  });

  const res = await request(createApp())
    .post('/api/invoices/qtn-src/convert')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({});

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.source, 'WHOLESALE');
  assert.equal(created?.invoice_type, DOCUMENT_TYPE_INVOICE);
  assert.equal(res.body.source, 'WHOLESALE');
  assert.equal((quote as { source?: unknown }).source, undefined);
  assert.match(String(quote.shipping_type), /^converted:/);
});

test('H/L — legacy Invoice constructed without source stays source-less', () => {
  const doc = new Invoice({
    invoice_number: 'INV#LEGACY-ABSENT',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 50,
    amount_paid: 0,
  });
  assert.equal(doc.source, undefined);
  const dumped = doc.toObject() as { source?: unknown };
  assert.equal(dumped.source, undefined);
});

test('PUT cannot change ONLINE source or invent source on a legacy document', async () => {
  assertNoMongoConnection();

  const online = {
    _id: { toString: () => 'inv-online' },
    invoice_number: 'INV-WEB-0099',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    source: 'ONLINE',
    items: [],
    total_amount: 40,
    amount_paid: 0,
    payment_status: 'unpaid',
    save: async () => {},
    toObject() {
      return {
        _id: this._id,
        invoice_number: this.invoice_number,
        payment_status: this.payment_status,
        source: this.source,
      };
    },
  };
  mock.method(Invoice, 'findById', async () => online);
  const onlineRes = await request(createApp())
    .put('/api/invoices/inv-online')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ source: 'WHOLESALE', customer_name: 'Spoof' });
  assert.equal(onlineRes.status, 200);
  assert.equal(online.source, 'ONLINE');

  mock.restoreAll();

  const legacy = {
    _id: { toString: () => 'inv-legacy' },
    invoice_number: 'INV-WEB-0042',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    items: [],
    total_amount: 40,
    amount_paid: 0,
    payment_status: 'unpaid',
    save: async () => {},
    toObject() {
      return {
        _id: this._id,
        invoice_number: this.invoice_number,
        payment_status: this.payment_status,
      };
    },
  };
  mock.method(Invoice, 'findById', async () => legacy);
  const legacyRes = await request(createApp())
    .put('/api/invoices/inv-legacy')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ source: 'WHOLESALE', customer_name: 'Legacy' });
  assertNoMongoConnection();
  assert.equal(legacyRes.status, 200);
  assert.equal((legacy as { source?: unknown }).source, undefined);
  assert.equal('source' in legacy, false);
});

test('PUT does not overwrite an existing WHOLESALE source', async () => {
  assertNoMongoConnection();
  const doc = {
    _id: { toString: () => 'inv-wh' },
    invoice_number: 'INV#001',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    source: 'WHOLESALE',
    items: [],
    total_amount: 10,
    amount_paid: 0,
    payment_status: 'unpaid',
    save: async () => {},
    toObject() {
      return {
        _id: this._id,
        invoice_number: this.invoice_number,
        payment_status: this.payment_status,
        source: this.source,
      };
    },
  };
  mock.method(Invoice, 'findById', async () => doc);
  const res = await request(createApp())
    .put('/api/invoices/inv-wh')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ source: 'ONLINE', customer_name: 'Keep' });
  assert.equal(res.status, 200);
  assert.equal(doc.source, 'WHOLESALE');
});

test('K — wholesale inventory is source-routed; PUT still does not write source', () => {
  const invoices = readFileSync(join(process.cwd(), 'src/routes/invoices.ts'), 'utf8');
  assert.match(invoices, /source:\s*'WHOLESALE'/);
  assert.match(invoices, /usesMigratedWholesaleInventory/);
  assert.match(invoices, /createWholesaleInvoiceWithInventory/);
  assert.match(invoices, /shouldAdjustInventoryForDocumentType\(invoice\.invoice_type\)/);
  assert.match(invoices, /invoice\.source !== 'ONLINE'/);
  assert.equal(invoices.includes('INV-WEB-'), false);
  assert.equal(invoices.includes('OnlineOrder'), false);
  const putAt = invoices.indexOf("router.put('/:id'");
  const putBlock = invoices.slice(putAt, invoices.indexOf("router.delete('/:id'"));
  assert.equal(putBlock.includes('body.source'), false);
  assert.equal(putBlock.includes('source:'), false);
});

test('H — payment update does not assign source', () => {
  const src = readFileSync(join(process.cwd(), 'src/services/paymentApplication.ts'), 'utf8');
  assert.equal(src.includes('source:'), false);
  assert.match(src, /\$inc:\s*\{\s*amount_paid:/);
  assert.match(src, /\$set:\s*\{\s*payment_status:/);
});

test('email update does not assign source', () => {
  const invoices = readFileSync(join(process.cwd(), 'src/routes/invoices.ts'), 'utf8');
  assert.match(invoices, /Invoice\.findByIdAndUpdate\(req\.params\.id, \{ email_sent: true \}\)/);
});

test('no historical backfill or INV-WEB classification exists', () => {
  const invoices = readFileSync(join(process.cwd(), 'src/routes/invoices.ts'), 'utf8');
  const online = readFileSync(join(process.cwd(), 'src/routes/online-orders.ts'), 'utf8');
  const model = readFileSync(join(process.cwd(), 'src/models/Invoice.ts'), 'utf8');
  assert.equal(invoices.includes('updateMany'), false);
  assert.equal(online.includes("source: 'ONLINE'"), true);
  assert.equal(online.includes('source: invoice_number'), false);
  assert.match(model, /enum:\s*\['WHOLESALE', 'ONLINE', 'POS'\]/);
  assert.equal(/source:\s*\{[^}]*default/.test(model), false);
  assert.equal(/source:\s*\{[^}]*required:\s*true/.test(model), false);
});

function stubOnlineDeliveryClaim(order: {
  status: string;
  status_history: Array<{ status: string; timestamp: Date }>;
  invoice_id?: unknown;
  payment_status?: string;
}, opts?: { claimThrows?: boolean }) {
  const session = {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(OnlineOrder, 'findOneAndUpdate', async (_filter: unknown, update: Record<string, unknown>) => {
    if (opts?.claimThrows) {
      throw new Error('simulated delivery claim persistence failure after invoice create');
    }
    Object.assign(order, update.$set || {});
    if ((update.$push as { status_history?: { status: string; timestamp: Date } } | undefined)?.status_history) {
      order.status_history.push((update.$push as { status_history: { status: string; timestamp: Date } }).status_history);
    }
    order.status = 'delivered';
    return order;
  });
  mock.method(Product, 'findById', () => ({
    session: async () => null,
    then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(null).then(onFulfilled, onRejected);
    },
  }));
  return session;
}

test('E — online delivery Invoice.create includes source ONLINE', async () => {
  assertNoMongoConnection();
  const order = {
    _id: { toString: () => ORDER_ID },
    order_number: 'WEB-0042',
    customer_name: 'Delivery Customer',
    customer_phone: '5550100',
    customer_email: 'delivery@example.com',
    address_line1: '1 Main St',
    city: 'Plymouth Meeting',
    state: 'PA',
    zip: '19462',
    items: [],
    subtotal: 80,
    tax_amount: 20,
    total_amount: 100,
    payment_method: 'cod' as const,
    payment_status: 'pending',
    status: 'dispatched',
    status_history: [] as Array<{ status: string; timestamp: Date }>,
    save: async () => {},
  };
  const created: Record<string, unknown>[] = [];
  mock.method(OnlineOrder, 'findById', async () => order);
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => {
    created.push(doc);
    return { _id: { toString: () => INVOICE_ID }, ...doc };
  });
  mock.method(paymentApplication, 'applyPaymentToInvoice', async () => ({
    invoice_id: INVOICE_ID,
    invoice_number: 'INV-WEB-0042',
    amount_applied: 100,
    amount_paid: 100,
    remaining_balance: 0,
    payment_status: 'paid',
    receipt: { id: 'r', trx_id: 't', amount_received: 100, invoice_num: 'INV-WEB-0042' },
  }));
  stubOnlineDeliveryClaim(order);

  const res = await request(createApp())
    .put(`/api/online-orders/${ORDER_ID}/status`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ status: 'delivered' });

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(created.length, 1);
  assert.equal(created[0].source, 'ONLINE');
  assert.equal(created[0].invoice_type, 'invoice');
});

test('F — claim failure after payment compensates receipt and deletes unpaid ONLINE invoice', async () => {
  assertNoMongoConnection();
  const created: Record<string, unknown>[] = [];
  const deletedReceipts: string[] = [];
  const deletedInvoices: string[] = [];
  const order = {
    _id: { toString: () => ORDER_ID },
    order_number: 'WEB-0042',
    customer_name: 'Delivery Customer',
    customer_phone: '5550100',
    customer_email: 'delivery@example.com',
    address_line1: '1 Main St',
    city: 'Plymouth Meeting',
    state: 'PA',
    zip: '19462',
    items: [],
    subtotal: 80,
    tax_amount: 20,
    total_amount: 100,
    payment_method: 'cod' as const,
    payment_status: 'pending',
    status: 'dispatched',
    status_history: [] as Array<{ status: string; timestamp: Date }>,
    save: async () => {},
  };
  mock.method(OnlineOrder, 'findById', async () => order);
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => {
    created.push(doc);
    return { _id: { toString: () => INVOICE_ID }, ...doc };
  });
  mock.method(paymentApplication, 'applyPaymentToInvoice', async () => ({
    invoice_id: INVOICE_ID,
    invoice_number: 'INV-WEB-0042',
    amount_applied: 100,
    amount_paid: 100,
    remaining_balance: 0,
    payment_status: 'paid',
    receipt: { id: 'r-source', trx_id: 't', amount_received: 100, invoice_num: 'INV-WEB-0042' },
  }));
  mock.method(paymentApplication, 'deleteReceiptLifecycle', async (receiptId: string) => {
    deletedReceipts.push(receiptId);
    return {
      deleted: true as const,
      invoice: {
        id: INVOICE_ID,
        invoice_number: 'INV-WEB-0042',
        total_amount: 100,
        amount_paid: 0,
        payment_status: 'unpaid',
      },
    };
  });
  mock.method(Invoice, 'findByIdAndDelete', async (id: { toString(): string }) => {
    deletedInvoices.push(id.toString());
    return { _id: id };
  });
  const session = stubOnlineDeliveryClaim(order, { claimThrows: true });

  const res = await request(createApp())
    .put(`/api/online-orders/${ORDER_ID}/status`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ status: 'delivered' });

  assertNoMongoConnection();
  assert.equal(res.status, 500);
  assert.equal(created.length, 1);
  assert.equal(created[0].source, 'ONLINE');
  assert.equal(order.status, 'dispatched');
  assert.ok(session.abortTransaction.mock.callCount() >= 1);
  assert.deepEqual(deletedReceipts, ['r-source']);
  assert.deepEqual(deletedInvoices, [INVOICE_ID]);
});
