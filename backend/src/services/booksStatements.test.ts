import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExpenseStatement,
  buildPurchaseBooksStatement,
  type ExpenseBook,
  type PurchaseOrderBook,
  type VendorCreditBook,
} from './booksStatements';

const start = new Date('2026-11-01T00:00:00');
const end = new Date('2026-11-30T23:59:59.999');

function po(overrides: Partial<PurchaseOrderBook> = {}): PurchaseOrderBook {
  return {
    id: 'po-1',
    number: 'PO#001',
    vendorId: 'v1',
    vendorName: 'Supplier XYZ',
    supplierCode: 'S100',
    contact: 'Asha',
    phone: '555',
    terms: 'Net 15',
    status: 'received',
    createdAt: new Date('2026-11-10T09:00:00'),
    subtotal: 100,
    tax: 8,
    total: 108,
    items: [{ name: 'Flowers', ordered: 10, received: 10, unitCost: 10, subtotal: 100 }],
    payments: [],
    ...overrides,
  };
}

function credit(overrides: Partial<VendorCreditBook> = {}): VendorCreditBook {
  return {
    number: 'CMV#001',
    vendorId: 'v1',
    vendorName: 'Supplier XYZ',
    supplierCode: 'S100',
    contact: 'Asha',
    phone: '555',
    terms: 'Net 15',
    poNumber: 'PO#001',
    reason: 'DAMAGED',
    status: 'ADJUSTED',
    at: new Date('2026-11-12T09:00:00'),
    merchandise: 20,
    tax: 0,
    total: 20,
    items: [{ name: 'Flowers', quantity: 2, unitPrice: 10, total: 20 }],
    ...overrides,
  };
}

test('a draft purchase order is listed and does not change what is owed', () => {
  const statement = buildPurchaseBooksStatement([po({ status: 'draft' })], [], start, end);
  assert.equal(statement.opening_owed, 0);
  assert.equal(statement.purchases, 0);
  assert.equal(statement.closing_owed, 0);
  assert.equal(statement.purchase_orders[0].on_books, false);
  assert.equal(statement.purchase_orders[0].balance, 0);
  assert.equal(statement.ledger[0].debit, 0);
});

test('an earlier bill stays open, and a payment plus a matching supplier credit reduce it', () => {
  const statement = buildPurchaseBooksStatement(
    [
      po({
        createdAt: new Date('2026-10-02T09:00:00'),
        payments: [{ amount: 30, at: new Date('2026-11-15T09:00:00'), method: 'Cash', reference: 'CHK1' }],
      }),
    ],
    [credit()],
    start,
    end
  );
  assert.equal(statement.opening_owed, 108);
  assert.equal(statement.purchases, 0);
  assert.equal(statement.payments, 30);
  assert.equal(statement.supplier_credits, 20);
  assert.equal(statement.closing_owed, 58);
  assert.equal(statement.purchase_orders[0].balance, 58);
  assert.equal(statement.suppliers[0].closing, 58);
  assert.deepEqual(statement.ledger.map((line) => line.kind), ['supplier_credit', 'payment']);
});

test('a supplier credit for a different purchase order does not clear the first bill', () => {
  const statement = buildPurchaseBooksStatement(
    [po(), po({ id: 'po-2', number: 'PO#002', total: 40, subtotal: 40, tax: 0, createdAt: new Date('2026-11-11T09:00:00') })],
    [credit({ poNumber: 'PO#002', total: 40, merchandise: 40 })],
    start,
    end
  );
  const first = statement.purchase_orders.find((row) => row.number === 'PO#001');
  const second = statement.purchase_orders.find((row) => row.number === 'PO#002');
  assert.equal(first?.balance, 108);
  assert.equal(second?.balance, 0);
  assert.equal(statement.closing_owed, 108);
});

test('a draft supplier credit is listed and does not reduce the balance', () => {
  const statement = buildPurchaseBooksStatement([po()], [credit({ status: 'DRAFT' })], start, end);
  assert.equal(statement.supplier_credits, 0);
  assert.equal(statement.closing_owed, 108);
  assert.equal(statement.credit_memos[0].on_books, false);
});

test('expense statement carries earlier spending into the period and totals each type', () => {
  const expenses: ExpenseBook[] = [
    { number: 'EXP#001', at: new Date('2026-10-02T09:00:00'), expenseType: 'Rent', description: 'October', payee: 'Landlord', paymentMode: 'CASH', amount: 500, recurring: true },
    { number: 'EXP#002', at: new Date('2026-11-03T09:00:00'), expenseType: 'Rent', description: 'November', payee: 'Landlord', paymentMode: 'CASH', amount: 500, recurring: true },
    { number: 'EXP#003', at: new Date('2026-11-04T09:00:00'), expenseType: 'Fuel', description: '', payee: '', paymentMode: 'CREDIT_CARD', amount: 40, recurring: false },
  ];
  const statement = buildExpenseStatement(expenses, start, end);
  assert.equal(statement.opening_spent, 500);
  assert.equal(statement.spent, 540);
  assert.equal(statement.closing_spent, 1040);
  assert.equal(statement.lines[1].balance, 1040);
  assert.deepEqual(statement.categories, [
    { expense_type: 'Rent', amount: 500 },
    { expense_type: 'Fuel', amount: 40 },
  ]);
});
