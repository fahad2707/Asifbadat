/**
 * Customer credit memos from invoice lines.
 *
 * Run with:
 *     npx tsx --test src/modules/credit-memo/creditMemoFromInvoice.test.ts
 */
import '../../load-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_TYPE_INVOICE, DOCUMENT_TYPE_QUOTATION } from '../../utils/documentType';
import {
  creditedQtyByLineKey,
  invoiceLineKey,
  remainingReturnQty,
  shouldCreditInventory,
  soldQtyByLineKey,
  taxPercentFromInvoiceLine,
  validateCustomerReturnLines,
} from './services/creditMemoFromInvoice';

const PRODUCT_A = '64b0000000000000000c0001';
const PRODUCT_B = '64b0000000000000000c0002';
const CUSTOMER = '64b0000000000000000e0001';

test('sold qty aggregates duplicate invoice lines at the same price', () => {
  const sold = soldQtyByLineKey([
    { product_id: PRODUCT_A, quantity: 3, price: 10 },
    { product_id: PRODUCT_A, quantity: 2, price: 10 },
    { product_id: PRODUCT_A, quantity: 1, price: 8 },
  ]);
  assert.equal(sold.get(invoiceLineKey(PRODUCT_A, 10)), 5);
  assert.equal(sold.get(invoiceLineKey(PRODUCT_A, 8)), 1);
});

test('remaining qty subtracts approved credits at the sold price', () => {
  const sold = soldQtyByLineKey([{ product_id: PRODUCT_A, quantity: 10, price: 12.5 }]);
  const credited = creditedQtyByLineKey([
    { items: [{ product_id: PRODUCT_A, quantity: 4, unit_price: 12.5 }] },
  ]);
  assert.equal(
    remainingReturnQty(sold.get(invoiceLineKey(PRODUCT_A, 12.5)) || 0, credited.get(invoiceLineKey(PRODUCT_A, 12.5)) || 0),
    6
  );
});

test('tax percent prefers invoice percent rate, else derives from line tax amount', () => {
  assert.equal(taxPercentFromInvoiceLine({ quantity: 2, price: 10, tax_rate_type: 'percent', tax_rate: 6 }), 6);
  assert.equal(taxPercentFromInvoiceLine({ quantity: 2, price: 10, tax_amount: 1.2 }), 6);
});

test('validate locks invoice prices and blocks over-return', () => {
  const invoice = {
    customer_id: CUSTOMER,
    invoice_type: DOCUMENT_TYPE_INVOICE,
    items: [
      { product_id: PRODUCT_A, product_name: 'Widget', quantity: 5, price: 10, tax_rate_type: 'percent', tax_rate: 0 },
      { product_id: PRODUCT_B, product_name: 'Gadget', quantity: 2, price: 20 },
    ],
  };
  const ok = validateCustomerReturnLines({
    invoice,
    customerId: CUSTOMER,
    existingMemos: [{ items: [{ product_id: PRODUCT_A, quantity: 1, unit_price: 10 }] }],
    requested: [{ product_id: PRODUCT_A, quantity: 2, unit_price: 99 }],
  });
  assert.equal(ok.items[0].unit_price, 10);
  assert.equal(ok.items[0].quantity, 2);

  assert.throws(
    () =>
      validateCustomerReturnLines({
        invoice,
        customerId: CUSTOMER,
        existingMemos: [{ items: [{ product_id: PRODUCT_A, quantity: 4, unit_price: 10 }] }],
        requested: [{ product_id: PRODUCT_A, quantity: 2, unit_price: 10 }],
      }),
    /remaining/
  );
});

test('validate rejects quotations and other customers', () => {
  assert.throws(
    () =>
      validateCustomerReturnLines({
        invoice: { customer_id: CUSTOMER, invoice_type: DOCUMENT_TYPE_QUOTATION, items: [{ product_id: PRODUCT_A, quantity: 1, price: 10 }] },
        customerId: CUSTOMER,
        existingMemos: [],
        requested: [{ product_id: PRODUCT_A, quantity: 1, unit_price: 10 }],
      }),
    /invoices/
  );
  assert.throws(
    () =>
      validateCustomerReturnLines({
        invoice: { customer_id: CUSTOMER, invoice_type: DOCUMENT_TYPE_INVOICE, items: [{ product_id: PRODUCT_A, quantity: 1, price: 10 }] },
        customerId: '64b0000000000000000e9999',
        existingMemos: [],
        requested: [{ product_id: PRODUCT_A, quantity: 1, unit_price: 10 }],
      }),
    /does not belong/
  );
});

test('stock comes back only when the invoice already took stock and the reason is a return', () => {
  assert.equal(shouldCreditInventory({ reason: 'RETURN', invoice: { inventory_applied: true } }), true);
  assert.equal(shouldCreditInventory({ reason: 'RETURN', invoice: { inventory_applied: false } }), false);
  assert.equal(shouldCreditInventory({ reason: 'RETURN', invoice: {} }), true);
  assert.equal(shouldCreditInventory({ reason: 'RATE_DIFFERENCE', invoice: { inventory_applied: true } }), false);
});
