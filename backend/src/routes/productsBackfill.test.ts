/**
 * POST /api/products/backfill-codes — no write without a body confirmation
 * and a confirmed local database. No Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/productsBackfill.test.ts
 */
import '../load-env';
import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import Product from '../models/Product';
import { connectedTarget } from '../db/cleanupRunner';
import { migrationRuntime } from '../utils/productCodes';
import { migrationJournal } from '../utils/migrationJournal';
import { identifierLock, type IdentifierLockRecord } from '../utils/identifierLock';
import { backfillRuntime, PUBLIC_TARGET_REFUSAL } from '../utils/productCodeBackfill';

const DB = 'express_distributors_dev';
const ADMIN_ID = '64b0000000000000000a0001';
const HELD: IdentifierLockRecord = {
  ownerRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ownerPid: 4242,
  ownerHost: 'dev-laptop',
  ownerStartedAt: 'Mon Nov 16 08:00:00 2026',
  databaseName: DB,
  purpose: 'product-code-migration',
  acquiredAt: '2026-01-01T00:00:00.000Z',
};
let acquireCalls = 0;
let settleCalls = 0;

beforeEach(() => {
  acquireCalls = 0;
  settleCalls = 0;
  mock.method(migrationJournal, 'listRunning', async () => []);
  mock.method(migrationJournal, 'settle', async () => {
    settleCalls += 1;
    return [];
  });
  mock.method(migrationJournal, 'begin', async (input: {
    databaseName: string;
    connectionHost: string;
    planDigest: string;
    notAttempted: string[];
  }) => ({
    runId: '11111111-1111-1111-1111-111111111111',
    databaseName: input.databaseName,
    connectionHost: input.connectionHost,
    planDigest: input.planDigest,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    updatedIds: [] as string[],
    failed: [] as Array<{ id: string; reason: string }>,
    notAttempted: [...input.notAttempted],
    entries: [] as Array<{ id: string; before: { product_id: string; sku: string }; set: { product_id?: string; sku?: string } }>,
    status: 'running' as const,
  }));
  mock.method(migrationJournal, 'record', async () => {});
  mock.method(identifierLock, 'acquire', async () => {
    acquireCalls += 1;
    return HELD;
  });
  mock.method(identifierLock, 'read', async () => HELD);
  mock.method(identifierLock, 'release', async () => true);
});

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'backfill route tests must not open a MongoDB connection');
}

function adminToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: ADMIN_ID, role: 'admin' }, secret, { expiresIn: '8h' });
}

function userToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real user JWT');
  return jwt.sign({ userId: '64b0000000000000000a0002', phone: '5550100' }, secret, { expiresIn: '8h' });
}

function product(id: string, fields: Record<string, unknown>) {
  return { _id: { toString: () => id }, ...fields };
}

const FIXTURES = [
  product('aaa111111111111111111111', { barcode: '012345678905', plu: '99887766' }),
  product('bbb222222222222222222222', { product_id: '22222', sku: 'SKU-KEEP' }),
  product('ccc333333333333333333333', { product_id: '33333', sku: 'SKU-3', barcode: '44444444', plu: '55555555' }),
  product('ddd444444444444444444444', { sku: '12345', barcode: '012345678905', plu: '99887766' }),
];

function stubProducts() {
  const writes: Array<{ filter: { _id?: string }; update: Record<string, unknown> }> = [];
  mock.method(Product, 'find', () => ({
    select: () => ({ lean: async () => FIXTURES }),
  }));
  mock.method(Product, 'findById', (id: string) => ({
    select: () => ({
      lean: async () => FIXTURES.find((row) => row._id.toString() === String(id)) || null,
    }),
  }));
  mock.method(Product, 'findOne', () => ({
    select() {
      return this;
    },
    lean: async () => null,
  }));
  mock.method(Product, 'updateOne', async (filter: { _id?: string }, update: Record<string, unknown>) => {
    writes.push({ filter, update });
    return { modifiedCount: 1 };
  });
  return writes;
}

function allowDirectApply() {
  mock.method(migrationRuntime, 'uri', () => `mongodb://127.0.0.1:27017/${DB}`);
  mock.method(migrationRuntime, 'nodeEnv', () => 'development');
  mock.method(migrationRuntime, 'localHostnames', () => [os.hostname()]);
  mock.method(connectedTarget, 'read', async () => ({
    databaseName: DB,
    connectionHost: '127.0.0.1',
    serverReportedHosts: [] as string[],
    serverHostname: os.hostname(),
    isMongosRouter: false,
  }));
}

function assess(safe: boolean, databaseName = DB) {
  mock.method(backfillRuntime, 'assess', async () =>
    safe
      ? { safe: true, databaseName }
      : { safe: false, reason: 'target is not this machine', databaseName }
  );
}

function post(body?: Record<string, unknown> | undefined, query?: Record<string, string>) {
  const req = request(createApp()).post('/api/products/backfill-codes').set('Authorization', `Bearer ${adminToken()}`);
  if (query) req.query(query);
  if (body !== undefined) req.send(body);
  return req;
}

test('the route does not call the unguarded migration', () => {
  const source = fs.readFileSync(path.join(__dirname, 'products.ts'), 'utf8');
  assert.doesNotMatch(source, /migrateProductIdAndSku/);
});

test('an ordinary admin POST is a dry run and does not write', async () => {
  assertNoMongoConnection();
  const writes = stubProducts();
  assess(true);

  const res = await post({});

  assert.equal(res.status, 200);
  assert.equal(res.body.mode, 'dry-run');
  assert.equal(res.body.updated, 0);
  assert.equal(res.body.wouldUpdate, 1);
  assert.equal(res.body.manualReview, 1);
  assert.equal(res.body.fields.product_id, 1);
  assert.equal(res.body.fields.sku, 1);
  assert.equal(res.body.fields.barcode, undefined);
  assert.match(res.body.reviews[0].reason, /Existing SKU would have to be replaced/);
  assert.equal(res.body.databaseName, DB);
  assert.equal(writes.length, 0);
  assert.doesNotMatch(JSON.stringify(res.body), /012345678905/);
  assertNoMongoConnection();
});

test('an explicit dry-run does not write even when the database name is also sent', async () => {
  assertNoMongoConnection();
  const writes = stubProducts();
  assess(true);

  const res = await post({ dryRun: true, confirmDatabase: DB });

  assert.equal(res.status, 200);
  assert.equal(res.body.mode, 'dry-run');
  assert.equal(writes.length, 0);
  assert.equal(acquireCalls, 0);
  assert.equal(settleCalls, 0);
});

test('missing confirmation refuses an execution attempt', async () => {
  assertNoMongoConnection();
  const writes = stubProducts();
  assess(true);

  const res = await post({ execute: true });

  assert.equal(res.status, 400);
  assert.equal(res.body.mode, 'refused');
  assert.equal(res.body.updated, 0);
  assert.match(res.body.reason, /Missing confirmDatabase/);
  assert.equal(writes.length, 0);
});

test('a query parameter cannot authorize a write, even with the right database name', async () => {
  assertNoMongoConnection();
  const writes = stubProducts();
  assess(true);

  const res = await post(undefined, { confirmDatabase: DB, execute: 'true' });

  assert.equal(res.status, 400);
  assert.equal(res.body.mode, 'refused');
  assert.match(res.body.reason, /query parameter cannot authorize/);
  assert.equal(writes.length, 0);
});

test('the wrong database name refuses execution', async () => {
  assertNoMongoConnection();
  const writes = stubProducts();
  assess(true);

  const res = await post({ confirmDatabase: 'test' });

  assert.equal(res.status, 409);
  assert.equal(res.body.mode, 'refused');
  assert.equal(res.body.updated, 0);
  assert.match(res.body.reason, /does not match the connected database/);
  assert.equal(writes.length, 0);
});

test('a production or uncertain target refuses execution even with the right database name', async () => {
  assertNoMongoConnection();
  for (const databaseName of ['test', DB]) {
    const writes = stubProducts();
    assess(false, databaseName);

    const res = await post({ confirmDatabase: databaseName });

    assert.equal(res.status, 409, databaseName);
    assert.equal(res.body.mode, 'refused');
    assert.equal(res.body.updated, 0);
    assert.equal(res.body.reason, PUBLIC_TARGET_REFUSAL);
    assert.equal(res.body.wouldUpdate, 1);
    assert.doesNotMatch(JSON.stringify(res.body), /mongodb|secret|target is not this machine/);
    assert.equal(writes.length, 0);
    mock.restoreAll();
  }
});

test('a dry run against an unsafe target reports the plan and does not write', async () => {
  assertNoMongoConnection();
  const writes = stubProducts();
  assess(false, 'test');

  const res = await post({});

  assert.equal(res.status, 200);
  assert.equal(res.body.mode, 'dry-run');
  assert.match(res.body.message, /Execution is refused/);
  assert.equal(writes.length, 0);
});

test('an admin token without confirmation cannot mutate products', async () => {
  assertNoMongoConnection();
  const writes = stubProducts();
  assess(true);

  const res = await request(createApp())
    .post('/api/products/backfill-codes')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ confirmDatabase: '' });

  assert.equal(res.status, 400);
  assert.equal(writes.length, 0);
});

test('authentication and authorization are unchanged', async () => {
  assertNoMongoConnection();
  const writes = stubProducts();

  const anonymous = await request(createApp()).post('/api/products/backfill-codes').send({ confirmDatabase: DB });
  const user = await request(createApp())
    .post('/api/products/backfill-codes')
    .set('Authorization', `Bearer ${userToken()}`)
    .send({ confirmDatabase: DB });

  assert.equal(anonymous.status, 401);
  assert.equal(user.status, 403);
  assert.equal(writes.length, 0);
});

test('execution still refuses production or an uncertain server when the route assessment was bypassed', async () => {
  assertNoMongoConnection();
  for (const nodeEnv of ['production', 'development']) {
    const writes = stubProducts();
    assess(true);
    mock.method(migrationRuntime, 'uri', () =>
      nodeEnv === 'production' ? `mongodb://127.0.0.1:27017/${DB}` : `mongodb://127.0.0.1:27017/${DB}`
    );
    mock.method(migrationRuntime, 'nodeEnv', () => nodeEnv);
    mock.method(migrationRuntime, 'localHostnames', () => ['dev-laptop.local']);
    mock.method(connectedTarget, 'read', async () => ({
      databaseName: DB,
      connectionHost: '127.0.0.1',
      serverReportedHosts: [] as string[],
      serverHostname: nodeEnv === 'production' ? 'dev-laptop.local' : undefined,
      isMongosRouter: false,
    }));

    const res = await post({ confirmDatabase: DB });

    assert.equal(res.status, 409, nodeEnv);
    assert.equal(res.body.mode, 'refused');
    assert.equal(res.body.updated, 0);
    assert.deepEqual(res.body.updatedIds, []);
    assert.deepEqual(res.body.failed, []);
    assert.deepEqual(res.body.notAttempted, []);
    assert.equal(res.body.reason, PUBLIC_TARGET_REFUSAL);
    assert.doesNotMatch(JSON.stringify(res.body), /mongodb|secret|dev-laptop/);
    assert.equal(writes.length, 0, nodeEnv);
    mock.restoreAll();
  }
  assertNoMongoConnection();
});

test('a confirmed request on a local database applies the migration and leaves other fields alone', async () => {
  assertNoMongoConnection();
  const writes = stubProducts();
  assess(true);
  allowDirectApply();

  const res = await post({ confirmDatabase: DB });

  assert.equal(res.status, 200);
  assert.equal(res.body.mode, 'executed');
  assert.equal(res.body.updated, 1);
  assert.equal(acquireCalls, 1);
  assert.deepEqual(res.body.updatedIds, ['aaa111111111111111111111']);
  assert.deepEqual(res.body.failed, []);
  assert.deepEqual(res.body.notAttempted, []);
  assert.deepEqual(
    writes.map((write) => write.filter._id),
    ['aaa111111111111111111111']
  );
  for (const write of writes) {
    const set = write.update.$set as Record<string, unknown>;
    assert.deepEqual(Object.keys(set).sort(), ['product_id', 'sku', 'updated_at']);
    assert.equal(write.update.$unset, undefined);
    for (const field of ['barcode', 'plu', 'price', 'cost_price', 'stock_quantity', 'category_id', 'image_url']) {
      assert.equal(field in set, false, field);
    }
  }
  assert.equal((writes[0].update.$set as { sku: string }).sku, '012345678905');
  const kept = writes.find((write) => write.filter._id === 'ccc333333333333333333333' || write.filter._id === 'ddd444444444444444444444');
  assert.equal(kept, undefined, 'barcode, PLU and an existing SKU are not written');
  assertNoMongoConnection();
});
