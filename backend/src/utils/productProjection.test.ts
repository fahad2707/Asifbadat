/**
 * Task 03 regression tests for the product response boundary.
 *
 * Uses only Node's built-in `node:test` + `node:assert` — no new test-framework
 * dependencies. Run with:
 *     npx tsx --test src/utils/productProjection.test.ts
 *
 * These tests protect the invariant that customer-facing product responses
 * never contain purchase costs, supplier information, or other internal
 * fields, regardless of how the underlying document is populated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toPublicProduct,
  toStaffProduct,
  INTERNAL_PRODUCT_FIELDS,
  type RawProductDoc,
} from './productProjection';

// A synthetic document that carries every internal field with distinctive
// values so any leak is unambiguous when asserting.
const raw: RawProductDoc = {
  _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  name: 'Test Widget',
  slug: 'test-widget',
  description: 'A widget for tests.',
  product_type: 'inventory',
  price: 100,
  cost_price: 42,                       // INTERNAL
  vendor_id: 'bbbbbbbbbbbbbbbbbbbbbbbb', // INTERNAL
  image_url: 'https://example.invalid/w.png',
  product_id: 'W001',
  barcode: 'BAR-1',
  plu: 'PLU-1',                          // INTERNAL
  sku: 'SKU-1',
  stock_quantity: 20,
  committed_quantity: 7,                 // INTERNAL
  low_stock_threshold: 5,                // INTERNAL
  reorder_point: 3,                      // INTERNAL
  is_active: true,
  tax_rate: 8.5,
  category_id: { _id: 'cccccccccccccccccccccccc', name: 'Cat', slug: 'cat' },
  sub_category_id: { _id: 'dddddddddddddddddddddddd', name: 'Sub', slug: 'sub' },
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-02-01T00:00:00.000Z'),
};

test('public shape contains no internal fields', () => {
  const pub = toPublicProduct(raw) as Record<string, unknown>;
  for (const key of INTERNAL_PRODUCT_FIELDS) {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(pub, key),
      false,
      `public shape must not include internal field "${key}"`,
    );
  }
  // Explicit belt-and-braces: assert individual known-bad fields.
  assert.strictEqual('cost_price' in pub, false);
  assert.strictEqual('vendor_id' in pub, false);
  assert.strictEqual('reorder_point' in pub, false);
  assert.strictEqual('committed_quantity' in pub, false);
  assert.strictEqual('low_stock_threshold' in pub, false);
  assert.strictEqual('plu' in pub, false);
});

test('public shape preserves storefront-required fields', () => {
  const pub = toPublicProduct(raw);
  assert.strictEqual(pub.id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.strictEqual(pub.name, 'Test Widget');
  assert.strictEqual(pub.slug, 'test-widget');
  assert.strictEqual(pub.description, 'A widget for tests.');
  assert.strictEqual(pub.price, 100);
  assert.strictEqual(pub.tax_rate, 8.5);
  assert.strictEqual(pub.image_url, 'https://example.invalid/w.png');
  assert.strictEqual(pub.sku, 'SKU-1');
  assert.strictEqual(pub.barcode, 'BAR-1');
  assert.strictEqual(pub.product_id, 'W001');
  assert.strictEqual(pub.category_id, 'cccccccccccccccccccccccc');
  assert.strictEqual(pub.category_name, 'Cat');
  assert.strictEqual(pub.category_slug, 'cat');
  assert.strictEqual(pub.sub_category_name, 'Sub');
  assert.strictEqual(pub.is_active, true);
});

test('public stock_quantity is available, not raw on-hand', () => {
  const pub = toPublicProduct(raw);
  // on-hand 20, committed 7 → available 13. Public callers must never see 20.
  assert.strictEqual(pub.stock_quantity, 13);
  assert.strictEqual(pub.available_quantity, 13);
});

test('public shape never exposes negative availability', () => {
  const pub = toPublicProduct({ ...raw, stock_quantity: 3, committed_quantity: 10 });
  assert.strictEqual(pub.stock_quantity, 0);
  assert.strictEqual(pub.available_quantity, 0);
});

test('staff shape includes internal fields', () => {
  const staff = toStaffProduct(raw);
  assert.strictEqual(staff.cost_price, 42);
  assert.strictEqual(staff.vendor_id, 'bbbbbbbbbbbbbbbbbbbbbbbb');
  assert.strictEqual(staff.reorder_point, 3);
  assert.strictEqual(staff.low_stock_threshold, 5);
  assert.strictEqual(staff.committed_quantity, 7);
  assert.strictEqual(staff.plu, 'PLU-1');
  // Staff must see the raw on-hand count, not the clamped public value.
  assert.strictEqual(staff.stock_quantity, 20);
  assert.strictEqual(staff.available_quantity, 13);
});

test('staff shape preserves all public fields as a superset', () => {
  const pub = toPublicProduct(raw) as Record<string, unknown>;
  const staff = toStaffProduct(raw) as Record<string, unknown>;
  for (const key of Object.keys(pub)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(staff, key),
      `staff shape must also expose public field "${key}"`,
    );
  }
});

test('missing cost_price is emitted as null in staff shape (not omitted)', () => {
  const staff = toStaffProduct({ ...raw, cost_price: undefined });
  assert.strictEqual(staff.cost_price, null);
});

test('public shape falls back safely on missing populated refs', () => {
  const pub = toPublicProduct({
    ...raw,
    category_id: 'cccccccccccccccccccccccc',   // unpopulated ObjectId string
    sub_category_id: undefined,
  });
  assert.strictEqual(pub.category_id, 'cccccccccccccccccccccccc');
  assert.strictEqual(pub.category_name, undefined);
  assert.strictEqual(pub.sub_category_id, undefined);
  assert.strictEqual(pub.sub_category_name, undefined);
});

test('inactive is_active variants normalize to true in public (guests only see active)', () => {
  // Storefront query already filters inactive out. Public shape returns constant true
  // for the field so no admin state leaks even if a caller bypasses the query filter.
  const pub = toPublicProduct({ ...raw, is_active: false });
  assert.strictEqual(pub.is_active, true);
});
