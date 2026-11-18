import Product from '../models/Product';

/**
 * Decides SKU and barcode fills for the Excel import.
 * This is separate from the product-code migration planner.
 * A non-empty SKU or barcode that differs from the sheet is a conflict.
 * PLU is never written. Conflicting products are left out of `changes`.
 */

export type SkuBarcodeProduct = {
  id: string;
  sku: string;
  barcode: string;
  plu: string;
};

export type SkuBarcodeConflict = {
  productId: string;
  field: 'sku' | 'barcode';
  existing: string;
  proposed: string;
  reason: string;
};

export type SkuBarcodeChange = {
  productId: string;
  before: { sku: string; barcode: string; plu: string };
  set: { sku?: string; barcode?: string };
};

export type SkuBarcodePlan = {
  changes: SkuBarcodeChange[];
  conflicts: SkuBarcodeConflict[];
  skipped: string[];
};

export type SkuBarcodeApplyResult = {
  updated: string[];
  failed: Array<{ productId: string; reason: string }>;
  notAttempted: string[];
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function conflict(
  productId: string,
  field: 'sku' | 'barcode',
  existing: string,
  proposed: string,
  reason: string
): SkuBarcodeConflict {
  return { productId, field, existing, proposed, reason };
}

/**
 * Classifies every matched row before any write.
 * `catalog` is the products already loaded, used to see whether a proposed
 * code belongs to a different product.
 */
export function planSkuBarcodeUpdates(
  rows: Array<{ product: SkuBarcodeProduct; proposed: string }>,
  catalog: SkuBarcodeProduct[]
): SkuBarcodePlan {
  const conflicts: SkuBarcodeConflict[] = [];
  const skipped: string[] = [];
  const pending = new Map<string, SkuBarcodeChange>();

  for (const row of rows) {
    const product = row.product;
    const proposed = text(row.proposed);
    const sku = text(product.sku);
    const barcode = text(product.barcode);
    const plu = text(product.plu);
    const rowConflicts: SkuBarcodeConflict[] = [];
    if (sku && sku !== proposed) {
      rowConflicts.push(
        conflict(
          product.id,
          'sku',
          sku,
          proposed,
          'Existing SKU is not empty and does not match the proposed code.'
        )
      );
    }
    if (barcode && barcode !== proposed) {
      rowConflicts.push(
        conflict(
          product.id,
          'barcode',
          barcode,
          proposed,
          'Existing barcode is not empty and does not match the proposed code.'
        )
      );
    }
    if (rowConflicts.length > 0) {
      conflicts.push(...rowConflicts);
      pending.delete(product.id);
      continue;
    }
    if (sku === proposed && barcode === proposed) {
      if (!skipped.includes(product.id)) skipped.push(product.id);
      pending.delete(product.id);
      continue;
    }
    const set: { sku?: string; barcode?: string } = {};
    if (!sku) set.sku = proposed;
    if (!barcode) set.barcode = proposed;
    const change: SkuBarcodeChange = {
      productId: product.id,
      before: { sku, barcode, plu },
      set,
    };
    const previous = pending.get(product.id);
    if (previous && (previous.set.sku !== set.sku || previous.set.barcode !== set.barcode)) {
      conflicts.push(
        conflict(
          product.id,
          'sku',
          sku,
          proposed,
          'The sheet proposes more than one code for this product.'
        )
      );
      pending.delete(product.id);
      continue;
    }
    pending.set(product.id, change);
  }

  const owners = new Map<string, string[]>();
  for (const change of pending.values()) {
    const code = change.set.sku || change.set.barcode || '';
    const ids = owners.get(code) || [];
    ids.push(change.productId);
    owners.set(code, ids);
  }
  for (const [code, ids] of owners) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const change = pending.get(id);
      pending.delete(id);
      const field = change?.set.sku ? 'sku' : 'barcode';
      conflicts.push(
        conflict(
          id,
          field,
          field === 'sku' ? change?.before.sku || '' : change?.before.barcode || '',
          code,
          'The same code is proposed for more than one product.'
        )
      );
    }
  }

  for (const change of [...pending.values()]) {
    const code = change.set.sku || change.set.barcode || '';
    const other = catalog.find(
      (product) => product.id !== change.productId && (text(product.sku) === code || text(product.barcode) === code)
    );
    if (!other) continue;
    pending.delete(change.productId);
    const field = change.set.sku ? 'sku' : 'barcode';
    conflicts.push(
      conflict(
        change.productId,
        field,
        field === 'sku' ? change.before.sku : change.before.barcode,
        code,
        `Proposed code is already used by product ${other.id}.`
      )
    );
  }

  return { changes: [...pending.values()], conflicts, skipped };
}

function still(field: 'sku' | 'barcode' | 'plu', value: string): Record<string, unknown> {
  if (value) return { [field]: value };
  return { $or: [{ [field]: '' }, { [field]: null }, { [field]: { $exists: false } }] };
}

function matchedWrite(result: { matchedCount?: number; modifiedCount?: number } | null | undefined): boolean {
  if (!result) return false;
  if (typeof result.matchedCount === 'number') return result.matchedCount > 0;
  return (result.modifiedCount ?? 0) > 0;
}

/**
 * Writes only the approved sku and barcode fills.
 * Each write matches the identifiers that were planned, including PLU, and
 * never includes PLU in the update. A miss or an error is not retried.
 */
export async function applySkuBarcodeChanges(changes: SkuBarcodeChange[]): Promise<SkuBarcodeApplyResult> {
  const updated: string[] = [];
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const remaining = changes.slice(index + 1).map((item) => item.productId);
    const keys = Object.keys(change.set || {});
    if (keys.length === 0 || keys.some((key) => key !== 'sku' && key !== 'barcode')) {
      return {
        updated,
        failed: [
          {
            productId: change.productId,
            reason: 'Refusing to write a field other than an empty sku or barcode.',
          },
        ],
        notAttempted: remaining,
      };
    }
    const code = change.set.sku || change.set.barcode || '';
    const other = await Product.findOne({
      _id: { $ne: change.productId },
      $or: [{ sku: code }, { barcode: code }],
    })
      .select('_id')
      .lean();
    if (other) {
      return {
        updated,
        failed: [
          {
            productId: change.productId,
            reason: `Proposed code is already used by product ${String(other._id)}. Not retried.`,
          },
        ],
        notAttempted: remaining,
      };
    }
    try {
      const result = (await Product.updateOne(
        {
          _id: change.productId,
          $and: [still('sku', change.before.sku), still('barcode', change.before.barcode), still('plu', change.before.plu)],
        },
        { $set: { ...change.set, updated_at: new Date() } }
      )) as { matchedCount?: number; modifiedCount?: number };
      if (!matchedWrite(result)) {
        return {
          updated,
          failed: [
            {
              productId: change.productId,
              reason: 'Product identifiers changed before the write. Not retried.',
            },
          ],
          notAttempted: remaining,
        };
      }
      updated.push(change.productId);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        updated,
        failed: [{ productId: change.productId, reason }],
        notAttempted: remaining,
      };
    }
  }
  return { updated, failed: [], notAttempted: [] };
}
