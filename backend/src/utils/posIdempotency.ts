/**
 * Task 07D-08 — POS checkout idempotency helpers.
 *
 * The unique+sparse POSSale.idempotency_key index is the concurrency
 * guarantee. These helpers only identify a duplicate-key conflict and
 * wait until a committed sale is readable. They do not create sales.
 */

export const POS_IDEMPOTENCY_POLL_ATTEMPTS = 20;
export const POS_IDEMPOTENCY_POLL_MS = 50;

type MongoDuplicateError = {
  code?: number;
  keyPattern?: Record<string, unknown>;
  message?: string;
};

export function isIdempotencyDuplicateKey(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as MongoDuplicateError;
  if (e.code !== 11000) return false;
  if (e.keyPattern && Object.prototype.hasOwnProperty.call(e.keyPattern, 'idempotency_key')) {
    return true;
  }
  return typeof e.message === 'string' && e.message.includes('idempotency_key');
}

export async function waitForCommittedKeyedSale<T>(
  findCommittedSale: () => Promise<T | null | undefined>,
  attempts = POS_IDEMPOTENCY_POLL_ATTEMPTS,
  delayMs = POS_IDEMPOTENCY_POLL_MS
): Promise<T | null> {
  for (let i = 0; i < attempts; i += 1) {
    const sale = await findCommittedSale();
    if (sale) return sale;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

function copyEnumerable(value: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    record[key] = Reflect.get(value, key);
  }
  return record;
}

function documentToPlain(value: object): object {
  const method = Reflect.get(value, 'toObject');
  if (typeof method !== 'function') return value;
  const converted = Reflect.apply(method, value, []);
  return converted !== null && typeof converted === 'object' ? converted : value;
}

/** Drops internal sale-time cost from a response line. Persisted POSSale is unchanged. */
export function omitInternalCostPrice(
  item: object | null | undefined
): Record<string, unknown> | null | undefined {
  if (item === null || item === undefined) return item;
  const { cost_price: _costPrice, ...rest } = copyEnumerable(documentToPlain(item));
  return rest;
}

export function formatPosSaleResponse(sale: any, invoice: any) {
  const saleObj = typeof sale?.toObject === 'function' ? sale.toObject() : { ...sale };
  const invoiceObj = typeof invoice?.toObject === 'function' ? invoice.toObject() : { ...invoice };
  return {
    sale: {
      id: String(sale?._id ?? saleObj?._id),
      ...saleObj,
      items: Array.isArray(saleObj?.items) ? saleObj.items.map(omitInternalCostPrice) : saleObj?.items,
    },
    invoice: {
      id: String(invoice?._id ?? invoiceObj?._id),
      ...invoiceObj,
      items: Array.isArray(invoiceObj?.items) ? invoiceObj.items.map(omitInternalCostPrice) : invoiceObj?.items,
    },
  };
}
