import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canApproveApplication,
  canBindMatchedCustomer,
  candidateCustomerIds,
  needsManualResolution,
} from './websiteSignupResolution';

const USER = '64b0000000000000000a0001';
const CUSTOMER = '64b0000000000000000c0001';
const OTHER = '64b0000000000000000c0002';

test('Manik-style unlinked non_approved_crm needs bind workflow, not Approve', () => {
  const app = {
    status: 'pending' as const,
    link_outcome: 'unlinked' as const,
    match_kind: 'non_approved_crm' as const,
    user_id: USER,
    customer_id: null,
    matched_customer_ids: [CUSTOMER],
  };
  assert.equal(canApproveApplication(app), false);
  assert.equal(needsManualResolution(app), true);
  assert.equal(canBindMatchedCustomer(app), true);
  assert.deepEqual(candidateCustomerIds(app), [CUSTOMER]);
});

test('ambiguous matches require bind with a candidate list', () => {
  const app = {
    status: 'pending' as const,
    link_outcome: 'unlinked' as const,
    match_kind: 'ambiguous' as const,
    user_id: USER,
    customer_id: null,
    matched_customer_ids: [CUSTOMER, OTHER],
  };
  assert.equal(canBindMatchedCustomer(app), true);
  assert.deepEqual(candidateCustomerIds(app), [CUSTOMER, OTHER]);
});

test('already_linked cannot bind from the queue', () => {
  const app = {
    status: 'pending' as const,
    link_outcome: 'unlinked' as const,
    match_kind: 'already_linked' as const,
    user_id: USER,
    customer_id: null,
    matched_customer_ids: [CUSTOMER],
  };
  assert.equal(canBindMatchedCustomer(app), false);
  assert.equal(needsManualResolution(app), true);
});

test('safe created path stays on Approve', () => {
  const app = {
    status: 'pending' as const,
    link_outcome: 'created' as const,
    match_kind: 'none' as const,
    user_id: USER,
    customer_id: CUSTOMER,
    matched_customer_ids: [],
  };
  assert.equal(canApproveApplication(app), true);
  assert.equal(needsManualResolution(app), false);
  assert.equal(canBindMatchedCustomer(app), false);
});
