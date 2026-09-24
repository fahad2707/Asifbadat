/**
 * Task 07D-06 — POS available-stock predicate.
 *
 * Run with:
 *     npx tsx --test src/utils/posStock.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posStockDecrementFilter } from './posStock';

test('decrement filter requires stock_quantity - committed_quantity >= qty', () => {
  const productId = '64b0000000000000000d0404';
  const filter = posStockDecrementFilter(productId, 7);
  assert.equal(filter._id, productId);
  assert.deepEqual(filter.$expr, {
    $gte: [
      {
        $subtract: [
          { $ifNull: ['$stock_quantity', 0] },
          { $ifNull: ['$committed_quantity', 0] },
        ],
      },
      7,
    ],
  });
});
