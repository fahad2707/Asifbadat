/**
 * Excel SKU/barcode import target gate. The script file is not imported, so
 * its main() never runs and no database is contacted.
 *
 * Run with:
 *     npx tsx --test src/utils/skuBarcodeExcelRun.test.ts
 */
import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Product from '../models/Product';
import type { ConnectedTargetEvidence } from '../db/cleanupSafeguards';
import { runSkuBarcodeExcelImport, type SkuBarcodeExcelDeps, type SkuBarcodeExcelLoad } from './skuBarcodeExcelRun';
import { identifierLock, IdentifierLockHeldError, type IdentifierLockRecord } from './identifierLock';
import type { SkuBarcodeChange } from './skuBarcodeImport';

const DB = 'express_distributors_dev';
const HELD: IdentifierLockRecord = {
  ownerRunId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ownerPid: 4242,
  ownerHost: 'dev-laptop',
  ownerStartedAt: 'Mon Nov 16 08:00:00 2026',
  databaseName: DB,
  purpose: 'sku-barcode-excel',
  acquiredAt: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'excel guard tests must not open a MongoDB connection');
}

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

function fill(productId: string): SkuBarcodeChange {
  return {
    productId,
    before: { sku: '', barcode: '', plu: 'PLU-KEEP' },
    set: { sku: '999', barcode: '999' },
  };
}

function run(options: {
  argv?: string[];
  env?: SkuBarcodeExcelDeps['env'];
  evidence?: Partial<ConnectedTargetEvidence>;
  loaded?: SkuBarcodeExcelLoad;
} = {}) {
  const events: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  let loads = 0;
  const writes: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  mock.method(Product, 'findOne', () => ({
    select() {
      return this;
    },
    lean: async () => null,
  }));
  mock.method(Product, 'updateOne', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    writes.push({ filter, update });
    return { matchedCount: 1, modifiedCount: 1 };
  });
  const deps: SkuBarcodeExcelDeps = {
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
    loadPlan: async () => {
      loads += 1;
      return (
        options.loaded || {
          plan: { changes: [fill('p-empty')], conflicts: [], skipped: [] },
          errors: [],
          skipped: [],
        }
      );
    },
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
  };
  return { deps, events, logs, errors, writes, loads: () => loads };
}

test('a dry run on an unconfirmed database reads the plan and does not write', async () => {
  assertNoMongoConnection();
  for (const argv of [[], ['--apply']]) {
    let acquired = 0;
    mock.method(identifierLock, 'acquire', async () => {
      acquired += 1;
      return HELD;
    });
    const { deps, events, logs, writes, loads } = run({ argv });

    assert.equal(await runSkuBarcodeExcelImport(deps), 0, argv.join(' ') || '(no flags)');

    assert.deepEqual(events, ['connect', 'disconnect']);
    assert.equal(loads(), 1);
    assert.equal(acquired, 0);
    assert.equal(writes.length, 0);
    assert.match(logs.join('\n'), /DRY RUN: no products were changed/);
    mock.restoreAll();
  }
  assertNoMongoConnection();
});

test('--apply on production or an mongodb+srv URI is refused before connecting', async () => {
  assertNoMongoConnection();
  const cases: Array<{ label: string; env: SkuBarcodeExcelDeps['env'] }> = [
    {
      label: 'production',
      env: { MONGODB_URI: `mongodb://127.0.0.1:27017/${DB}`, NODE_ENV: 'production' },
    },
    {
      label: 'srv',
      env: {
        MONGODB_URI: 'mongodb+srv://user:secret@cluster0.example.mongodb.net/test',
        NODE_ENV: 'development',
      },
    },
  ];
  for (const item of cases) {
    const { deps, events, errors, writes, loads } = run({
      argv: ['--apply', `--confirm-database=${DB}`],
      env: item.env,
    });

    assert.equal(await runSkuBarcodeExcelImport(deps), 1, item.label);

    assert.deepEqual(events, [], item.label);
    assert.equal(loads(), 0, item.label);
    assert.equal(writes.length, 0, item.label);
    assert.match(errors.join('\n'), /No database connection was opened/);
    assert.doesNotMatch(errors.join('\n'), /secret/);
    mock.restoreAll();
  }
  assertNoMongoConnection();
});

test('--apply on an uncertain server is refused after connecting and before any product read', async () => {
  assertNoMongoConnection();
  const { deps, events, writes, loads } = run({
    argv: ['--apply', `--confirm-database=${DB}`],
    evidence: { serverHostname: undefined },
  });

  assert.equal(await runSkuBarcodeExcelImport(deps), 1);

  assert.deepEqual(events, ['connect', 'disconnect']);
  assert.equal(loads(), 0);
  assert.equal(writes.length, 0);
  assertNoMongoConnection();
});

test('an authorized local run writes only the approved fills and leaves conflicts unchanged', async () => {
  assertNoMongoConnection();
  const order: string[] = [];
  mock.method(identifierLock, 'acquire', async () => {
    order.push('acquire');
    return HELD;
  });
  mock.method(identifierLock, 'release', async () => {
    order.push('release');
    return true;
  });
  const conflict = {
    productId: 'p-keep',
    field: 'sku' as const,
    existing: 'KEEP',
    proposed: '999',
    reason: 'Existing SKU is not empty and does not match the proposed code.',
  };
  const { deps, writes, loads } = run({
    argv: ['--apply', `--confirm-database=${DB}`],
    loaded: {
      plan: { changes: [fill('p-empty')], conflicts: [conflict], skipped: [] },
      errors: [],
      skipped: [],
    },
  });
  const originalLoad = deps.loadPlan;
  deps.loadPlan = async () => {
    order.push('plan');
    return originalLoad();
  };

  assert.equal(await runSkuBarcodeExcelImport(deps), 0);

  assert.equal(loads(), 1);
  assert.deepEqual(order, ['acquire', 'plan', 'release']);
  assert.deepEqual(
    writes.map((write) => write.filter._id),
    ['p-empty']
  );
  const set = writes[0].update.$set as Record<string, unknown>;
  assert.equal(set.sku, '999');
  assert.equal(set.barcode, '999');
  assert.equal('plu' in set, false);
  assert.equal(writes[0].update.$unset, undefined);
  assert.match(JSON.stringify(writes[0].filter), /PLU-KEEP/);
  assertNoMongoConnection();
});

test('a wrong database confirmation refuses --apply', async () => {
  assertNoMongoConnection();
  const { deps, writes, loads } = run({ argv: ['--apply', '--confirm-database=test'] });

  assert.equal(await runSkuBarcodeExcelImport(deps), 1);

  assert.equal(loads(), 1);
  assert.equal(writes.length, 0);
  assertNoMongoConnection();
});

test('a failed excel lock acquisition performs no product reads or writes', async () => {
  assertNoMongoConnection();
  mock.method(identifierLock, 'acquire', async () => {
    throw new IdentifierLockHeldError(HELD);
  });
  const { deps, writes, loads, errors } = run({ argv: ['--apply', `--confirm-database=${DB}`] });

  assert.equal(await runSkuBarcodeExcelImport(deps), 1);
  assert.equal(loads(), 0);
  assert.equal(writes.length, 0);
  assert.match(errors.join('\n'), /already locked/);
  assertNoMongoConnection();
});
