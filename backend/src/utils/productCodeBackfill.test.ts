/**
 * Product-code migration plan and the CLI guard. No Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/utils/productCodeBackfill.test.ts
 */
import { beforeEach, test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import Product from '../models/Product';
import { connectedTarget } from '../db/cleanupRunner';
import {
  MIGRATION_TARGET_REFUSAL,
  applyProductCodeMigration,
  migrateProductIdAndSku,
  migrationRuntime,
  planProductCodeMigration,
  productCodePlanDigest,
  type ProductCodeChange,
  type ProductCodeMigrationPlan,
} from './productCodes';
import {
  assessBackfillTarget,
  readBackfillIntent,
  runProductCodeBackfill,
  type BackfillCliDeps,
} from './productCodeBackfill';
import type { ConnectedTargetEvidence } from '../db/cleanupSafeguards';
import { migrationJournal } from './migrationJournal';
import { IdentifierLockHeldError, identifierLock, processIdentity, type IdentifierLockRecord } from './identifierLock';

const DB = 'express_distributors_dev';
const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-code-journal-'));
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

beforeEach(() => {
  fs.rmSync(journalDir, { recursive: true, force: true });
  fs.mkdirSync(journalDir, { recursive: true });
  mock.method(migrationJournal, 'directory', () => journalDir);
  acquireCalls = 0;
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
  assert.equal(mongoose.connection.readyState, 0, 'backfill tests must not open a MongoDB connection');
}

/** Makes direct execution see a MongoDB server on this machine. Does not open a connection. */
function useLocalMigrationTarget() {
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

function product(id: string, fields: Record<string, unknown>) {
  return { _id: { toString: () => id }, ...fields };
}

function stubProducts(rows: Array<Record<string, unknown>>) {
  const writes: Array<{ filter: { _id?: string; $and?: unknown }; update: Record<string, unknown> }> = [];
  mock.method(Product, 'find', () => ({
    select: () => ({ lean: async () => rows }),
  }));
  mock.method(Product, 'findById', (id: string) => ({
    select: () => ({
      lean: async () => rows.find((row) => String((row._id as { toString: () => string }).toString()) === String(id)) || null,
    }),
  }));
  mock.method(Product, 'findOne', () => ({
    select() {
      return this;
    },
    lean: async () => null,
  }));
  mock.method(Product, 'updateOne', async (filter: { _id?: string; $and?: unknown }, update: Record<string, unknown>) => {
    writes.push({ filter, update });
    return { modifiedCount: 1 };
  });
  return writes;
}

/** Empty codes. Safe to fill product_id and copy the barcode into sku. */
const NEEDS_FILL = product('aaa111111111111111111111', {
  barcode: '012345678905',
  plu: '99887766',
});
/** Already has both codes. Nothing to fill. */
const ALREADY_DONE = product('bbb222222222222222222222', {
  product_id: '22222',
  sku: 'SKU-KEEP',
});
/** Barcode and PLU stay even though sku is already set. */
const BARCODE_STILL_SET = product('ccc333333333333333333333', {
  product_id: '33333',
  sku: 'SKU-3',
  barcode: '44444444',
  plu: '55555555',
});
/** A 5-digit sku plus a different barcode would require replacing the sku. */
const SKU_CONFLICT = product('ddd444444444444444444444', {
  sku: '12345',
  barcode: '012345678905',
  plu: '99887766',
});

const FIXTURES = [NEEDS_FILL, ALREADY_DONE, BARCODE_STILL_SET, SKU_CONFLICT];

function assertCodeWrite(update: Record<string, unknown>, expected: { product_id?: string; sku?: string }) {
  const set = update.$set as Record<string, unknown>;
  assert.equal(update.$unset, undefined);
  assert.deepEqual(Object.keys(set).sort(), ['product_id', 'sku', 'updated_at'].filter((key) => key === 'updated_at' || key in expected).sort());
  if (expected.product_id) assert.equal(set.product_id, expected.product_id);
  if (expected.sku) assert.equal(set.sku, expected.sku);
  for (const protectedField of ['barcode', 'plu', 'image_url', 'price', 'cost_price', 'stock_quantity', 'category_id', 'vendor_id', 'tax_type_id']) {
    assert.equal(protectedField in set, false, protectedField);
  }
}

test('planning performs no writes and sends conflicts to manual review', async () => {
  assertNoMongoConnection();
  const writes = stubProducts(FIXTURES);

  const plan = await planProductCodeMigration({ allocateProductId: async () => '10001' });

  assert.equal(writes.length, 0);
  assert.equal(plan.examined, 4);
  assert.equal(plan.skippedNoChange, 2);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].id, 'aaa111111111111111111111');
  assert.deepEqual(plan.changes[0].set, { product_id: '10001', sku: '012345678905' });
  assert.deepEqual(plan.changes[0].fields, ['product_id', 'sku']);
  assert.equal(plan.reviews.length, 1);
  assert.equal(plan.reviews[0].id, 'ddd444444444444444444444');
  assert.match(plan.reviews[0].reason, /Existing SKU would have to be replaced/);
  assert.equal(plan.digest, productCodePlanDigest(plan));
  assertNoMongoConnection();
});

test('applying a plan fills only empty product_id and sku and preserves barcode and PLU', async () => {
  assertNoMongoConnection();
  useLocalMigrationTarget();
  const writes = stubProducts(FIXTURES);
  const plan = await planProductCodeMigration({ allocateProductId: async () => '10001' });

  const applied = await applyProductCodeMigration(plan);

  assert.equal(applied.applied, true);
  assert.equal(applied.updated, 1);
  assert.deepEqual(
    writes.map((write) => write.filter._id),
    ['aaa111111111111111111111']
  );
  assertCodeWrite(writes[0].update, { product_id: '10001', sku: '012345678905' });
  assert.equal(
    writes.some((write) => write.filter._id === 'ccc333333333333333333333'),
    false,
    'a stored barcode is not removed and its sku is not replaced'
  );
  assert.equal(
    writes.some((write) => write.filter._id === 'ddd444444444444444444444'),
    false,
    'a conflicting sku is not overwritten'
  );
});

test('existing product_id and sku are not silently overwritten', async () => {
  assertNoMongoConnection();
  useLocalMigrationTarget();
  const rows = [
    product('eee555555555555555555555', { product_id: '22222', sku: 'SKU-KEEP', barcode: '99999999' }),
    product('fff666666666666666666666', { sku: 'SKU-ALREADY', barcode: '88888888' }),
  ];
  const writes = stubProducts(rows);

  const plan = await planProductCodeMigration({ allocateProductId: async () => '10001' });
  await applyProductCodeMigration(plan);

  assert.equal(plan.reviews.length, 0);
  assert.equal(plan.changes.length, 1);
  assert.equal('sku' in plan.changes[0].set, false);
  assert.deepEqual(plan.changes[0].set, { product_id: '10001' });
  assertCodeWrite(writes[0].update, { product_id: '10001' });
});

test('duplicate proposed product IDs and SKUs are left for manual review', async () => {
  assertNoMongoConnection();
  let nextId = 30000;
  const skuWrites = stubProducts([
    product('aaa111111111111111111111', { barcode: 'SAME-SKU' }),
    product('bbb222222222222222222222', { barcode: 'SAME-SKU' }),
    product('eee555555555555555555555', { product_id: '10001', sku: 'TAKEN-SKU' }),
    product('fff666666666666666666666', { barcode: 'TAKEN-SKU' }),
  ]);
  const skuPlan = await planProductCodeMigration({
    allocateProductId: async (used) => {
      while (used.has(String(nextId))) nextId += 1;
      const id = String(nextId);
      nextId += 1;
      return id;
    },
  });
  assert.equal(skuWrites.length, 0);
  assert.equal(skuPlan.changes.length, 0);
  for (const id of ['aaa111111111111111111111', 'bbb222222222222222222222', 'fff666666666666666666666']) {
    assert.match(skuPlan.reviews.find((review) => review.id === id)?.reason || '', /Proposed SKU is already used or duplicated/);
  }
  mock.restoreAll();

  const idWrites = stubProducts([
    product('ccc333333333333333333333', {}),
    product('ddd444444444444444444444', {}),
    product('eee555555555555555555555', { product_id: '10001', sku: 'TAKEN-SKU' }),
  ]);
  const idPlan = await planProductCodeMigration({ allocateProductId: async () => '10001' });
  assert.equal(idWrites.length, 0);
  assert.equal(idPlan.changes.length, 0);
  for (const id of ['ccc333333333333333333333', 'ddd444444444444444444444']) {
    assert.match(idPlan.reviews.find((review) => review.id === id)?.reason || '', /Proposed product_id is already used or duplicated/);
  }
});

test('a stale or altered plan is rejected before any write', async () => {
  assertNoMongoConnection();
  useLocalMigrationTarget();
  const rows = [product('aaa111111111111111111111', { barcode: '012345678905' })];
  const writes = stubProducts(rows);
  const plan = await planProductCodeMigration({ allocateProductId: async () => '10001' });

  const altered: ProductCodeMigrationPlan = {
    ...plan,
    changes: plan.changes.map((change) => ({ ...change, set: { ...change.set, sku: 'REPLACED' } })),
  };
  const alteredResult = await applyProductCodeMigration(altered);
  assert.equal(alteredResult.applied, false);
  assert.match(alteredResult.reason || '', /altered/);
  assert.equal(writes.length, 0);

  const forged: ProductCodeChange = {
    ...plan.changes[0],
    before: { ...plan.changes[0].before, sku: 'KEEP-ME' },
    set: { sku: 'NEW-SKU' },
    fields: ['sku'],
  };
  const forgedPlan: ProductCodeMigrationPlan = {
    ...plan,
    changes: [forged],
    reviews: [],
    digest: '',
  };
  forgedPlan.digest = productCodePlanDigest(forgedPlan);
  const forgedResult = await applyProductCodeMigration(forgedPlan);
  assert.equal(forgedResult.applied, false);
  assert.match(forgedResult.reason || '', /overwrite an existing SKU/);
  assert.equal(writes.length, 0);

  rows[0] = product('aaa111111111111111111111', { barcode: 'CHANGED' });
  const stale = await applyProductCodeMigration(plan);
  assert.equal(stale.applied, false);
  assert.match(stale.reason || '', /stale/);
  assert.deepEqual(stale.updatedIds, []);
  assert.deepEqual(stale.failed, []);
  assert.deepEqual(stale.notAttempted, ['aaa111111111111111111111']);
  assert.equal(writes.length, 0);
});

test('migrateProductIdAndSku does not write', async () => {
  assertNoMongoConnection();
  const writes = stubProducts(FIXTURES);
  await assert.rejects(() => migrateProductIdAndSku(), /no longer writes/);
  assert.equal(writes.length, 0);
});

test('readBackfillIntent never treats a query parameter as confirmation', () => {
  assert.deepEqual(readBackfillIntent(undefined, {}), { kind: 'dry-run' });
  assert.deepEqual(readBackfillIntent({}, { confirmDatabase: DB, execute: 'true' }), {
    kind: 'refused',
    status: 400,
    reason: 'A query parameter cannot authorize this write. Send confirmDatabase in the JSON body.',
  });
  assert.deepEqual(readBackfillIntent({ execute: true }, {}), {
    kind: 'refused',
    status: 400,
    reason: 'Missing confirmDatabase. Execution requires the connected database name in the JSON body.',
  });
  assert.deepEqual(readBackfillIntent({ confirmDatabase: `  ${DB}  ` }, { confirmDatabase: 'ignored' }), {
    kind: 'execute',
    confirmDatabase: DB,
  });
  assert.deepEqual(readBackfillIntent({ dryRun: true, confirmDatabase: DB }, {}), { kind: 'dry-run' });
});

function localEvidence(overrides: Partial<ConnectedTargetEvidence> = {}): ConnectedTargetEvidence {
  return {
    databaseName: DB,
    connectionHost: '127.0.0.1',
    serverReportedHosts: [],
    serverHostname: 'dev-laptop.local',
    isMongosRouter: false,
    ...overrides,
  };
}

test('a remote or production target is refused before the server is asked anything', async () => {
  assertNoMongoConnection();
  let reads = 0;
  const remote = await assessBackfillTarget({
    uri: 'mongodb+srv://user:secret@cluster0.example.mongodb.net/test',
    nodeEnv: 'development',
    localHostnames: ['dev-laptop.local'],
    readEvidence: async () => {
      reads += 1;
      return localEvidence();
    },
  });
  assert.equal(remote.safe, false);
  assert.equal(reads, 0);
  assert.doesNotMatch(remote.reason || '', /secret/);

  const production = await assessBackfillTarget({
    uri: 'mongodb://127.0.0.1:27017/dev',
    nodeEnv: 'production',
    localHostnames: ['dev-laptop.local'],
    readEvidence: async () => {
      reads += 1;
      return localEvidence();
    },
  });
  assert.equal(production.safe, false);
  assert.match(production.reason || '', /production/);
  assert.equal(reads, 0);
});

test('uncertain server evidence fails closed and a server on this machine passes', async () => {
  const uncertain = await assessBackfillTarget({
    uri: 'mongodb://127.0.0.1:27017/dev',
    nodeEnv: 'development',
    localHostnames: ['dev-laptop.local'],
    readEvidence: async () => localEvidence({ serverHostname: undefined }),
  });
  assert.equal(uncertain.safe, false);

  const local = await assessBackfillTarget({
    uri: 'mongodb://127.0.0.1:27017/dev',
    nodeEnv: 'development',
    localHostnames: ['dev-laptop.local'],
    readEvidence: async () => localEvidence(),
  });
  assert.deepEqual(local, { safe: true, databaseName: DB });
});

function cli(options: {
  argv?: string[];
  env?: BackfillCliDeps['env'];
  evidence?: Partial<ConnectedTargetEvidence>;
} = {}) {
  const events: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const deps: BackfillCliDeps = {
    argv: options.argv || [],
    env: options.env || { MONGODB_URI: `mongodb://127.0.0.1:27017/${DB}`, NODE_ENV: 'development' },
    localHostnames: ['dev-laptop.local'],
    connect: async () => {
      events.push('connect');
    },
    readEvidence: async () => localEvidence(options.evidence),
    disconnect: async () => {
      events.push('disconnect');
    },
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
  };
  return { deps, events, logs, errors };
}

test('CLI dry run reports field counts and does not write', async () => {
  assertNoMongoConnection();
  const writes = stubProducts(FIXTURES);
  const { deps, events, logs } = cli();

  assert.equal(await runProductCodeBackfill(deps), 0);

  assert.equal(writes.length, 0);
  assert.deepEqual(events, ['connect', 'disconnect']);
  const report = logs.join('\n');
  assert.match(report, new RegExp(`Connected database : ${DB}`));
  assert.match(report, /Would update        : 1/);
  assert.match(report, /Manual review       : 1/);
  assert.match(report, /Barcode, PLU, price, cost, stock, category and image_url are not changed/);
  assert.match(report, /DRY RUN: no products were changed/);
  assert.doesNotMatch(report, /012345678905/, 'the report names fields, not the barcode values');
});

test('CLI refuses a remote URI before connecting, even with a confirmation', async () => {
  assertNoMongoConnection();
  const writes = stubProducts(FIXTURES);
  const { deps, events, errors } = cli({
    argv: [`--confirm-database=${DB}`],
    env: {
      MONGODB_URI: 'mongodb+srv://user:secret@cluster0.example.mongodb.net/test',
      NODE_ENV: 'development',
    },
  });

  assert.equal(await runProductCodeBackfill(deps), 1);
  assert.deepEqual(events, []);
  assert.equal(writes.length, 0);
  assert.match(errors.join('\n'), /No database connection was opened/);
  assert.doesNotMatch(errors.join('\n'), /secret/);
});

test('CLI refuses production, an uncertain server, and a wrong or missing confirmation', async () => {
  assertNoMongoConnection();
  const cases: Array<{ label: string; argv?: string[]; env?: BackfillCliDeps['env']; evidence?: Partial<ConnectedTargetEvidence>; connect: boolean }> = [
    { label: 'production', env: { MONGODB_URI: `mongodb://127.0.0.1/${DB}`, NODE_ENV: 'production' }, argv: [`--confirm-database=${DB}`], connect: false },
    { label: 'unknown machine', evidence: { serverHostname: undefined }, argv: [`--confirm-database=${DB}`], connect: true },
    { label: 'wrong database', argv: ['--confirm-database=test'], connect: true },
    { label: 'confirmation without a value', argv: ['--confirm-database'], connect: true },
  ];
  for (const item of cases) {
    const writes = stubProducts(FIXTURES);
    const { deps, events } = cli({ argv: item.argv, env: item.env, evidence: item.evidence });
    assert.equal(await runProductCodeBackfill(deps), 1, item.label);
    assert.equal(writes.length, 0, item.label);
    assert.equal(events.includes('connect'), item.connect, item.label);
    mock.restoreAll();
  }
});

test('CLI execution writes only after the database name is confirmed', async () => {
  assertNoMongoConnection();
  useLocalMigrationTarget();
  const writes = stubProducts(FIXTURES);
  const { deps, logs } = cli({ argv: [`--confirm-database=${DB}`] });

  assert.equal(await runProductCodeBackfill(deps), 0);

  assert.deepEqual(
    writes.map((write) => write.filter._id),
    ['aaa111111111111111111111']
  );
  assert.equal(writes[0].update.$unset, undefined);
  assert.match(logs.join('\n'), /Product code backfill applied to 1 product\(s\)/);
});

test('CLI refuses a confirmation stored in the package.json script', async () => {
  assertNoMongoConnection();
  const writes = stubProducts(FIXTURES);
  const { deps, errors } = cli({
    argv: [`--confirm-database=${DB}`],
    env: {
      MONGODB_URI: `mongodb://127.0.0.1:27017/${DB}`,
      NODE_ENV: 'development',
      npm_lifecycle_script: `tsx src/db/backfill-product-codes.ts --confirm-database=${DB}`,
    },
  });

  assert.equal(await runProductCodeBackfill(deps), 1);
  assert.equal(writes.length, 0);
  assert.match(errors.join('\n'), /stored in the package\.json script/);
});

test('direct execution refuses production, an uncertain server, and a remote host', async () => {
  assertNoMongoConnection();
  const secretUri = 'mongodb+srv://user:secret@cluster0.example.mongodb.net/test';
  const planRows = [product('aaa111111111111111111111', { barcode: '012345678905', plu: '99887766' })];

  const productionWrites = stubProducts(planRows);
  let serverReads = 0;
  let productReads = 0;
  mock.method(migrationRuntime, 'uri', () => `mongodb://127.0.0.1:27017/${DB}`);
  mock.method(migrationRuntime, 'nodeEnv', () => 'production');
  mock.method(migrationRuntime, 'localHostnames', () => ['dev-laptop.local']);
  mock.method(connectedTarget, 'read', async () => {
    serverReads += 1;
    return localEvidence();
  });
  mock.method(Product, 'findById', () => {
    productReads += 1;
    return { select: () => ({ lean: async () => planRows[0] }) };
  });
  const plan = await planProductCodeMigration({ allocateProductId: async () => '10001' });
  const altered = await applyProductCodeMigration({ ...plan, digest: 'tampered' });
  assert.match(altered.reason || '', /altered/);
  assert.equal(productionWrites.length, 0);

  const production = await applyProductCodeMigration(plan);
  assert.equal(production.applied, false);
  assert.equal(production.updated, 0);
  assert.equal(production.reason, MIGRATION_TARGET_REFUSAL);
  assert.deepEqual(production.updatedIds, []);
  assert.deepEqual(production.failed, []);
  assert.deepEqual(production.notAttempted, ['aaa111111111111111111111']);
  assert.equal(serverReads, 0, 'production is refused before the server is asked');
  assert.equal(productReads, 0, 'production is refused before products are read');
  assert.equal(productionWrites.length, 0);
  assert.doesNotMatch(production.reason || '', /secret|mongodb/);
  mock.restoreAll();

  const uncertainWrites = stubProducts(planRows);
  mock.method(migrationRuntime, 'uri', () => `mongodb://127.0.0.1:27017/${DB}`);
  mock.method(migrationRuntime, 'nodeEnv', () => 'development');
  mock.method(migrationRuntime, 'localHostnames', () => ['dev-laptop.local']);
  mock.method(connectedTarget, 'read', async () => localEvidence({ serverHostname: undefined }));
  const uncertain = await applyProductCodeMigration(plan);
  assert.equal(uncertain.applied, false);
  assert.equal(uncertain.reason, MIGRATION_TARGET_REFUSAL);
  assert.equal(uncertainWrites.length, 0);
  assert.deepEqual(uncertain.notAttempted, ['aaa111111111111111111111']);
  mock.restoreAll();

  const remoteWrites = stubProducts(planRows);
  let remoteReads = 0;
  mock.method(migrationRuntime, 'uri', () => secretUri);
  mock.method(migrationRuntime, 'nodeEnv', () => 'development');
  mock.method(migrationRuntime, 'localHostnames', () => ['dev-laptop.local']);
  mock.method(connectedTarget, 'read', async () => {
    remoteReads += 1;
    return localEvidence();
  });
  const remote = await applyProductCodeMigration(plan);
  assert.equal(remote.applied, false);
  assert.equal(remote.reason, MIGRATION_TARGET_REFUSAL);
  assert.doesNotMatch(remote.reason || '', /secret/);
  assert.equal(remoteReads, 0);
  assert.equal(remoteWrites.length, 0);
  mock.restoreAll();

  const namedWrites = stubProducts(planRows);
  mock.method(migrationRuntime, 'uri', () => `mongodb://127.0.0.1:27017/${DB}`);
  mock.method(migrationRuntime, 'nodeEnv', () => 'development');
  mock.method(migrationRuntime, 'localHostnames', () => ['dev-laptop.local']);
  mock.method(connectedTarget, 'read', async () =>
    localEvidence({
      databaseName: DB,
      connectionHost: 'cluster0.example.mongodb.net',
      serverReportedHosts: ['cluster0.example.mongodb.net:27017'],
      serverHostname: 'atlas-host',
    })
  );
  const named = await applyProductCodeMigration(plan);
  assert.equal(named.applied, false);
  assert.equal(named.reason, MIGRATION_TARGET_REFUSAL);
  assert.doesNotMatch(named.reason || '', /atlas-host|mongodb\.net|secret/);
  assert.equal(namedWrites.length, 0);
  assertNoMongoConnection();
});

test('a failed write reports updated, failed, and not attempted products and is not retried', async () => {
  assertNoMongoConnection();
  useLocalMigrationTarget();
  const rows = [
    product('aaa111111111111111111111', { barcode: '11111111' }),
    product('bbb222222222222222222222', { barcode: '22222222' }),
    product('ccc333333333333333333333', { barcode: '33333333' }),
  ];
  const writes = stubProducts(rows);
  let calls = 0;
  mock.method(Product, 'updateOne', async (filter: { _id?: string; $and?: unknown }, update: Record<string, unknown>) => {
    writes.push({ filter, update });
    calls += 1;
    if (calls === 1) return { matchedCount: 1, modifiedCount: 1 };
    if (calls === 2) return { matchedCount: 0, modifiedCount: 0 };
    throw new Error('continued after a failed write');
  });
  let nextId = 60000;
  const plan = await planProductCodeMigration({
    allocateProductId: async (used) => {
      while (used.has(String(nextId))) nextId += 1;
      const id = String(nextId);
      nextId += 1;
      return id;
    },
  });

  const applied = await applyProductCodeMigration(plan);

  assert.equal(plan.changes.length, 3);
  assert.equal(applied.applied, false);
  assert.equal(applied.updated, 1);
  assert.deepEqual(applied.updatedIds, ['aaa111111111111111111111']);
  assert.equal(applied.failed.length, 1);
  assert.equal(applied.failed[0].id, 'bbb222222222222222222222');
  assert.match(applied.failed[0].reason, /not retried/);
  assert.deepEqual(applied.notAttempted, ['ccc333333333333333333333']);
  assert.equal(calls, 2);
  assert.equal(writes[0].update.$unset, undefined);
  assert.ok(Array.isArray(writes[0].filter.$and), 'the write matches the planned snapshot');
  assertNoMongoConnection();
});

test('CLI reports a partial execution and does not continue', async () => {
  assertNoMongoConnection();
  useLocalMigrationTarget();
  const rows = [
    product('aaa111111111111111111111', { barcode: '11111111' }),
    product('bbb222222222222222222222', { barcode: '22222222' }),
    product('ccc333333333333333333333', { barcode: '33333333' }),
  ];
  const writes = stubProducts(rows);
  let calls = 0;
  mock.method(Product, 'updateOne', async () => {
    calls += 1;
    writes.push({ filter: { _id: 'counted' }, update: {} });
    if (calls === 1) return { matchedCount: 1, modifiedCount: 1 };
    if (calls === 2) throw new Error('disk full');
    throw new Error('continued after a failed write');
  });
  const { deps, errors } = cli({ argv: [`--confirm-database=${DB}`] });

  assert.equal(await runProductCodeBackfill(deps), 1);

  const report = errors.join('\n');
  assert.match(report, /STOPPED/);
  assert.match(report, /Updated: aaa111111111111111111111/);
  assert.match(report, /Failed: bbb222222222222222222222: disk full/);
  assert.match(report, /Not attempted: ccc333333333333333333333/);
  assert.equal(calls, 2);
  assert.equal(writes.length, 2);
  assertNoMongoConnection();
});

test('an interrupted journal is identified and its plan is not replayed', async () => {
  assertNoMongoConnection();
  useLocalMigrationTarget();
  const filled = 'aaa111111111111111111111';
  const pending = 'bbb222222222222222222222';
  const rows = [
    product(filled, { product_id: '11111', sku: 'KEEP-SKU', barcode: '11111111', plu: 'PLU-A' }),
    product(pending, { barcode: '22222222', plu: 'PLU-B' }),
  ];
  const writes = stubProducts(rows);
  const old = await migrationJournal.begin({
    databaseName: DB,
    connectionHost: '127.0.0.1',
    planDigest: 'previous-plan-not-to-be-replayed',
    notAttempted: [filled, pending],
  });
  const file = path.join(journalDir, `${old.runId}.json`);
  const planted = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  planted.uri = 'mongodb+srv://user:secret@cluster.example.mongodb.net/test';
  planted.proposedSku = 'EVIL-SKU';
  fs.writeFileSync(file, JSON.stringify(planted));

  const plan = await planProductCodeMigration({ allocateProductId: async () => '40001' });
  const applied = await applyProductCodeMigration(plan);

  const saved = fs.readFileSync(file, 'utf8');
  assert.equal(JSON.parse(saved).status, 'interrupted');
  assert.equal(JSON.parse(saved).planDigest, 'previous-plan-not-to-be-replayed');
  assert.doesNotMatch(saved, /secret|EVIL-SKU|mongodb/);
  assert.deepEqual(applied.interruptedRunIds, [old.runId]);
  assert.equal(applied.applied, true);
  assert.deepEqual(writes.map((write) => write.filter._id), [pending]);
  assert.equal((writes[0].update.$set as { sku: string }).sku, '22222222');
  assert.equal(
    writes.some((write) => write.filter._id === filled),
    false
  );
  const journals = fs.readdirSync(journalDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(journalDir, name), 'utf8')) as {
      runId: string;
      entries?: Array<{ before: { sku: string }; set: { sku?: string } }>;
    });
  const current = journals.find((journal) => journal.runId !== old.runId);
  assert.ok(current);
  assert.equal(current.entries?.[0].before.sku, '');
  assert.equal(current.entries?.[0].set.sku, '22222222');
  assertNoMongoConnection();
});

test('a dry run reports an interrupted journal and does not write products', async () => {
  assertNoMongoConnection();
  const writes = stubProducts(FIXTURES);
  const old = await migrationJournal.begin({
    databaseName: DB,
    connectionHost: '127.0.0.1',
    planDigest: 'previous-plan-not-to-be-replayed',
    notAttempted: ['aaa111111111111111111111'],
  });
  const { deps, logs, errors } = cli();

  assert.equal(await runProductCodeBackfill(deps), 0);

  assert.equal(writes.length, 0);
  assert.equal(acquireCalls, 0);
  assert.match(errors.join('\n'), new RegExp(`RUNNING JOURNAL ${old.runId}`));
  assert.match(errors.join('\n'), /did not change that journal/);
  assert.match(errors.join('\n'), /did not replay/);
  assert.match(logs.join('\n'), /DRY RUN: no products were changed/);
  const saved = JSON.parse(fs.readFileSync(path.join(journalDir, `${old.runId}.json`), 'utf8')) as { status: string };
  assert.equal(saved.status, 'running');
  assertNoMongoConnection();
});

test('a journal that cannot be saved blocks product writes', async () => {
  assertNoMongoConnection();
  useLocalMigrationTarget();
  const writes = stubProducts([product('aaa111111111111111111111', { barcode: '012345678905' })]);
  mock.method(migrationJournal, 'begin', async () => {
    throw new Error('disk full');
  });
  const plan = await planProductCodeMigration({ allocateProductId: async () => '10001' });

  const applied = await applyProductCodeMigration(plan);

  assert.equal(applied.applied, false);
  assert.equal(applied.updated, 0);
  assert.match(applied.reason || '', /journal could not be saved/);
  assert.deepEqual(applied.notAttempted, ['aaa111111111111111111111']);
  assert.equal(writes.length, 0);
  assertNoMongoConnection();
});

test('a journal write that fails after one product does not continue', async () => {
  assertNoMongoConnection();
  useLocalMigrationTarget();
  const rows = [
    product('aaa111111111111111111111', { barcode: '11111111' }),
    product('bbb222222222222222222222', { barcode: '22222222' }),
  ];
  const writes = stubProducts(rows);
  mock.method(migrationJournal, 'record', async () => {
    throw new Error('disk full');
  });
  let nextId = 70000;
  const plan = await planProductCodeMigration({
    allocateProductId: async (used) => {
      while (used.has(String(nextId))) nextId += 1;
      const id = String(nextId);
      nextId += 1;
      return id;
    },
  });

  const applied = await applyProductCodeMigration(plan);

  assert.equal(applied.applied, false);
  assert.deepEqual(applied.updatedIds, ['aaa111111111111111111111']);
  assert.deepEqual(applied.notAttempted, ['bbb222222222222222222222']);
  assert.match(applied.reason || '', /journal could not be saved/);
  assert.equal(writes.length, 1);
  assert.equal((writes[0].update.$set as { sku?: string }).sku, '11111111');
  assertNoMongoConnection();
});

test('an approved migration acquires the lock before planning and releases it', async () => {
  assertNoMongoConnection();
  useLocalMigrationTarget();
  const order: string[] = [];
  const rows = [product('aaa111111111111111111111', { barcode: '012345678905' })];
  mock.method(identifierLock, 'acquire', async () => {
    order.push('acquire');
    return HELD;
  });
  mock.method(identifierLock, 'read', async () => HELD);
  mock.method(identifierLock, 'release', async () => {
    order.push('release');
    return true;
  });
  mock.method(Product, 'find', () => ({
    select: () => ({
      lean: async () => {
        order.push('plan');
        return rows;
      },
    }),
  }));
  mock.method(Product, 'findById', () => ({
    select: () => ({ lean: async () => rows[0] }),
  }));
  mock.method(Product, 'findOne', () => {
    const query = {
      select() {
        return query;
      },
      lean: async () => null,
    };
    return query;
  });
  mock.method(Product, 'updateOne', async () => {
    order.push('write');
    return { matchedCount: 1, modifiedCount: 1 };
  });
  const { deps } = cli({ argv: [`--confirm-database=${DB}`] });

  assert.equal(await runProductCodeBackfill(deps), 0);
  assert.deepEqual(order, ['acquire', 'plan', 'write', 'release']);
  assertNoMongoConnection();
});

test('a failed lock acquisition performs no product writes', async () => {
  assertNoMongoConnection();
  useLocalMigrationTarget();
  const writes = stubProducts(FIXTURES);
  mock.method(identifierLock, 'acquire', async () => {
    throw new IdentifierLockHeldError(HELD);
  });
  const { deps, errors } = cli({ argv: [`--confirm-database=${DB}`] });

  assert.equal(await runProductCodeBackfill(deps), 1);
  assert.equal(writes.length, 0);
  assert.match(errors.join('\n'), /already locked/);
  assert.match(errors.join('\n'), /No products were changed/);
  assertNoMongoConnection();
});

test('manual release is refused while the owner process is still the same live process', async () => {
  assertNoMongoConnection();
  let released = 0;
  mock.method(identifierLock, 'read', async () => HELD);
  mock.method(identifierLock, 'release', async () => {
    released += 1;
    return true;
  });
  mock.method(processIdentity, 'host', () => HELD.ownerHost);
  mock.method(processIdentity, 'isAlive', () => true);
  mock.method(processIdentity, 'startedAt', async () => HELD.ownerStartedAt);
  const { deps } = cli({
    argv: ['--release-lock', `--confirm-database=${DB}`, `--owner-run-id=${HELD.ownerRunId}`],
  });

  assert.equal(await runProductCodeBackfill(deps), 1);
  assert.equal(released, 0);
  assertNoMongoConnection();
});

test('manual release is refused when the owner process cannot be verified', async () => {
  assertNoMongoConnection();
  let released = 0;
  mock.method(identifierLock, 'read', async () => HELD);
  mock.method(identifierLock, 'release', async () => {
    released += 1;
    return true;
  });
  mock.method(processIdentity, 'host', () => HELD.ownerHost);
  mock.method(processIdentity, 'isAlive', () => true);
  mock.method(processIdentity, 'startedAt', async () => null);
  const { deps, errors } = cli({
    argv: ['--release-lock', `--confirm-database=${DB}`, `--owner-run-id=${HELD.ownerRunId}`],
  });

  assert.equal(await runProductCodeBackfill(deps), 1);
  assert.equal(released, 0);
  assert.match(errors.join('\n'), /could not be verified/);
  assertNoMongoConnection();
});
