/**
 * Module-level, shipment-keyed request ownership for package create/print/list.
 * Survives ShipmentPackagesSection remounts when switching shipments in the drawer.
 *
 * Verification generation: a list GET may clear needs-verify only if it captured
 * the same generation that is current at completion (i.e. it started after the
 * latest uncertain-create bump) and no create is in flight for that shipment.
 */

const createInFlight = new Set<string>();
const printInFlight = new Set<string>();
const needsVerify = new Set<string>();
const verifyGeneration = new Map<string, number>();

export function getVerifyGeneration(shipmentId: string): number {
  return verifyGeneration.get(shipmentId) ?? 0;
}

/** Capture generation at list-request start. */
export function beginListRequest(shipmentId: string): number {
  return getVerifyGeneration(shipmentId);
}

export function isCreateInFlight(shipmentId: string): boolean {
  return createInFlight.has(shipmentId);
}

export function isPrintInFlight(shipmentId: string): boolean {
  return printInFlight.has(shipmentId);
}

export function needsCreateVerification(shipmentId: string): boolean {
  return needsVerify.has(shipmentId);
}

/**
 * Begin a create for this shipment. Returns false if one is already in flight
 * or verification is still required.
 */
export function tryBeginCreate(shipmentId: string): boolean {
  if (createInFlight.has(shipmentId)) return false;
  if (needsVerify.has(shipmentId)) return false;
  createInFlight.add(shipmentId);
  return true;
}

export function endCreate(shipmentId: string): void {
  createInFlight.delete(shipmentId);
}

export function tryBeginPrint(shipmentId: string): boolean {
  if (printInFlight.has(shipmentId)) return false;
  printInFlight.add(shipmentId);
  return true;
}

export function endPrint(shipmentId: string): void {
  printInFlight.delete(shipmentId);
}

/** Confirmed create success — drop any stale verify flag for this shipment. */
export function markCreateConfirmed(shipmentId: string): void {
  needsVerify.delete(shipmentId);
}

/**
 * Uncertain create outcome: bump generation so older list GETs cannot clear the
 * guard, and require a qualifying refresh before another create.
 */
export function markCreateUncertain(shipmentId: string): void {
  verifyGeneration.set(shipmentId, getVerifyGeneration(shipmentId) + 1);
  needsVerify.add(shipmentId);
}

/**
 * After a successful list response: clear needs-verify only when this GET is
 * not stale relative to uncertain-create bumps and create is not in flight.
 * Returns true if the shipment is clear to create again (no verify required).
 */
export function applySuccessfulListResult(
  shipmentId: string,
  capturedGeneration: number
): boolean {
  if (createInFlight.has(shipmentId)) {
    return !needsVerify.has(shipmentId);
  }
  if (capturedGeneration !== getVerifyGeneration(shipmentId)) {
    return !needsVerify.has(shipmentId);
  }
  needsVerify.delete(shipmentId);
  return true;
}

/** Test helper — not for production UI paths. */
export function __resetShipmentPackageRequestGuardsForTests(): void {
  createInFlight.clear();
  printInFlight.clear();
  needsVerify.clear();
  verifyGeneration.clear();
}
