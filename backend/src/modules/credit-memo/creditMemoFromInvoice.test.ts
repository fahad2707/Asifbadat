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
  customerCreditLineAmounts,
  invoiceGoodsWithCustomer,
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

/**
 * FUTURE GUARD — taxPercentFromInvoiceLine is intentionally unchanged.
 *
 * A confirmed percent rate of 0, and a confirmed non-taxable line with tax_amount 0,
 * both stay 0. An incomplete wholesale snapshot can also store tax_amount 0 with
 * zero_confirmed false. This function does not read tax_snapshot, so that incomplete
 * 0 becomes 0% as well.
 *
 * A later credit-memo change must look at the snapshot before calling this function.
 * When money_decision is incomplete, or zero_confirmed is false and the decision is
 * not confirmed_non_taxable or a confirmed percent rate, it must not store tax_percent 0
 * as a confirmed zero. Legacy lines without tax_snapshot keep today's derivation.
 * Existing credit memos are not rewritten and historical invoices are not backfilled.
 */
test('incomplete snapshot zero is currently indistinguishable from a confirmed zero', () => {
  const confirmedPercentZero = taxPercentFromInvoiceLine({
    quantity: 1,
    price: 10,
    tax_rate_type: 'percent',
    tax_rate: 0,
    tax_amount: 0,
  });
  const confirmedNonTaxable = taxPercentFromInvoiceLine({
    quantity: 1,
    price: 10,
    tax_amount: 0,
  });
  const incompleteLine = {
    quantity: 1,
    price: 10,
    tax_amount: 0,
    tax_snapshot: {
      version: 1,
      money_decision: 'incomplete',
      zero_confirmed: false,
      posted_tax_cents: 0,
    },
  };
  const incompleteSnapshot = taxPercentFromInvoiceLine(incompleteLine);
  assert.equal(confirmedPercentZero, 0);
  assert.equal(confirmedNonTaxable, 0);
  assert.equal(incompleteSnapshot, 0);
  assert.equal(incompleteSnapshot, confirmedNonTaxable);
});

test('a full return credits the merchandise and leaves the sales tax', () => {
  const line = customerCreditLineAmounts({ quantity: 5, unit_price: 40, tax_percent: 18 });
  assert.equal(line.tax_percent, 18);
  assert.equal(line.tax_amount, 0);
  assert.equal(line.total, 200);
});

test('an invoice is creditable only after pickup or delivery', () => {
  assert.equal(invoiceGoodsWithCustomer({ inventory_applied: false, fulfillment_method: 'unfulfilled' }), false);
  assert.equal(invoiceGoodsWithCustomer({ inventory_applied: false, fulfillment_method: 'shipment' }), false);
  assert.equal(invoiceGoodsWithCustomer({ inventory_applied: true, fulfillment_method: 'store_pickup' }), true);
  assert.equal(invoiceGoodsWithCustomer({ inventory_applied: true, fulfillment_method: 'shipment' }), true);
  assert.throws(
    () =>
      validateCustomerReturnLines({
        invoice: {
          customer_id: CUSTOMER,
          invoice_type: DOCUMENT_TYPE_INVOICE,
          inventory_applied: false,
          fulfillment_method: 'unfulfilled',
          items: [{ product_id: PRODUCT_A, product_name: 'Photoframe', quantity: 5, price: 40, tax_amount: 36 }],
        },
        customerId: CUSTOMER,
        existingMemos: [],
        requested: [{ product_id: PRODUCT_A, quantity: 5, unit_price: 40 }],
      }),
    /picked up or delivered/
  );
});

test('stock comes back only when the invoice already took stock and the reason is a return', () => {
  assert.equal(shouldCreditInventory({ reason: 'RETURN', invoice: { inventory_applied: true } }), true);
  assert.equal(shouldCreditInventory({ reason: 'RETURN', invoice: { inventory_applied: false } }), false);
  assert.equal(shouldCreditInventory({ reason: 'RETURN', invoice: {} }), true);
  assert.equal(shouldCreditInventory({ reason: 'RATE_DIFFERENCE', invoice: { inventory_applied: true } }), false);
});
