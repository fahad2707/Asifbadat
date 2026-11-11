import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOC_PREFIX,
  convertedInvoicePrefix,
  nextPrefixedNumber,
  quotationPrefixForOrigin,
} from './documentNumbers';

function modelWith(numbers: string[], field = 'invoice_number') {
  const docs = numbers.map((invoice_number) => ({ [field]: invoice_number }));
  return {
    find() {
      return {
        select() {
          return this;
        },
        lean: async () => docs,
      };
    },
  };
}

test('quotation origin maps to a short prefix', () => {
  assert.equal(quotationPrefixForOrigin('rfq'), 'RQ#');
  assert.equal(quotationPrefixForOrigin('online'), 'WQ#');
  assert.equal(quotationPrefixForOrigin('quotation'), 'QTN#');
  assert.equal(quotationPrefixForOrigin(undefined), 'QTN#');
});

test('converted invoices use a different series from the source quote', () => {
  assert.equal(convertedInvoicePrefix('QTN#012'), 'QI#');
  assert.equal(convertedInvoicePrefix('RQ#001'), 'RI#');
  assert.equal(convertedInvoicePrefix('WQ#008'), 'WI#');
  assert.equal(convertedInvoicePrefix('odd'), 'QI#');
});

test('nextPrefixedNumber increments the numeric suffix for that prefix only', async () => {
  const n = await nextPrefixedNumber(
    modelWith(['INV#001', 'QI#002', 'INV#009', 'INV#010']),
    'invoice_number',
    DOC_PREFIX.invoice
  );
  assert.equal(n, 'INV#011');
});

test('nextPrefixedNumber starts at 001', async () => {
  const n = await nextPrefixedNumber(modelWith([]), 'po_number', DOC_PREFIX.purchaseOrder);
  assert.equal(n, 'PO#001');
});
