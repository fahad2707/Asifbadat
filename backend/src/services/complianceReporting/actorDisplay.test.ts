/**
 * Audit display names. No database.
 *
 * Run with:
 *     npx tsx --test src/services/complianceReporting/actorDisplay.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actorFromName, attachActors } from './actorDisplay';

const ADMIN_ID = '6afc9826cbcbb3a823ca3d9b';

test('a stored admin name is shown and a missing name is not invented', () => {
  assert.deepEqual(actorFromName(ADMIN_ID, 'QA Compliance'), {
    id: ADMIN_ID,
    name: 'QA Compliance',
    label: 'QA Compliance',
  });
  const unnamed = actorFromName(ADMIN_ID, '   ');
  assert.equal(unnamed.name, null);
  assert.equal(unnamed.label, 'Administrator 3d9b');
  assert.equal(actorFromName(ADMIN_ID, null).label, 'Administrator 3d9b');
  assert.equal(actorFromName(null, null).label, 'User not recorded');
  assert.equal(actorFromName('not-an-id', 'QA Compliance').id, null);
});

test('attachActors uses the lookup name and keeps the original id', async () => {
  const rows = await attachActors(
    [{ admin_id: ADMIN_ID, action: 'sales_tax_exemption_draft_created' }],
    'admin_id',
    async () => [{ _id: ADMIN_ID, name: 'QA Compliance' }]
  );
  assert.equal(rows[0].admin_id, ADMIN_ID);
  assert.equal(rows[0].actor.label, 'QA Compliance');
  const missing = await attachActors([{ created_by: ADMIN_ID }], 'created_by', async () => []);
  assert.equal(missing[0].actor.name, null);
  assert.equal(missing[0].actor.label, 'Administrator 3d9b');
});
