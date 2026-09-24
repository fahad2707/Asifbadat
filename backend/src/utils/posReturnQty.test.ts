/**
 * Task 07D-10E-01 — Atomic remaining-qty claim helper.
 *
 * Isolated: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/utils/posReturnQty.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posReturnQuantityClaimFilter, posReturnQuantityClaimUpdate } from './posReturnQty';

const SALE_ID = '64b0000000000000000a0a0a';
const PRODUCT_A = '64b0000000000000000d0404';
const PRODUCT_B = '64b0000000000000000d0505';

test('claim filter requires already_returned + requested <= original quantity', () => {
  const filter = posReturnQuantityClaimFilter(SALE_ID, [
    { product_id: PRODUCT_A, quantity: 2, original_quantity: 3 },
  ]);
  assert.equal(filter._id, SALE_ID);
  assert.equal(filter.$and.length, 1);
  assert.deepEqual(filter.$and[0].$expr, {
    $lte: [
      {
        $add: [{ $ifNull: [`$returned_quantities.${PRODUCT_A}`, 0] }, 2],
      },
      3,
    ],
  });
});

test('claim update increments only returned_quantities and merges duplicate products', () => {
  const update = posReturnQuantityClaimUpdate([
    { product_id: PRODUCT_A, quantity: 2 },
    { product_id: PRODUCT_B, quantity: 1 },
    { product_id: PRODUCT_A, quantity: 1 },
  ]);
  assert.deepEqual(update, {
    $inc: {
      [`returned_quantities.${PRODUCT_A}`]: 3,
      [`returned_quantities.${PRODUCT_B}`]: 1,
    },
  });
  assert.equal(Object.keys(update.$inc).every((key) => key.startsWith('returned_quantities.')), true);
});
