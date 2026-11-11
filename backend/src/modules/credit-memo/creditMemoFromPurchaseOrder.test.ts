/**
 * Run with:
 *     npx tsx --test src/modules/credit-memo/creditMemoFromPurchaseOrder.test.ts
 */
import '../../load-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receivedQtyByLineKey, validateVendorReturnLines } from './services/creditMemoFromPurchaseOrder';

const PRODUCT_A = '64b0000000000000000c0001';
const VENDOR = '64b0000000000000000f0001';

test('only received PO qty can be credited', () => {
  const received = receivedQtyByLineKey([
    { product_id: PRODUCT_A, quantity_ordered: 10, quantity_received: 4, unit_cost: 3 },
  ]);
  assert.equal([...received.values()][0], 4);
});

test('validate locks PO cost and blocks over-return', () => {
  const po = {
    vendor_id: VENDOR,
    items: [{ product_id: PRODUCT_A, product_name: 'Lays', quantity_received: 5, unit_cost: 3 }],
  };
  const ok = validateVendorReturnLines({
    po,
    vendorId: VENDOR,
    existingMemos: [{ items: [{ product_id: PRODUCT_A, quantity: 1, unit_price: 3 }] }],
    requested: [{ product_id: PRODUCT_A, quantity: 2, unit_price: 99 }],
  });
  assert.equal(ok.items[0].unit_price, 3);
  assert.throws(
    () =>
      validateVendorReturnLines({
        po,
        vendorId: VENDOR,
        existingMemos: [{ items: [{ product_id: PRODUCT_A, quantity: 5, unit_price: 3 }] }],
        requested: [{ product_id: PRODUCT_A, quantity: 1, unit_price: 3 }],
      }),
    /remaining/
  );
});
