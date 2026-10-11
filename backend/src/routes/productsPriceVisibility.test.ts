/**
 * Phase 2G.1-B — server-enforced catalog price visibility.
 *
 * Isolated harness: no Mongo writes. Product / User / Customer are stubbed.
 *
 * Run with:
 *     npx tsx --test src/routes/productsPriceVisibility.test.ts
 */
import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import Product from '../models/Product';
import User from '../models/User';
import Customer from '../models/Customer';
import {
  ACCOUNT_STATUS_APPROVED,
  ACCOUNT_STATUS_PENDING,
  ACCOUNT_STATUS_REJECTED,
} from '../utils/customerAccount';

const PRODUCT_ID = '64c1c2d3e4f5a6b7c8d9e0a1';
const USER_ID = '64b0000000000000000a0001';
const VENDOR_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(
    mongoose.connection.readyState,
    0,
    '2G.1-B tests must not open a MongoDB connection',
  );
}

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '2g1b-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function userTestToken(extra: Record<string, unknown> = {}): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real user JWT');
  return jwt.sign({ userId: USER_ID, phone: '5550100', ...extra }, secret, { expiresIn: '8h' });
}

function expiredUserToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real user JWT');
  return jwt.sign({ userId: USER_ID, phone: '5550100' }, secret, { expiresIn: '-1s' });
}

const catalogDoc = {
  _id: PRODUCT_ID,
  name: 'Catalog Widget',
  slug: 'catalog-widget',
  description: 'A widget for catalog tests.',
  product_type: 'inventory',
  price: 99.5,
  cost_price: 40,
  vendor_id: VENDOR_ID,
  image_url: 'https://example.invalid/w.png',
  product_id: 'P001',
  barcode: 'BAR-1',
  plu: 'PLU-1',
  sku: 'SKU-1',
  stock_quantity: 10,
  committed_quantity: 2,
  low_stock_threshold: 5,
  reorder_point: 3,
  is_active: true,
  tax_rate: 8.5,
  category_id: { _id: 'cccccccccccccccccccccccc', name: 'Cat', slug: 'cat' },
  sub_category_id: { _id: 'dddddddddddddddddddddddd', name: 'Sub', slug: 'sub' },
};

function chainFind(result: unknown) {
  const c: { populate: () => typeof c; sort: () => typeof c; skip: () => typeof c; limit: () => typeof c; lean: () => Promise<unknown> } = {
    populate: () => c,
    sort: () => c,
    skip: () => c,
    limit: () => c,
    lean: async () => result,
  };
  return c;
}

function chainFindById(result: unknown) {
  const c: { populate: () => typeof c; lean: () => Promise<unknown> } = {
    populate: () => c,
    lean: async () => result,
  };
  return c;
}

function stubCatalogList() {
  mock.method(Product, 'find', () => chainFind([catalogDoc]));
  mock.method(Product, 'countDocuments', async () => 1);
}

function stubCatalogDetail() {
  mock.method(Product, 'findById', (id: unknown) => {
    if (String(id) !== PRODUCT_ID) return chainFindById(null);
    return chainFindById(catalogDoc);
  });
}

function stubUserCustomer(accountStatus: string | undefined | null) {
  mock.method(User, 'findById', (id: unknown) => ({
    select: () => ({
      lean: async () => (String(id) === USER_ID ? { _id: USER_ID } : null),
    }),
  }));
  mock.method(Customer, 'findOne', () => ({
    select: () => ({
      lean: async () =>
        accountStatus === undefined
          ? null
          : { user_id: USER_ID, account_status: accountStatus, is_active: true },
    }),
  }));
}

function assertVaryAuthorization(res: { headers: Record<string, unknown> }) {
  assert.match(String(res.headers.vary || ''), /Authorization/i);
}

function assertPublicFields(body: Record<string, unknown>) {
  assert.equal(body.id, PRODUCT_ID);
  assert.equal(body.name, 'Catalog Widget');
  assert.equal(body.sku, 'SKU-1');
  assert.equal(body.barcode, 'BAR-1');
  assert.equal(body.product_id, 'P001');
  assert.equal(body.tax_rate, 8.5);
  assert.equal(body.stock_quantity, 8);
  assert.equal(body.available_quantity, 8);
}

function assertNoPrice(body: Record<string, unknown>) {
  assert.equal('price' in body, false);
  assert.equal(body.price, undefined);
}

function assertNoCost(body: Record<string, unknown>) {
  assert.equal('cost_price' in body, false);
  assert.equal('vendor_id' in body, false);
}

test('GET /api/products — guest has no price, omits cost_price, Vary Authorization', async () => {
  assertNoMongoConnection();
  stubCatalogList();

  const res = await request(createApp())
    .get('/api/products')
    .query({ showPrice: 'true', approved: 'true' });

  assert.equal(res.status, 200);
  assert.equal(res.body.products.length, 1);
  assert.equal(res.body.pagination.total, 1);
  assert.equal(res.body.pagination.page, 1);
  const product = res.body.products[0] as Record<string, unknown>;
  assertPublicFields(product);
  assertNoPrice(product);
  assertNoCost(product);
  assertVaryAuthorization(res);
});

test('GET /api/products — unapproved User has no price', async () => {
  assertNoMongoConnection();
  stubCatalogList();
  stubUserCustomer(ACCOUNT_STATUS_PENDING);

  const res = await request(createApp())
    .get('/api/products')
    .set('Authorization', `Bearer ${userTestToken({ account_status: 'approved' })}`);

  assert.equal(res.status, 200);
  const product = res.body.products[0] as Record<string, unknown>;
  assertPublicFields(product);
  assertNoPrice(product);
  assertNoCost(product);
  assertVaryAuthorization(res);
});

test('GET /api/products — rejected User has no price', async () => {
  assertNoMongoConnection();
  stubCatalogList();
  stubUserCustomer(ACCOUNT_STATUS_REJECTED);

  const res = await request(createApp())
    .get('/api/products')
    .set('Authorization', `Bearer ${userTestToken()}`);

  assert.equal(res.status, 200);
  const product = res.body.products[0] as Record<string, unknown>;
  assertPublicFields(product);
  assertNoPrice(product);
  assertNoCost(product);
  assertVaryAuthorization(res);
});

test('GET /api/products — approved User has price, still omits cost_price', async () => {
  assertNoMongoConnection();
  stubCatalogList();
  stubUserCustomer(ACCOUNT_STATUS_APPROVED);

  const res = await request(createApp())
    .get('/api/products')
    .set('Authorization', `Bearer ${userTestToken()}`);

  assert.equal(res.status, 200);
  const product = res.body.products[0] as Record<string, unknown>;
  assertPublicFields(product);
  assert.equal(product.price, 99.5);
  assertNoCost(product);
  assertVaryAuthorization(res);
});

test('GET /api/products — admin staff response includes price and cost_price', async () => {
  assertNoMongoConnection();
  stubCatalogList();

  const res = await request(createApp())
    .get('/api/products')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  const product = res.body.products[0] as Record<string, unknown>;
  assert.equal(product.price, 99.5);
  assert.equal(product.cost_price, 40);
  assert.equal(product.vendor_id, VENDOR_ID);
  assert.equal(product.stock_quantity, 10);
  assert.equal(product.committed_quantity, 2);
  assertVaryAuthorization(res);
});

test('GET /api/products — invalid/expired User JWT has no price and is not 401', async () => {
  assertNoMongoConnection();
  stubCatalogList();

  const expired = await request(createApp())
    .get('/api/products')
    .set('Authorization', `Bearer ${expiredUserToken()}`);

  assert.equal(expired.status, 200);
  assertNoPrice(expired.body.products[0] as Record<string, unknown>);
  assertNoCost(expired.body.products[0] as Record<string, unknown>);
  assertVaryAuthorization(expired);

  const invalid = await request(createApp())
    .get('/api/products')
    .set('Authorization', 'Bearer not-a-valid-jwt');

  assert.equal(invalid.status, 200);
  assertNoPrice(invalid.body.products[0] as Record<string, unknown>);
  assertVaryAuthorization(invalid);
});

test('GET /api/products/:id — guest has no price', async () => {
  assertNoMongoConnection();
  stubCatalogDetail();

  const res = await request(createApp()).get(`/api/products/${PRODUCT_ID}`);

  assert.equal(res.status, 200);
  assertPublicFields(res.body);
  assertNoPrice(res.body);
  assertNoCost(res.body);
  assertVaryAuthorization(res);
});

test('GET /api/products/:id — unapproved User has no price', async () => {
  assertNoMongoConnection();
  stubCatalogDetail();
  stubUserCustomer(ACCOUNT_STATUS_PENDING);

  const res = await request(createApp())
    .get(`/api/products/${PRODUCT_ID}`)
    .set('Authorization', `Bearer ${userTestToken()}`);

  assert.equal(res.status, 200);
  assertNoPrice(res.body);
  assertNoCost(res.body);
});

test('GET /api/products/:id — approved User has price', async () => {
  assertNoMongoConnection();
  stubCatalogDetail();
  stubUserCustomer(ACCOUNT_STATUS_APPROVED);

  const res = await request(createApp())
    .get(`/api/products/${PRODUCT_ID}`)
    .set('Authorization', `Bearer ${userTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.price, 99.5);
  assertNoCost(res.body);
});

test('GET /api/products/:id — admin staff response includes price', async () => {
  assertNoMongoConnection();
  stubCatalogDetail();

  const res = await request(createApp())
    .get(`/api/products/${PRODUCT_ID}`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.price, 99.5);
  assert.equal(res.body.cost_price, 40);
  assert.equal(res.body.stock_quantity, 10);
  assertVaryAuthorization(res);
});
