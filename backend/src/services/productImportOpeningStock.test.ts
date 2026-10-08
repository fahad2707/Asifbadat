/**
 * Phase 2F — CSV import opening stock movements.
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/services/productImportOpeningStock.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import Product from '../models/Product';
import Category from '../models/Category';
import SubCategory from '../models/SubCategory';
import StockMovement from '../models/StockMovement';
import { executeImport } from './productImportService';
import { StockMovementType } from '../shared/enums';
import {
  OPENING_STOCK_REASON,
  OPENING_STOCK_REFERENCE_TYPE,
} from '../utils/openingStockMovement';

const PRODUCT_ID = '64b0000000000000000c0001';
const CATEGORY_ID = '64b0000000000000000a0001';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'import opening-stock tests must not open a MongoDB connection');
}

function csv(body: string): Buffer {
  return Buffer.from(body, 'utf-8');
}

function firstCreateDoc(docs: unknown): Record<string, unknown> {
  return (Array.isArray(docs) ? docs[0] : docs) as Record<string, unknown>;
}

type ImportHarness = {
  created: Record<string, unknown>[];
  movements: Array<{ doc: Record<string, unknown>; options: unknown }>;
  session: {
    startTransaction: ReturnType<typeof mock.fn>;
    commitTransaction: ReturnType<typeof mock.fn>;
    abortTransaction: ReturnType<typeof mock.fn>;
    endSession: ReturnType<typeof mock.fn>;
  };
};

function stubImportHarness(opts: {
  existing?: Array<{ name: string; category_id?: string; sub_category_id?: string }>;
  createdProductType?: string;
} = {}): ImportHarness {
  const created: Record<string, unknown>[] = [];
  const movements: Array<{ doc: Record<string, unknown>; options: unknown }> = [];
  const session = {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };

  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Product, 'distinct', async () => []);
  mock.method(Product, 'findOne', () => ({ lean: async () => null }));
  mock.method(Product, 'find', () => ({
    select: () => ({
      session: () => ({
        lean: async () => opts.existing || [],
      }),
    }),
  }));

  const category = { _id: { toString: () => CATEGORY_ID } };
  mock.method(Category, 'findOne', () => ({
    session: () => ({
      lean: async () => category,
    }),
  }));
  mock.method(SubCategory, 'findOne', () => ({
    session: () => ({
      lean: async () => null,
    }),
  }));
  mock.method(SubCategory, 'create', async () => {
    throw new Error('SubCategory.create must not run in these import tests');
  });

  mock.method(Product, 'create', async (docs: unknown) => {
    const doc = firstCreateDoc(docs);
    const row = {
      ...doc,
      _id: { toString: () => PRODUCT_ID },
      product_type: opts.createdProductType ?? doc.product_type,
    };
    created.push(row);
    return [row];
  });

  mock.method(StockMovement, 'create', async (docs: unknown, options?: unknown) => {
    const doc = firstCreateDoc(docs);
    movements.push({ doc, options });
    return [doc];
  });

  return { created, movements, session };
}

test('F — new inventory import qty 10 writes one opening ADJUSTMENT', async () => {
  assertNoMongoConnection();
  const h = stubImportHarness();
  const result = await executeImport(
    csv('name,price,stock_quantity,category\nWidget,1.99,10,Snacks\n'),
    { skipDuplicatesByNameInSubcategory: true }
  );

  assert.equal(result.imported, 1);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].stock_quantity, 10);
  assert.equal(h.movements.length, 1);
  const movement = h.movements[0].doc;
  assert.equal(movement.movement_type, StockMovementType.ADJUSTMENT);
  assert.equal(movement.quantity_before, 0);
  assert.equal(movement.quantity_change, 10);
  assert.equal(movement.quantity_after, 10);
  assert.equal(movement.reference_type, OPENING_STOCK_REFERENCE_TYPE);
  assert.equal(String(movement.reference_id), PRODUCT_ID);
  assert.equal(movement.reason, OPENING_STOCK_REASON);
  assert.deepEqual(h.movements[0].options, { session: h.session });
});

test('G — duplicate existing product skips stock mutation and movement', async () => {
  assertNoMongoConnection();
  const h = stubImportHarness({
    existing: [{ name: 'Widget', category_id: CATEGORY_ID }],
  });
  const result = await executeImport(
    csv('name,price,stock_quantity,category\nWidget,1.99,10,Snacks\n'),
    { skipDuplicatesByNameInSubcategory: true }
  );

  assert.equal(result.imported, 0);
  assert.equal(result.duplicate_skipped, 1);
  assert.equal(h.created.length, 0);
  assert.equal(h.movements.length, 0);
});

test('H — import qty 0 writes no opening movement', async () => {
  assertNoMongoConnection();
  const h = stubImportHarness();
  const result = await executeImport(
    csv('name,price,stock_quantity,category\nZero Stock,1.99,0,Snacks\n'),
    { skipDuplicatesByNameInSubcategory: true }
  );

  assert.equal(result.imported, 1);
  assert.equal(h.created[0].stock_quantity, 0);
  assert.equal(h.movements.length, 0);
});

test('I — imported service/non_inventory row writes no opening movement', async () => {
  assertNoMongoConnection();
  const h = stubImportHarness({ createdProductType: 'service' });
  const result = await executeImport(
    csv('name,price,stock_quantity,category\nDelivery Fee,5,10,Snacks\n'),
    { skipDuplicatesByNameInSubcategory: true }
  );

  assert.equal(result.imported, 1);
  assert.equal(h.movements.length, 0);

  const serviceSrc = readFileSync(join(process.cwd(), 'src/services/productImportService.ts'), 'utf8');
  assert.match(serviceSrc, /shouldWriteOpeningStockMovement\(/);
  assert.match(serviceSrc, /product_type:\s*'inventory'/);
});
