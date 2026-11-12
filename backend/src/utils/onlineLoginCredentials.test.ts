import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeCustomerCode, onlinePasswordFromName, pickLoginIdentifier } from './onlineLoginCredentials';

test('password is first name with leading capital plus 321', () => {
  assert.equal(onlinePasswordFromName('afzal'), 'Afzal321');
  assert.equal(onlinePasswordFromName('Afzal Rahman'), 'Afzal321');
  assert.equal(onlinePasswordFromName('  AFZAL  '), 'Afzal321');
});

test('empty name falls back to Customer321', () => {
  assert.equal(onlinePasswordFromName(''), 'Customer321');
});

test('customer codes match C plus 4–6 digits', () => {
  assert.equal(looksLikeCustomerCode('C48291'), true);
  assert.equal(looksLikeCustomerCode('c12345'), true);
  assert.equal(looksLikeCustomerCode('C418779'), true);
  assert.equal(looksLikeCustomerCode('afzal@example.com'), false);
});

test('pickLoginIdentifier prefers customer_code over email', () => {
  assert.equal(pickLoginIdentifier({ email: 'a@b.com', customer_code: 'C48291' }), 'C48291');
  assert.equal(pickLoginIdentifier({ email: 'C418779' }), 'C418779');
});
