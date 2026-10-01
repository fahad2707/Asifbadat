import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  formatTaxTypeLabel,
  hasExplicitTaxTypeField,
  parseTaxTypeIdInput,
  staffTaxTypeFields,
} from './productTaxType';

test('formatTaxTypeLabel uses percent and amount forms', () => {
  assert.equal(formatTaxTypeLabel({ name: 'GST', rate: 18, rate_type: 'percent' }), 'GST — 18%');
  assert.equal(formatTaxTypeLabel({ name: 'VAT', rate: 12, rate_type: 'percent' }), 'VAT — 12%');
  assert.equal(formatTaxTypeLabel({ name: 'CAST', rate: 2, rate_type: 'amount' }), 'CAST — $2');
  assert.equal(formatTaxTypeLabel({ name: 'CAST', rate: 2.5, rate_type: 'amount' }), 'CAST — $2.5');
});

test('missing tax_type_id is not configured; null is No Tax', () => {
  assert.equal(hasExplicitTaxTypeField({ name: 'ABC' }), false);
  assert.equal(staffTaxTypeFields({}).tax_type_label, 'Not configured');
  assert.equal(staffTaxTypeFields({}).tax_type_configured, false);
  assert.equal(staffTaxTypeFields({ tax_type_id: null }).tax_type_label, 'No Tax');
  assert.equal(staffTaxTypeFields({ tax_type_id: null }).tax_type_configured, true);
});

test('parseTaxTypeIdInput distinguishes omit, no tax, and assigned', () => {
  assert.deepEqual(parseTaxTypeIdInput(undefined), { kind: 'omit' });
  assert.deepEqual(parseTaxTypeIdInput(null), { kind: 'no_tax' });
  assert.deepEqual(parseTaxTypeIdInput(''), { kind: 'no_tax' });
  const id = '64b1c2d3e4f5a6b7c8d9e0f1';
  const parsed = parseTaxTypeIdInput(id);
  assert.equal(parsed.kind, 'assigned');
  if (parsed.kind === 'assigned') {
    assert.ok(parsed.id instanceof mongoose.Types.ObjectId);
    assert.equal(parsed.id.toString(), id);
  }
});

test('parseTaxTypeIdInput rejects invalid ids', () => {
  assert.throws(() => parseTaxTypeIdInput('not-an-id'), /Invalid tax_type_id/);
  assert.throws(() => parseTaxTypeIdInput(18), /Invalid tax_type_id/);
});

test('assigned populated TaxType formats a human label', () => {
  const fields = staffTaxTypeFields({
    tax_type_id: { _id: '64b1c2d3e4f5a6b7c8d9e0f1', name: 'GST', rate: 18, rate_type: 'percent' },
  });
  assert.equal(fields.tax_type_configured, true);
  assert.equal(fields.tax_type_id, '64b1c2d3e4f5a6b7c8d9e0f1');
  assert.equal(fields.tax_type_label, 'GST — 18%');
});
