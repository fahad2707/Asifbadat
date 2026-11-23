import test from 'node:test';
import assert from 'node:assert/strict';
import { containsQuery, escapeRegex, isExactCode, sortDeskHits, type DeskHit } from './adminDeskSearch';

test('escapeRegex keeps invoice numbers searchable', () => {
  assert.equal(escapeRegex('INV.001'), 'INV\\.001');
  assert.equal(containsQuery('Tax Display Customer', 'display'), true);
  assert.equal(isExactCode('INV#001', 'inv#001'), true);
  assert.equal(isExactCode('INV#001', 'INV#'), false);
});

test('customer hits sort ahead of other matches, exact codes first', () => {
  const hits: DeskHit[] = [
    { type: 'Product', title: 'Flowers', subtitle: '', href: '/p', exact: false },
    { type: 'Invoice', title: 'INV#001', subtitle: 'Tax Display Customer', href: '/i', exact: false },
    { type: 'Customer', title: 'Tax Display Customer', subtitle: 'C10016', href: '/c', exact: false },
    { type: 'Invoice', title: 'INV#001', subtitle: '', href: '/i2', exact: true },
  ];
  const sorted = sortDeskHits(hits);
  assert.equal(sorted[0].exact, true);
  assert.equal(sorted[1].type, 'Customer');
  assert.equal(sorted[2].type, 'Invoice');
});
