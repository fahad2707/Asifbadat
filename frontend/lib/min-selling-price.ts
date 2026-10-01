/** Selling price must stay at least 5% above cost. */

export const MIN_SELL_MARGIN = 0.05;

export function minSellingPrice(cost: number): number {
  return Math.round(Number(cost) * (1 + MIN_SELL_MARGIN) * 100) / 100;
}

export function sellingBelowMin(price: number, cost: number | null | undefined): boolean {
  if (cost == null || !(Number(cost) > 0)) return false;
  return Number(price) + 1e-9 < minSellingPrice(Number(cost));
}
