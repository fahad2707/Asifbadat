import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInvoiceTaxes, taxMarkFromName } from './invoiceTaxDisplay';

test('a taxable GST line is marked GST and a non-taxable line has no mark', () => {
  assert.equal(taxMarkFromName('GST', true), 'GST');
  assert.equal(taxMarkFromName('PAT', true), 'PAT');
  assert.equal(taxMarkFromName('GST', false), '');
});

test('invoice tax groups each named tax and leaves the merchandise prices alone', () => {
  const groups = summarizeInvoiceTaxes([
    { product_name: 'Flowers', taxable: true, tax_type_name: 'GST', tax_amount: 1.8 },
    { product_name: 'Photoframe', taxable: true, tax_type_name: 'VAT', tax_amount: 1.2 },
    { product_name: 'Card', taxable: false, tax_type_name: 'No Tax', tax_amount: 0 },
    { product_name: 'Ribbon', taxable: true, tax_type_name: 'GST', tax_amount: 0.9 },
  ]);
  assert.deepEqual(groups, [
    { mark: 'GST', name: 'GST', amount: 2.7 },
    { mark: 'VAT', name: 'VAT', amount: 1.2 },
  ]);
});
