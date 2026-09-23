/**
 * Task 07B-03 — invoice list unpaid_only uses derived financial state.
 *
 * Run with:
 *     npx tsx --test src/utils/invoiceListFilter.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCUMENT_TYPE_INVOICE, DOCUMENT_TYPE_QUOTATION } from './documentType';
import {
  derivedUnpaidReceivableMatch,
  isUnpaidOnlyListEligible,
} from './invoiceFinancialState';

test('ordinary unpaid invoice appears in unpaid_only', () => {
  assert.equal(
    isUnpaidOnlyListEligible({
      invoice_type: DOCUMENT_TYPE_INVOICE,
      total_amount: 100,
      amount_paid: 0,
    }),
    true
  );
});

test('partial payment appears in unpaid_only', () => {
  assert.equal(
    isUnpaidOnlyListEligible({
      invoice_type: DOCUMENT_TYPE_INVOICE,
      total_amount: 100,
      amount_paid: 40,
    }),
    true
  );
});

test('paid invoice does not appear in unpaid_only', () => {
  assert.equal(
    isUnpaidOnlyListEligible({
      invoice_type: DOCUMENT_TYPE_INVOICE,
      total_amount: 100,
      amount_paid: 100,
    }),
    false
  );
});

test('stored paid with zero amount_paid follows derived unpaid', () => {
  const storedPaidZeroPaid = {
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 0,
    payment_status: 'paid',
  };
  assert.equal(isUnpaidOnlyListEligible(storedPaidZeroPaid), true);
});

test('stored unpaid with full amount_paid follows derived paid', () => {
  const storedUnpaidFullyPaid = {
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 100,
    payment_status: 'unpaid',
  };
  assert.equal(isUnpaidOnlyListEligible(storedUnpaidFullyPaid), false);
});

test('quotation is not an unpaid receivable', () => {
  assert.equal(
    isUnpaidOnlyListEligible({
      invoice_type: DOCUMENT_TYPE_QUOTATION,
      total_amount: 16.99,
      amount_paid: 0,
    }),
    false
  );
});

test('unpaid_only Mongo match uses $expr field comparison, not stored payment_status', () => {
  assert.equal(derivedUnpaidReceivableMatch.invoice_type, DOCUMENT_TYPE_INVOICE);
  assert.ok(derivedUnpaidReceivableMatch.$expr);
  const invoices = readFileSync(join(process.cwd(), 'src/routes/invoices.ts'), 'utf8');
  assert.match(invoices, /derivedUnpaidReceivableMatch/);
  assert.equal(invoices.includes("query.payment_status = 'unpaid'"), false);
});
