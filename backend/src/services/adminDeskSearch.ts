export type DeskHitType =
  | 'Customer'
  | 'Invoice'
  | 'Quotation'
  | 'RFQ'
  | 'Shipment'
  | 'Transaction'
  | 'Credit memo'
  | 'Online order'
  | 'Product'
  | 'Vendor'
  | 'Purchase order'
  | 'Website signup';

export type DeskHit = {
  type: DeskHitType;
  title: string;
  subtitle: string;
  href: string;
  exact: boolean;
};

const TYPE_ORDER: Record<DeskHitType, number> = {
  Customer: 0,
  Invoice: 1,
  Quotation: 2,
  Transaction: 3,
  RFQ: 4,
  Shipment: 5,
  'Credit memo': 6,
  'Online order': 7,
  Product: 8,
  Vendor: 9,
  'Purchase order': 10,
  'Website signup': 11,
};

export function escapeRegex(q: string): string {
  return String(q || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function containsQuery(haystack: string | undefined | null, q: string): boolean {
  if (!haystack || !q) return false;
  return String(haystack).toLowerCase().includes(q.toLowerCase());
}

export function isExactCode(haystack: string | undefined | null, q: string): boolean {
  if (!haystack || !q) return false;
  return String(haystack).trim().toLowerCase() === q.trim().toLowerCase();
}

export function textRegex(q: string) {
  return new RegExp(escapeRegex(q.trim()), 'i');
}

export function sortDeskHits(hits: DeskHit[]): DeskHit[] {
  return [...hits].sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    const ta = TYPE_ORDER[a.type] ?? 99;
    const tb = TYPE_ORDER[b.type] ?? 99;
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  });
}
