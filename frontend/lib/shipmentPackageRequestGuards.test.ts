/**
 * B4.4-R2 — per-shipment in-flight + verification-generation interleavings.
 *
 * Run: npx tsx --test lib/shipmentPackageRequestGuards.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetShipmentPackageRequestGuardsForTests,
  applySuccessfulListResult,
  beginListRequest,
  endCreate,
  endPrint,
  isCreateInFlight,
  isPrintInFlight,
  markCreateConfirmed,
  markCreateUncertain,
  needsCreateVerification,
  tryBeginCreate,
  tryBeginPrint,
} from './shipmentPackageRequestGuards';

const A = 'ship-a';
const B = 'ship-b';

afterEach(() => {
  __resetShipmentPackageRequestGuardsForTests();
});

test('R2: create A pending → create B pending → A settles; A stays protected until A ends', () => {
  assert.equal(tryBeginCreate(A), true);
  assert.equal(tryBeginCreate(B), true);
  assert.equal(isCreateInFlight(A), true);
  assert.equal(isCreateInFlight(B), true);
  // A cannot start a second create while pending
  assert.equal(tryBeginCreate(A), false);

  endCreate(A);
  assert.equal(isCreateInFlight(A), false);
  assert.equal(isCreateInFlight(B), true);
  // B finishing must not affect A's ability to start a new create
  endCreate(B);
  assert.equal(tryBeginCreate(A), true);
  endCreate(A);
});

test('R2: create A pending → leave and return semantics (in-flight survives)', () => {
  assert.equal(tryBeginCreate(A), true);
  // Simulate UI remount: still in flight for A
  assert.equal(isCreateInFlight(A), true);
  assert.equal(tryBeginCreate(A), false);
  endCreate(A);
  assert.equal(tryBeginCreate(A), true);
  endCreate(A);
});

test('R2: GET starts before uncertain create → old GET cannot clear verify', () => {
  const genAtStart = beginListRequest(A);
  markCreateUncertain(A);
  assert.equal(needsCreateVerification(A), true);
  // Stale GET completes after uncertain outcome
  assert.equal(applySuccessfulListResult(A, genAtStart), false);
  assert.equal(needsCreateVerification(A), true);
});

test('R2: uncertain create → new GET afterward → success clears guard', () => {
  markCreateUncertain(A);
  assert.equal(needsCreateVerification(A), true);
  assert.equal(tryBeginCreate(A), false);

  const gen = beginListRequest(A);
  assert.equal(applySuccessfulListResult(A, gen), true);
  assert.equal(needsCreateVerification(A), false);
  assert.equal(tryBeginCreate(A), true);
  endCreate(A);
});

test('R2: failed refresh leaves guard (applySuccessfulListResult not called)', () => {
  markCreateUncertain(A);
  // Simulate failed GET: do not call applySuccessfulListResult
  assert.equal(needsCreateVerification(A), true);
  assert.equal(tryBeginCreate(A), false);
});

test('R2: GET during create in flight cannot clear verify even with matching gen', () => {
  assert.equal(tryBeginCreate(A), true);
  const gen = beginListRequest(A);
  markCreateUncertain(A); // bumps gen; create still in flight until endCreate
  // Stale relative to bump:
  assert.equal(applySuccessfulListResult(A, gen), false);
  assert.equal(needsCreateVerification(A), true);

  // Fresh GET while still in flight — matching gen but create in flight blocks clear
  const gen2 = beginListRequest(A);
  assert.equal(applySuccessfulListResult(A, gen2), false);
  assert.equal(needsCreateVerification(A), true);

  endCreate(A);
  const gen3 = beginListRequest(A);
  assert.equal(applySuccessfulListResult(A, gen3), true);
  assert.equal(needsCreateVerification(A), false);
});

test('R2: print A and print B overlap without corrupting markers', () => {
  assert.equal(tryBeginPrint(A), true);
  assert.equal(tryBeginPrint(B), true);
  assert.equal(tryBeginPrint(A), false);
  endPrint(A);
  assert.equal(isPrintInFlight(A), false);
  assert.equal(isPrintInFlight(B), true);
  endPrint(B);
  assert.equal(tryBeginPrint(A), true);
  endPrint(A);
});

test('R2: print does not affect create verification', () => {
  markCreateUncertain(A);
  assert.equal(tryBeginPrint(A), true);
  endPrint(A);
  assert.equal(needsCreateVerification(A), true);
  markCreateConfirmed(A);
  assert.equal(needsCreateVerification(A), false);
});
