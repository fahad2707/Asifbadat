import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAdjustmentNumber, formatStockDifference, physicalCountDelta } from './physicalCount';

test('48 counted as 50 is difference +2', () => {
  assert.equal(physicalCountDelta(48, 50), 2);
  assert.equal(formatStockDifference(2), '+2');
});

test('48 counted as 45 is difference -3', () => {
  assert.equal(physicalCountDelta(48, 45), -3);
  assert.equal(formatStockDifference(-3), '-3');
});

test('unchanged count is difference 0', () => {
  assert.equal(physicalCountDelta(48, 48), 0);
  assert.equal(formatStockDifference(0), '0');
});

test('adjustment numbers are short sequences', () => {
  assert.equal(formatAdjustmentNumber(1), 'ADJ-0001');
  assert.equal(formatAdjustmentNumber(12), 'ADJ-0012');
  assert.equal(formatAdjustmentNumber(10000), 'ADJ-10000');
});
