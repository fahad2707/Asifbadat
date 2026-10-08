/**
 * OnlineOrder checkout idempotency helpers.
 *
 * The unique+sparse compound index on (user_id, checkout_submission_id) is the
 * concurrency guarantee. These helpers identify that duplicate-key race and
 * compare checkout payloads for mismatch safety.
 */

export const ONLINE_ORDER_IDEMPOTENCY_POLL_ATTEMPTS = 20;
export const ONLINE_ORDER_IDEMPOTENCY_POLL_MS = 50;

type MongoDuplicateError = {
  code?: number;
  keyPattern?: Record<string, unknown>;
  message?: string;
};

export function isCheckoutSubmissionDuplicateKey(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as MongoDuplicateError;
  if (e.code !== 11000) return false;
  if (
    e.keyPattern &&
    Object.prototype.hasOwnProperty.call(e.keyPattern, 'checkout_submission_id')
  ) {
    return true;
  }
  return typeof e.message === 'string' && e.message.includes('checkout_submission_id');
}

export async function waitForCommittedCheckoutOrder<T>(
  findCommitted: () => Promise<T | null | undefined>,
  attempts = ONLINE_ORDER_IDEMPOTENCY_POLL_ATTEMPTS,
  delayMs = ONLINE_ORDER_IDEMPOTENCY_POLL_MS
): Promise<T | null> {
  for (let i = 0; i < attempts; i += 1) {
    const doc = await findCommitted();
    if (doc) return doc;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

type CheckoutItemLike = { product_id?: unknown; quantity?: unknown };

/** Stable item multiset for mismatch checks (product_id + quantity only). */
export function normalizeCheckoutItems(
  items: CheckoutItemLike[] | undefined | null
): Array<{ product_id: string; quantity: number }> {
  const rows = (items || [])
    .map((item) => ({
      product_id: String(item.product_id ?? ''),
      quantity: Number(item.quantity),
    }))
    .filter((item) => item.product_id && Number.isFinite(item.quantity));
  rows.sort((a, b) => {
    const byId = a.product_id.localeCompare(b.product_id);
    return byId !== 0 ? byId : a.quantity - b.quantity;
  });
  return rows;
}

export function checkoutItemsMatch(
  existingItems: CheckoutItemLike[] | undefined | null,
  requestItems: CheckoutItemLike[] | undefined | null
): boolean {
  const a = normalizeCheckoutItems(existingItems);
  const b = normalizeCheckoutItems(requestItems);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].product_id !== b[i].product_id || a[i].quantity !== b[i].quantity) {
      return false;
    }
  }
  return true;
}

type CheckoutAddressLike = {
  payment_method?: unknown;
  address_line1?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
  customer_email?: unknown;
};

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Material checkout identity for mismatch detection — items + payment + core address.
 * Does not use JSON.stringify of the whole body.
 */
export function checkoutPayloadMatches(
  existing: CheckoutAddressLike & { items?: CheckoutItemLike[] },
  request: CheckoutAddressLike & { items?: CheckoutItemLike[] }
): boolean {
  if (!checkoutItemsMatch(existing.items, request.items)) return false;
  if (norm(existing.payment_method) !== norm(request.payment_method)) return false;
  if (norm(existing.address_line1) !== norm(request.address_line1)) return false;
  if (norm(existing.city) !== norm(request.city)) return false;
  if (norm(existing.state) !== norm(request.state)) return false;
  if (norm(existing.zip) !== norm(request.zip)) return false;
  if (norm(existing.customer_email) !== norm(request.customer_email)) return false;
  return true;
}

export function formatOnlineOrderCreateResponse(order: {
  _id?: { toString(): string } | string;
  id?: string;
  order_number?: string;
  total_amount?: number;
  status?: string;
  toObject?: () => Record<string, unknown>;
}) {
  const doc =
    typeof order?.toObject === 'function'
      ? (order.toObject() as Record<string, unknown>)
      : (order as Record<string, unknown>);
  const idRaw = doc._id ?? order._id ?? order.id;
  const id =
    idRaw && typeof (idRaw as { toString?: () => string }).toString === 'function'
      ? (idRaw as { toString(): string }).toString()
      : String(idRaw ?? '');
  return {
    id,
    order_number: doc.order_number,
    total_amount: doc.total_amount,
    status: doc.status,
  };
}
