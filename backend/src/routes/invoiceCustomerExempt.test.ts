/**
 * TAX-03 — Customer.tax_exempt on admin invoices / quotations.
 * Isolated harness: no Mongo writes.
 *
 * Run with:
 *     npx tsx --test src/routes/invoiceCustomerExempt.test.ts
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
import Customer from '../models/Customer';
import CustomerProductPrice from '../models/CustomerProductPrice';
import { DOCUMENT_TYPE_INVOICE, DOCUMENT_TYPE_QUOTATION } from '../utils/documentType';

const GST_ID = '64b1c2d3e4f5a6b7c8d9e0f1';
const VAT_ID = '64b1c2d3e4f5a6b7c8d9e0f2';
const PRODUCT_A = '64c1c2d3e4f5a6b7c8d9e0a1';
const PRODUCT_B = '64c1c2d3e4f5a6b7c8d9e0a2';
const PRODUCT_C = '64c1c2d3e4f5a6b7c8d9e0a3';
const CUSTOMER_ID = '64d1c2d3e4f5a6b7c8d9e0b1';

const catalog: Record<string, Record<string, unknown>> = {
  [PRODUCT_A]: {
    _id: PRODUCT_A,
    name: 'ABC',
    price: 100,
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
};

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: 'tax03-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'TAX-03 tests must not open a MongoDB connection');
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

const catalogSnapshot = JSON.parse(JSON.stringify(catalog));

afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(catalogSnapshot)) {
    catalog[key] = JSON.parse(JSON.stringify(catalogSnapshot[key]));
  }
});

function stubCatalog() {
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
  mock.method(CustomerProductPrice, 'bulkWrite', async () => ({ ok: 1 }));
}

function stubCustomer(taxExempt: boolean) {
  mock.method(Customer, 'findById', (id: unknown) => ({
    select() {
      return this;
    },
    lean: async () => ({ _id: id, tax_exempt: taxExempt }),
  }));
}

function createdInvoice(fields: Record<string, unknown>) {
  const _id = { toString: () => 'inv-tax-03' };
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

test('A — taxable customer + GST 18% on $100 is tax 18 total 118', async () => {
  assertNoMongoConnection();
  stubCatalog();
  stubCustomer(false);
  let created: Record<string, unknown> | undefined;
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return createdInvoice(doc);
  });
  const res = await postInvoice({
    invoice_number: 'INV#A',
    customer_id: CUSTOMER_ID,
    items: [{ product_id: PRODUCT_A, product_name: 'ABC', quantity: 1, price: 100, subtotal: 100 }],
  });
  assert.equal(res.status, 201);
  assert.equal(created?.subtotal_amount, 100);
  assert.equal(created?.tax_amount, 18);
  assert.equal(created?.total_amount, 118);
  const line = (created?.items as Array<Record<string, unknown>>)[0];
  assert.equal(line.taxable, true);
  assert.notEqual(line.tax_exempt, true);
  assert.equal(String(catalog[PRODUCT_A].tax_type_id && (catalog[PRODUCT_A].tax_type_id as { _id: string })._id), GST_ID);
});

test('B — exempt customer + GST 18% on $100 is tax 0 total 100', async () => {
  assertNoMongoConnection();
  stubCatalog();
  stubCustomer(true);
  let created: Record<string, unknown> | undefined;
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return createdInvoice(doc);
  });
  const originalTaxType = catalog[PRODUCT_A].tax_type_id;
  const res = await postInvoice({
    invoice_number: 'INV#B',
    customer_id: CUSTOMER_ID,
    items: [{ product_id: PRODUCT_A, product_name: 'ABC', quantity: 1, price: 100, subtotal: 100 }],
  });
  assert.equal(res.status, 201);
  assert.equal(created?.subtotal_amount, 100);
  assert.equal(created?.tax_amount, 0);
  assert.equal(created?.total_amount, 100);
  const line = (created?.items as Array<Record<string, unknown>>)[0];
  assert.equal(line.taxable, false);
  assert.equal(line.tax_exempt, true);
  assert.equal(line.tax_type_label, 'Customer Exempt');
  assert.equal(String(line.tax_type_id), GST_ID);
  assert.deepEqual(catalog[PRODUCT_A].tax_type_id, originalTaxType);
});

test('C — exempt customer zeros mixed GST / VAT / No Tax lines', async () => {
  assertNoMongoConnection();
  stubCatalog();
  stubCustomer(true);
  let created: Record<string, unknown> | undefined;
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return createdInvoice(doc);
  });
  const res = await postInvoice({
    invoice_number: 'INV#C',
    customer_id: CUSTOMER_ID,
    items: [
      { product_id: PRODUCT_A, product_name: 'ABC', quantity: 1, price: 4.99, subtotal: 4.99 },
      { product_id: PRODUCT_B, product_name: 'DEF', quantity: 1, price: 10, subtotal: 10 },
      { product_id: PRODUCT_C, product_name: 'XYZ', quantity: 1, price: 7.5, subtotal: 7.5 },
    ],
  });
  assert.equal(res.status, 201);
  assert.equal(created?.tax_amount, 0);
  assert.equal(created?.total_amount, 22.49);
  const items = created?.items as Array<Record<string, unknown>>;
  assert.ok(items.every((item) => item.tax_exempt === true && item.tax_amount === 0));
});

test('D — historical exempt invoice stays tax-free after customer becomes taxable', async () => {
  assertNoMongoConnection();
  stubCatalog();
  stubCustomer(false);
  const existingItems = [
    {
      product_id: PRODUCT_A,
      product_name: 'ABC',
      quantity: 1,
      price: 100,
      subtotal: 100,
      taxable: false,
      tax_exempt: true,
      tax_type_id: GST_ID,
      tax_type_name: 'GST',
      tax_rate_type: 'percent',
      tax_rate: 18,
      tax_amount: 0,
      tax_type_label: 'Customer Exempt',
      total: 100,
    },
  ];
  const doc = {
    _id: { toString: () => 'inv-d' },
    invoice_number: 'INV#D',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    customer_id: CUSTOMER_ID,
    items: existingItems,
    subtotal_amount: 100,
    tax_amount: 0,
    total_amount: 100,
    amount_paid: 0,
    payment_status: 'unpaid',
    save: async () => {},
    toObject() {
      return { _id: this._id, invoice_number: this.invoice_number, payment_status: this.payment_status };
    },
  };
  mock.method(Invoice, 'findById', async () => doc);
  const res = await request(createApp())
    .put('/api/invoices/inv-d')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ items: [{ product_id: PRODUCT_A, product_name: 'ABC', quantity: 1, price: 100, subtotal: 100 }] });
  assert.equal(res.status, 200);
  const line = (doc.items as Array<Record<string, unknown>>)[0];
  assert.equal(line.tax_exempt, true);
  assert.equal(line.tax_amount, 0);
  assert.equal(doc.tax_amount, 0);
  assert.equal(doc.total_amount, 100);
});

test('E — historical taxable invoice keeps GST after customer becomes exempt', async () => {
  assertNoMongoConnection();
  stubCatalog();
  stubCustomer(true);
  const existingItems = [
    {
      product_id: PRODUCT_A,
      product_name: 'ABC',
      quantity: 1,
      price: 100,
      subtotal: 100,
      taxable: true,
      tax_type_id: GST_ID,
      tax_type_name: 'GST',
      tax_rate_type: 'percent',
      tax_rate: 18,
      tax_amount: 18,
      tax_type_label: 'GST — 18%',
      total: 118,
    },
  ];
  const doc = {
    _id: { toString: () => 'inv-e' },
    invoice_number: 'INV#E',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    customer_id: CUSTOMER_ID,
    items: existingItems,
    subtotal_amount: 100,
    tax_amount: 18,
    total_amount: 118,
    amount_paid: 0,
    payment_status: 'unpaid',
    save: async () => {},
    toObject() {
      return { _id: this._id, invoice_number: this.invoice_number, payment_status: this.payment_status };
    },
  };
  mock.method(Invoice, 'findById', async () => doc);
  const res = await request(createApp())
    .put('/api/invoices/inv-e')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ items: [{ product_id: PRODUCT_A, product_name: 'ABC', quantity: 1, price: 100, subtotal: 100 }] });
  assert.equal(res.status, 200);
  const line = (doc.items as Array<Record<string, unknown>>)[0];
  assert.notEqual(line.tax_exempt, true);
  assert.equal(line.taxable, true);
  assert.equal(line.tax_amount, 18);
  assert.equal(doc.tax_amount, 18);
  assert.equal(doc.total_amount, 118);
});

test('F — converting an exempt quotation copies the stored zero-tax snapshot', async () => {
  assertNoMongoConnection();
  stubCatalog();
  stubCustomer(false);
  const quoteItems = [
    {
      product_id: PRODUCT_A,
      product_name: 'ABC',
      quantity: 1,
      price: 100,
      subtotal: 100,
      taxable: false,
      tax_exempt: true,
      tax_type_id: GST_ID,
      tax_type_name: 'GST',
      tax_rate_type: 'percent',
      tax_rate: 18,
      tax_amount: 0,
      tax_type_label: 'Customer Exempt',
      total: 100,
    },
  ];
  const quote = {
    _id: { toString: () => 'qtn-f' },
    invoice_number: 'QTN#F',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    customer_id: CUSTOMER_ID,
    customer_name: 'Exempt Co',
    items: quoteItems,
    tax_amount: 0,
    total_amount: 100,
    subtotal_amount: 100,
    shipping_type: '',
    save: async () => {},
  };
  mock.method(Invoice, 'findById', async () => quote);
  mock.method(Invoice, 'find', () => ({
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    lean: async () => [],
  }));
  let created: Record<string, unknown> | undefined;
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return createdInvoice(doc);
  });
  const res = await request(createApp())
    .post('/api/invoices/qtn-f/convert')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({});
  assert.equal(res.status, 201);
  assert.equal(created?.invoice_type, DOCUMENT_TYPE_INVOICE);
  assert.equal(created?.tax_amount, 0);
  assert.equal(created?.total_amount, 100);
  const line = (created?.items as Array<Record<string, unknown>>)[0];
  assert.equal(line.tax_exempt, true);
  assert.equal(line.tax_amount, 0);
  assert.equal(line.tax_type_label, 'Customer Exempt');
});

test('G — customer exemption does not modify Product.tax_type_id', async () => {
  assertNoMongoConnection();
  stubCatalog();
  stubCustomer(true);
  const before = JSON.stringify(catalog[PRODUCT_A].tax_type_id);
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => createdInvoice(doc));
  const res = await postInvoice({
    invoice_number: 'INV#G',
    customer_id: CUSTOMER_ID,
    items: [{ product_id: PRODUCT_A, product_name: 'ABC', quantity: 1, price: 100, subtotal: 100 }],
  });
  assert.equal(res.status, 201);
  assert.equal(JSON.stringify(catalog[PRODUCT_A].tax_type_id), before);
  assert.equal(catalog[PRODUCT_A].price, 100);
  assert.equal(catalog[PRODUCT_A].tax_rate, 8.5);
});

test('H — legacy invoice without line snapshots keeps document-level tax', async () => {
  assertNoMongoConnection();
  let created: Record<string, unknown> | undefined;
  mock.method(Invoice, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return createdInvoice(doc);
  });
  const res = await postInvoice({
    invoice_number: 'INV#H',
    items: [{ product_name: 'Legacy Line', quantity: 1, price: 100, subtotal: 100 }],
    tax_amount: 8.5,
  });
  assert.equal(res.status, 201);
  assert.equal(created?.tax_amount, 8.5);
  assert.equal(created?.total_amount, 108.5);
  const line = (created?.items as Array<Record<string, unknown>>)[0];
  assert.equal(Object.prototype.hasOwnProperty.call(line, 'taxable'), false);
});
