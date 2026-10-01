/**
 * TAX-07 — customer exemption preview helpers.
 *
 * Run with:
 *     npx tsx --test lib/tax-type.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CUSTOMER_EXEMPT_TAX_LABEL,
  customerIsCurrentlyExempt,
  inheritInvoiceLineTax,
} from './tax-type';

const gst = {
  name: 'ABC',
  tax_type_configured: true,
  tax_type_id: '64b1c2d3e4f5a6b7c8d9e0f1',
  tax_type_label: 'GST — 18%',
  tax_type: { id: '64b1c2d3e4f5a6b7c8d9e0f1', name: 'GST', rate: 18, rate_type: 'percent' },
};

const noTax = {
  name: 'XYZ',
  tax_type_configured: true,
  tax_type_id: null as string | null,
  tax_type_label: 'No Tax',
  tax_type: null,
};

test('customerIsCurrentlyExempt is true only for explicit true', () => {
  assert.equal(customerIsCurrentlyExempt({ tax_exempt: true }), true);
  assert.equal(customerIsCurrentlyExempt({ tax_exempt: false }), false);
  assert.equal(customerIsCurrentlyExempt({}), false);
  assert.equal(customerIsCurrentlyExempt(null), false);
  assert.equal(customerIsCurrentlyExempt(undefined), false);
  assert.equal(customerIsCurrentlyExempt({ tax_exempt: 'true' }), false);
});

test('1 — exempt customer previews GST as Customer Exempt', () => {
  const snap = inheritInvoiceLineTax(gst, 100, customerIsCurrentlyExempt({ tax_exempt: true }));
  assert.equal(snap.taxable, false);
  assert.equal(snap.tax_exempt, true);
  assert.equal(snap.tax_amount, 0);
  assert.equal(snap.tax_type_label, CUSTOMER_EXEMPT_TAX_LABEL);
  assert.equal(snap.tax_rate, 18);
});

test('2 — non-exempt customer previews GST 18%', () => {
  const snap = inheritInvoiceLineTax(gst, 100, customerIsCurrentlyExempt({ tax_exempt: false }));
  assert.equal(snap.taxable, true);
  assert.notEqual(snap.tax_exempt, true);
  assert.equal(snap.tax_amount, 18);
  assert.equal(snap.tax_type_label, 'GST — 18%');
});

test('3/4 — stored snapshot recalculation is independent of live exemption helper', () => {
  assert.equal(customerIsCurrentlyExempt({ tax_exempt: true }), true);
  const gstSnap = inheritInvoiceLineTax(gst, 100, false);
  const noneSnap = inheritInvoiceLineTax(noTax, 7.5, false);
  assert.equal(gstSnap.taxable, true);
  assert.equal(gstSnap.tax_amount, 18);
  assert.equal(noneSnap.taxable, false);
  assert.equal(noneSnap.tax_type_label, 'No Tax');
  assert.notEqual(noneSnap.tax_exempt, true);
});

test('invoice editor keeps edit-mode snapshot lines and syncs live exemption for new lines', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../components/admin/InvoiceFormLightbox.tsx'), 'utf8');
  assert.match(src, /customerIsCurrentlyExempt/);
  assert.match(src, /if \(!isOpen \|\| editId \|\| !usesLineTax\) return/);
  assert.match(src, /lineFromProduct\(product, 1, usePrice, undefined, usesLineTax, customerTaxExempt\)/);
  assert.match(src, /Existing lines keep their stored tax/);
  assert.equal(src.includes('!editId && customerTaxExempt'), false);
});
