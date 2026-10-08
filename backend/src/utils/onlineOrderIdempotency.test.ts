import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkoutItemsMatch,
  checkoutPayloadMatches,
  isCheckoutSubmissionDuplicateKey,
  normalizeCheckoutItems,
} from './onlineOrderIdempotency';

test('isCheckoutSubmissionDuplicateKey accepts only 11000 on checkout_submission_id', () => {
  assert.equal(
    isCheckoutSubmissionDuplicateKey({
      code: 11000,
      keyPattern: { user_id: 1, checkout_submission_id: 1 },
    }),
    true
  );
  assert.equal(
    isCheckoutSubmissionDuplicateKey({
      code: 11000,
      message: 'E11000 duplicate key: checkout_submission_id',
    }),
    true
  );
  assert.equal(
    isCheckoutSubmissionDuplicateKey({ code: 11000, keyPattern: { order_number: 1 } }),
    false
  );
  assert.equal(isCheckoutSubmissionDuplicateKey({ code: 50 }), false);
  assert.equal(isCheckoutSubmissionDuplicateKey(null), false);
});

test('normalizeCheckoutItems sorts by product_id then quantity', () => {
  const normalized = normalizeCheckoutItems([
    { product_id: 'b', quantity: 2 },
    { product_id: 'a', quantity: 1 },
    { product_id: 'a', quantity: 3 },
  ]);
  assert.deepEqual(normalized, [
    { product_id: 'a', quantity: 1 },
    { product_id: 'a', quantity: 3 },
    { product_id: 'b', quantity: 2 },
  ]);
});

test('checkoutPayloadMatches ignores item order and rejects qty/address changes', () => {
  const existing = {
    payment_method: 'cod',
    address_line1: '1 Main',
    city: 'Town',
    state: 'PA',
    zip: '19462',
    customer_email: 'A@Example.COM',
    items: [
      { product_id: '64c1c2d3e4f5a6b7c8d9e0a1', quantity: 2 },
      { product_id: '64c1c2d3e4f5a6b7c8d9e0a2', quantity: 1 },
    ],
  };
  assert.equal(
    checkoutPayloadMatches(existing, {
      ...existing,
      customer_email: 'a@example.com',
      items: [
        { product_id: '64c1c2d3e4f5a6b7c8d9e0a2', quantity: 1 },
        { product_id: '64c1c2d3e4f5a6b7c8d9e0a1', quantity: 2 },
      ],
    }),
    true
  );
  assert.equal(checkoutItemsMatch(existing.items, existing.items), true);
  assert.equal(
    checkoutPayloadMatches(existing, {
      ...existing,
      items: [{ product_id: '64c1c2d3e4f5a6b7c8d9e0a1', quantity: 5 }],
    }),
    false
  );
  assert.equal(
    checkoutPayloadMatches(existing, { ...existing, address_line1: '2 Other' }),
    false
  );
});
