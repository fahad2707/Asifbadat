/**
 * Physical count math. Backend is authoritative; frontend uses the same
 * helpers only for preview. Difference is always counted − current.
 */

export function physicalCountDelta(currentQuantity: number, countedQuantity: number): number {
  return countedQuantity - currentQuantity;
}

export function formatStockDifference(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

/** Short warehouse document number. ADJ-0001, ADJ-0002, and so on. */
export function formatAdjustmentNumber(seq: number): string {
  const n = Math.trunc(Number(seq));
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('Adjustment sequence must be a positive integer');
  }
  return `ADJ-${String(n).padStart(4, '0')}`;
}

export const PHYSICAL_COUNT_REASON = 'PHYSICAL_COUNT';
export const PHYSICAL_COUNT_REFERENCE_TYPE = 'PHYSICAL_COUNT';
