/**
 * The real cleanup plans, driven through the guarded runner with every
 * Mongoose model method stubbed. No Mongo connection, no Cloudinary call.
 *
 * Run with:
 *     npx tsx --test src/db/cleanupPlans.test.ts
 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { v2 as cloudinary } from 'cloudinary';
import mongoose from 'mongoose';
import {
  FULL_RESET_MODELS,
  LOCAL_PRODUCTS_ONLY_DATABASE,
  OPERATIONAL_KEEP_COLLECTIONS,
  OPERATIONAL_WIPE_MODELS,
  RESET_ADMIN_EMAIL,
  RESET_ADMIN_OLD_EMAIL,
  adminDataCleanupConfig,
  adminResetConfig,
  fullResetConfig,
  localProductsOnlyCleanupConfig,
  operationalCleanupConfig,
  productsAndCategoriesCleanupConfig,
} from './cleanupPlans';
import { runGuardedCleanup, type CleanupConfig, type CleanupDeps } from './cleanupRunner';
import {
  ACKNOWLEDGE_CATALOGUE_DELETION_FLAG,
  CONFIRMATION_FLAGS,
  CONFIRM_DATABASE_FLAG,
  type ConnectedTargetEvidence,
} from './cleanupSafeguards';

const DB = LOCAL_PRODUCTS_ONLY_DATABASE;
const CONFIRM = `${CONFIRM_DATABASE_FLAG}=${DB}`;
const ACK = ACKNOWLEDGE_CATALOGUE_DELETION_FLAG;

const ALL_CONFIGS: ReadonlyArray<[string, CleanupConfig]> = [
  ['db:clear-ops', operationalCleanupConfig],
  ['db:reset', fullResetConfig],
  ['db:clear-products-categories', productsAndCategoriesCleanupConfig],
  ['clear-local-products-only', localProductsOnlyCleanupConfig],
  ['clear-admin-data', adminDataCleanupConfig],
  ['reset-admin', adminResetConfig],
];

/** Scripts whose plan deletes Product, Category or SubCategory records. */
const CATALOGUE_DELETING: ReadonlyArray<[string, CleanupConfig]> = ALL_CONFIGS.filter(([name]) =>
  ['db:reset', 'db:clear-products-categories', 'clear-local-products-only', 'clear-admin-data'].includes(name)
);

const WRITE_METHODS = [
  'deleteMany',
  'deleteOne',
  'findOneAndDelete',
  'findByIdAndDelete',
  'updateMany',
  'updateOne',
  'findOneAndUpdate',
  'findByIdAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'bulkWrite',
  'insertMany',
  'create',
] as const;

type WriteCall = { model: string; method: string; args: unknown[] };

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'plan tests must not open a MongoDB connection');
}

/**
 * Replaces every read and write method on every registered model. Writes are
 * recorded and never reach a database.
 */
function stubModels(
  t: TestContext,
  options: { existingAdmin?: boolean; productSnapshots?: Array<Record<string, unknown>[]> } = {}
) {
  const writes: WriteCall[] = [];
  const product = { _id: 'p1', image_url: 'https://img/p1.png', sku: 'SKU-1', price: 10, cost_price: 6, stock_quantity: 40 };
  const snapshots = options.productSnapshots ? [...options.productSnapshots] : undefined;

  for (const [modelName, model] of Object.entries(mongoose.models)) {
    const target = model as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const method of WRITE_METHODS) {
      t.mock.method(target, method, async (...args: unknown[]) => {
        writes.push({ model: modelName, method, args });
        return { deletedCount: 3, modifiedCount: 2, matchedCount: 2 };
      });
    }
    t.mock.method(target, 'countDocuments', async () => 3);
    t.mock.method(target, 'findOne', async () =>
      modelName === 'Admin' && options.existingAdmin ? { email: RESET_ADMIN_EMAIL } : null
    );
    t.mock.method(target, 'find', () => ({
      select: () => ({
        lean: async () => (snapshots && snapshots.length > 0 ? snapshots.shift() : [product]),
      }),
    }));
  }

  const connection = mongoose.connection as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const method of ['dropDatabase', 'dropCollection']) {
    t.mock.method(connection, method, async (...args: unknown[]) => {
      writes.push({ model: 'connection', method, args });
    });
  }
  return writes;
}

/** Any Cloudinary call that deletes or changes remote assets. */
function stubCloudinaryDeletion(t: TestContext) {
  const calls: string[] = [];
  const record = (name: string) => async () => {
    calls.push(name);
    return {};
  };
  const uploader = cloudinary.uploader as unknown as Record<string, (...args: unknown[]) => unknown>;
  const api = cloudinary.api as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const method of ['destroy', 'upload', 'rename', 'explicit']) {
    t.mock.method(uploader, method, record(`uploader.${method}`));
  }
  for (const method of [
    'delete_resources',
    'delete_resources_by_prefix',
    'delete_resources_by_tag',
    'delete_all_resources',
    'delete_derived_resources',
    'delete_folder',
  ]) {
    t.mock.method(api, method, record(`api.${method}`));
  }
  return calls;
}

function harness(options: {
  argv?: string[];
  env?: CleanupDeps['env'];
  evidence?: Partial<ConnectedTargetEvidence>;
  collections?: string[];
} = {}) {
  const events: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const rawDeletes: string[] = [];
  const rawRequested: string[] = [];
  const deps: CleanupDeps = {
    argv: options.argv || [],
    env: options.env || { MONGODB_URI: `mongodb://127.0.0.1:27017/${DB}`, NODE_ENV: 'development' },
    localHostnames: ['dev-laptop.local'],
    connect: async () => {
      events.push('connect');
    },
    describeConnection: async () => ({
      databaseName: DB,
      connectionHost: '127.0.0.1',
      serverReportedHosts: [],
      serverHostname: 'dev-laptop.local',
      isMongosRouter: false,
      ...options.evidence,
    }),
    disconnect: async () => {
      events.push('disconnect');
    },
    listCollectionNames: async () => options.collections || [],
    rawCollection: (name) => {
      rawRequested.push(name);
      return {
        countDocuments: async () => 5,
        deleteMany: async () => {
          rawDeletes.push(name);
          return { deletedCount: 5 };
        },
      };
    },
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
  };
  return { deps, events, logs, errors, rawDeletes, rawRequested };
}

const modelsWith = (writes: WriteCall[], method: string) =>
  writes.filter((call) => call.method === method).map((call) => call.model);

const modelNames = (models: ReadonlyArray<{ model: { modelName: string } }>) =>
  models.map(({ model }) => model.modelName);

/* ---------------- db:clear-ops ---------------- */

test('db:clear-ops keep and wipe lists protect the catalogue, admins, settings and audit history', () => {
  assertNoMongoConnection();
  assert.deepEqual(
    [...OPERATIONAL_KEEP_COLLECTIONS].sort(),
    ['admins', 'auditlogs', 'categories', 'products', 'storesettings', 'subcategories']
  );
  const wiped = new Set(OPERATIONAL_WIPE_MODELS.map(({ model }) => model.collection.name));
  for (const kept of OPERATIONAL_KEEP_COLLECTIONS) {
    assert.equal(wiped.has(kept), false, `${kept} must not be in the wipe list`);
  }
  assert.doesNotThrow(() => operationalCleanupConfig.preflight?.());
  assert.equal(operationalCleanupConfig.allowsCatalogueDeletion, false);
  assert.equal(operationalCleanupConfig.allowsAuditLogDeletion, false);
});

test('db:clear-ops executed: never deletes Product, Category, SubCategory, AuditLog, Admin or StoreSettings', async (t) => {
  assertNoMongoConnection();
  const writes = stubModels(t);
  const { deps, rawDeletes, rawRequested, logs } = harness({
    argv: [CONFIRM],
    collections: [
      'products',
      'categories',
      'subcategories',
      'auditlogs',
      'admins',
      'storesettings',
      'system.views',
      'customers',
      'legacy_things',
    ],
  });

  const code = await runGuardedCleanup(operationalCleanupConfig, deps);

  assert.equal(code, 0);
  const deleted = modelsWith(writes, 'deleteMany');
  assert.deepEqual(deleted, modelNames(OPERATIONAL_WIPE_MODELS));
  for (const protectedModel of ['Product', 'Category', 'SubCategory', 'AuditLog', 'Admin', 'StoreSettings']) {
    assert.equal(deleted.includes(protectedModel), false, `${protectedModel} must not be deleted`);
  }
  assert.deepEqual(rawRequested, ['legacy_things'], 'kept, listed and system collections are never even opened');
  assert.deepEqual(rawDeletes, ['legacy_things']);
  assert.ok(logs.includes('Operational data cleanup complete.'));
});

test('db:clear-ops executed: the only write to Product resets committed_quantity and nothing else', async (t) => {
  assertNoMongoConnection();
  const writes = stubModels(t);
  const { deps } = harness({ argv: [CONFIRM] });

  assert.equal(await runGuardedCleanup(operationalCleanupConfig, deps), 0);

  const productWrites = writes.filter((call) => call.model === 'Product');
  assert.equal(productWrites.length, 1);
  assert.equal(productWrites[0].method, 'updateMany');
  assert.deepEqual(productWrites[0].args, [
    { committed_quantity: { $ne: 0 } },
    { $set: { committed_quantity: 0 } },
  ]);
  for (const model of ['Category', 'SubCategory', 'AuditLog', 'Admin', 'StoreSettings']) {
    assert.deepEqual(writes.filter((call) => call.model === model), [], `${model} must not be written`);
  }
  const otherMethods = writes.filter((call) => !['deleteMany', 'updateMany'].includes(call.method));
  assert.deepEqual(otherMethods, []);
});

test('db:clear-ops needs no catalogue acknowledgement and reports no catalogue or image deletion', async (t) => {
  assertNoMongoConnection();
  stubModels(t);
  const { deps, logs } = harness();

  assert.equal(await runGuardedCleanup(operationalCleanupConfig, deps), 0);

  const report = logs.join('\n');
  assert.match(report, /Product catalogue records deleted : no/);
  assert.match(report, /Image references affected         : no/);
  assert.match(report, /Products \(reservations only\) \[products\]/);
  assert.match(report, /product catalogue  : YES - field\(s\) committed_quantity modified, records kept/);
  assert.match(report, /To execute, type on this run: npm run db:clear-ops -- --confirm-database=<database name shown above>$/m);
});

test('db:clear-ops fails its safety check if a protected product field changed during the run', async (t) => {
  assertNoMongoConnection();
  const before = [{ _id: 'p1', image_url: 'https://img/p1.png', sku: 'SKU-1', price: 10, cost_price: 6, stock_quantity: 40 }];
  for (const [field, value] of Object.entries({ image_url: '', sku: 'X', price: 0, cost_price: 0, stock_quantity: 0 })) {
    stubModels(t, { productSnapshots: [before, [{ ...before[0], [field]: value }]] });
    const { deps, errors } = harness({ argv: [CONFIRM] });

    const code = await runGuardedCleanup(operationalCleanupConfig, deps);

    assert.equal(code, 1, field);
    assert.match(
      errors.join('\n'),
      /SAFETY CHECK FAILED: Product image_url, sku, price, cost_price and stock_quantity unchanged/,
      field
    );
    t.mock.restoreAll();
  }
});

/* ---------------- dry run, all scripts ---------------- */

test('every script is a dry run by default and performs no delete or update', async (t) => {
  assertNoMongoConnection();
  for (const argv of [[], ['--dry-run'], [CONFIRM, ACK, '--dry-run']]) {
    for (const [name, config] of ALL_CONFIGS) {
      const writes = stubModels(t);
      const { deps, logs, rawDeletes, events } = harness({ argv, collections: ['legacy_things'] });

      const code = await runGuardedCleanup(config, deps);

      assert.equal(code, 0, name);
      assert.deepEqual(writes, [], `${name} must not write during a dry run (${argv.join(' ')})`);
      assert.deepEqual(rawDeletes, [], name);
      assert.ok(logs.includes('DRY RUN: nothing was deleted or changed.'), name);
      assert.deepEqual(events, ['connect', 'disconnect'], name);
      t.mock.restoreAll();
    }
  }
});

test('every dry run reports database, host, collection, count, operation, catalogue and image impact', async (t) => {
  assertNoMongoConnection();
  for (const [name, config] of ALL_CONFIGS) {
    stubModels(t);
    const { deps, logs } = harness();

    await runGuardedCleanup(config, deps);

    const report = logs.join('\n');
    assert.match(report, new RegExp(`Connected database : ${DB}`), name);
    assert.match(report, /Connected host     : 127\.0\.0\.1/, name);
    assert.match(report, /Cloudinary                        : no remote image is deleted by this script/, name);
    const planLines = logs.filter((line) => /^ {2}\d+\. /.test(line));
    assert.ok(planLines.length > 0, name);
    for (const label of ['documents', 'operation', 'product catalogue', 'image references']) {
      const count = logs.filter((line) => line.trimStart().startsWith(`${label} `)).length;
      assert.equal(count, planLines.length, `${name}: every operation reports "${label}"`);
    }
    t.diagnostic(`dry run of ${name}:\n${report}`);
    t.mock.restoreAll();
  }
});

/* ---------------- catalogue-deleting scripts ---------------- */

test('scripts that delete catalogue records refuse without every required acknowledgement', async (t) => {
  assertNoMongoConnection();
  const incomplete = [
    [CONFIRM],
    [ACK],
    [CONFIRM_DATABASE_FLAG, ACK],
    [`${CONFIRM_DATABASE_FLAG}=test`, ACK],
    [`${CONFIRM_DATABASE_FLAG}=`, ACK],
    [CONFIRM, '--yes'],
    [CONFIRM, '--force', '-y'],
  ];
  for (const [name, config] of CATALOGUE_DELETING) {
    for (const argv of incomplete) {
      const writes = stubModels(t);
      const { deps, errors } = harness({ argv });

      const code = await runGuardedCleanup(config, deps);

      assert.equal(code, 1, `${name}: ${argv.join(' ')}`);
      assert.deepEqual(writes, [], `${name}: ${argv.join(' ')}`);
      assert.match(errors.join('\n'), /REFUSED: .* did not run\. Nothing was deleted or changed\./, name);
      t.mock.restoreAll();
    }
  }
});

test('db:reset with both confirmations deletes exactly its documented models', async (t) => {
  assertNoMongoConnection();
  const writes = stubModels(t);
  const { deps, logs } = harness({ argv: [CONFIRM, ACK] });

  assert.equal(await runGuardedCleanup(fullResetConfig, deps), 0);

  assert.deepEqual(modelsWith(writes, 'deleteMany'), modelNames(FULL_RESET_MODELS));
  assert.equal(writes.every((call) => call.method === 'deleteMany'), true);
  for (const model of ['Product', 'Category', 'SubCategory', 'AuditLog', 'Admin', 'StoreSettings']) {
    assert.ok(modelsWith(writes, 'deleteMany').includes(model), `full reset still deletes ${model}`);
  }
  const report = logs.join('\n');
  assert.match(report, /Product catalogue records deleted : YES \(Products, SubCategories, Categories\)/);
  assert.match(report, /Image references affected         : YES \(Products, Categories, StoreSettings\)/);
  assert.match(report, /audit history is permanently lost/);
});

test('db:clear-products-categories with both confirmations deletes only its four collections', async (t) => {
  assertNoMongoConnection();
  const writes = stubModels(t);
  const { deps } = harness({ argv: [CONFIRM, ACK] });

  assert.equal(await runGuardedCleanup(productsAndCategoriesCleanupConfig, deps), 0);

  assert.deepEqual(
    writes.map((call) => `${call.model}.${call.method}`),
    ['CustomerProductPrice.deleteMany', 'Product.deleteMany', 'Category.deleteMany', 'SubCategory.deleteMany']
  );
});

test('clear-local-products-only deletes products only, and only on express_distributors_dev', async (t) => {
  assertNoMongoConnection();
  let writes = stubModels(t);
  const local = harness({ argv: [CONFIRM, ACK] });

  assert.equal(await runGuardedCleanup(localProductsOnlyCleanupConfig, local.deps), 0);
  assert.deepEqual(writes.map((call) => `${call.model}.${call.method}`), ['Product.deleteMany']);
  t.mock.restoreAll();

  for (const databaseName of ['express_distributors', 'test', 'express_distributors_dev2']) {
    writes = stubModels(t);
    const other = harness({
      argv: [`${CONFIRM_DATABASE_FLAG}=${databaseName}`, ACK],
      evidence: { databaseName },
    });

    assert.equal(await runGuardedCleanup(localProductsOnlyCleanupConfig, other.deps), 1, databaseName);
    assert.deepEqual(writes, [], databaseName);
    assert.match(other.errors.join('\n'), /only runs against the database "express_distributors_dev"/);
    t.mock.restoreAll();
  }
});

test('clear-admin-data keeps its scope: six collections, products never deleted', async (t) => {
  assertNoMongoConnection();
  const writes = stubModels(t);
  const { deps, logs } = harness({ argv: [CONFIRM, ACK] });

  assert.equal(await runGuardedCleanup(adminDataCleanupConfig, deps), 0);

  assert.deepEqual(
    writes.map((call) => `${call.model}.${call.method}`),
    [
      'Invoice.deleteMany',
      'Customer.deleteMany',
      'Vendor.deleteMany',
      'Receipt.deleteMany',
      'SubCategory.deleteMany',
      'Category.deleteMany',
    ]
  );
  assert.match(logs.join('\n'), /Product catalogue records deleted : YES \(Sub-categories, Categories\)/);
});

/* ---------------- reset-admin ---------------- */

test('reset-admin touches the Admin collection only, with the same two steps as before', async (t) => {
  assertNoMongoConnection();
  let writes = stubModels(t, { existingAdmin: true });
  const existing = harness({ argv: [CONFIRM] });

  assert.equal(await runGuardedCleanup(adminResetConfig, existing.deps), 0);
  assert.deepEqual(writes.map((call) => `${call.model}.${call.method}`), ['Admin.deleteMany', 'Admin.updateOne']);
  assert.deepEqual(writes[0].args, [{ email: RESET_ADMIN_OLD_EMAIL }]);
  assert.deepEqual(writes[1].args[0], { email: RESET_ADMIN_EMAIL });
  assert.deepEqual(Object.keys(writes[1].args[1] as object).sort(), ['name', 'password_hash', 'role']);
  t.mock.restoreAll();

  writes = stubModels(t, { existingAdmin: false });
  const missing = harness({ argv: [CONFIRM] });

  assert.equal(await runGuardedCleanup(adminResetConfig, missing.deps), 0);
  assert.deepEqual(writes.map((call) => `${call.model}.${call.method}`), ['Admin.deleteMany', 'Admin.create']);
  assert.equal((writes[1].args[0] as { email: string }).email, RESET_ADMIN_EMAIL);
});

/* ---------------- target protection, all scripts ---------------- */

test('every script refuses a production-like target even when NODE_ENV is development and every flag is given', async (t) => {
  assertNoMongoConnection();
  const remoteUris = [
    'mongodb+srv://user:secret@cluster0.example.mongodb.net/test?retryWrites=true&w=majority',
    'mongodb://user:secret@cluster0-shard-00-00.example.mongodb.net:27017/test?ssl=true',
    'mongodb://db.internal.example:27017/express_distributors',
    'mongodb://10.0.0.12:27017/express_distributors_dev',
  ];
  for (const [name, config] of ALL_CONFIGS) {
    for (const uri of remoteUris) {
      const writes = stubModels(t);
      const { deps, events, errors, logs } = harness({
        argv: [CONFIRM, `${CONFIRM_DATABASE_FLAG}=test`, ACK],
        env: { MONGODB_URI: uri, NODE_ENV: 'development' },
      });

      const code = await runGuardedCleanup(config, deps);

      assert.equal(code, 1, `${name}: ${uri}`);
      assert.deepEqual(events, [], `${name} must not connect to ${uri}`);
      assert.deepEqual(writes, [], name);
      assert.match(errors.join('\n'), /No database connection was opened\./, name);
      assert.doesNotMatch(errors.concat(logs).join('\n'), /secret/, name);
      t.mock.restoreAll();
    }
  }
});

test('every script refuses NODE_ENV=production even for a local database', async (t) => {
  assertNoMongoConnection();
  for (const [name, config] of ALL_CONFIGS) {
    const writes = stubModels(t);
    const { deps, events } = harness({
      argv: [CONFIRM, ACK],
      env: { MONGODB_URI: `mongodb://127.0.0.1:27017/${DB}`, NODE_ENV: 'production' },
    });

    assert.equal(await runGuardedCleanup(config, deps), 1, name);
    assert.deepEqual(events, [], name);
    assert.deepEqual(writes, [], name);
    t.mock.restoreAll();
  }
});

test('every script refuses a remote or unverifiable server reached through a local address', async (t) => {
  assertNoMongoConnection();
  const evidences: Array<[string, Partial<ConnectedTargetEvidence>]> = [
    ['tunnel to a replica set', { serverReportedHosts: ['cluster0-shard-00-00.example.mongodb.net:27017'] }],
    ['tunnel to a standalone server', { serverHostname: 'prod-db-01' }],
    ['mongos router', { isMongosRouter: true }],
    ['container hostname', { serverHostname: '3f9a1c2b7d10' }],
    ['server machine unknown', { serverHostname: undefined }],
    ['server hosts unknown', { serverReportedHosts: undefined }],
    ['connected host unknown', { connectionHost: undefined }],
    ['database name unknown', { databaseName: undefined }],
  ];
  for (const [name, config] of ALL_CONFIGS) {
    for (const [label, evidence] of evidences) {
      const writes = stubModels(t);
      const { deps, events, errors } = harness({ argv: [CONFIRM, ACK], evidence });

      const code = await runGuardedCleanup(config, deps);

      assert.equal(code, 1, `${name}: ${label}`);
      assert.deepEqual(writes, [], `${name}: ${label}`);
      assert.deepEqual(events, ['connect', 'disconnect'], `${name}: ${label}`);
      assert.match(errors.join('\n'), /REFUSED/, `${name}: ${label}`);
      t.mock.restoreAll();
    }
  }
});

/* ---------------- Cloudinary ---------------- */

test('no cleanup path calls Cloudinary, even when fully executed', async (t) => {
  assertNoMongoConnection();
  for (const [name, config] of ALL_CONFIGS) {
    const cloudinaryCalls = stubCloudinaryDeletion(t);
    const writes = stubModels(t, { existingAdmin: true });
    const { deps } = harness({ argv: [CONFIRM, ACK], collections: ['legacy_things'] });

    assert.equal(await runGuardedCleanup(config, deps), 0, name);
    assert.ok(writes.length > 0, `${name} was actually executed`);
    assert.deepEqual(cloudinaryCalls, [], `${name} must not call Cloudinary`);
    t.mock.restoreAll();
  }
});

/* ---------------- source contracts ---------------- */

const DB_DIR = __dirname;
const read = (file: string) => fs.readFileSync(path.join(DB_DIR, file), 'utf8');
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ENTRY_POINTS: Record<string, string> = {
  'clear-workflow-data.ts': 'operationalCleanupConfig',
  'clear-all-data.ts': 'fullResetConfig',
  'clear-products-categories.ts': 'productsAndCategoriesCleanupConfig',
  'clear-local-products-only.ts': 'localProductsOnlyCleanupConfig',
  'clear-admin-data.ts': 'adminDataCleanupConfig',
  'reset-admin.ts': 'adminResetConfig',
};

const DESTRUCTIVE_CALL =
  /\.(deleteMany|deleteOne|findOneAndDelete|findByIdAndDelete|findOneAndRemove|findByIdAndRemove|remove|drop|dropDatabase|dropCollection)\(/;

test('every destructive script is only an entry point into the guarded runner', () => {
  for (const [file, configName] of Object.entries(ENTRY_POINTS)) {
    const code = withoutComments(read(file));
    assert.match(
      code,
      new RegExp(`runGuardedCleanup\\(${configName}, createCleanupDeps\\(connectDB\\)\\)`),
      `${file} must run ${configName} through the guarded runner`
    );
    assert.doesNotMatch(code, DESTRUCTIVE_CALL, `${file} must not delete anything itself`);
    assert.doesNotMatch(code, /\.(updateMany|updateOne|bulkWrite|findOneAndUpdate|save|create|insertMany)\(/, file);
    assert.doesNotMatch(code, /connectDB\(\)/, `${file} must not connect outside the runner`);
    assert.doesNotMatch(code, /from '\.\.\/models\//, `${file} must not use models directly`);
    for (const flag of CONFIRMATION_FLAGS) {
      assert.equal(code.includes(flag), false, `${file} must not supply ${flag} itself`);
    }
  }
});

test('delete and drop calls under src/db exist only in the guarded plan and runner modules', () => {
  const allowed = new Set(['cleanupPlans.ts', 'cleanupRunner.ts']);
  const files = fs.readdirSync(DB_DIR).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
  assert.ok(files.includes('seed.ts') && files.includes('clear-all-data.ts'));
  for (const file of files) {
    if (allowed.has(file)) continue;
    assert.doesNotMatch(withoutComments(read(file)), DESTRUCTIVE_CALL, `${file} must not contain a delete or drop call`);
  }
});

test('seed is non-destructive: it does not delete anything or use Product or Category', () => {
  const code = withoutComments(read('seed.ts'));
  assert.doesNotMatch(code, DESTRUCTIVE_CALL);
  assert.doesNotMatch(code, /\.(updateMany|updateOne|bulkWrite|findOneAndUpdate|insertMany)\(/);
  assert.doesNotMatch(code, /models\/(Product|Category|SubCategory)'/);
  assert.match(code, /Admin\.findOne\(\{ email: defaultEmail \}\)/);
  assert.match(code, /if \(!existingAdmin\)/);
});

test('no file under src/db imports or calls Cloudinary', () => {
  const files = fs.readdirSync(DB_DIR).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
  for (const file of files) {
    const code = withoutComments(read(file));
    assert.doesNotMatch(code, /from ['"][^'"]*cloudinary[^'"]*['"]/i, `${file} must not import Cloudinary`);
    assert.doesNotMatch(code, /require\(['"][^'"]*cloudinary[^'"]*['"]\)/i, file);
    assert.doesNotMatch(code, /\.(destroy|delete_resources\w*|delete_all_resources|delete_folder)\(/, file);
  }
});

test('package.json never supplies a destructive confirmation', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(DB_DIR, '..', '..', 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  for (const [name, script] of Object.entries(pkg.scripts)) {
    for (const flag of CONFIRMATION_FLAGS) {
      assert.equal(script.includes(flag), false, `package.json script "${name}" must not contain ${flag}`);
    }
  }
  const expected: Record<string, string> = {
    'db:clear-ops': 'tsx src/db/clear-workflow-data.ts',
    'db:reset': 'tsx src/db/clear-all-data.ts',
    'db:clear-products-categories': 'tsx src/db/clear-products-categories.ts',
    'clear-admin-data': 'tsx src/db/clear-admin-data.ts',
    seed: 'tsx src/db/seed.ts',
  };
  for (const [name, script] of Object.entries(expected)) {
    assert.equal(pkg.scripts[name], script, `"${name}" must pass no arguments of its own`);
  }
  const entryFiles = Object.keys(ENTRY_POINTS);
  for (const [name, script] of Object.entries(pkg.scripts)) {
    const target = entryFiles.find((file) => script.includes(file));
    if (!target) continue;
    assert.equal(script, `tsx src/db/${target}`, `"${name}" must not wrap ${target} with extra arguments`);
  }
});
