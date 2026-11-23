import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInventoryStatement, StatementProductInput } from './inventoryStatement';

const start = new Date('2026-11-01T00:00:00.000Z');
const end = new Date('2026-11-21T18:00:00.000Z');

function product(overrides: Partial<StatementProductInput> = {}): StatementProductInput {
  return {
    id: 'p1',
    product_id: '75330',
    sku: 'EDI-75330',
    name: 'Photoframe',
    stock_quantity: 60,
    cost_price: 10,
    price: 40,
    is_active: true,
    ...overrides,
  };
}

test('a product with no movements keeps the same opening and closing balance', () => {
  const statement = buildInventoryStatement({
    businessName: 'Express Distributors Inc',
    periodStart: start,
    periodEnd: end,
    products: [product()],
    movements: [],
  });
  const row = statement.products[0];
  assert.equal(row.opening_qty, 60);
  assert.equal(row.closing_qty, 60);
  assert.equal(row.opening_purchase_value, 600);
  assert.equal(row.opening_estimated_value, 2400);
  assert.equal(statement.register.length, 0);
  assert.equal(statement.summary.closing_purchase_value, 600);
});

test('stock added inside the period and again after it rebuilds opening, closing, and the running balance', () => {
  const statement = buildInventoryStatement({
    businessName: 'Express Distributors Inc',
    periodStart: start,
    periodEnd: end,
    products: [product({ stock_quantity: 65 })],
    movements: [
      {
        id: 'm1',
        product_id: 'p1',
        created_at: '2026-11-10T12:00:00.000Z',
        movement_type: 'ADJUSTMENT',
        reference_type: 'ADJUSTMENT',
        reference_number: 'ADJ-0001',
        notes: 'Shelf note',
        quantity_change: 10,
        performed_by: 'Admin',
      },
      {
        id: 'm2',
        product_id: 'p1',
        created_at: '2026-11-22T12:00:00.000Z',
        movement_type: 'ADJUSTMENT',
        reference_type: 'ADJUSTMENT',
        reference_number: 'ADJ-0002',
        quantity_change: 5,
      },
    ],
  });
  const row = statement.products[0];
  assert.equal(row.opening_qty, 50);
  assert.equal(row.closing_qty, 60);
  assert.equal(row.units_in, 10);
  assert.equal(row.units_out, 0);
  assert.equal(statement.register.length, 1);
  assert.equal(statement.register[0].type, 'Adjustment');
  assert.equal(statement.register[0].reference, 'Adjustment · ADJ-0001');
  assert.equal(statement.register[0].notes, 'Shelf note');
  assert.equal(statement.register[0].balance_qty, 60);
  assert.equal(statement.register[0].running_purchase_value, 600);
  assert.equal(statement.register[0].running_estimated_value, 2400);
  assert.equal(statement.summary.units_in, 10);
  assert.equal(statement.summary.opening_units, 50);
  assert.equal(statement.summary.closing_units, 60);
});
