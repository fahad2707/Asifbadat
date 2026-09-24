/**
 * Task 07D-10D — POS return merchandise calculation and remaining-qty checks.
 * Read-only. Does not write Return / POSSale / stock / money.
 *
 * Refund = original unit price
 *         - line discount per unit (POSSale.items[].discount is a line total)
 *         - bill discount / total units sold
 * Tax is never included.
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

  const billDiscount = roundMoney(sale.discount_amount);
  const billDiscountPerUnit = roundMoney(billDiscount / totalUnitsSold);

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

    const lineDiscountPerUnit = saleLine.quantity > 0 ? roundMoney(saleLine.discount / saleLine.quantity) : 0;
    const allocatedDiscountPerUnit = roundMoney(lineDiscountPerUnit + billDiscountPerUnit);
    const refundableUnit = roundMoney(saleLine.price - allocatedDiscountPerUnit);
    const refundableAmount = roundMoney(refundableUnit * requestedQty);

    lines.push({
      product_id: key,
      product_name: saleLine.product_name,
      requested_quantity: requestedQty,
      original_quantity: saleLine.quantity,
      already_returned_quantity: alreadyReturned,
      remaining_quantity: remaining,
      original_unit_price: saleLine.price,
      allocated_discount_per_unit: allocatedDiscountPerUnit,
      refundable_unit_amount: refundableUnit,
      refundable_amount: refundableAmount,
    });
  }

  const total_refund = roundMoney(lines.reduce((sum, line) => sum + line.refundable_amount, 0));
  return { lines, total_refund };
}
