/**
 * Exemption identity rules. No database.
 *
 * Run with:
 *     npx tsx --test src/services/exemptions/exemptionDraft.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { certificateKey, isExemptionDuplicateKey } from './exemptionDraft';

test('certificate keys ignore case and extra spaces and keep the number intact', () => {
  assert.equal(certificateKey('  qa-cert-1 '), 'QA-CERT-1');
  assert.equal(certificateKey('qa   cert'), 'QA CERT');
  assert.equal(certificateKey('QA-CERT-1'), certificateKey('qa-cert-1'));
  assert.equal(certificateKey(''), null);
  assert.equal(certificateKey('   '), null);
  assert.equal(certificateKey('QA-CERT-1') === certificateKey('QA-CERT-2'), false);
});

test('only the active certificate index is treated as an exemption duplicate', () => {
  assert.equal(isExemptionDuplicateKey({ code: 11000, keyPattern: { certificate_key: 1, customer_id: 1 } }), true);
  assert.equal(isExemptionDuplicateKey({ code: 11000, message: 'E11000 duplicate key error index: active_customer_certificate' }), true);
  assert.equal(isExemptionDuplicateKey({ code: 11000, message: 'E11000 duplicate key error index: email_1' }), false);
  assert.equal(isExemptionDuplicateKey({ code: 121, message: 'active_customer_certificate' }), false);
});
