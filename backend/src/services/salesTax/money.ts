/**
 * Integer-cent money helpers for sales-tax preview.
 *
 * Rates are basis points: 600 = 6.00%. Callers pass amounts that are already
 * integer cents. This module does not read Product, Invoice, or StoreSettings,
 * and it does not apply a Pennsylvania bracket table.
 */

export function isIntegerCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function rateTaxHalfAwayFromZero(baseCents: number, rateBasisPoints: number): number {
  if (!isIntegerCents(baseCents) || !isIntegerCents(rateBasisPoints)) {
    throw new Error('Tax amounts and rates must be safe integers.');
  }
  if (rateBasisPoints < 0 || rateBasisPoints > 10000) {
    throw new Error('Rate basis points must be between 0 and 10000.');
  }
  const product = baseCents * rateBasisPoints;
  if (!Number.isSafeInteger(product)) {
    throw new Error('Tax product exceeds safe integer range.');
  }
  const sign = product < 0 ? -1 : 1;
  const rounded = Math.floor((Math.abs(product) + 5000) / 10000);
  return sign * rounded;
}

export type CentsAllocation = { id: string; cents: number };

export type CentsAllocationResult =
  | { ok: true; shares: CentsAllocation[] }
  | { ok: false; reason: 'invalid_amount' | 'weights_required' | 'amount_overflow' };

/**
 * Split an integer cent amount across weights. Remainder cents go to the
 * largest remainders. Equal remainders break toward the smaller id so the
 * result does not depend on input order.
 */
export function allocateIntegerCents(
  totalCents: number,
  weights: ReadonlyArray<{ id: string; weightCents: number }>
): CentsAllocationResult {
  if (!isIntegerCents(totalCents) || totalCents < 0) return { ok: false, reason: 'invalid_amount' };
  if (weights.length === 0) return { ok: false, reason: 'weights_required' };
  const sum = weights.reduce((acc, row) => acc + row.weightCents, 0);
  if (!weights.every((row) => isIntegerCents(row.weightCents) && row.weightCents >= 0) || !isIntegerCents(sum)) {
    return { ok: false, reason: 'invalid_amount' };
  }
  if (totalCents === 0) return { ok: true, shares: weights.map((row) => ({ id: row.id, cents: 0 })) };
  if (sum === 0) return { ok: false, reason: 'weights_required' };

  const floors = weights.map((row) => {
    const product = totalCents * row.weightCents;
    if (!Number.isSafeInteger(product)) return null;
    return {
      id: row.id,
      cents: Math.floor(product / sum),
      remainder: product % sum,
    };
  });
  if (floors.some((row) => row == null)) return { ok: false, reason: 'amount_overflow' };
  const rows = floors as Array<{ id: string; cents: number; remainder: number }>;
  let leftover = totalCents - rows.reduce((acc, row) => acc + row.cents, 0);
  const order = [...rows].sort((a, b) => b.remainder - a.remainder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const row of order) {
    if (leftover <= 0) break;
    row.cents += 1;
    leftover -= 1;
  }
  const byId = new Map(rows.map((row) => [row.id, row.cents]));
  return { ok: true, shares: weights.map((row) => ({ id: row.id, cents: byId.get(row.id) ?? 0 })) };
}
