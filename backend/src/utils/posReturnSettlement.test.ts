/**
 * Task 07D-10E-02 — POS return settlement helpers.
 *
 * Isolated: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/utils/posReturnSettlement.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPosReturnSettlementResponse,
  isReturnSettlementDuplicateKey,
  posReturnHasEligibleCreditCustomer,
  posReturnSettlementClaimFilter,
  posReturnSettlementClaimUpdate,
} from './posReturnSettlement';

const RETURN_ID = '64b0000000000000000f0606';

test('claim filter matches only unsettled returns', () => {
  assert.deepEqual(posReturnSettlementClaimFilter(RETURN_ID), {
    _id: RETURN_ID,
    $or: [{ settlement_status: 'unsettled' }, { settlement_status: { $exists: false } }],
  });
});

test('claim update sets settlement state and does not touch sale economics', () => {
  const settled_at = new Date('2026-02-01T00:00:00.000Z');
  const update = posReturnSettlementClaimUpdate({
    settled_at,
    refund_method: 'cheque',
    cheque_reference: 'CHK-1',
    settlement_id: 'settle-1',
  });
  assert.deepEqual(update.$set, {
    settlement_status: 'settled',
    settled_at,
    refund_method: 'cheque',
    cheque_reference: 'CHK-1',
    settlement_id: 'settle-1',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(update, '$inc'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(update.$set, 'total_refund'), false);
});

test('credit eligibility requires a customer_id and walk-in is ineligible', () => {
  assert.equal(posReturnHasEligibleCreditCustomer({ customer_id: '64b0000000000000000e0505' }), true);
  assert.equal(posReturnHasEligibleCreditCustomer({}), false);
  assert.equal(posReturnHasEligibleCreditCustomer({ customer_id: undefined }), false);
});

test('isReturnSettlementDuplicateKey accepts only 11000 on return_id', () => {
  assert.equal(isReturnSettlementDuplicateKey({ code: 11000, keyPattern: { return_id: 1 } }), true);
  assert.equal(
    isReturnSettlementDuplicateKey({ code: 11000, message: 'E11000 duplicate key: return_id' }),
    true
  );
  assert.equal(isReturnSettlementDuplicateKey({ code: 11000, keyPattern: { idempotency_key: 1 } }), false);
  assert.equal(isReturnSettlementDuplicateKey({ code: 50 }), false);
});

test('formatPosReturnSettlementResponse preserves ids', () => {
  const payload = formatPosReturnSettlementResponse(
    { _id: 'set-1', amount: 90, toObject() { return { amount: 90 }; } },
    { _id: 'ret-1', total_refund: 90, toObject() { return { total_refund: 90 }; } }
  );
  assert.equal(payload.settlement.id, 'set-1');
  assert.equal(payload.return.id, 'ret-1');
  assert.equal(payload.settlement.amount, 90);
});
