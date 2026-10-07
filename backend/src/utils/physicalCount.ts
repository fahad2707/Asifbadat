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

export function adjustmentNumberDateKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function formatAdjustmentNumber(dateKey: string, seq: number): string {
  return `ADJ-${dateKey}-${String(seq).padStart(4, '0')}`;
}

export const PHYSICAL_COUNT_REASON = 'PHYSICAL_COUNT';
export const PHYSICAL_COUNT_REFERENCE_TYPE = 'PHYSICAL_COUNT';
