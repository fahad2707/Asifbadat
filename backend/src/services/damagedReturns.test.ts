import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDamagedReturnRows, damagedRowsForStatement, type DamagedCustomerMemo, type DamagedReturnRow, type DamagedSupplierMemo } from './damagedReturns';

function customer(overrides: Partial<DamagedCustomerMemo> = {}): DamagedCustomerMemo {
  return {
    credit_memo_id: 'cmc-1',
    credit_memo_number: 'CMC#010',
    status: 'ADJUSTED',
    received_at: new Date('2026-11-22T10:00:00.000Z'),
    created_at: new Date('2026-11-22T09:00:00.000Z'),
    customer_name: 'Customer ABC',
    invoice_number: 'INV#010',
    items: [
      {
        id: 'line-1',
        product_id: 'photoframe',
        product_name: 'Photoframe',
        quantity: 5,
        purchase_match: 'rate',
        purchase_rate: 10,
        purchase_vendor_id: 'vendor-xyz',
        purchase_vendor_name: 'Supplier XYZ',
        purchase_po_id: 'po-xyz',
        purchase_po_number: 'PO-XYZ',
        purchase_unit_cost: 10,
      },
    ],
    ...overrides,
  };
}

test('a received damaged return stays held with the customer, supplier, PO, invoice, and memo', () => {
  const [row] = buildDamagedReturnRows([customer()], []);
  assert.equal(row.hold, 'held');
  assert.equal(row.quantity_still_held, 5);
  assert.equal(row.customer_name, 'Customer ABC');
  assert.equal(row.supplier_name, 'Supplier XYZ');
  assert.equal(row.po_number, 'PO-XYZ');
  assert.equal(row.invoice_number, 'INV#010');
  assert.equal(row.credit_memo_number, 'CMC#010');
  assert.equal(row.purchase_rate, 10);
});

test('an approved damaged memo is waiting and is not counted as stock', () => {
  const [row] = buildDamagedReturnRows([customer({ status: 'APPROVED', received_at: null })], []);
  assert.equal(row.hold, 'waiting');
  assert.equal(row.quantity_still_held, 0);
  assert.equal(row.quantity, 5);
});

test('a supplier credit for the same purchase clears the damaged row', () => {
  const supplier: DamagedSupplierMemo = {
    credit_memo_id: 'cmv-1',
    credit_memo_number: 'CMV#004',
    po_id: 'po-xyz',
    dispatched_at: new Date('2026-11-23T10:00:00.000Z'),
    items: [{ product_id: 'photoframe', quantity: 5 }],
  };
  const [row] = buildDamagedReturnRows([customer()], [supplier]);
  assert.equal(row.hold, 'returned');
  assert.equal(row.quantity_still_held, 0);
  assert.equal(row.quantity_returned_to_supplier, 5);
  assert.equal(row.supplier_credit_memo_number, 'CMV#004');
});

test('a supplier credit for a different purchase does not clear this damaged return', () => {
  const supplier: DamagedSupplierMemo = {
    credit_memo_id: 'cmv-2',
    credit_memo_number: 'CMV#009',
    po_id: 'po-other',
    dispatched_at: new Date('2026-11-23T10:00:00.000Z'),
    items: [{ product_id: 'photoframe', quantity: 5 }],
  };
  const [row] = buildDamagedReturnRows([customer()], [supplier]);
  assert.equal(row.hold, 'held');
  assert.equal(row.quantity_still_held, 5);
  assert.equal(row.supplier_credit_memo_number, null);
});

test('a partial supplier return leaves the rest in damaged stock, oldest customer return first', () => {
  const older = customer();
  const newer = customer({
    credit_memo_id: 'cmc-2',
    credit_memo_number: 'CMC#011',
    received_at: new Date('2026-11-22T12:00:00.000Z'),
    items: [
      {
        id: 'line-2',
        product_id: 'photoframe',
        product_name: 'Photoframe',
        quantity: 5,
        purchase_match: 'rate',
        purchase_rate: 10,
        purchase_vendor_id: 'vendor-xyz',
        purchase_vendor_name: 'Supplier XYZ',
        purchase_po_id: 'po-xyz',
        purchase_po_number: 'PO-XYZ',
        purchase_unit_cost: 10,
      },
    ],
  });
  const rows = buildDamagedReturnRows(
    [newer, older],
    [
      {
        credit_memo_id: 'cmv-1',
        credit_memo_number: 'CMV#004',
        po_id: 'po-xyz',
        dispatched_at: new Date('2026-11-23T10:00:00.000Z'),
        items: [{ product_id: 'photoframe', quantity: 2 }],
      },
    ]
  );
  const first = rows.find((row) => row.credit_memo_number === 'CMC#010');
  const second = rows.find((row) => row.credit_memo_number === 'CMC#011');
  assert.equal(first?.quantity_returned_to_supplier, 2);
  assert.equal(first?.quantity_still_held, 3);
  assert.equal(first?.hold, 'held');
  assert.equal(second?.quantity_still_held, 5);
  assert.equal(second?.hold, 'held');
});

test('a statement keeps damaged stock still held and rows dated inside the period', () => {
  const [held] = buildDamagedReturnRows([customer()], []);
  const heldBefore = { ...held, id: 'before', date: '2026-10-15T00:00:00.000Z' };
  const later = { ...held, id: 'later', date: '2026-12-01T00:00:00.000Z', hold: 'waiting' as const, quantity_still_held: 0 };
  const earlierReturned = {
    ...held,
    id: 'old',
    date: '2026-10-01T00:00:00.000Z',
    hold: 'returned' as const,
    quantity_still_held: 0,
  };
  const picked = damagedRowsForStatement(
    [held, heldBefore, later, earlierReturned] as DamagedReturnRow[],
    new Date('2026-11-01T00:00:00.000Z'),
    new Date('2026-11-30T00:00:00.000Z')
  );
  assert.deepEqual(picked.map((row) => row.id).sort(), [held.id, 'before'].sort());
});
