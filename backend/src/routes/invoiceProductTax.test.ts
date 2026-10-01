/**
 * TAX-02 — admin invoice inherits Product TaxType.
 * Isolated harness: no Mongo writes.
 *
 * Run with:
 *     npx tsx --test src/routes/invoiceProductTax.test.ts
 */
import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import Invoice from '../models/Invoice';
import Product from '../models/Product';
import TaxType from '../models/TaxType';
import { DOCUMENT_TYPE_INVOICE, DOCUMENT_TYPE_QUOTATION } from '../utils/documentType';

const GST_ID = '64b1c2d3e4f5a6b7c8d9e0f1';
const VAT_ID = '64b1c2d3e4f5a6b7c8d9e0f2';
const PRODUCT_A = '64c1c2d3e4f5a6b7c8d9e0a1';
const PRODUCT_B = '64c1c2d3e4f5a6b7c8d9e0a2';
const PRODUCT_C = '64c1c2d3e4f5a6b7c8d9e0a3';
const PRODUCT_NC = '64c1c2d3e4f5a6b7c8d9e0a4';
const CUSTOMER_ID = '64d1c2d3e4f5a6b7c8d9e0b1';

const catalog: Record<string, Record<string, unknown>> = {
  [PRODUCT_A]: {
    _id: PRODUCT_A,
    name: 'ABC',
    price: 4.99,
    tax_rate: 8.5,
    stock_quantity: 50,
    product_type: 'inventory',
    tax_type_id: { _id: GST_ID, name: 'GST', rate: 18, rate_type: 'percent' },
  },
  [PRODUCT_B]: {
    _id: PRODUCT_B,
    name: 'DEF',
    price: 10,
    tax_rate: 0,
    stock_quantity: 50,
    product_type: 'inventory',
    tax_type_id: { _id: VAT_ID, name: 'VAT', rate: 12, rate_type: 'percent' },
  },
  [PRODUCT_C]: {
    _id: PRODUCT_C,
    name: 'XYZ',
    price: 7.5,
    tax_rate: 5,
    stock_quantity: 50,
    product_type: 'inventory',
    tax_type_id: null,
  },
  [PRODUCT_NC]: {
    _id: PRODUCT_NC,
    name: 'Bare',
    price: 3,
    tax_rate: 0,
    stock_quantity: 50,
    product_type: 'inventory',
  },
};

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: 'tax02-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'TAX-02 tests must not open a MongoDB connection');
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

const catalogSnapshot = JSON.parse(JSON.stringify(catalog));

afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(catalogSnapshot)) {
    catalog[key] = JSON.parse(JSON.stringify(catalogSnapshot[key]));
  }
});

function stubProducts() {
  mock.method(Product, 'find', () => ({
    populate() {
      return this;
    },
    lean: async () => Object.values(catalog),
  }));
  mock.method(Product, 'findById', (id: unknown) => {
    const doc = catalog[String(id)] ? { ...catalog[String(id)] } : null;
    return {
      lean: async () => doc,
      then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve(doc).then(onFulfilled, onRejected);
      },
    };
  });
  mock.method(Product, 'findByIdAndUpdate', async () => null);
}

function createdInvoice(fields: Record<string, unknown>) {
  const _id = { toString: () => 'inv-tax-02' };
  return {
    _id,
    toObject: () => ({ _id, ...fields }),
    ...fields,
  };
}

async function postInvoice(body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/invoices')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

test('POST invoice inherits GST / VAT / No Tax per line and sums tax', async () => {
  assertNoMongoConnection();
  stubProducts();
  const stockUpdates: Array<{ id: unknown; update: unknown }> = [];
  mock.method(Product, 'findByIdAndUpdate', async (id: unknown, update: unknown) => {
    stockUpdates.push({ id, update });
    return catalog[String(id)];
  });
  let created: Record<string, unknown> | undefined;
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return createdInvoice(doc);
  });

  const originalA = { ...catalog[PRODUCT_A] };
  const res = await postInvoice({
    invoice_number: 'INV#TAX02',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    items: [
      { product_id: PRODUCT_A, product_name: 'ABC', quantity: 1, price: 4.99, subtotal: 4.99 },
      { product_id: PRODUCT_B, product_name: 'DEF', quantity: 1, price: 10, subtotal: 10 },
      { product_id: PRODUCT_C, product_name: 'XYZ', quantity: 1, price: 7.5, subtotal: 7.5 },
    ],
  });

  assert.equal(res.status, 201);
  assert.ok(created);
  const items = created.items as Array<Record<string, unknown>>;
  assert.equal(items[0].tax_type_name, 'GST');
  assert.equal(items[0].tax_rate, 18);
  assert.equal(items[0].tax_amount, 0.9);
  assert.equal(items[0].price, 4.99);
  assert.equal(items[0].taxable, true);
  assert.equal(items[1].tax_type_name, 'VAT');
  assert.equal(items[1].tax_amount, 1.2);
  assert.equal(items[2].taxable, false);
  assert.equal(items[2].tax_amount, 0);
  assert.equal(created.subtotal_amount, 22.49);
  assert.equal(created.tax_amount, 2.1);
  assert.equal(created.total_amount, 24.59);
  assert.equal(catalog[PRODUCT_A].price, originalA.price);
  assert.equal(catalog[PRODUCT_A].tax_rate, originalA.tax_rate);
  assert.deepEqual(catalog[PRODUCT_A].tax_type_id, originalA.tax_type_id);
  for (const row of stockUpdates) {
    assert.deepEqual(row.update, { $inc: { stock_quantity: -1 } });
    assert.equal((row.update as { price?: unknown }).price, undefined);
    assert.equal((row.update as { tax_rate?: unknown }).tax_rate, undefined);
    assert.equal((row.update as { tax_type_id?: unknown }).tax_type_id, undefined);
  }
});

test('POST invoice rejects a Not configured product', async () => {
  assertNoMongoConnection();
  stubProducts();
  mock.method(Invoice, 'create', async () => {
    throw new Error('create must not run for unconfigured tax');
  });
  const res = await postInvoice({
    invoice_number: 'INV#BARE',
    items: [{ product_id: PRODUCT_NC, product_name: 'Bare', quantity: 1, price: 3, subtotal: 3 }],
  });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /no configured tax type/i);
});

test('POST quotation inherits line tax and does not touch stock', async () => {
  assertNoMongoConnection();
  stubProducts();
  mock.method(Product, 'findByIdAndUpdate', async () => {
    throw new Error('quotations must not adjust inventory');
  });
  let created: Record<string, unknown> | undefined;
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return createdInvoice(doc);
  });
  const res = await postInvoice({
    invoice_number: 'QTN#TAX02',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    items: [{ product_id: PRODUCT_A, product_name: 'ABC', quantity: 1, price: 4.99, subtotal: 4.99 }],
  });
  assert.equal(res.status, 201);
  assert.equal(created?.invoice_type, DOCUMENT_TYPE_QUOTATION);
  const items = created?.items as Array<Record<string, unknown>>;
  assert.equal(items[0].tax_type_name, 'GST');
  assert.equal(created?.tax_amount, 0.9);
  assert.equal(created?.total_amount, 5.89);
});

test('PUT keeps historical GST after Product TaxType changes to VAT', async () => {
  assertNoMongoConnection();
  stubProducts();
  const existingItems = [
    {
      product_id: PRODUCT_A,
      product_name: 'ABC',
      quantity: 1,
      price: 4.99,
      subtotal: 4.99,
      taxable: true,
      tax_type_id: GST_ID,
      tax_type_name: 'GST',
      tax_rate_type: 'percent',
      tax_rate: 18,
      tax_amount: 0.9,
      tax_type_label: 'GST — 18%',
      total: 5.89,
    },
  ];
  const doc = {
    _id: { toString: () => 'inv-hist' },
    invoice_number: 'INV#HIST',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    items: existingItems,
    subtotal_amount: 4.99,
    tax_amount: 0.9,
    total_amount: 5.89,
    amount_paid: 0,
    payment_status: 'unpaid',
    save: async () => {},
    toObject() {
      return { _id: this._id, invoice_number: this.invoice_number, payment_status: this.payment_status };
    },
  };
  mock.method(Invoice, 'findById', async () => doc);
  catalog[PRODUCT_A] = {
    ...catalog[PRODUCT_A],
    tax_type_id: { _id: VAT_ID, name: 'VAT', rate: 12, rate_type: 'percent' },
  };

  const res = await request(createApp())
    .put('/api/invoices/inv-hist')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({
      items: [{ product_id: PRODUCT_A, product_name: 'ABC', quantity: 1, price: 4.99, subtotal: 4.99 }],
    });

  assert.equal(res.status, 200);
  const line = (doc.items as Array<Record<string, unknown>>)[0];
  assert.equal(line.tax_type_name, 'GST');
  assert.equal(line.tax_rate, 18);
  assert.equal(line.tax_amount, 0.9);
  assert.equal(doc.tax_amount, 0.9);
  assert.equal(doc.total_amount, 5.89);
  assert.equal(doc.amount_paid, 0);
});

test('POST /receive-payment is still delegated to paymentApplication', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const invoices = readFileSync(join(process.cwd(), 'src/routes/invoices.ts'), 'utf8');
  assert.match(invoices, /paymentApplication\.applyCustomerPayment/);
  assert.match(invoices, /shouldAdjustInventoryForDocumentType\(docType\)/);
});

test('DELETE tax type is blocked when products are assigned', async () => {
  assertNoMongoConnection();
  mock.method(Product, 'countDocuments', async () => 3);
  mock.method(TaxType, 'findByIdAndDelete', async () => {
    throw new Error('assigned TaxType must not be deleted');
  });
  const res = await request(createApp())
    .delete(`/api/tax-types/${GST_ID}`)
    .set('Authorization', `Bearer ${adminTestToken()}`);
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /assigned to 3 products/i);
});
