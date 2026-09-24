/**
 * Task 07D-10E-02 — POS settlement and store-credit schema.
 *
 * Isolated: no Mongo connection. Validation uses validateSync().
 *
 * Run with:
 *     npx tsx --test src/models/PosReturnSettlement.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import PosReturnSettlement from './PosReturnSettlement';
import PosCustomerCredit from './PosCustomerCredit';

const RETURN_ID = new mongoose.Types.ObjectId('64b0000000000000000f0606');
const USER_ID = new mongoose.Types.ObjectId('64b0000000000000000e0505');
const SETTLEMENT_ID = new mongoose.Types.ObjectId('64b0000000000000000c0c0c');

test('settlement requires unique return_id and stores the Return merchandise amount', () => {
  const doc = new PosReturnSettlement({
    return_id: RETURN_ID,
    return_number: 'RET-1',
    amount: 90,
    refund_method: 'cash',
    settled_at: new Date('2026-02-01'),
  });
  assert.equal(doc.validateSync(), undefined);

  const path = PosReturnSettlement.schema.path('return_id') as { options?: { unique?: boolean } };
  assert.equal(path.options?.unique, true);

  const invalid = new PosReturnSettlement({
    return_id: RETURN_ID,
    return_number: 'RET-1',
    amount: 90,
    refund_method: 'card',
    settled_at: new Date(),
  });
  assert.ok(invalid.validateSync()?.errors.refund_method);
});

test('POS customer credit is a dedicated ledger entry keyed by return_id', () => {
  const doc = new PosCustomerCredit({
    customer_id: USER_ID,
    return_id: RETURN_ID,
    settlement_id: SETTLEMENT_ID,
    amount: 90,
    type: 'pos_return_credit',
    direction: 'credit',
  });
  assert.equal(doc.validateSync(), undefined);

  const path = PosCustomerCredit.schema.path('return_id') as { options?: { unique?: boolean } };
  assert.equal(path.options?.unique, true);

  const missingCustomer = new PosCustomerCredit({
    return_id: RETURN_ID,
    settlement_id: SETTLEMENT_ID,
    amount: 90,
    type: 'pos_return_credit',
    direction: 'credit',
  });
  assert.ok(missingCustomer.validateSync()?.errors.customer_id);
});
