/**
 * Task 07D-10E-04 — POS sale-time cost basis snapshot.
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/posSaleCostBasis.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import Product from '../models/Product';
import Invoice from '../models/Invoice';
import POSSale from '../models/POSSale';
import StockMovement from '../models/StockMovement';
import User from '../models/User';
import Customer from '../models/Customer';
import { formatPosSaleResponse } from '../utils/posIdempotency';
import { INTERNAL_PRODUCT_FIELDS, toPublicProduct } from '../utils/productProjection';

const PRODUCT_ID = '64b0000000000000000d0404';
const SALE_TIME_COST = 42.5;
const saleItems = [{ product_id: PRODUCT_ID, quantity: 2 }];

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07d10e04-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'POS cost-basis tests must not open a MongoDB connection');
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

afterEach(() => {
  mock.restoreAll();
});

function catalogProduct(cost: number) {
  return {
    _id: { toString: () => PRODUCT_ID },
    name: 'Retail Item',
    price: 100,
    cost_price: cost,
    tax_rate: 0,
    is_active: true,
    product_type: 'inventory',
    stock_quantity: 10,
    committed_quantity: 0,
  };
}

function stubCatalogProduct(cost = SALE_TIME_COST) {
  const product = catalogProduct(cost);
  mock.method(Product, 'findById', async () => product);
  mock.method(Product, 'findOneAndUpdate', async () => ({}));
  mock.method(StockMovement, 'create', async () => ({}));
  mock.method(User, 'findOne', async () => null);
  mock.method(User, 'create', async () => ({ _id: { toString: () => 'user-1' } }));
  mock.method(User, 'findByIdAndUpdate', async () => ({}));
  mock.method(Customer, 'findById', async () => null);
  return product;
}

async function postSale(body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/pos/sale')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

test('A — new POS sale persists sale-time Product.cost_price on the line', async () => {
  assertNoMongoConnection();
  stubCatalogProduct(SALE_TIME_COST);
  const createdSales: Array<Record<string, unknown>> = [];
  const session = {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Invoice, 'create', async (docs: unknown) => {
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    return [{ _id: { toString: () => 'inv-cost-1' }, ...doc, toObject: () => doc }];
  });
  mock.method(POSSale, 'create', async (docs: unknown) => {
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    createdSales.push(doc);
    return [{ _id: { toString: () => 'sale-cost-1' }, ...doc, toObject: () => doc }];
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 200 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(createdSales.length, 1);
  const items = createdSales[0].items as Array<{ cost_price?: number; quantity?: number; price?: number }>;
  assert.equal(items[0].cost_price, SALE_TIME_COST);
  assert.equal(items[0].quantity, 2);
  assert.equal(items[0].price, 100);
});

test('B — changing Product.cost_price after create does not change the persisted sale snapshot', async () => {
  assertNoMongoConnection();
  const product = stubCatalogProduct(SALE_TIME_COST);
  const createdSales: Array<Record<string, unknown>> = [];
  const session = {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Invoice, 'create', async (docs: unknown) => {
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    return [{ _id: { toString: () => 'inv-cost-2' }, ...doc, toObject: () => doc }];
  });
  mock.method(POSSale, 'create', async (docs: unknown) => {
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    createdSales.push({
      ...doc,
      items: (doc.items as Array<Record<string, unknown>>).map((item) => ({ ...item })),
    });
    product.cost_price = 99.99;
    return [{ _id: { toString: () => 'sale-cost-2' }, ...doc, toObject: () => doc }];
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 200 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  const items = createdSales[0].items as Array<{ cost_price?: number }>;
  assert.equal(items[0].cost_price, SALE_TIME_COST);
  assert.equal(product.cost_price, 99.99);
});

test('C — sale-time cost snapshot does not change pricing, tax, tender, or totals', async () => {
  assertNoMongoConnection();
  stubCatalogProduct(SALE_TIME_COST);
  const createdInvoices: Array<Record<string, unknown>> = [];
  const createdSales: Array<Record<string, unknown>> = [];
  const session = {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Invoice, 'create', async (docs: unknown) => {
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    createdInvoices.push(doc);
    return [{ _id: { toString: () => 'inv-cost-3' }, ...doc, toObject: () => doc }];
  });
  mock.method(POSSale, 'create', async (docs: unknown) => {
    const doc = Array.isArray(docs) ? (docs[0] as Record<string, unknown>) : (docs as Record<string, unknown>);
    createdSales.push(doc);
    return [{ _id: { toString: () => 'sale-cost-3' }, ...doc, toObject: () => doc }];
  });

  const res = await postSale({
    items: saleItems,
    payment_method: 'cash',
    payment_split: { cash: 200 },
  });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(createdSales[0].subtotal, 200);
  assert.equal(createdSales[0].tax_amount, 0);
  assert.equal(createdSales[0].total_amount, 200);
  assert.deepEqual(createdSales[0].payment_split, { cash: 200, card: 0, digital: 0 });
  assert.equal(createdInvoices[0].total_amount, 200);
  assert.equal(createdInvoices[0].amount_paid, 200);
  const invoiceItems = createdInvoices[0].items as Array<Record<string, unknown>>;
  assert.equal('cost_price' in invoiceItems[0], false);
  assert.equal(invoiceItems[0].price, 100);
  assert.equal(invoiceItems[0].subtotal, 200);
});

test('D — customer-facing/public POS data does not expose the internal cost field', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/pos.ts'), 'utf8');
  assert.match(src, /cost_price:\s*Number\(\(product as \{ cost_price\?: number \}\)\.cost_price\) \|\| 0/);
  const invoiceMap = src.slice(src.indexOf('items: saleItems.map'), src.indexOf('const saleNumber'));
  assert.match(invoiceMap, /product_id: item\.product_id/);
  assert.equal(invoiceMap.includes('cost_price'), false);

  const payload = formatPosSaleResponse(
    {
      _id: 'sale-public',
      items: [{ product_id: PRODUCT_ID, quantity: 1, price: 100, subtotal: 100, cost_price: SALE_TIME_COST }],
      total_amount: 100,
    },
    {
      _id: 'inv-public',
      items: [{ product_id: PRODUCT_ID, quantity: 1, price: 100, subtotal: 100 }],
      total_amount: 100,
    }
  );
  assert.equal('cost_price' in payload.sale.items[0], false);
  assert.equal('cost_price' in payload.invoice.items[0], false);

  const pub = toPublicProduct({
    _id: PRODUCT_ID,
    name: 'Retail Item',
    slug: 'retail-item',
    price: 100,
    cost_price: SALE_TIME_COST,
  });
  assert.equal('cost_price' in pub, false);
  assert.ok(INTERNAL_PRODUCT_FIELDS.includes('cost_price'));
});

test('E — existing POSSale documents without cost_price remain readable', () => {
  const itemPath = POSSale.schema.path('items') as { schema?: mongoose.Schema };
  const costPath = itemPath.schema?.path('cost_price') as { isRequired?: boolean; instance?: string };
  assert.equal(costPath?.instance, 'Number');
  assert.notEqual(costPath?.isRequired, true);

  const sale = new POSSale({
    sale_number: `POS-LEGACY-${Date.now()}`,
    items: [{ product_id: PRODUCT_ID, quantity: 1, price: 100, subtotal: 100 }],
    subtotal: 100,
    total_amount: 100,
    payment_method: 'cash',
  });
  assert.equal(sale.validateSync(), undefined);
  assert.equal(sale.items[0].cost_price, undefined);
  assert.equal(sale.items[0].price, 100);
  assert.equal(sale.total_amount, 100);
});
