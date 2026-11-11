/**
 * Run with:
 *     npx tsx --test src/modules/vendors/bestSupplierRates.test.ts
 */
import '../../load-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBestSupplierRates } from './services/bestSupplierRates';

const PRODUCT_LAYS = '64b0000000000000000c0001';
const VENDOR_A = '64b0000000000000000f0001';
const VENDOR_B = '64b0000000000000000f0002';

test('lowest unit cost wins even if an older PO was higher', () => {
  const best = pickBestSupplierRates([
    {
      product_id: PRODUCT_LAYS,
      vendor_id: VENDOR_A,
      unit_cost: 5,
      po_number: 'PO-A',
      at: new Date('2026-01-01'),
    },
    {
      product_id: PRODUCT_LAYS,
      vendor_id: VENDOR_B,
      unit_cost: 3,
      po_number: 'PO-B',
      at: new Date('2026-06-01'),
    },
  ]);
  const winner = best.get(PRODUCT_LAYS);
  assert.equal(winner?.vendor_id, VENDOR_B);
  assert.equal(winner?.unit_cost, 3);
});

test('same cost prefers the more recent PO', () => {
  const best = pickBestSupplierRates([
    {
      product_id: PRODUCT_LAYS,
      vendor_id: VENDOR_A,
      unit_cost: 4,
      at: new Date('2026-02-01'),
    },
    {
      product_id: PRODUCT_LAYS,
      vendor_id: VENDOR_B,
      unit_cost: 4,
      at: new Date('2026-03-01'),
    },
  ]);
  assert.equal(best.get(PRODUCT_LAYS)?.vendor_id, VENDOR_B);
});
