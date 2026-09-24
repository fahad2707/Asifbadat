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
  omitInternalCostPrice,
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

test('formatPosSaleResponse omits internal sale-time cost from sale and invoice items', () => {
  const payload = formatPosSaleResponse(
    {
      _id: 'sale-cost',
      items: [{ product_id: 'p1', quantity: 1, price: 100, subtotal: 100, cost_price: 42 }],
    },
    {
      _id: 'inv-cost',
      items: [{ product_id: 'p1', quantity: 1, price: 100, subtotal: 100, cost_price: 42 }],
    }
  );
  assert.equal('cost_price' in payload.sale.items[0], false);
  assert.equal(payload.sale.items[0].price, 100);
  assert.equal('cost_price' in payload.invoice.items[0], false);
});

test('omitInternalCostPrice strips cost_price from plain and toObject lines', () => {
  const plain = omitInternalCostPrice({ product_id: 'p1', price: 100, cost_price: 42 });
  assert.ok(plain);
  assert.equal('cost_price' in plain, false);
  assert.equal(plain.price, 100);

  const fromDoc = omitInternalCostPrice({
    product_id: 'p1',
    price: 100,
    cost_price: 42,
    toObject() {
      return { product_id: 'p1', price: 100, cost_price: 42 };
    },
  });
  assert.ok(fromDoc);
  assert.equal('cost_price' in fromDoc, false);
  assert.equal(fromDoc.price, 100);
  assert.equal('toObject' in fromDoc, false);
});
