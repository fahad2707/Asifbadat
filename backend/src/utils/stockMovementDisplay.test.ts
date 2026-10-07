import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StockMovementType } from '../shared/enums';
import {
  canonicalStockMovementType,
  serializeStockMovement,
  stockMovementTypeLabel,
} from './stockMovementDisplay';

test('legacy lowercase strings stay readable without rewriting storage', () => {
  assert.equal(canonicalStockMovementType('sale'), StockMovementType.SALE);
  assert.equal(canonicalStockMovementType('purchase'), StockMovementType.PURCHASE);
  assert.equal(canonicalStockMovementType('adjustment'), StockMovementType.ADJUSTMENT);
  assert.equal(canonicalStockMovementType('pos_return'), StockMovementType.RETURN_IN);
  assert.equal(canonicalStockMovementType(StockMovementType.PHYSICAL_COUNT), StockMovementType.PHYSICAL_COUNT);
  assert.equal(stockMovementTypeLabel(StockMovementType.PHYSICAL_COUNT), 'Physical count');
});

test('serialize exposes before / delta / after and does not invent missing snapshots', () => {
  const withSnap = serializeStockMovement({
    _id: { toString: () => 'm1' },
    product_id: { toString: () => 'p1' },
    movement_type: StockMovementType.PHYSICAL_COUNT,
    quantity_change: 2,
    quantity_before: 48,
    quantity_after: 50,
    reference_number: 'ADJ-20261008-0001',
    reason: 'PHYSICAL_COUNT',
    notes: 'Warehouse recount',
    created_at: new Date('2026-10-08T10:32:00Z'),
    admin_id: { _id: 'a1', name: 'Admin User' },
  });
  assert.equal(withSnap.quantity_before, 48);
  assert.equal(withSnap.quantity_delta, 2);
  assert.equal(withSnap.quantity_after, 50);
  assert.equal(withSnap.performed_by, 'Admin User');
  assert.equal(withSnap.reference_number, 'ADJ-20261008-0001');

  const legacy = serializeStockMovement({
    _id: 'm2',
    product_id: 'p1',
    movement_type: 'sale',
    quantity_change: -1,
    created_at: new Date(),
  });
  assert.equal(legacy.quantity_before, null);
  assert.equal(legacy.quantity_after, null);
  assert.equal(legacy.movement_type, 'sale');
  assert.equal(legacy.movement_type_canonical, 'SALE');
});
