import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustmentNumberDateKey,
  formatAdjustmentNumber,
  formatStockDifference,
  physicalCountDelta,
} from './physicalCount';

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

test('adjustment numbers are date-prefixed sequences, not timestamps', () => {
  assert.equal(formatAdjustmentNumber('20261008', 1), 'ADJ-20261008-0001');
  assert.equal(formatAdjustmentNumber('20261008', 12), 'ADJ-20261008-0012');
  assert.match(adjustmentNumberDateKey(new Date('2026-10-08T10:32:00Z')), /^20261008$/);
});
