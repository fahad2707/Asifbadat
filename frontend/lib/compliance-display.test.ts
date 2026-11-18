import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  actorLabel,
  filterByText,
  formatAuditTime,
  formatCents,
  formatCount,
  formatPacks,
  listPhase,
  nextReportAction,
  submissionAllowed,
  validateMovement,
  validatePeriod,
  viewState,
} from './compliance-display';

test('missing counts and money stay unavailable, including a recorded zero', () => {
  assert.equal(formatCount({ availability: 'unavailable', reason: 'period' }), 'Not available');
  assert.equal(formatCount({ availability: 'recorded', count: 0 }), '0');
  assert.equal(formatCents({ availability: 'unavailable', reason: 'missing' }), 'Not available');
  assert.equal(formatCents({ availability: 'recorded_preview', cents: 0 }), '$0.00');
  assert.equal(formatCents({ availability: 'recorded_preview', cents: 600 }), '$6.00');
});

test('report actions never offer filing', () => {
  assert.equal(nextReportAction('preview')?.status, 'needs_review');
  assert.equal(nextReportAction('needs_review')?.label, 'Approve preview');
  assert.equal(nextReportAction('filed'), null);
  assert.equal(nextReportAction('filing_ready'), null);
  assert.notEqual(nextReportAction('approved')?.status, 'filed');
});

test('a recorded zero pack is not the same as inventory that was not established', () => {
  assert.equal(formatPacks({ availability: 'recorded', packs: 0 }), '0');
  assert.equal(formatPacks({ availability: 'recorded', packs: 8 }), '8');
  assert.equal(formatPacks({ availability: 'unavailable', reason: 'opening_not_established' }), 'Not established');
  assert.equal(formatPacks(0), 'Not established');
  assert.equal(formatPacks(null), 'Not established');
});

test('reads stay in loading until the request finishes, including a slow or failed read', () => {
  assert.equal(listPhase({ requested: false, loading: false, count: 0 }), 'idle');
  assert.equal(listPhase({ requested: true, loading: true, count: 0 }), 'loading');
  assert.equal(listPhase({ requested: true, loading: true, count: 3 }), 'refreshing');
  assert.equal(listPhase({ requested: true, loading: false, count: 0 }), 'empty');
  assert.equal(listPhase({ requested: true, loading: false, count: 2 }), 'ready');
  assert.equal(listPhase({ requested: true, loading: false, error: 'down', count: 0 }), 'error');
  assert.equal(listPhase({ requested: true, loading: true, authFailed: true, count: 0 }), 'auth');
});

test('audit times are labeled UTC and unnamed administrators stay unnamed', () => {
  assert.match(formatAuditTime('2026-11-17T18:09:59.909Z'), /17 Nov 2026, 18:09 UTC/);
  assert.equal(formatAuditTime('not-a-date'), 'Time not recorded');
  assert.equal(actorLabel({ label: 'QA Compliance' }), 'QA Compliance');
  assert.equal(actorLabel({ label: 'Administrator 3d9b' }), 'Administrator 3d9b');
  assert.equal(actorLabel(null), 'User not recorded');
});

test('period, movement, search, and submit guards', () => {
  assert.equal(validatePeriod('', '2026-11-30'), 'Choose a start and end date.');
  assert.equal(validatePeriod('2026-11-30', '2026-11-01'), 'The start date must be on or before the end date.');
  assert.equal(validatePeriod('2026-11-01', '2026-11-30'), null);
  assert.match(validateMovement({ productId: 'abc', quantity: '1.5', reason: '', movementType: 'sale' }) || '', /whole number|product|reason/);
  assert.equal(validateMovement({ productId: 'a'.repeat(24), quantity: '2', reason: 'Count', movementType: 'sale' }), null);
  assert.equal(submissionAllowed(true), false);
  assert.equal(submissionAllowed(false), true);
  assert.equal(viewState(true, '', 0), 'loading');
  assert.equal(viewState(false, 'failed', 0), 'error');
  assert.equal(viewState(false, '', 0), 'empty');
  const rows = filterByText([{ number: 'INV-1' }, { number: 'POS-2' }], 'pos', (row) => row.number);
  assert.deepEqual(rows, [{ number: 'POS-2' }]);
});
