/**
 * Physical count preview math (UI only). Backend remains authoritative.
 *
 * Run with:
 *     npx tsx --test lib/physical-count.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatStockDifference, physicalCountPreview } from './physical-count';

test('current 48 count 50 shows difference +2 and new stock 50', () => {
  const preview = physicalCountPreview(48, 50);
  assert.equal(preview.difference, 2);
  assert.equal(preview.newQty, 50);
  assert.equal(formatStockDifference(preview.difference!), '+2');
});

test('current 48 count 45 shows difference -3 and new stock 45', () => {
  const preview = physicalCountPreview(48, 45);
  assert.equal(preview.difference, -3);
  assert.equal(preview.newQty, 45);
  assert.equal(formatStockDifference(preview.difference!), '-3');
});

test('empty count shows no difference', () => {
  const preview = physicalCountPreview(48, '');
  assert.equal(preview.difference, null);
  assert.equal(preview.newQty, null);
});
