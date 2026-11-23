import test from 'node:test';
import assert from 'node:assert/strict';
import { damagedHoldNote, pickPurchaseSourceByRate, type PurchaseRateLine } from './services/purchaseSourceByRate';

function line(overrides: Partial<PurchaseRateLine> = {}): PurchaseRateLine {
  return {
    product_id: 'product-1',
    vendor_id: 'vendor-a',
    vendor_name: 'Supplier A',
    po_id: 'po-1',
    po_number: 'PO-1',
    unit_cost: 10,
    quantity_received: 20,
    at: new Date('2026-01-01T00:00:00.000Z'),
    method: 'purchase_order',
    ...overrides,
  };
}

test('the supplier is the purchase at the product cost rate, not a cheaper lot', () => {
  const picked = pickPurchaseSourceByRate(
    [
      line({ vendor_name: 'Cheap Co', unit_cost: 8, po_number: 'PO-CHEAP', at: new Date('2026-06-01T00:00:00.000Z') }),
      line({ vendor_name: 'Supplier XYZ', vendor_id: 'vendor-x', unit_cost: 10, po_number: 'PO-XYZ' }),
    ],
    10
  );
  assert.equal(picked.matched, true);
  if (!picked.matched) return;
  assert.equal(picked.source.vendor_name, 'Supplier XYZ');
  assert.equal(picked.source.po_number, 'PO-XYZ');
  assert.equal(picked.source.unit_cost, 10);
});

test('when two purchases share the rate, the most recent received one is the source', () => {
  const picked = pickPurchaseSourceByRate(
    [
      line({ vendor_name: 'Older', po_number: 'PO-OLD', at: new Date('2026-01-01T00:00:00.000Z') }),
      line({ vendor_name: 'Newer', vendor_id: 'vendor-b', po_id: 'po-2', po_number: 'PO-NEW', at: new Date('2026-08-01T00:00:00.000Z') }),
    ],
    10
  );
  assert.equal(picked.matched, true);
  if (!picked.matched) return;
  assert.equal(picked.source.po_number, 'PO-NEW');
});

test('a purchase that was never received does not count', () => {
  const picked = pickPurchaseSourceByRate([line({ quantity_received: 0 })], 10);
  assert.deepEqual(picked, { matched: false, rate: 10 });
});

test('no cost rate and no matching purchase stay unmatched', () => {
  assert.deepEqual(pickPurchaseSourceByRate([line()], null), { matched: false, rate: null });
  assert.deepEqual(pickPurchaseSourceByRate([line({ unit_cost: 12 })], 10), { matched: false, rate: 10 });
});

test('a damaged hold note names the supplier found through the rate', () => {
  const note = damagedHoldNote(5, {
    purchase_match: 'rate',
    purchase_rate: 10,
    purchase_vendor_name: 'Supplier XYZ',
    purchase_po_number: 'PO-XYZ',
    purchase_unit_cost: 10,
  });
  assert.match(note, /5 damaged, held out of sellable stock/);
  assert.match(note, /Supplier XYZ/);
  assert.match(note, /\$10\.00/);
  assert.match(note, /PO-XYZ/);
});

test('a damaged hold note says when the rate has no purchase', () => {
  assert.match(damagedHoldNote(5, { purchase_match: 'none', purchase_rate: 10 }), /No received purchase matches the cost rate \$10\.00/);
  assert.match(damagedHoldNote(5, { purchase_match: 'none', purchase_rate: null }), /No cost rate is on file/);
});
