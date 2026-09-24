/**
 * Task 07D-10E-01 — Atomic remaining-quantity claim for POS returns.
 *
 * The database enforces already_returned + requested <= original_quantity
 * via a conditional update on POSSale.returned_quantities. That field is a
 * non-financial counter and must not be treated as sale economics.
 */

export class PosReturnQtyError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PosReturnQtyError';
    this.status = status;
  }
}

export type PosReturnQtyLine = {
  product_id: string;
  quantity: number;
  original_quantity: number;
};

export function posReturnQuantityClaimFilter(saleId: unknown, lines: PosReturnQtyLine[]) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new PosReturnQtyError('At least one return line is required.');
  }
  return {
    _id: saleId,
    $and: lines.map((line) => ({
      $expr: {
        $lte: [
          {
            $add: [
              { $ifNull: [`$returned_quantities.${line.product_id}`, 0] },
              line.quantity,
            ],
          },
          line.original_quantity,
        ],
      },
    })),
  };
}

export function posReturnQuantityClaimUpdate(lines: Array<{ product_id: string; quantity: number }>) {
  const inc: Record<string, number> = {};
  for (const line of lines) {
    const key = `returned_quantities.${line.product_id}`;
    inc[key] = (inc[key] || 0) + line.quantity;
  }
  return { $inc: inc };
}
