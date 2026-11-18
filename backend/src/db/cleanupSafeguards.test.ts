/**
 * Cleanup safeguards — pure decision logic, no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/db/cleanupSafeguards.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog';
import Category from '../models/Category';
import Product from '../models/Product';
import SubCategory from '../models/SubCategory';
import {
  ACKNOWLEDGE_CATALOGUE_DELETION_FLAG,
  AUDIT_LOG_COLLECTION,
  CATALOGUE_COLLECTIONS,
  CONFIRM_DATABASE_FLAG,
  CleanupSafeguardError,
  DRY_RUN_FLAG,
  PROTECTED_PRODUCT_FIELDS,
  assertCleanupPreservesAuditLog,
  assertCleanupPreservesCatalogue,
  assertOperationalCleanupIsSafe,
  catalogueFieldFingerprint,
  describeMongoUri,
  evaluateCleanupRequest,
  evaluateConnectedTarget,
  evaluateTargetBeforeConnect,
  isLocalHost,
  isProtectedFromOperationalCleanup,
  type ConnectedTargetEvidence,
} from './cleanupSafeguards';

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'safeguard tests must not open a MongoDB connection');
}

const otherModel = { collection: { name: 'customers' } };
const fullKeep = ['products', 'categories', 'subcategories', 'admins', 'storesettings', 'auditlogs'];
const LOCAL = ['dev-laptop.local'];

function reason(decision: { safe: boolean } | { mode: string }): string {
  return (decision as { reason?: string }).reason || '';
}

/* ---------------- protected collections ---------------- */

test('protected collections are auditlogs, products, categories and subcategories', () => {
  assertNoMongoConnection();
  assert.equal(AUDIT_LOG_COLLECTION, 'auditlogs');
  assert.equal(AUDIT_LOG_COLLECTION, AuditLog.collection.name);
  assert.deepEqual([...CATALOGUE_COLLECTIONS], ['products', 'categories', 'subcategories']);
  assert.deepEqual(
    [...CATALOGUE_COLLECTIONS],
    [Product.collection.name, Category.collection.name, SubCategory.collection.name]
  );
  for (const name of ['auditlogs', 'products', 'categories', 'subcategories']) {
    assert.equal(isProtectedFromOperationalCleanup(name), true, name);
  }
  assert.equal(isProtectedFromOperationalCleanup('customers'), false);
  assert.deepEqual([...PROTECTED_PRODUCT_FIELDS], ['image_url', 'sku', 'price', 'cost_price', 'stock_quantity']);
});

test('operational plan with catalogue and audit history kept is accepted', () => {
  assertNoMongoConnection();
  assert.doesNotThrow(() =>
    assertOperationalCleanupIsSafe({
      wipeModels: [{ name: 'Customers', model: otherModel }],
      keepCollections: new Set(fullKeep),
    })
  );
});

test('operational plan that wipes AuditLog is refused', () => {
  assertNoMongoConnection();
  for (const model of [AuditLog, { collection: { name: 'auditlogs' } }]) {
    const plan = { wipeModels: [{ name: 'Audit logs', model }], keepCollections: new Set(fullKeep) };
    assert.throws(
      () => assertCleanupPreservesAuditLog(plan),
      (err: unknown) => err instanceof CleanupSafeguardError && /would delete audit history/.test(err.message)
    );
    assert.throws(() => assertOperationalCleanupIsSafe(plan), CleanupSafeguardError);
  }
});

test('operational plan whose keep list omits auditlogs is refused', () => {
  assertNoMongoConnection();
  const plan = {
    wipeModels: [{ name: 'Customers', model: otherModel }],
    keepCollections: new Set(fullKeep.filter((name) => name !== 'auditlogs')),
  };
  assert.throws(
    () => assertOperationalCleanupIsSafe(plan),
    (err: unknown) => err instanceof CleanupSafeguardError && /"auditlogs" must be in the keep list/.test(err.message)
  );
});

test('operational plan that wipes Product, Category or SubCategory is refused', () => {
  assertNoMongoConnection();
  const cases: Array<[string, unknown, string]> = [
    ['Products', Product, 'products'],
    ['Categories', Category, 'categories'],
    ['SubCategories', SubCategory, 'subcategories'],
    ['Alias of products', { collection: { name: 'products' } }, 'products'],
  ];
  for (const [name, model, collection] of cases) {
    const plan = { wipeModels: [{ name, model }], keepCollections: new Set(fullKeep) };
    const check = (err: unknown) =>
      err instanceof CleanupSafeguardError &&
      err.message.includes(`"${name}" would delete product catalogue records (${collection})`);
    assert.throws(() => assertCleanupPreservesCatalogue(plan), check);
    assert.throws(() => assertOperationalCleanupIsSafe(plan), check);
  }
});

test('operational plan whose keep list omits a catalogue collection is refused', () => {
  assertNoMongoConnection();
  for (const missing of ['products', 'categories', 'subcategories']) {
    const plan = {
      wipeModels: [{ name: 'Customers', model: otherModel }],
      keepCollections: new Set(fullKeep.filter((name) => name !== missing)),
    };
    assert.throws(
      () => assertOperationalCleanupIsSafe(plan),
      (err: unknown) =>
        err instanceof CleanupSafeguardError && err.message.includes(`"${missing}" must be in the keep list`)
    );
  }
});

/* ---------------- target gate before connecting ---------------- */

test('local MongoDB URIs pass the pre-connection gate', () => {
  assertNoMongoConnection();
  const uris = [
    undefined,
    '',
    'mongodb://localhost:27017/express_distributors',
    'mongodb://127.0.0.1:27017/express_distributors_dev',
    'mongodb://user:p%40ss@127.0.0.1:27017/dev?authSource=admin',
    'mongodb://[::1]:27017/dev',
    'mongodb://localhost:27017,127.0.0.1:27018/dev?replicaSet=rs0',
    'mongodb://dev-laptop.local:27017/dev',
  ];
  for (const uri of uris) {
    assert.deepEqual(
      evaluateTargetBeforeConnect({ uri, nodeEnv: 'development', localHostnames: LOCAL }),
      { safe: true },
      String(uri)
    );
  }
});

test('remote targets are refused before connecting even when NODE_ENV is development', () => {
  assertNoMongoConnection();
  const uris = [
    'mongodb+srv://user:secret@cluster0.example.mongodb.net/test?retryWrites=true',
    'mongodb://user:secret@cluster0-shard-00-00.example.mongodb.net:27017/test',
    'mongodb://db.internal.example:27017/express_distributors',
    'mongodb://10.0.0.12:27017/express_distributors',
    'mongodb://192.168.1.20:27017/express_distributors',
    'mongodb://localhost:27017,db.internal.example:27017/express_distributors',
    'mongodb+srv://localhost/express_distributors',
  ];
  for (const nodeEnv of ['development', 'test', undefined, '']) {
    for (const uri of uris) {
      const decision = evaluateTargetBeforeConnect({ uri, nodeEnv, localHostnames: LOCAL });
      assert.equal(decision.safe, false, `${uri} with NODE_ENV=${nodeEnv}`);
      assert.doesNotMatch(reason(decision), /secret/, 'credentials must never appear in a refusal');
    }
  }
});

test('NODE_ENV=production is refused before connecting even for a local URI', () => {
  assertNoMongoConnection();
  for (const nodeEnv of ['production', 'PRODUCTION', ' production ']) {
    const decision = evaluateTargetBeforeConnect({ uri: 'mongodb://localhost:27017/dev', nodeEnv });
    assert.equal(decision.safe, false);
    assert.match(reason(decision), /production/);
  }
});

test('connection strings that cannot be understood fail closed', () => {
  assertNoMongoConnection();
  for (const uri of ['localhost:27017/dev', 'postgres://localhost/dev', 'mongodb://', 'mongodb:///dev', 'not a uri']) {
    const decision = evaluateTargetBeforeConnect({ uri, nodeEnv: 'development' });
    assert.equal(decision.safe, false, uri);
  }
  assert.equal(describeMongoUri('mongodb://'), null);
  assert.deepEqual(describeMongoUri('mongodb://a:b@h1:1,h2:2/db'), { srv: false, hosts: ['h1:1', 'h2:2'] });
  assert.deepEqual(describeMongoUri('mongodb://user:p@ss@host.example/db'), { srv: false, hosts: ['host.example'] });
});

test('isLocalHost accepts loopback and this machine only', () => {
  assertNoMongoConnection();
  for (const host of ['localhost', 'LOCALHOST:27017', '127.0.0.1', '127.0.0.1:27947', '::1', '[::1]:27017']) {
    assert.equal(isLocalHost(host), true, host);
  }
  assert.equal(isLocalHost('dev-laptop.local:27017', LOCAL), true);
  for (const host of ['', 'example.com', '10.0.0.1', '0.0.0.0', 'localhost.example.com', 'mongo', 'dev-laptop']) {
    assert.equal(isLocalHost(host, LOCAL), false, host);
  }
});

/* ---------------- target gate after connecting ---------------- */

function localEvidence(overrides: Partial<ConnectedTargetEvidence> = {}): ConnectedTargetEvidence {
  return {
    databaseName: 'express_distributors_dev',
    connectionHost: '127.0.0.1',
    serverReportedHosts: [],
    serverHostname: 'dev-laptop.local',
    isMongosRouter: false,
    ...overrides,
  };
}

test('a MongoDB server on this machine passes the post-connection gate', () => {
  assertNoMongoConnection();
  assert.deepEqual(evaluateConnectedTarget(localEvidence(), LOCAL), { safe: true });
  assert.deepEqual(
    evaluateConnectedTarget(localEvidence({ serverReportedHosts: ['127.0.0.1:27947', '127.0.0.1:27947'] }), LOCAL),
    { safe: true }
  );
  assert.deepEqual(
    evaluateConnectedTarget(
      localEvidence({ connectionHost: 'localhost', serverReportedHosts: ['dev-laptop.local:27017'] }),
      LOCAL
    ),
    { safe: true }
  );
  assert.deepEqual(
    evaluateConnectedTarget(localEvidence({ serverHostname: 'DEV-LAPTOP.lan' }), LOCAL),
    { safe: true },
    'the short machine name is compared, so a changed network suffix does not matter'
  );
});

test('a remote database reached through localhost (tunnel or port-forward) is refused', () => {
  assertNoMongoConnection();
  const replicaSetBehindTunnel = evaluateConnectedTarget(
    localEvidence({
      serverReportedHosts: ['cluster0-shard-00-00.example.mongodb.net:27017'],
      serverHostname: 'atlas-abc123-shard-00-00',
    }),
    LOCAL
  );
  assert.equal(replicaSetBehindTunnel.safe, false);
  assert.match(reason(replicaSetBehindTunnel), /identifies itself as/);

  const standaloneBehindTunnel = evaluateConnectedTarget(
    localEvidence({ serverReportedHosts: [], serverHostname: 'prod-db-01' }),
    LOCAL
  );
  assert.equal(standaloneBehindTunnel.safe, false);
  assert.match(reason(standaloneBehindTunnel), /runs on "prod-db-01", not on this machine/);

  const mongos = evaluateConnectedTarget(localEvidence({ isMongosRouter: true }), LOCAL);
  assert.equal(mongos.safe, false);
  assert.match(reason(mongos), /mongos router/);
});

test('a non-local connected host is refused', () => {
  assertNoMongoConnection();
  const decision = evaluateConnectedTarget(localEvidence({ connectionHost: 'db.internal.example' }), LOCAL);
  assert.equal(decision.safe, false);
  assert.match(reason(decision), /not this machine/);
});

test('uncertain targets fail closed', () => {
  assertNoMongoConnection();
  const uncertain: Array<[string, Partial<ConnectedTargetEvidence>, readonly string[]]> = [
    ['unknown database name', { databaseName: undefined }, LOCAL],
    ['blank database name', { databaseName: '  ' }, LOCAL],
    ['unknown connected host', { connectionHost: undefined }, LOCAL],
    ['server did not report hosts', { serverReportedHosts: undefined }, LOCAL],
    ['server did not report its machine', { serverHostname: undefined }, LOCAL],
    ['blank server machine', { serverHostname: '' }, LOCAL],
    ['container hostname', { serverHostname: '3f9a1c2b7d10' }, LOCAL],
    ['this machine hostname unknown', {}, []],
  ];
  for (const [label, overrides, localHostnames] of uncertain) {
    const decision = evaluateConnectedTarget(localEvidence(overrides), localHostnames);
    assert.equal(decision.safe, false, label);
    assert.ok(reason(decision).length > 0, label);
  }
});

/* ---------------- per-run confirmation ---------------- */

const DB = 'express_distributors_dev';
const confirm = `${CONFIRM_DATABASE_FLAG}=${DB}`;

test('no confirmation flags means dry run, for every kind of script', () => {
  assertNoMongoConnection();
  for (const deletesCatalogue of [true, false]) {
    for (const argv of [[], ['--verbose'], [DRY_RUN_FLAG]]) {
      assert.deepEqual(evaluateCleanupRequest({ argv, databaseName: DB, deletesCatalogue }), { mode: 'dry-run' });
    }
  }
});

test('--dry-run wins over complete confirmations', () => {
  assertNoMongoConnection();
  assert.deepEqual(
    evaluateCleanupRequest({
      argv: [confirm, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG, DRY_RUN_FLAG],
      databaseName: DB,
      deletesCatalogue: true,
    }),
    { mode: 'dry-run' }
  );
});

test('a script that does not delete catalogue records executes with the database confirmation alone', () => {
  assertNoMongoConnection();
  assert.deepEqual(
    evaluateCleanupRequest({ argv: [confirm], databaseName: DB, deletesCatalogue: false }),
    { mode: 'execute' }
  );
});

test('catalogue deletion is refused without every required acknowledgement', () => {
  assertNoMongoConnection();
  const incomplete: Array<[string[], RegExp]> = [
    [[confirm], /Missing --acknowledge-catalogue-deletion/],
    [[ACKNOWLEDGE_CATALOGUE_DELETION_FLAG], /Missing --confirm-database=<database name>/],
    [[CONFIRM_DATABASE_FLAG, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG], /Missing --confirm-database=<database name>/],
    [[`${CONFIRM_DATABASE_FLAG}=test`, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG], /does not match the connected database/],
    [[`${CONFIRM_DATABASE_FLAG}=`, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG], /does not match the connected database/],
    [[`${CONFIRM_DATABASE_FLAG}=EXPRESS_DISTRIBUTORS_DEV`, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG], /does not match/],
    [[confirm, `${CONFIRM_DATABASE_FLAG}=test`, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG], /does not match/],
    [[confirm, `${ACKNOWLEDGE_CATALOGUE_DELETION_FLAG}=no`], /Missing --acknowledge-catalogue-deletion/],
    [[confirm, '--yes', '--force'], /Missing --acknowledge-catalogue-deletion/],
  ];
  for (const [argv, pattern] of incomplete) {
    const decision = evaluateCleanupRequest({ argv, databaseName: DB, deletesCatalogue: true });
    assert.equal(decision.mode, 'refused', argv.join(' '));
    assert.match(reason(decision), pattern, argv.join(' '));
  }
});

test('catalogue deletion executes only with the database confirmation and the acknowledgement', () => {
  assertNoMongoConnection();
  assert.deepEqual(
    evaluateCleanupRequest({
      argv: [confirm, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG],
      databaseName: DB,
      deletesCatalogue: true,
    }),
    { mode: 'execute' }
  );
});

test('a confirmation is refused when the database name is unknown', () => {
  assertNoMongoConnection();
  for (const databaseName of [undefined, '', '   ']) {
    const decision = evaluateCleanupRequest({
      argv: [`${CONFIRM_DATABASE_FLAG}=`, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG],
      databaseName,
      deletesCatalogue: true,
    });
    assert.equal(decision.mode, 'refused');
  }
});

test('a confirmation stored in the package.json script is refused, even if also typed', () => {
  assertNoMongoConnection();
  const baked = [
    `tsx src/db/clear-all-data.ts ${confirm} ${ACKNOWLEDGE_CATALOGUE_DELETION_FLAG}`,
    `tsx src/db/clear-all-data.ts ${ACKNOWLEDGE_CATALOGUE_DELETION_FLAG}`,
    `tsx src/db/clear-workflow-data.ts ${confirm}`,
  ];
  for (const npmLifecycleScript of baked) {
    for (const argv of [[], [confirm, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG]]) {
      const decision = evaluateCleanupRequest({ argv, databaseName: DB, deletesCatalogue: true, npmLifecycleScript });
      assert.equal(decision.mode, 'refused', npmLifecycleScript);
      assert.match(reason(decision), /stored in the package\.json script/);
    }
  }
  assert.deepEqual(
    evaluateCleanupRequest({
      argv: [confirm, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG],
      databaseName: DB,
      deletesCatalogue: true,
      npmLifecycleScript: 'tsx src/db/clear-all-data.ts',
    }),
    { mode: 'execute' }
  );
});

/* ---------------- catalogue fingerprint ---------------- */

test('catalogue fingerprint ignores order and unprotected fields but detects any protected change', () => {
  assertNoMongoConnection();
  const a = { _id: 'a', image_url: 'https://img/a.png', sku: 'A-1', price: 9.99, cost_price: 4, stock_quantity: 12 };
  const b = { _id: 'b', image_url: 'https://img/b.png', sku: 'B-1', price: 5, cost_price: 2, stock_quantity: 0 };
  const base = catalogueFieldFingerprint([a, b]);

  assert.equal(catalogueFieldFingerprint([b, a]), base);
  assert.equal(catalogueFieldFingerprint([{ ...a, committed_quantity: 0, name: 'renamed' }, b]), base);

  for (const [field, value] of Object.entries({
    image_url: 'https://img/other.png',
    sku: 'A-2',
    price: 10,
    cost_price: 5,
    stock_quantity: 11,
  })) {
    assert.notEqual(catalogueFieldFingerprint([{ ...a, [field]: value }, b]), base, field);
  }
  assert.notEqual(catalogueFieldFingerprint([{ ...a, image_url: undefined }, b]), base, 'image_url removed');
  assert.notEqual(catalogueFieldFingerprint([a]), base, 'product removed');
});
