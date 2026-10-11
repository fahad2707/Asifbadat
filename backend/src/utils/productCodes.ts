import mongoose from 'mongoose';
import Product from '../models/Product';

/**
 * Internal scannable SKU prefix — not a GTIN/EAN/UPC.
 * Format: EDI-<product_id> (e.g. EDI-48217). Distinct from numeric manufacturer barcodes.
 */
export const INTERNAL_SKU_PREFIX = 'EDI-';

/** True when value looks like a permanent 5-digit product ID (not a UPC). */
export function isFiveDigitProductId(v: string): boolean {
  return /^\d{5}$/.test(String(v ?? '').trim());
}

/** True when sku is missing or whitespace-only. */
export function isBlankSku(sku: unknown): boolean {
  return !String(sku ?? '').trim();
}

/**
 * Build the canonical internal SKU from an assigned product_id.
 * Does not invent GTIN/EAN/UPC values.
 */
export function buildInternalSkuFromProductId(productId: string): string {
  const id = String(productId ?? '').trim();
  if (!id) {
    throw new Error('product_id is required to build an internal SKU');
  }
  return `${INTERNAL_SKU_PREFIX}${id}`;
}

export type EnsureInternalSkuResult = {
  id: string;
  product_id: string;
  sku: string;
  created: boolean;
  stock_quantity: number;
  price: number;
  barcode: string | null;
  plu: string | null;
};

export class InternalSkuError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'InternalSkuError';
  }
}

function blankSkuMatch() {
  return {
    $or: [{ sku: { $exists: false } }, { sku: null }, { sku: '' }, { sku: /^\s*$/ }],
  };
}

/**
 * Assign EDI-<product_id> as sku when sku is blank. Idempotent if sku already set.
 * Never overwrites a non-empty sku; never writes legacy barcode/plu; never changes
 * an already-assigned product_id. Concurrent-safe via conditional findOneAndUpdate.
 */
export async function ensureInternalSkuForProduct(productObjectId: string): Promise<EnsureInternalSkuResult> {
  if (!productObjectId || !mongoose.isValidObjectId(productObjectId)) {
    throw new InternalSkuError(400, 'Invalid product id');
  }

  const existing = await Product.findById(productObjectId)
    .select('_id product_id sku barcode plu stock_quantity price')
    .lean();
  if (!existing) {
    throw new InternalSkuError(404, 'Product not found');
  }

  const currentSku = String((existing as { sku?: string }).sku ?? '').trim();
  let productId = String((existing as { product_id?: string }).product_id ?? '').trim();

  if (currentSku) {
    return {
      id: String((existing as { _id: { toString: () => string } })._id),
      product_id: productId,
      sku: currentSku,
      created: false,
      stock_quantity: Number((existing as { stock_quantity?: number }).stock_quantity ?? 0),
      price: Number((existing as { price?: number }).price ?? 0),
      barcode: (existing as { barcode?: string }).barcode != null ? String((existing as { barcode?: string }).barcode) : null,
      plu: (existing as { plu?: string }).plu != null ? String((existing as { plu?: string }).plu) : null,
    };
  }

  if (!productId) {
    productId = await generateProductId();
    const withPid = await Product.findOneAndUpdate(
      {
        _id: productObjectId,
        $or: [{ product_id: { $exists: false } }, { product_id: null }, { product_id: '' }],
      },
      { $set: { product_id: productId, updated_at: new Date() } },
      { new: true }
    )
      .select('_id product_id sku barcode plu stock_quantity price')
      .lean();
    if (withPid) {
      productId = String((withPid as { product_id?: string }).product_id || productId).trim();
    } else {
      const reloaded = await Product.findById(productObjectId).select('product_id sku').lean();
      if (!reloaded) throw new InternalSkuError(404, 'Product not found');
      productId = String((reloaded as { product_id?: string }).product_id || '').trim();
      const racedSku = String((reloaded as { sku?: string }).sku || '').trim();
      if (racedSku) {
        return {
          id: productObjectId,
          product_id: productId,
          sku: racedSku,
          created: false,
          stock_quantity: Number((existing as { stock_quantity?: number }).stock_quantity ?? 0),
          price: Number((existing as { price?: number }).price ?? 0),
          barcode: (existing as { barcode?: string }).barcode != null ? String((existing as { barcode?: string }).barcode) : null,
          plu: (existing as { plu?: string }).plu != null ? String((existing as { plu?: string }).plu) : null,
        };
      }
      if (!productId) {
        throw new InternalSkuError(409, 'Could not assign product_id required for internal SKU');
      }
    }
  }

  const candidate = buildInternalSkuFromProductId(productId);

  try {
    const updated = await Product.findOneAndUpdate(
      { _id: productObjectId, ...blankSkuMatch() },
      { $set: { sku: candidate, updated_at: new Date() } },
      { new: true }
    )
      .select('_id product_id sku barcode plu stock_quantity price')
      .lean();

    if (updated) {
      const sku = String((updated as { sku?: string }).sku || '').trim();
      return {
        id: String((updated as { _id: { toString: () => string } })._id),
        product_id: String((updated as { product_id?: string }).product_id || productId).trim(),
        sku,
        created: sku === candidate,
        stock_quantity: Number((updated as { stock_quantity?: number }).stock_quantity ?? 0),
        price: Number((updated as { price?: number }).price ?? 0),
        barcode: (updated as { barcode?: string }).barcode != null ? String((updated as { barcode?: string }).barcode) : null,
        plu: (updated as { plu?: string }).plu != null ? String((updated as { plu?: string }).plu) : null,
      };
    }
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err?.code !== 11000) throw e;
    // Duplicate key on sku: another product may already hold EDI-<id>, or a race wrote first.
  }

  const after = await Product.findById(productObjectId)
    .select('_id product_id sku barcode plu stock_quantity price')
    .lean();
  if (!after) throw new InternalSkuError(404, 'Product not found');
  const afterSku = String((after as { sku?: string }).sku || '').trim();
  if (afterSku) {
    return {
      id: String((after as { _id: { toString: () => string } })._id),
      product_id: String((after as { product_id?: string }).product_id || productId).trim(),
      sku: afterSku,
      created: false,
      stock_quantity: Number((after as { stock_quantity?: number }).stock_quantity ?? 0),
      price: Number((after as { price?: number }).price ?? 0),
      barcode: (after as { barcode?: string }).barcode != null ? String((after as { barcode?: string }).barcode) : null,
      plu: (after as { plu?: string }).plu != null ? String((after as { plu?: string }).plu) : null,
    };
  }

  throw new InternalSkuError(
    409,
    `Internal SKU ${candidate} is already in use by another product. Resolve the conflict before generating.`
  );
}

/** True when value looks like a scannable SKU / UPC (long numeric or alphanumeric). */
export function isLongSkuCode(v: string): boolean {
  const t = String(v ?? '').trim();
  if (!t) return false;
  if (isFiveDigitProductId(t)) return false;
  return t.length >= 8 || /^\d{6,}$/.test(t);
}

/**
 * Generate a permanent 5-digit product identifier (10000–99999).
 * Stored in `product_id` — never regenerated once assigned.
 */
export async function generateProductId(): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const id = String(Math.floor(10000 + Math.random() * 90000));
    const exists = await Product.findOne({ product_id: id }).lean();
    if (!exists) return id;
  }
  for (let i = 0; i < 20; i++) {
    const id = String(Math.floor(100000 + Math.random() * 900000));
    const exists = await Product.findOne({ product_id: id }).lean();
    if (!exists) return id;
  }
  return String(Date.now() % 100000).padStart(5, '0');
}

/**
 * One-time migration for existing catalog (~1400+ products):
 * - Long UPC/barcode values → `sku`
 * - Short 5-digit values wrongly stored in `sku` → `product_id`
 * - Assign new `product_id` where missing
 * - Clear legacy `barcode` / `plu` (no longer used)
 */
export async function migrateProductIdAndSku(): Promise<{
  updated: number;
  examined: number;
  skippedNoChange: number;
  warnings: string[];
}> {
  const products = await Product.find({})
    .select('_id product_id sku barcode plu')
    .lean();
  const examined = products.length;
  const warnings: string[] = [];
  let updated = 0;
  let skippedNoChange = 0;

  const usedProductIds = new Set<string>();
  for (const p of products) {
    const pid = String((p as { product_id?: string }).product_id || '').trim();
    if (pid) usedProductIds.add(pid);
  }

  for (const p of products as {
    _id: { toString: () => string };
    product_id?: string;
    sku?: string;
    barcode?: string;
    plu?: string;
  }[]) {
    const oid = p._id;
    const id = oid.toString();
    let productId = String(p.product_id || '').trim();
    let sku = String(p.sku || '').trim();
    const barcode = String(p.barcode || '').trim();
    const plu = String(p.plu || '').trim();
    const origProductId = productId;
    const origSku = sku;

    const longCandidates = [barcode, plu, isLongSkuCode(sku) ? sku : ''].filter(Boolean);
    let longSku = longCandidates[0] || '';

    if (!productId && sku && isFiveDigitProductId(sku)) {
      productId = sku;
      sku = longSku;
    } else if (!productId && sku && isLongSkuCode(sku)) {
      longSku = sku;
      sku = sku;
    } else if (!sku && longSku) {
      sku = longSku;
    } else if (!sku && barcode && !isFiveDigitProductId(barcode)) {
      sku = barcode;
    } else if (!sku && plu && !isFiveDigitProductId(plu)) {
      sku = plu;
    }

    if (!productId) {
      let candidate = '';
      for (let attempt = 0; attempt < 40; attempt++) {
        candidate = await generateProductId();
        if (!usedProductIds.has(candidate)) break;
      }
      if (usedProductIds.has(candidate)) {
        warnings.push(`[${id}] Could not allocate unique product_id`);
        continue;
      }
      productId = candidate;
      usedProductIds.add(productId);
    }

    if (productId === origProductId && sku === origSku && !barcode && !plu) {
      skippedNoChange++;
      continue;
    }

    try {
      await Product.updateOne(
        { _id: oid },
        {
          $set: {
            product_id: productId,
            sku: sku || undefined,
            updated_at: new Date(),
          },
          $unset: { barcode: 1, plu: 1 },
        }
      );
      updated++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`[${id}] Update failed: ${msg}`);
    }
  }

  return { updated, examined, skippedNoChange, warnings };
}
