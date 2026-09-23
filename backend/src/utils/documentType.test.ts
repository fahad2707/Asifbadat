/**
 * Task 05 — quotation vs invoice document boundary.
 *
 * Run with:
 *     npx tsx --test src/utils/documentType.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DOCUMENT_TYPE_INVOICE,
  DOCUMENT_TYPE_QUOTATION,
  isOverdueReceivable,
  isQuotationType,
  isReceivableInvoiceType,
  nonQuotationMatch,
  quotationPaymentRejection,
  receivableInvoiceMatch,
  receivableOpenBalance,
  saleAmountFromInvoiceDocument,
  shouldAdjustInventoryForDocumentType,
} from './documentType';

const quotation = {
  invoice_type: DOCUMENT_TYPE_QUOTATION,
  total_amount: 16.99,
  amount_paid: 0,
  due_date: new Date('2020-01-01'),
};

const unpaidInvoice = {
  invoice_type: DOCUMENT_TYPE_INVOICE,
  total_amount: 216.99,
  amount_paid: 0,
  due_date: new Date('2020-01-01'),
};

const paidInvoice = {
  invoice_type: DOCUMENT_TYPE_INVOICE,
  total_amount: 100,
  amount_paid: 100,
  due_date: new Date('2020-01-01'),
};

test('creating a quotation must not adjust inventory', () => {
  assert.equal(shouldAdjustInventoryForDocumentType(DOCUMENT_TYPE_QUOTATION), false);
});

test('creating a normal invoice still adjusts inventory', () => {
  assert.equal(shouldAdjustInventoryForDocumentType(DOCUMENT_TYPE_INVOICE), true);
});

test('quotation does not appear in customer AR', () => {
  assert.equal(receivableOpenBalance(quotation), 0);
  assert.equal(isReceivableInvoiceType(quotation.invoice_type), false);
  assert.deepEqual(receivableInvoiceMatch, { invoice_type: DOCUMENT_TYPE_INVOICE });
});

test('normal invoice does appear in customer AR', () => {
  assert.equal(receivableOpenBalance(unpaidInvoice), 216.99);
  assert.equal(receivableOpenBalance(paidInvoice), 0);
  assert.equal(isReceivableInvoiceType(unpaidInvoice.invoice_type), true);
});

test('quotation is excluded from overdue and AR summary rules', () => {
  const now = new Date('2026-09-23');
  assert.equal(isOverdueReceivable(quotation, now), false);
  assert.equal(isOverdueReceivable(unpaidInvoice, now), true);
  assert.equal(isOverdueReceivable({ ...unpaidInvoice, due_date: new Date('2026-12-01') }, now), false);
});

test('quotation is excluded from sales/revenue aggregation of Invoice documents', () => {
  assert.equal(saleAmountFromInvoiceDocument(quotation), 0);
  assert.equal(saleAmountFromInvoiceDocument(unpaidInvoice), 216.99);
  assert.deepEqual(nonQuotationMatch, { invoice_type: { $ne: DOCUMENT_TYPE_QUOTATION } });
});

test('quotation cannot receive payment', () => {
  assert.equal(isQuotationType(DOCUMENT_TYPE_QUOTATION), true);
  const body = quotationPaymentRejection(['QTN#002']);
  assert.match(body.error, /Quotations cannot receive payment/);
  assert.match(body.error, /QTN#002/);
});

test('editing a quotation does not change stock or AR', () => {
  const editedQuote = { ...quotation, total_amount: 99.5, items: [{ quantity: 9 }] };
  assert.equal(shouldAdjustInventoryForDocumentType(editedQuote.invoice_type), false);
  assert.equal(receivableOpenBalance(editedQuote), 0);
});

test('route source keeps quotation inventory and payment gates explicit', () => {
  const root = join(process.cwd(), 'src');
  const invoices = readFileSync(join(root, 'routes/invoices.ts'), 'utf8');
  const customers = readFileSync(join(root, 'routes/customers.ts'), 'utf8');
  const admin = readFileSync(join(root, 'routes/admin.ts'), 'utf8');
  const paymentApplication = readFileSync(join(root, 'services/paymentApplication.ts'), 'utf8');

  assert.match(invoices, /shouldAdjustInventoryForDocumentType\(docType\)/);
  assert.match(invoices, /shouldAdjustInventoryForDocumentType\(invoice\.invoice_type\)/);
  assert.match(invoices, /paymentApplication/);
  assert.match(paymentApplication, /isQuotationType/);
  assert.match(paymentApplication, /Quotations cannot receive payment|quotationPaymentRejection/);
  assert.match(invoices, /receivableInvoiceMatch/);
  assert.match(customers, /receivableInvoiceMatch/);
  assert.match(admin, /nonQuotationMatch/);
  assert.equal(invoices.includes('document type is immutable'), true);
});
