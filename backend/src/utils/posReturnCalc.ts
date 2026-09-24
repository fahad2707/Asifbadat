/**
 * Task 07D-10D / 07D-10E-03 — POS return merchandise calculation.
 * Read-only. Does not write Return / POSSale / stock / money.
 *
 * Refund = original unit price
 *         - line discount (POSSale.items[].discount is a line-total, allocated in cents)
 *         - bill discount (POSSale.discount_amount, allocated by total units sold, in cents)
 * Tax is never included.
 *
 * Discount cents use the largest-remainder method so every unit of a sale
 * sums to the exact merchandise total. Already-returned units consume the
 * leading slice of that deterministic sequence.
 */
import { roundMoney } from '../services/paymentApplication';

export class PosReturnCalcError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PosReturnCalcError';
    this.status = status;
  }
}

export type PosReturnCalcSaleItem = {
  product_id?: unknown;
  product_name?: string;
  quantity?: unknown;
  price?: unknown;
  discount?: unknown;
  tax?: unknown;
  subtotal?: unknown;
};

export type PosReturnCalcSale = {
  items?: PosReturnCalcSaleItem[];
  discount_amount?: unknown;
  tax_amount?: unknown;
  total_amount?: unknown;
};

export type PosReturnRequestLine = {
  product_id: string;
  quantity: number;
};

export type PosReturnExistingReturn = {
  status?: unknown;
  items?: Array<{ product_id?: unknown; quantity?: unknown }>;
};

export type PosReturnCalcLine = {
  product_id: string;
  product_name: string;
  requested_quantity: number;
  original_quantity: number;
  already_returned_quantity: number;
  remaining_quantity: number;
  original_unit_price: number;
  allocated_discount_per_unit: number;
  refundable_unit_amount: number;
  refundable_amount: number;
};

export type PosReturnCalcResult = {
  lines: PosReturnCalcLine[];
  total_refund: number;
};

function productKey(id: unknown): string {
  if (id == null) return '';
  return String(typeof id === 'object' && id !== null && 'toString' in id ? (id as { toString: () => string }).toString() : id);
}

function requirePositiveInt(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new PosReturnCalcError(`${label} must be a positive integer.`);
  }
  return n;
}

function moneyToCents(value: unknown): number {
  return Math.round(roundMoney(value) * 100);
}

function centsToMoney(cents: number): number {
  return roundMoney(cents / 100);
}

/** Largest-remainder allocation. Extra cents go to the leading slots (stable index order). */
function allocateCents(totalCents: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.trunc(totalCents / n);
  const remainder = totalCents - base * n;
  const shares = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    shares[i] = base + (i < remainder ? 1 : 0);
  }
  return shares;
}

export function calculatePosReturnRefund(
  sale: PosReturnCalcSale,
  requested: PosReturnRequestLine[],
  existingReturns: PosReturnExistingReturn[] = []
): PosReturnCalcResult {
  const saleItems = sale?.items || [];
  const byProduct = new Map<
    string,
    { product_id: string; product_name: string; quantity: number; price: number; discount: number }
  >();

  for (const item of saleItems) {
    const key = productKey(item.product_id);
    if (!key) continue;
    const quantity = Number(item.quantity) || 0;
    const price = roundMoney(item.price);
    const discount = roundMoney(item.discount);
    const existing = byProduct.get(key);
    if (existing) {
      if (existing.price !== price) {
        throw new PosReturnCalcError(`Sale has inconsistent unit prices for product ${key}.`);
      }
      existing.quantity += quantity;
      existing.discount = roundMoney(existing.discount + discount);
    } else {
      byProduct.set(key, {
        product_id: key,
        product_name: item.product_name ? String(item.product_name) : '',
        quantity,
        price,
        discount,
      });
    }
  }

  const totalUnitsSold = [...byProduct.values()].reduce((sum, item) => sum + item.quantity, 0);
  if (!(totalUnitsSold > 0)) {
    throw new PosReturnCalcError('Sale has no returnable quantity.');
  }

  const lineDiscountCents = new Map<string, number[]>();
  const billDiscountCents = new Map<string, number[]>();
  for (const [key, line] of byProduct) {
    lineDiscountCents.set(key, allocateCents(moneyToCents(line.discount), line.quantity));
    billDiscountCents.set(key, new Array<number>(line.quantity).fill(0));
  }

  const globalUnits: Array<{ key: string; index: number }> = [];
  for (const [key, line] of byProduct) {
    for (let i = 0; i < line.quantity; i += 1) {
      globalUnits.push({ key, index: i });
    }
  }
  const billShares = allocateCents(moneyToCents(sale.discount_amount), globalUnits.length);
  for (let i = 0; i < globalUnits.length; i += 1) {
    const unit = globalUnits[i];
    billDiscountCents.get(unit.key)![unit.index] = billShares[i];
  }

  const returnedByProduct = new Map<string, number>();
  for (const ret of existingReturns) {
    if (ret.status !== 'completed') continue;
    for (const item of ret.items || []) {
      const key = productKey(item.product_id);
      if (!key) continue;
      returnedByProduct.set(key, (returnedByProduct.get(key) || 0) + (Number(item.quantity) || 0));
    }
  }

  if (!Array.isArray(requested) || requested.length === 0) {
    throw new PosReturnCalcError('At least one return line is required.');
  }

  const seen = new Set<string>();
  const lines: PosReturnCalcLine[] = [];

  for (const req of requested) {
    const key = productKey(req.product_id);
    if (!key) {
      throw new PosReturnCalcError('Each return line must include a product_id.');
    }
    if (seen.has(key)) {
      throw new PosReturnCalcError(`Duplicate product in return request: ${key}.`);
    }
    seen.add(key);

    const requestedQty = requirePositiveInt(req.quantity, 'Return quantity');
    const saleLine = byProduct.get(key);
    if (!saleLine) {
      throw new PosReturnCalcError(`Product ${key} was not part of the original sale.`);
    }

    const alreadyReturned = returnedByProduct.get(key) || 0;
    const remaining = saleLine.quantity - alreadyReturned;
    if (requestedQty > remaining) {
      throw new PosReturnCalcError(
        `Cannot return ${requestedQty} of product ${key}. Remaining returnable quantity: ${Math.max(0, remaining)}.`
      );
    }

    const priceCents = moneyToCents(saleLine.price);
    const lineShares = lineDiscountCents.get(key)!;
    const billSharesForProduct = billDiscountCents.get(key)!;
    let refundCents = 0;
    for (let i = 0; i < requestedQty; i += 1) {
      const unitIndex = alreadyReturned + i;
      refundCents += priceCents - lineShares[unitIndex] - billSharesForProduct[unitIndex];
    }

    const refundable_amount = centsToMoney(refundCents);
    const refundable_unit_amount =
      requestedQty > 0 ? centsToMoney(Math.round(refundCents / requestedQty)) : 0;
    const allocated_discount_per_unit = roundMoney(saleLine.price - refundable_unit_amount);

    lines.push({
      product_id: key,
      product_name: saleLine.product_name,
      requested_quantity: requestedQty,
      original_quantity: saleLine.quantity,
      already_returned_quantity: alreadyReturned,
      remaining_quantity: remaining,
      original_unit_price: saleLine.price,
      allocated_discount_per_unit,
      refundable_unit_amount,
      refundable_amount,
    });
  }

  const total_refund = centsToMoney(lines.reduce((sum, line) => sum + moneyToCents(line.refundable_amount), 0));
  return { lines, total_refund };
}
