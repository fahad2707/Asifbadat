/**
 * Exclusive product-identifier lock. Uses an in-memory collection, not MongoDB.
 *
 * Run with:
 *     npx tsx --test src/utils/identifierLock.test.ts
 */
import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import Product from '../models/Product';
import { connectedTarget } from '../db/cleanupRunner';
import { migrationRuntime } from './productCodes';
import { migrationJournal } from './migrationJournal';
import { runProductCodeBackfill } from './productCodeBackfill';
import { runSkuBarcodeExcelImport } from './skuBarcodeExcelRun';
import {
  acquireIdentifierLock,
  decideManualRelease,
  identifierLock,
  PRODUCT_IDENTIFIER_LOCK_ID,
  releaseIdentifierLock,
  type IdentifierLockPurpose,
  type IdentifierLockStore,
  type ProcessIdentity,
} from './identifierLock';
import { classifyIdentifierRecovery, type MigrationJournalEntry } from './migrationJournal';

function memoryStore(): IdentifierLockStore & { current(): Parameters<IdentifierLockStore['insertOne']>[0] | null } {
  let doc: Parameters<IdentifierLockStore['insertOne']>[0] | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    current: () => doc,
    insertOne(next) {
      const run = chain.then(() => {
        if (doc) {
          const error = new Error('E11000 duplicate key') as Error & { code: number };
          error.code = 11000;
          throw error;
        }
        doc = next;
      });
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
    async findOne() {
      return doc;
    },
    async deleteOne(filter) {
      if (doc && doc._id === filter._id && doc.ownerRunId === filter.ownerRunId) {
        doc = null;
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },
  };
}

const identity: ProcessIdentity = {
  pid: () => 50,
  host: () => 'dev-laptop',
  isAlive: () => false,
  startedAt: async () => 'Mon Nov 16 08:00:00 2026',
};

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'lock tests must not open a MongoDB connection');
}

test('two simultaneous acquisitions succeed exactly once', async () => {
  assertNoMongoConnection();
  const store = memoryStore();
  const results = await Promise.allSettled([
    acquireIdentifierLock(store, { databaseName: 'express_distributors_dev', purpose: 'product-code-migration' }, identity),
    acquireIdentifierLock(store, { databaseName: 'express_distributors_dev', purpose: 'sku-barcode-excel' }, identity),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.match(String(rejected.reason), /already locked/);
  assert.equal(store.current()?._id, PRODUCT_IDENTIFIER_LOCK_ID);
  assertNoMongoConnection();
});

test('a non-owner cannot release the lock and the owner can', async () => {
  assertNoMongoConnection();
  const store = memoryStore();
  const lock = await acquireIdentifierLock(
    store,
    { databaseName: 'express_distributors_dev', purpose: 'product-code-migration' },
    identity
  );
  const stranger = await releaseIdentifierLock(store, { ownerRunId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
  assert.equal(stranger, false);
  assert.equal(store.current()?.ownerRunId, lock.ownerRunId);
  const owner = await releaseIdentifierLock(store, lock);
  assert.equal(owner, true);
  assert.equal(store.current(), null);
  assertNoMongoConnection();
});

test('an active owner blocks recovery and an unverifiable owner blocks recovery', async () => {
  assertNoMongoConnection();
  const lock = {
    ownerRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ownerPid: 77,
    ownerHost: 'dev-laptop',
    ownerStartedAt: 'Mon Nov 16 08:00:00 2026',
    databaseName: 'express_distributors_dev',
    purpose: 'product-code-migration' as IdentifierLockPurpose,
    acquiredAt: '2026-01-01T00:00:00.000Z',
  };
  const active = await decideManualRelease({
    lock,
    databaseName: lock.databaseName,
    ownerRunId: lock.ownerRunId,
    localHost: 'dev-laptop',
    isAlive: () => true,
    startedAt: async () => lock.ownerStartedAt,
  });
  assert.equal(active.allow, false);
  assert.match(active.reason, /same live process/);

  const unverifiable = await decideManualRelease({
    lock,
    databaseName: lock.databaseName,
    ownerRunId: lock.ownerRunId,
    localHost: 'dev-laptop',
    isAlive: () => true,
    startedAt: async () => null,
  });
  assert.equal(unverifiable.allow, false);
  assert.match(unverifiable.reason, /could not be verified/);

  const otherMachine = await decideManualRelease({
    lock,
    databaseName: lock.databaseName,
    ownerRunId: lock.ownerRunId,
    localHost: 'other-machine',
    isAlive: () => false,
    startedAt: async () => null,
  });
  assert.equal(otherMachine.allow, false);
  assert.match(otherMachine.reason, /cannot be verified/);

  const dead = await decideManualRelease({
    lock,
    databaseName: lock.databaseName,
    ownerRunId: lock.ownerRunId,
    localHost: 'dev-laptop',
    isAlive: () => false,
    startedAt: async () => null,
  });
  assert.equal(dead.allow, true);
  assertNoMongoConnection();
});

test('journal recovery classifies completed, not completed, and uncertain without writing', () => {
  assertNoMongoConnection();
  const entry: MigrationJournalEntry = {
    id: 'p1',
    before: { product_id: '', sku: '' },
    set: { product_id: '10001', sku: '012345678905' },
  };
  assert.equal(
    classifyIdentifierRecovery(entry, { product_id: '10001', sku: '012345678905' }),
    'completed'
  );
  assert.equal(
    classifyIdentifierRecovery(entry, { product_id: '', sku: '' }),
    'not_completed'
  );
  assert.equal(
    classifyIdentifierRecovery(entry, { product_id: '10001', sku: 'SOMETHING-ELSE' }),
    'uncertain'
  );
  assert.equal(classifyIdentifierRecovery(entry, null), 'uncertain');
  assertNoMongoConnection();
});

const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'identifier-lock-journal-'));

afterEach(() => {
  mock.restoreAll();
});

test('a held lock stops both an approved migration and an excel apply before either writes', async () => {
  assertNoMongoConnection();
  const store = memoryStore();
  await acquireIdentifierLock(
    store,
    { databaseName: 'express_distributors_dev', purpose: 'product-code-migration' },
    identity
  );
  mock.method(identifierLock, 'store', () => store);
  mock.method(migrationJournal, 'directory', () => journalDir);
  mock.method(migrationRuntime, 'uri', () => 'mongodb://127.0.0.1:27017/express_distributors_dev');
  mock.method(migrationRuntime, 'nodeEnv', () => 'development');
  mock.method(migrationRuntime, 'localHostnames', () => [os.hostname()]);
  mock.method(connectedTarget, 'read', async () => ({
    databaseName: 'express_distributors_dev',
    connectionHost: '127.0.0.1',
    serverReportedHosts: [] as string[],
    serverHostname: os.hostname(),
    isMongosRouter: false,
  }));
  let writes = 0;
  let plans = 0;
  mock.method(Product, 'find', () => ({
    select: () => ({
      lean: async () => {
        plans += 1;
        return [];
      },
    }),
  }));
  mock.method(Product, 'updateOne', async () => {
    writes += 1;
    return { matchedCount: 1, modifiedCount: 1 };
  });

  const migration = await runProductCodeBackfill({
    argv: ['--confirm-database=express_distributors_dev'],
    env: { MONGODB_URI: 'mongodb://127.0.0.1:27017/express_distributors_dev', NODE_ENV: 'development' },
    localHostnames: ['dev-laptop.local'],
    connect: async () => undefined,
    readEvidence: async () => ({
      databaseName: 'express_distributors_dev',
      connectionHost: '127.0.0.1',
      serverReportedHosts: [],
      serverHostname: 'dev-laptop.local',
      isMongosRouter: false,
    }),
    disconnect: async () => undefined,
    log: () => undefined,
    error: () => undefined,
  });
  let excelPlans = 0;
  const excel = await runSkuBarcodeExcelImport({
    argv: ['--apply', '--confirm-database=express_distributors_dev'],
    env: { MONGODB_URI: 'mongodb://127.0.0.1:27017/express_distributors_dev', NODE_ENV: 'development' },
    localHostnames: ['dev-laptop.local'],
    connect: async () => undefined,
    readEvidence: async () => ({
      databaseName: 'express_distributors_dev',
      connectionHost: '127.0.0.1',
      serverReportedHosts: [],
      serverHostname: 'dev-laptop.local',
      isMongosRouter: false,
    }),
    disconnect: async () => undefined,
    loadPlan: async () => {
      excelPlans += 1;
      return { plan: { changes: [], conflicts: [], skipped: [] }, errors: [], skipped: [] };
    },
    log: () => undefined,
    error: () => undefined,
  });

  assert.equal(migration, 1);
  assert.equal(excel, 1);
  assert.equal(plans, 0);
  assert.equal(excelPlans, 0);
  assert.equal(writes, 0);
  assert.equal(store.current()?.purpose, 'product-code-migration');
  assertNoMongoConnection();
});
