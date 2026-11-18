/**
 * Catalogue search for tobacco classification.
 *
 * An empty query does not return the catalogue. Name, SKU, barcode, and
 * product id use the same escaped, case-insensitive substring. The caller
 * still applies skip/limit. This function does not read or write products.
 */

const MAX_QUERY = 80;

export type ProductSearch =
  | { searchRequired: true }
  | { searchRequired: false; clause: Record<string, unknown> };

export function escapeProductSearch(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function tobaccoProductSearch(raw: unknown): ProductSearch {
  const query = String(raw || '').trim().slice(0, MAX_QUERY);
  if (!query) return { searchRequired: true };
  const pattern = escapeProductSearch(query);
  return {
    searchRequired: false,
    clause: {
      $or: [
        { name: { $regex: pattern, $options: 'i' } },
        { sku: { $regex: pattern, $options: 'i' } },
        { barcode: { $regex: pattern, $options: 'i' } },
        { product_id: { $regex: pattern, $options: 'i' } },
      ],
    },
  };
}
