/**
 * Task 07D-06 — POS stock decrement filter.
 * Availability is stock_quantity - committed_quantity (same as the POS pre-check).
 */
export class PosStockError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PosStockError';
    this.status = status;
  }
}

/** Atomic match: available on-hand must cover qty before $inc. */
export function posStockDecrementFilter(productId: unknown, quantity: number) {
  return {
    _id: productId,
    $expr: {
      $gte: [
        {
          $subtract: [
            { $ifNull: ['$stock_quantity', 0] },
            { $ifNull: ['$committed_quantity', 0] },
          ],
        },
        quantity,
      ],
    },
  };
}
