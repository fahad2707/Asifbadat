/**
 * Phase B2 — internal SKU helpers (no Mongo).
 *
 * Run: npx tsx --test src/utils/productCodes.internalSku.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERNAL_SKU_PREFIX,
  buildInternalSkuFromProductId,
  isBlankSku,
} from './productCodes';

test('buildInternalSkuFromProductId uses EDI-<product_id> format', () => {
  assert.equal(buildInternalSkuFromProductId('48217'), 'EDI-48217');
  assert.equal(buildInternalSkuFromProductId(' 99001 '), 'EDI-99001');
  assert.ok(buildInternalSkuFromProductId('48217').startsWith(INTERNAL_SKU_PREFIX));
});

test('buildInternalSkuFromProductId rejects blank product_id', () => {
  assert.throws(() => buildInternalSkuFromProductId(''), /product_id is required/);
  assert.throws(() => buildInternalSkuFromProductId('   '), /product_id is required/);
});

test('internal SKU is not a pure numeric UPC-style value', () => {
  const sku = buildInternalSkuFromProductId('12345');
  assert.equal(/^\d+$/.test(sku), false);
  assert.match(sku, /^EDI-\d+$/);
});

test('isBlankSku treats missing and whitespace as blank', () => {
  assert.equal(isBlankSku(undefined), true);
  assert.equal(isBlankSku(null), true);
  assert.equal(isBlankSku(''), true);
  assert.equal(isBlankSku('   '), true);
  assert.equal(isBlankSku('UPC-12345678'), false);
  assert.equal(isBlankSku('EDI-12345'), false);
});
