/**
 * Task 07B-04 — invoice PUT financial invariants.
 *
 * Run with:
 *     npx tsx --test src/utils/invoiceEditFinancial.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCUMENT_TYPE_INVOICE } from './documentType';
import { assertReceivableInvoiceEdit } from './invoiceFinancialState';
import { PaymentApplicationError } from '../services/paymentApplication';

test('unpaid invoice edit to a higher total remains unpaid', () => {
  const state = assertReceivableInvoiceEdit({
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 120,
    amount_paid: 0,
  });
  assert.equal(state.total, 120);
  assert.equal(state.amount_paid, 0);
  assert.equal(state.payment_status, 'unpaid');
});

test('partial-payment edit that remains valid preserves amount_paid', () => {
  const state = assertReceivableInvoiceEdit({
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 120,
    amount_paid: 40,
  });
  assert.equal(state.total, 120);
  assert.equal(state.amount_paid, 40);
  assert.equal(state.payment_status, 'unpaid');
});

test('fully-paid invoice edited above amount_paid becomes unpaid', () => {
  const state = assertReceivableInvoiceEdit({
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 120,
    amount_paid: 100,
  });
  assert.equal(state.total, 120);
  assert.equal(state.amount_paid, 100);
  assert.equal(state.payment_status, 'unpaid');
});

test('edit that would make amount_paid greater than total is rejected', () => {
  const invoice = {
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 60,
    amount_paid: 80,
    payment_status: 'unpaid',
  };
  assert.throws(
    () => assertReceivableInvoiceEdit(invoice),
    (err: unknown) => {
      assert.ok(err instanceof PaymentApplicationError);
      assert.equal(err.status, 400);
      assert.match(err.message, /already paid/i);
      return true;
    }
  );
  assert.equal(invoice.total_amount, 60);
  assert.equal(invoice.amount_paid, 80);
  assert.equal(invoice.payment_status, 'unpaid');
});

test('PUT invoice route validates proposed totals before save', () => {
  const invoices = readFileSync(join(process.cwd(), 'src/routes/invoices.ts'), 'utf8');
  const putAt = invoices.indexOf("router.put('/:id'");
  assert.ok(putAt >= 0);
  const validateAt = invoices.indexOf('assertReceivableInvoiceEdit', putAt);
  const inventoryAt = invoices.indexOf('shouldAdjustInventoryForDocumentType(invoice.invoice_type)', putAt);
  const saveAt = invoices.indexOf('await invoice.save()', putAt);
  assert.ok(validateAt > putAt && inventoryAt > validateAt && saveAt > inventoryAt);
});
