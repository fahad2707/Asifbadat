/**
 * Product response projections.
 *
 * The Product model contains fields the storefront must never see:
 *   - cost_price          (purchase cost / margin input)
 *   - vendor_id           (supplier)
 *   - reorder_point       (purchasing signal)
 *   - low_stock_threshold (internal inventory alert)
 *   - committed_quantity  (open-order reservation math)
 *   - plu                 (legacy internal identifier)
 *
 * These helpers build explicit allowlisted response shapes. We do NOT spread
 * the whole Mongoose document into responses. Route handlers pick the shape
 * from a **server-side authorization decision** (`req.userRole === 'admin'`)
 * — never from a client-supplied flag such as `?includeCost=` or `?isAdmin=`.
 *
 * `toStaffProduct` is a strict superset of `toPublicProduct` on the fields
 * that overlap, so staff callers can rely on both being present.
 */

import type mongoose from 'mongoose';

type PopulatedRef = { _id: mongoose.Types.ObjectId | string; name?: string; slug?: string };

/** Loose input shape — the caller passes a `.lean()` result with optional populated refs. */
export interface RawProductDoc {
  _id: mongoose.Types.ObjectId | string;
  name: string;
  slug: string;
  description?: string;
  product_type?: 'inventory' | 'non_inventory' | 'service';
  price: number;
  cost_price?: number | null;
  category_id?: mongoose.Types.ObjectId | string | PopulatedRef | null;
  sub_category_id?: mongoose.Types.ObjectId | string | PopulatedRef | null;
  vendor_id?: mongoose.Types.ObjectId | string | null;
  image_url?: string;
  product_id?: string;
  barcode?: string;
  plu?: string;
  sku?: string;
  stock_quantity?: number;
  committed_quantity?: number;
  low_stock_threshold?: number;
  reorder_point?: number;
  is_active?: boolean | 'false' | 0;
  tax_rate?: number;
  created_at?: Date | string;
  updated_at?: Date | string;
}

function idString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null) {
    // Populated ref: { _id, name, slug, ... }
    const anyV = v as { _id?: unknown; toString?: () => string };
    if (anyV._id != null) return String(anyV._id);
    if (typeof anyV.toString === 'function') return anyV.toString();
  }
  return undefined;
}

function refName(v: unknown): string | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const n = (v as { name?: unknown }).name;
    if (typeof n === 'string') return n;
  }
  return undefined;
}

function refSlug(v: unknown): string | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const s = (v as { slug?: unknown }).slug;
    if (typeof s === 'string') return s;
  }
  return undefined;
}

function nonNegative(n: unknown): number {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/**
 * Public / customer-facing shape. Guests and authenticated non-admin users
 * receive this. Note that `stock_quantity` is deliberately clamped to
 * `available_quantity` (on-hand minus committed) so the response never
 * reveals reservation load or exact on-hand counts.
 */
export function toPublicProduct(product: RawProductDoc) {
  const onHand = nonNegative(product.stock_quantity);
  const committed = nonNegative(product.committed_quantity);
  const available = Math.max(0, onHand - committed);
  return {
    id: String(product._id),
    name: product.name,
    slug: product.slug,
    description: product.description,
    product_type: product.product_type || 'inventory',
    product_id:
      product.product_id != null && String(product.product_id).trim() !== ''
        ? String(product.product_id).trim()
        : undefined,
    sku: product.sku,
    barcode: product.barcode,
    price: Number(product.price) || 0,
    tax_rate: product.tax_rate != null ? Number(product.tax_rate) : 0,
    image_url: product.image_url,
    category_id: idString(product.category_id),
    category_name: refName(product.category_id),
    category_slug: refSlug(product.category_id),
    sub_category_id: idString(product.sub_category_id),
    sub_category_name: refName(product.sub_category_id),
    // Availability, not raw inventory. Guests must never see on-hand vs committed.
    stock_quantity: available,
    available_quantity: available,
    is_active: true, // Guests only ever see active products; expose a constant.
  } as const;
}

/**
 * Authorized staff / admin shape. Superset of the public shape plus the
 * internal fields required for inventory, purchasing, and invoicing.
 *
 * IMPORTANT: `stock_quantity` here is the **raw on-hand count**, unlike the
 * public shape. Staff callers need this for restocking decisions.
 */
export function toStaffProduct(product: RawProductDoc) {
  const pub = toPublicProduct(product);
  const onHand = nonNegative(product.stock_quantity);
  const committed = nonNegative(product.committed_quantity);
  return {
    ...pub,
    stock_quantity: onHand,
    committed_quantity: committed,
    available_quantity: Math.max(0, onHand - committed),
    cost_price: product.cost_price != null ? Number(product.cost_price) : null,
    vendor_id: idString(product.vendor_id),
    reorder_point:
      product.reorder_point != null ? Number(product.reorder_point) : undefined,
    low_stock_threshold:
      product.low_stock_threshold != null
        ? Number(product.low_stock_threshold)
        : undefined,
    plu: product.plu,
    is_active:
      product.is_active !== false &&
      product.is_active !== 'false' &&
      product.is_active !== 0,
    created_at: product.created_at,
    updated_at: product.updated_at,
  } as const;
}

/**
 * Fields we never include in the public response — kept as a named list so
 * regression tests can assert their absence.
 */
export const INTERNAL_PRODUCT_FIELDS = [
  'cost_price',
  'vendor_id',
  'reorder_point',
  'low_stock_threshold',
  'committed_quantity',
  'plu',
  // updated_at is also omitted from public to minimize surface
  'updated_at',
] as const;
