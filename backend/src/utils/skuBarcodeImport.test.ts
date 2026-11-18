/**
 * Excel SKU/barcode import protection. Does not import the script, so the
 * script's main() never runs and no database is contacted.
 *
 * Run with:
 *     npx tsx --test src/utils/skuBarcodeImport.test.ts
 */
import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import Product from '../models/Product';
import {
  applySkuBarcodeChanges,
  planSkuBarcodeUpdates,
  type SkuBarcodeChange,
  type SkuBarcodeProduct,
} from './skuBarcodeImport';

afterEach(() => {
  mock.restoreAll();
});

function item(id: string, fields: Partial<SkuBarcodeProduct> = {}): SkuBarcodeProduct {
  return { id, sku: '', barcode: '', plu: '', ...fields };
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'excel import tests must not open a MongoDB connection');
}

test('an existing SKU is reported and the product is left unchanged', () => {
  assertNoMongoConnection();
  const product = item('p1', { sku: 'KEEP', plu: 'PLU-1' });
  const plan = planSkuBarcodeUpdates([{ product, proposed: 'NEW' }], [product]);

  assert.equal(plan.changes.length, 0);
  assert.deepEqual(plan.conflicts, [
    {
      productId: 'p1',
      field: 'sku',
      existing: 'KEEP',
      proposed: 'NEW',
      reason: 'Existing SKU is not empty and does not match the proposed code.',
    },
  ]);
});

test('an existing barcode is reported and the product is left unchanged', () => {
  assertNoMongoConnection();
  const product = item('p1', { barcode: '111', plu: 'PLU-1' });
  const plan = planSkuBarcodeUpdates([{ product, proposed: '222' }], [product]);

  assert.equal(plan.changes.length, 0);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].productId, 'p1');
  assert.equal(plan.conflicts[0].field, 'barcode');
  assert.equal(plan.conflicts[0].existing, '111');
  assert.equal(plan.conflicts[0].proposed, '222');
  assert.match(plan.conflicts[0].reason, /barcode/);
});

test('an existing SKU and barcode that both differ produce no write', () => {
  assertNoMongoConnection();
  const product = item('p1', { sku: 'KEEP', barcode: '111', plu: 'PLU-1' });
  const plan = planSkuBarcodeUpdates([{ product, proposed: 'NEW' }], [product]);

  assert.equal(plan.changes.length, 0);
  assert.deepEqual(
    plan.conflicts.map((row) => row.field).sort(),
    ['barcode', 'sku']
  );
  for (const row of plan.conflicts) {
    assert.equal(row.productId, 'p1');
    assert.equal(row.proposed, 'NEW');
  }
});

test('PLU is never written and does not block filling an empty sku and barcode', async () => {
  assertNoMongoConnection();
  const product = item('p1', { plu: 'PLU-KEEP' });
  const plan = planSkuBarcodeUpdates([{ product, proposed: '999' }], [product]);

  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.changes[0].before.plu, 'PLU-KEEP');
  assert.equal('plu' in plan.changes[0].set, false);
  assert.deepEqual(plan.changes[0].set, { sku: '999', barcode: '999' });

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

  const result = await applySkuBarcodeChanges(plan.changes);

  assert.deepEqual(result.updated, ['p1']);
  const set = writes[0].update.$set as Record<string, unknown>;
  assert.equal(set.sku, '999');
  assert.equal(set.barcode, '999');
  assert.equal('plu' in set, false);
  assert.equal(writes[0].update.$unset, undefined);
  assert.match(JSON.stringify(writes[0].filter), /PLU-KEEP/);
  assertNoMongoConnection();
});

test('a sku that already matches is kept and only an empty barcode is filled', () => {
  assertNoMongoConnection();
  const product = item('p1', { sku: '999', plu: 'PLU-KEEP' });
  const plan = planSkuBarcodeUpdates([{ product, proposed: '999' }], [product]);

  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(plan.changes[0].set, { barcode: '999' });
  assert.equal(plan.changes[0].before.plu, 'PLU-KEEP');
});

test('duplicate proposed codes conflict and neither product is changed', () => {
  assertNoMongoConnection();
  const first = item('p1');
  const second = item('p2');
  const plan = planSkuBarcodeUpdates(
    [
      { product: first, proposed: 'SAME' },
      { product: second, proposed: 'SAME' },
    ],
    [first, second]
  );

  assert.equal(plan.changes.length, 0);
  assert.equal(plan.conflicts.length, 2);
  assert.deepEqual(
    plan.conflicts.map((row) => row.productId).sort(),
    ['p1', 'p2']
  );
  for (const row of plan.conflicts) {
    assert.equal(row.existing, '');
    assert.equal(row.proposed, 'SAME');
    assert.match(row.reason, /more than one product/);
  }
});

test('a code already stored on another product is a conflict', () => {
  assertNoMongoConnection();
  const first = item('p1');
  const second = item('p2', { sku: 'TAKEN' });
  const plan = planSkuBarcodeUpdates([{ product: first, proposed: 'TAKEN' }], [first, second]);

  assert.equal(plan.changes.length, 0);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].productId, 'p1');
  assert.equal(plan.conflicts[0].proposed, 'TAKEN');
  assert.match(plan.conflicts[0].reason, /p2/);
});

test('a product whose sku and barcode already match is skipped', () => {
  assertNoMongoConnection();
  const product = item('p1', { sku: '999', barcode: '999', plu: 'PLU-KEEP' });
  const plan = planSkuBarcodeUpdates([{ product, proposed: '999' }], [product]);

  assert.equal(plan.changes.length, 0);
  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(plan.skipped, ['p1']);
});

test('a failed excel write is not retried and later products are not attempted', async () => {
  assertNoMongoConnection();
  const first = item('p1', { plu: 'A' });
  const second = item('p2', { plu: 'B' });
  const third = item('p3', { plu: 'C' });
  const plan = planSkuBarcodeUpdates(
    [
      { product: first, proposed: '111' },
      { product: second, proposed: '222' },
      { product: third, proposed: '333' },
    ],
    [first, second, third]
  );
  let calls = 0;
  mock.method(Product, 'findOne', () => ({
    select() {
      return this;
    },
    lean: async () => null,
  }));
  mock.method(Product, 'updateOne', async () => {
    calls += 1;
    if (calls === 1) return { matchedCount: 1, modifiedCount: 1 };
    if (calls === 2) return { matchedCount: 0, modifiedCount: 0 };
    throw new Error('continued after a failed write');
  });

  const result = await applySkuBarcodeChanges(plan.changes);

  assert.deepEqual(result.updated, ['p1']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].productId, 'p2');
  assert.match(result.failed[0].reason, /Not retried/);
  assert.deepEqual(result.notAttempted, ['p3']);
  assert.equal(calls, 2);
  assertNoMongoConnection();
});

test('a write that includes PLU is refused before any update', async () => {
  assertNoMongoConnection();
  let calls = 0;
  mock.method(Product, 'updateOne', async () => {
    calls += 1;
    return { matchedCount: 1, modifiedCount: 1 };
  });
  const forged: SkuBarcodeChange = {
    productId: 'p1',
    before: { sku: '', barcode: '', plu: 'KEEP' },
    set: { plu: 'NO' } as unknown as SkuBarcodeChange['set'],
  };

  const result = await applySkuBarcodeChanges([forged]);

  assert.equal(calls, 0);
  assert.deepEqual(result.updated, []);
  assert.match(result.failed[0].reason, /other than an empty sku or barcode/);
  assertNoMongoConnection();
});

test('the excel script delegates writes to the guarded runner and does not write PLU', () => {
  const source = fs.readFileSync(path.join(__dirname, '../db/apply-sku-barcode-from-excel.ts'), 'utf8');
  const runner = fs.readFileSync(path.join(__dirname, 'skuBarcodeExcelRun.ts'), 'utf8');
  assert.equal(source.includes('updateOne'), false);
  assert.equal(source.includes('applySkuBarcodeChanges'), false);
  assert.equal(source.includes('$unset'), false);
  assert.doesNotMatch(source, /plu:\s*(code|proposed)/);
  assert.match(source, /runSkuBarcodeExcelImport/);
  assert.match(source, /planSkuBarcodeUpdates/);
  const targetGate = runner.indexOf('evaluateTargetBeforeConnect({');
  const connectedGate = runner.indexOf('evaluateConnectedTarget(');
  const confirmation = runner.indexOf('evaluateCleanupRequest({');
  const call = runner.lastIndexOf('applySkuBarcodeChanges(');
  const acquire = runner.indexOf('identifierLock.acquire(');
  assert.ok(targetGate !== -1 && connectedGate > targetGate && confirmation > connectedGate && acquire > confirmation && call > acquire);
  assert.match(runner, /includes\('--apply'\)/);
});
