/** Preview-only. Backend recalculates difference = counted − current. */

export function physicalCountPreview(currentQty: number, countedQty: number | '' | null | undefined) {
  if (countedQty === '' || countedQty == null) {
    return { difference: null as number | null, newQty: null as number | null };
  }
  const counted = Math.trunc(Number(countedQty));
  if (!Number.isFinite(counted)) {
    return { difference: null as number | null, newQty: null as number | null };
  }
  const current = Number(currentQty) || 0;
  return {
    difference: counted - current,
    newQty: counted,
  };
}

export function formatStockDifference(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}
