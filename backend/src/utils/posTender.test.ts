/**
 * Task 07D-04 — POS tender total must equal sale total.
 *
 * Run with:
 *     npx tsx --test src/utils/posTender.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePosTenders, PosTenderError } from './posTender';

test('non-split cash equal to sale total is accepted', () => {
  const tenders = normalizePosTenders('cash', { cash: 100 }, 100);
  assert.equal(tenders.cash, 100);
  assert.equal(tenders.total, 100);
});

test('non-split omitted split is treated as full tender of the method', () => {
  const tenders = normalizePosTenders('card', undefined, 55.5);
  assert.equal(tenders.card, 55.5);
  assert.equal(tenders.total, 55.5);
});

test('non-split underpayment is rejected', () => {
  assert.throws(
    () => normalizePosTenders('cash', { cash: 90 }, 100),
    (err: unknown) => err instanceof PosTenderError && /must equal the sale total/.test(err.message)
  );
});

test('non-split overpayment is rejected', () => {
  assert.throws(
    () => normalizePosTenders('cash', { cash: 110 }, 100),
    (err: unknown) => err instanceof PosTenderError && /must equal the sale total/.test(err.message)
  );
});

test('split tenders that equal the sale total are accepted', () => {
  const tenders = normalizePosTenders('split', { cash: 40, card: 60 }, 100);
  assert.equal(tenders.cash, 40);
  assert.equal(tenders.card, 60);
  assert.equal(tenders.total, 100);
});

test('split underpayment, overpayment, and missing split are rejected', () => {
  assert.throws(() => normalizePosTenders('split', { cash: 40, card: 50 }, 100), PosTenderError);
  assert.throws(() => normalizePosTenders('split', { cash: 40, card: 70 }, 100), PosTenderError);
  assert.throws(() => normalizePosTenders('split', undefined, 100), PosTenderError);
});

test('zero or negative tender amounts are rejected', () => {
  assert.throws(() => normalizePosTenders('cash', { cash: 0 }, 100), PosTenderError);
  assert.throws(() => normalizePosTenders('cash', { cash: -5 }, 100), PosTenderError);
  assert.throws(() => normalizePosTenders('split', { cash: 100, card: -1 }, 100), PosTenderError);
});
