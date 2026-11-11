import assert from 'node:assert/strict';
import { test } from 'node:test';
import { titleCaseWords } from './titleCaseWords';

test('capitalizes the first letter of every word', () => {
  assert.equal(titleCaseWords('basmati rice 5kg'), 'Basmati Rice 5kg');
  assert.equal(titleCaseWords('frozen vegetables'), 'Frozen Vegetables');
  assert.equal(titleCaseWords('  dairy  &  cheese'), '  Dairy  &  Cheese');
});
