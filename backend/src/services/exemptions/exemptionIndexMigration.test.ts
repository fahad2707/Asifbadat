/**
 * Conflict grouping for the active exemption index. No database.
 *
 * Run with:
 *     npx tsx --test src/services/exemptions/exemptionIndexMigration.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IndexDescription } from 'mongodb';
import { ACTIVE_CUSTOMER_CERTIFICATE_INDEX } from '../../models/SalesTaxExemption';
import { activeCertificateIndexMatches, conflictsFromGroups, exemptionIndexWarnings, formatExemptionIndexWarnings } from './exemptionIndexMigration';

test('only repeated active certificate keys are conflicts', () => {
  const conflicts = conflictsFromGroups([
    { _id: { customer_id: 'customer-a', certificate_key: 'QA-1' }, ids: ['1', '2'], count: 2 },
    { _id: { customer_id: 'customer-a', certificate_key: 'QA-2' }, ids: ['3'], count: 1 },
    { _id: { customer_id: 'customer-b', certificate_key: 'QA-1' }, ids: ['4'], count: 1 },
  ]);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0], {
    customerId: 'customer-a',
    certificateKey: 'QA-1',
    ids: ['1', '2'],
  });
});

test('missing keys and case variants are warnings, not blocking conflicts', () => {
  const warnings = exemptionIndexWarnings([
    { id: '1', customerId: 'customer-a', status: 'draft', certificateKey: undefined },
    { id: '2', customerId: 'customer-a', status: 'rejected', certificateKey: null },
    { id: '3', customerId: 'customer-a', status: 'approved', certificateKey: 'ABC-123' },
    { id: '4', customerId: 'customer-a', status: 'draft', certificateKey: 'abc-123' },
    { id: '5', customerId: 'customer-b', status: 'approved', certificateKey: 'abc-123' },
    { id: '6', customerId: 'customer-a', status: 'expired', certificateKey: 'abc-123' },
    { id: '7', customerId: 'customer-a', status: 'draft', certificateKey: 'QA-EXACT' },
    { id: '8', customerId: 'customer-a', status: 'draft', certificateKey: 'QA-EXACT' },
  ]);
  assert.equal(warnings.missingCertificateKey.count, 2);
  assert.equal(warnings.missingCertificateKey.activeCount, 1);
  assert.deepEqual(warnings.missingCertificateKey.sampleIds, ['1', '2']);
  assert.equal(warnings.caseVariantGroups.length, 1);
  assert.equal(warnings.caseVariantGroups[0]?.customerId, 'customer-a');
  assert.equal(warnings.caseVariantGroups[0]?.normalizedKey, 'ABC-123');
  assert.deepEqual(warnings.caseVariantGroups[0]?.storedKeys, ['ABC-123', 'abc-123']);
  assert.match(formatExemptionIndexWarnings(warnings).join('\n'), /does not cover them/);
  assert.match(formatExemptionIndexWarnings(warnings).join('\n'), /stored key exactly/);
});

test('the declared partial unique index matches and a different index does not', () => {
  const declared: IndexDescription = {
    name: ACTIVE_CUSTOMER_CERTIFICATE_INDEX.options.name,
    key: { ...ACTIVE_CUSTOMER_CERTIFICATE_INDEX.fields },
    unique: true,
    partialFilterExpression: ACTIVE_CUSTOMER_CERTIFICATE_INDEX.options.partialFilterExpression,
  };
  assert.equal(activeCertificateIndexMatches(declared), true);
  assert.equal(activeCertificateIndexMatches({ ...declared, unique: false }), false);
  assert.equal(activeCertificateIndexMatches({ ...declared, key: { customer_id: 1 } }), false);
  assert.equal(activeCertificateIndexMatches({
    ...declared,
    partialFilterExpression: { status: { $in: ['draft'] } },
  }), false);
});
