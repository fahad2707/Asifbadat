/**
 * Task 07B-02 — invoice financial-state helper.
 *
 * Run with:
 *     npx tsx --test src/utils/invoiceFinancialState.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_TYPE_INVOICE, DOCUMENT_TYPE_QUOTATION } from './documentType';
import { invoiceFinancialState } from './invoiceFinancialState';

const now = new Date('2026-09-23T12:00:00.000Z');

test('unpaid invoice: full balance due', () => {
  const state = invoiceFinancialState({
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 0,
    due_date: new Date('2026-12-01'),
  }, now);
  assert.equal(state.total, 100);
  assert.equal(state.amount_paid, 0);
  assert.equal(state.balance_due, 100);
  assert.equal(state.payment_status, 'unpaid');
  assert.equal(state.overdue, false);
});

test('partial payment remains unpaid', () => {
  const state = invoiceFinancialState({
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 40,
  }, now);
  assert.equal(state.balance_due, 60);
  assert.equal(state.payment_status, 'unpaid');
});

test('fully paid invoice has zero balance', () => {
  const state = invoiceFinancialState({
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 100,
    due_date: new Date('2020-01-01'),
  }, now);
  assert.equal(state.balance_due, 0);
  assert.equal(state.payment_status, 'paid');
  assert.equal(state.overdue, false);
});

test('amount_paid >= total is paid', () => {
  const state = invoiceFinancialState({
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 80,
    amount_paid: 80,
  }, now);
  assert.equal(state.payment_status, 'paid');
  assert.equal(state.balance_due, 0);

  const over = invoiceFinancialState({
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 80,
    amount_paid: 90,
  }, now);
  assert.equal(over.payment_status, 'paid');
});

test('past due with positive balance is overdue', () => {
  const state = invoiceFinancialState({
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 40,
    due_date: new Date('2020-01-01'),
  }, now);
  assert.equal(state.balance_due, 60);
  assert.equal(state.overdue, true);
  assert.equal(state.payment_status, 'unpaid');
});

test('past due but paid is not overdue', () => {
  const state = invoiceFinancialState({
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 100,
    due_date: new Date('2020-01-01'),
  }, now);
  assert.equal(state.balance_due, 0);
  assert.equal(state.overdue, false);
});

test('quotation is not an overdue or AR receivable', () => {
  const state = invoiceFinancialState({
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    total_amount: 16.99,
    amount_paid: 0,
    due_date: new Date('2020-01-01'),
  }, now);
  assert.equal(state.overdue, false);
});
