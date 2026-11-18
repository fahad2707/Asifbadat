/**
 * Guarded cleanup against a REAL MongoDB server — read-only paths only.
 *
 * These tests prove, on a real server, that the target evidence is gathered
 * correctly and that a dry run or a refused run changes nothing. They never
 * run a cleanup in execute mode: no test here passes a complete, matching
 * confirmation.
 *
 * Opt-in. Skipped unless CLEANUP_TEST_MONGODB_URI points at a disposable local
 * MongoDB. The tests:
 * - refuse any host that is not localhost / 127.0.0.1 / [::1];
 * - ignore the database in the URI and use their own `cleanup_it_*` database,
 *   which they create, fill with made-up fixtures and drop when they finish;
 * - never read MONGODB_URI and never touch the application database.
 *
 * Run with:
 *     CLEANUP_TEST_MONGODB_URI='mongodb://127.0.0.1:27947/' \
 *       npx tsx --test src/db/cleanupRunner.integration.test.ts
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import mongoose from 'mongoose';
import {
  adminDataCleanupConfig,
  adminResetConfig,
  fullResetConfig,
  localProductsOnlyCleanupConfig,
  operationalCleanupConfig,
  productsAndCategoriesCleanupConfig,
} from './cleanupPlans';
import { createCleanupDeps, runGuardedCleanup, type CleanupConfig, type CleanupDeps } from './cleanupRunner';
import {
  ACKNOWLEDGE_CATALOGUE_DELETION_FLAG,
  CONFIRM_DATABASE_FLAG,
  evaluateConnectedTarget,
} from './cleanupSafeguards';

const URI = process.env.CLEANUP_TEST_MONGODB_URI?.trim() || '';
const SKIP: string | false = URI
  ? false
  : 'set CLEANUP_TEST_MONGODB_URI to a disposable local MongoDB to run real-database dry-run tests';

const DB_PREFIX = 'cleanup_it_';
const DB_NAME = `${DB_PREFIX}${randomBytes(6).toString('hex')}`;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const FIXTURES: Record<string, Record<string, unknown>[]> = {
  products: [
    { name: 'Fixture A', sku: 'FX-A', price: 12.5, cost_price: 7, stock_quantity: 30, committed_quantity: 4, image_url: 'https://img.example/a.png' },
    { name: 'Fixture B', sku: 'FX-B', price: 3, cost_price: 1.5, stock_quantity: 0, committed_quantity: 0, image_url: 'https://img.example/b.png' },
  ],
  categories: [{ name: 'Fixture category', image_url: 'https://img.example/c.png' }],
  subcategories: [{ name: 'Fixture subcategory' }],
  auditlogs: [{ action: 'fixture.event', entity_type: 'fixture', entity_id: '1', created_at: new Date(0) }],
  admins: [{ email: 'fixture-admin@example.invalid', password_hash: 'not-a-real-hash', name: 'Fixture', role: 'admin' }],
  storesettings: [{ logo_url: 'https://img.example/logo.png' }],
  customers: [{ name: 'Fixture customer' }, { name: 'Fixture customer 2' }],
  invoices: [{ invoice_number: 'FX-1' }],
  legacy_things: [{ note: 'collection without a model' }],
};

function assertLocalUri(uri: string) {
  const match = uri.match(/^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/);
  assert.ok(match, 'CLEANUP_TEST_MONGODB_URI must be a mongodb:// URI (mongodb+srv is refused)');
  for (const hostPort of match[1].split(',')) {
    const host = hostPort.replace(/:\d+$/, '').toLowerCase();
    assert.ok(LOCAL_HOSTS.has(host), `integration tests only run against a local MongoDB, got host "${host}"`);
  }
}

/** Every document of every collection, so "nothing changed" is checked byte for byte. */
async function snapshot(): Promise<string> {
  const db = mongoose.connection.db;
  assert.ok(db);
  const names = (await db.listCollections().toArray()).map((collection) => collection.name).sort();
  const dump: Record<string, unknown[]> = {};
  for (const name of names) {
    dump[name] = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
  }
  return JSON.stringify(dump);
}

function realDeps(argv: string[], overrides: Partial<CleanupDeps> = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  const deps: CleanupDeps = {
    // The real evidence, collection listing and raw-collection access.
    ...createCleanupDeps(async () => undefined),
    argv,
    env: { MONGODB_URI: URI, NODE_ENV: 'development' },
    // The connection is shared by the tests in this file and closed in `after`.
    disconnect: async () => undefined,
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    ...overrides,
  };
  return { deps, logs, errors };
}

const ALL_CONFIGS: ReadonlyArray<[string, CleanupConfig]> = [
  ['db:clear-ops', operationalCleanupConfig],
  ['db:reset', fullResetConfig],
  ['db:clear-products-categories', productsAndCategoriesCleanupConfig],
  ['clear-admin-data', adminDataCleanupConfig],
  ['reset-admin', adminResetConfig],
];

before(async () => {
  if (SKIP) return;
  assertLocalUri(URI);
  await mongoose.connect(URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
  assert.equal(mongoose.connection.name, DB_NAME);
  const db = mongoose.connection.db;
  assert.ok(db);
  for (const [name, documents] of Object.entries(FIXTURES)) {
    await db.collection(name).insertMany(documents.map((document) => ({ ...document })));
  }
});

after(async () => {
  if (SKIP) return;
  if (mongoose.connection.readyState === 1) {
    if (mongoose.connection.name === DB_NAME && DB_NAME.startsWith(DB_PREFIX)) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }
});

test('REAL: a MongoDB server on this machine is recognised from what the server itself reports', { skip: SKIP }, async () => {
  const { deps } = realDeps([]);

  const evidence = await deps.describeConnection();

  assert.equal(evidence.databaseName, DB_NAME);
  assert.ok(evidence.connectionHost, 'driver reports the connected host');
  assert.ok(Array.isArray(evidence.serverReportedHosts), 'hello was answered');
  assert.ok(evidence.serverHostname, 'hostInfo was answered');
  assert.equal(evidence.isMongosRouter, false);
  assert.deepEqual(evaluateConnectedTarget(evidence, [os.hostname()]), { safe: true });

  const elsewhere = evaluateConnectedTarget(evidence, ['some-other-machine.local']);
  assert.equal(elsewhere.safe, false, 'the same server is refused when it is not this machine');
});

test('REAL: a dry run of every script reads true counts and changes nothing', { skip: SKIP }, async (t) => {
  for (const [name, config] of ALL_CONFIGS) {
    const before = await snapshot();
    const { deps, logs, errors } = realDeps([]);

    const code = await runGuardedCleanup(config, deps);

    assert.equal(code, 0, `${name}: ${errors.join('\n')}`);
    assert.equal(await snapshot(), before, `${name}: a dry run must not change any document`);
    const report = logs.join('\n');
    assert.match(report, new RegExp(`Connected database : ${DB_NAME}`), name);
    assert.match(report, /Target check       : MongoDB server is on this machine/, name);
    assert.ok(logs.includes('DRY RUN: nothing was deleted or changed.'), name);
    t.diagnostic(`real dry run of ${name}:\n${report}`);
  }
});

test('REAL: db:clear-ops dry run counts the real documents, including the unlisted collection', { skip: SKIP }, async () => {
  const { deps, logs } = realDeps([]);

  assert.equal(await runGuardedCleanup(operationalCleanupConfig, deps), 0);

  const report = logs.join('\n');
  assert.match(report, /Customers \[customers\]\n\s+documents\s+: 2\n/);
  assert.match(report, /Invoices \/ quotations \[invoices\]\n\s+documents\s+: 1\n/);
  assert.match(report, /unlisted collection legacy_things \[legacy_things\]\n\s+documents\s+: 1\n/);
  assert.match(report, /Products \(reservations only\) \[products\]\n\s+documents\s+: 1\n/);
  for (const kept of ['products', 'categories', 'subcategories', 'auditlogs', 'admins', 'storesettings']) {
    assert.doesNotMatch(report, new RegExp(`unlisted collection ${kept} `), `${kept} must not be swept`);
  }
  assert.match(report, /Product catalogue records deleted : no/);
});

test('REAL: the invariants db:clear-ops checks can be read from real documents and are stable', { skip: SKIP }, async () => {
  const before = await snapshot();
  const first: Array<number | string> = [];
  const second: Array<number | string> = [];
  for (const invariant of operationalCleanupConfig.invariants || []) first.push(await invariant.read());
  for (const invariant of operationalCleanupConfig.invariants || []) second.push(await invariant.read());

  assert.deepEqual(second, first);
  assert.deepEqual(first.slice(0, 3), [2, 1, 1], 'product, category and subcategory counts');
  assert.match(String(first[3]), /^[0-9a-f]{64}$/, 'protected product field fingerprint');
  assert.equal(await snapshot(), before);
});

// No attempt below carries a complete, matching confirmation, so even if the
// check under test were broken a second check would still refuse the run.
const WRONG_DATABASE = `${CONFIRM_DATABASE_FLAG}=not-this-database`;

test('REAL: wrong or incomplete confirmations are refused and change nothing', { skip: SKIP }, async () => {
  const attempts: Array<[string, CleanupConfig, string[], RegExp]> = [
    ['db:reset, wrong database name', fullResetConfig, [WRONG_DATABASE, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG], /does not match the connected database/],
    ['db:reset, no acknowledgement', fullResetConfig, [`${CONFIRM_DATABASE_FLAG}=${DB_NAME}`], /Missing --acknowledge-catalogue-deletion/],
    ['db:reset, acknowledgement only', fullResetConfig, [ACKNOWLEDGE_CATALOGUE_DELETION_FLAG], /Missing --confirm-database/],
    ['db:clear-products-categories, no acknowledgement', productsAndCategoriesCleanupConfig, [`${CONFIRM_DATABASE_FLAG}=${DB_NAME}`], /Missing --acknowledge-catalogue-deletion/],
    ['clear-admin-data, no acknowledgement', adminDataCleanupConfig, [`${CONFIRM_DATABASE_FLAG}=${DB_NAME}`], /Missing --acknowledge-catalogue-deletion/],
    ['db:clear-ops, wrong database name', operationalCleanupConfig, [WRONG_DATABASE], /does not match the connected database/],
    ['reset-admin, wrong database name', adminResetConfig, [WRONG_DATABASE], /does not match the connected database/],
    // This script only runs against express_distributors_dev, whatever is confirmed.
    ['clear-local-products-only, other database', localProductsOnlyCleanupConfig, [WRONG_DATABASE, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG], /only runs against the database "express_distributors_dev"/],
  ];
  for (const [label, config, argv, reason] of attempts) {
    const before = await snapshot();
    const { deps, errors } = realDeps(argv);

    const code = await runGuardedCleanup(config, deps);

    assert.equal(code, 1, label);
    const output = errors.join('\n');
    assert.match(output, /REFUSED: .* did not run\. Nothing was deleted or changed\./, label);
    assert.match(output, reason, label);
    assert.equal(await snapshot(), before, `${label}: a refused run must not change any document`);
  }
});

test('REAL: a server that is not this machine is refused by the target check', { skip: SKIP }, async () => {
  for (const [name, config] of ALL_CONFIGS) {
    const before = await snapshot();
    const { deps, errors } = realDeps([WRONG_DATABASE, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG], {
      localHostnames: ['some-other-machine.local'],
    });

    const code = await runGuardedCleanup(config, deps);

    assert.equal(code, 1, name);
    assert.match(errors.join('\n'), /not on this machine/, name);
    assert.equal(await snapshot(), before, `${name}: nothing may change`);
  }
});
