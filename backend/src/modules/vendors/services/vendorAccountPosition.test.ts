import assert from 'node:assert/strict';
import test from 'node:test';
import { vendorAccountPosition, vendorCreditCoversUnpaidBills } from './vendorAccountPosition';

test('paid PO then $90 vendor credit is a $90 receivable from the supplier', () => {
  const pos = vendorAccountPosition({ purchases: 180, paid: 180, credits_open: 90 });
  assert.equal(pos.payable, 0);
  assert.equal(pos.receivable, 90);
  assert.equal(pos.account_position, -90);
});

test('unpaid PO is payable in red', () => {
  const pos = vendorAccountPosition({ purchases: 180, paid: 0, credits_open: 0 });
  assert.equal(pos.payable, 180);
  assert.equal(pos.receivable, 0);
});

test('open credit against unpaid PO reduces what we still pay', () => {
  const pos = vendorAccountPosition({ purchases: 180, paid: 0, credits_open: 90 });
  assert.equal(pos.payable, 90);
  assert.equal(pos.receivable, 0);
});

test('cash received on the credit leaves the next bill unaffected', () => {
  const pos = vendorAccountPosition({ purchases: 180, paid: 180, credits_open: 0, credits_received: 90 });
  assert.equal(pos.payable, 0);
  assert.equal(pos.receivable, 0);
});

test('credit that still covers unpaid bills cannot be collected as cash', () => {
  assert.equal(vendorCreditCoversUnpaidBills(80), true);
  assert.equal(vendorCreditCoversUnpaidBills(0), false);
  assert.equal(vendorCreditCoversUnpaidBills(-10), false);
});
