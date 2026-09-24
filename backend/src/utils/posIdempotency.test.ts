/**
 * Task 07D-08 — POS idempotency helpers.
 *
 * Isolated: no Mongo connection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPosSaleResponse,
  isIdempotencyDuplicateKey,
  waitForCommittedKeyedSale,
} from './posIdempotency';

test('isIdempotencyDuplicateKey accepts only 11000 on idempotency_key', () => {
  assert.equal(isIdempotencyDuplicateKey({ code: 11000, keyPattern: { idempotency_key: 1 } }), true);
  assert.equal(
    isIdempotencyDuplicateKey({ code: 11000, message: 'E11000 duplicate key: idempotency_key' }),
    true
  );
  assert.equal(isIdempotencyDuplicateKey({ code: 11000, keyPattern: { sale_number: 1 } }), false);
  assert.equal(isIdempotencyDuplicateKey({ code: 11000, message: 'E11000 sale_number' }), false);
  assert.equal(isIdempotencyDuplicateKey({ code: 50 }), false);
  assert.equal(isIdempotencyDuplicateKey(null), false);
});

test('waitForCommittedKeyedSale returns null until a committed sale is readable', async () => {
  let calls = 0;
  const sale = { _id: 'sale-1' };
  const found = await waitForCommittedKeyedSale(async () => {
    calls += 1;
    return calls >= 2 ? sale : null;
  }, 4, 1);
  assert.equal(found, sale);
  assert.equal(calls, 2);
});

test('waitForCommittedKeyedSale does not invent a sale when none becomes readable', async () => {
  const found = await waitForCommittedKeyedSale(async () => null, 3, 1);
  assert.equal(found, null);
});

test('formatPosSaleResponse preserves original ids', () => {
  const payload = formatPosSaleResponse(
    { _id: 'sale-orig', sale_number: 'POS-1', toObject() { return { sale_number: 'POS-1' }; } },
    { _id: 'inv-orig', invoice_number: 'INV-1', toObject() { return { invoice_number: 'INV-1' }; } }
  );
  assert.equal(payload.sale.id, 'sale-orig');
  assert.equal(payload.invoice.id, 'inv-orig');
});
