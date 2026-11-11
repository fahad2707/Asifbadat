import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fallbackCustomerCode, randomCustomerCode } from './customerCode';

test('random customer codes are C plus 5 digits', () => {
  for (let i = 0; i < 20; i++) {
    const code = randomCustomerCode();
    assert.match(code, /^C\d{5}$/);
  }
});

test('fallback customer codes are C plus 5 digits', () => {
  assert.match(fallbackCustomerCode(), /^C\d{5}$/);
});
