/**
 * Task 07D-10E-01 — POS return-window helper.
 *
 * Isolated: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/utils/posReturnWindow.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PosReturnWindowError, resolvePosReturnWindow } from './posReturnWindow';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const saleCreatedAt = new Date('2026-01-01T00:00:00.000Z');

test('default window is 15 days and is eligible inside that window', () => {
  const result = resolvePosReturnWindow({
    saleCreatedAt,
    now: new Date(saleCreatedAt.getTime() + 14 * MS_PER_DAY),
  });
  assert.equal(result.return_window_days, 15);
  assert.equal(result.window_extended, false);
  assert.equal(result.return_deadline.toISOString(), '2026-01-16T00:00:00.000Z');
});

test('explicit 30/45-day extensions succeed when still inside the extended window', () => {
  const day20 = new Date(saleCreatedAt.getTime() + 20 * MS_PER_DAY);
  const extended30 = resolvePosReturnWindow({
    saleCreatedAt,
    requestedWindowDays: 30,
    now: day20,
  });
  assert.equal(extended30.return_window_days, 30);
  assert.equal(extended30.window_extended, true);

  const extended45 = resolvePosReturnWindow({
    saleCreatedAt,
    requestedWindowDays: 45,
    now: day20,
  });
  assert.equal(extended45.return_window_days, 45);
  assert.equal(extended45.window_extended, true);
});

test('sale outside the effective window is rejected', () => {
  assert.throws(
    () =>
      resolvePosReturnWindow({
        saleCreatedAt,
        now: new Date(saleCreatedAt.getTime() + 16 * MS_PER_DAY),
      }),
    (err: unknown) => {
      assert.ok(err instanceof PosReturnWindowError);
      assert.equal(err.status, 400);
      assert.match(err.message, /outside the return window/i);
      return true;
    }
  );
});

test('values other than 15, 30, or 45 are rejected', () => {
  for (const requestedWindowDays of [20, 60, 14.5, 0]) {
    assert.throws(
      () => resolvePosReturnWindow({ saleCreatedAt, requestedWindowDays }),
      (err: unknown) => {
        assert.ok(err instanceof PosReturnWindowError);
        assert.match(err.message, /15, 30, or 45/i);
        return true;
      }
    );
  }
});
