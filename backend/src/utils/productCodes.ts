import { createHash } from 'node:crypto';
import os from 'node:os';
import mongoose from 'mongoose';
import Product from '../models/Product';
import {
  evaluateConnectedTarget,
  evaluateTargetBeforeConnect,
  type ConnectedTargetEvidence,
} from '../db/cleanupSafeguards';
import { connectedTarget } from '../db/cleanupRunner';
import { identifierLock, type IdentifierLockRecord } from './identifierLock';
import { migrationJournal, type MigrationJournal } from './migrationJournal';

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

export function isAssignableProductId(value: string): boolean {
  return /^\d{5,6}$/.test(String(value ?? '').trim());
}

/**
 * Keep a Generate-ID preview if it is still unused; otherwise mint a new one.
 */
export async function resolveCreateProductId(
  requested?: string | null,
  opts?: { excludeId?: string }
): Promise<string> {
  const incoming = String(requested ?? '').trim();
  if (!incoming) return generateProductId();
  if (!isAssignableProductId(incoming)) {
    const err: Error & { status?: number } = new Error('Product ID must be 5 or 6 digits');
    err.status = 400;
    throw err;
  }
  const clashQuery: Record<string, unknown> = { product_id: incoming };
  if (opts?.excludeId && mongoose.Types.ObjectId.isValid(opts.excludeId)) {
    clashQuery._id = { $ne: new mongoose.Types.ObjectId(opts.excludeId) };
  }
  const exists = await Product.findOne(clashQuery).select('_id').lean();
  if (exists) {
    const err: Error & { status?: number } = new Error('That Product ID is already in use');
    err.status = 400;
    throw err;
  }
  return incoming;
}

export type ProductCodeField = 'product_id' | 'sku';

export type ProductCodeSnapshot = {
  product_id: string;
  sku: string;
  barcode: string;
  plu: string;
};

/** A fill of a field that is empty today. Never includes barcode or plu. */
export type ProductCodeChange = {
  id: string;
  before: ProductCodeSnapshot;
  set: { product_id?: string; sku?: string };
  fields: ProductCodeField[];
};

/** A product the migration will not touch because an identifier would be overwritten or duplicated. */
export type ProductCodeReview = {
  id: string;
  reason: string;
  before: ProductCodeSnapshot;
};

export type ProductCodeMigrationPlan = {
  examined: number;
  skippedNoChange: number;
  changes: ProductCodeChange[];
  reviews: ProductCodeReview[];
  warnings: string[];
  /** Binds the plan. Execution rejects the plan when this does not match the contents. */
  digest: string;
};

export type ProductCodeApplyFailure = {
  id: string;
  reason: string;
};

export type ProductCodeApplyResult = {
  /** False when the plan was rejected or a write stopped the run. */
  applied: boolean;
  updated: number;
  /** Products whose conditional write matched. */
  updatedIds: string[];
  /** The product a write failed on. That write is not retried. */
  failed: ProductCodeApplyFailure[];
  /** Products not written because an earlier failure stopped the run, or because the plan was rejected first. */
  notAttempted: string[];
  /** Earlier runs left in "running" because the process stopped. Their plans were not replayed. */
  interruptedRunIds: string[];
  reason?: string;
  warnings: string[];
};

/**
 * Reads the process environment and this machine's hostname.
 * Execution never accepts a database name from its caller.
 */
export const migrationRuntime = {
  uri(): string | undefined {
    return process.env.MONGODB_URI;
  },
  nodeEnv(): string | undefined {
    return process.env.NODE_ENV;
  },
  localHostnames(): string[] {
    return [os.hostname()].filter(Boolean);
  },
};

/** Shown when execution itself refuses the database. Contains no host or credential. */
export const MIGRATION_TARGET_REFUSAL =
  'This database target is not a confirmed local development database, so no products were changed.';

type LeanCodeProduct = {
  _id: { toString: () => string };
  product_id?: string;
  sku?: string;
  barcode?: string;
  plu?: string;
};

const REVIEW_SKU_CONFLICT =
  'Existing SKU would have to be replaced. Left unchanged for manual review.';
const REVIEW_DUPLICATE_PRODUCT_ID =
  'Proposed product_id is already used or duplicated. Left unchanged for manual review.';
const REVIEW_DUPLICATE_SKU =
  'Proposed SKU is already used or duplicated. Left unchanged for manual review.';
const REVIEW_NO_PRODUCT_ID =
  'Could not allocate a unique product_id. Left unchanged for manual review.';

function codeText(value: unknown): string {
  return String(value ?? '').trim();
}

function snapshotOf(product: LeanCodeProduct): ProductCodeSnapshot {
  return {
    product_id: codeText(product.product_id),
    sku: codeText(product.sku),
    barcode: codeText(product.barcode),
    plu: codeText(product.plu),
  };
}

function sameSnapshot(left: ProductCodeSnapshot, right: ProductCodeSnapshot): boolean {
  return (
    left.product_id === right.product_id &&
    left.sku === right.sku &&
    left.barcode === right.barcode &&
    left.plu === right.plu
  );
}

/** Stable identity of a plan. Field order and array order do not matter. */
export function productCodePlanDigest(plan: {
  changes: readonly ProductCodeChange[];
  reviews: readonly ProductCodeReview[];
}): string {
  const changes = [...plan.changes]
    .map((change) => ({
      id: change.id,
      before: change.before,
      set: { product_id: change.set.product_id || '', sku: change.set.sku || '' },
      fields: [...change.fields].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const reviews = [...plan.reviews]
    .map((review) => ({ id: review.id, reason: review.reason, before: review.before }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.reason.localeCompare(b.reason));
  return createHash('sha256').update(JSON.stringify({ changes, reviews })).digest('hex');
}

async function defaultAllocateProductId(used: ReadonlySet<string>): Promise<string | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = await generateProductId();
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Read-only plan. Fills an empty product_id or an empty sku.
 * Does not write. Does not propose clearing or replacing barcode, PLU,
 * an existing SKU, or an existing product_id. Those products are returned
 * under `reviews` and are absent from `changes`.
 */
export async function planProductCodeMigration(options?: {
  allocateProductId?: (used: ReadonlySet<string>) => Promise<string | null>;
}): Promise<ProductCodeMigrationPlan> {
  const products = (await Product.find({})
    .select('_id product_id sku barcode plu')
    .lean()) as LeanCodeProduct[];
  const allocate = options?.allocateProductId || defaultAllocateProductId;
  const existingProductIds = new Set<string>();
  const existingSkus = new Set<string>();
  for (const product of products) {
    const snap = snapshotOf(product);
    if (snap.product_id) existingProductIds.add(snap.product_id);
    if (snap.sku) existingSkus.add(snap.sku);
  }

  const takenIds = new Set(existingProductIds);
  const reviews: ProductCodeReview[] = [];
  const tentative: ProductCodeChange[] = [];
  let skippedNoChange = 0;

  for (const product of products) {
    const id = product._id.toString();
    const before = snapshotOf(product);
    const otherCode = [before.barcode, before.plu].find((value) => value && value !== before.sku) || '';
    if (before.sku && isFiveDigitProductId(before.sku) && otherCode) {
      reviews.push({ id, reason: REVIEW_SKU_CONFLICT, before });
      continue;
    }

    const set: { product_id?: string; sku?: string } = {};
    if (!before.product_id) {
      if (before.sku && isFiveDigitProductId(before.sku)) {
        set.product_id = before.sku;
      } else {
        const allocated = await allocate(takenIds);
        if (!allocated) {
          reviews.push({ id, reason: REVIEW_NO_PRODUCT_ID, before });
          continue;
        }
        set.product_id = allocated;
        takenIds.add(allocated);
      }
    }
    if (!before.sku) {
      const candidate = before.barcode || before.plu;
      if (candidate) set.sku = candidate;
    }
    const fields = (Object.keys(set) as ProductCodeField[]).filter((field) => Boolean(set[field]));
    if (fields.length === 0) {
      skippedNoChange += 1;
      continue;
    }
    tentative.push({ id, before, set, fields });
  }

  const blocked = new Map<string, string>();
  const block = (id: string, reason: string) => {
    if (!blocked.has(id)) blocked.set(id, reason);
  };
  const productIdGroups = new Map<string, ProductCodeChange[]>();
  const skuGroups = new Map<string, ProductCodeChange[]>();
  for (const change of tentative) {
    if (change.set.product_id) {
      const group = productIdGroups.get(change.set.product_id) || [];
      group.push(change);
      productIdGroups.set(change.set.product_id, group);
    }
    if (change.set.sku) {
      const group = skuGroups.get(change.set.sku) || [];
      group.push(change);
      skuGroups.set(change.set.sku, group);
    }
  }
  for (const [productId, group] of productIdGroups) {
    if (group.length > 1 || existingProductIds.has(productId)) {
      for (const change of group) block(change.id, REVIEW_DUPLICATE_PRODUCT_ID);
    }
  }
  for (const [sku, group] of skuGroups) {
    if (group.length > 1 || existingSkus.has(sku)) {
      for (const change of group) block(change.id, REVIEW_DUPLICATE_SKU);
    }
  }

  const changes: ProductCodeChange[] = [];
  for (const change of tentative) {
    const reason = blocked.get(change.id);
    if (reason) reviews.push({ id: change.id, reason, before: change.before });
    else changes.push(change);
  }

  const planned = { examined: products.length, skippedNoChange, changes, reviews, warnings: [] as string[] };
  return { ...planned, digest: productCodePlanDigest(planned) };
}

function rejectPlan(
  reason: string,
  notAttempted: string[] = [],
  interruptedRunIds: string[] = []
): ProductCodeApplyResult {
  return {
    applied: false,
    updated: 0,
    updatedIds: [],
    failed: [],
    notAttempted,
    interruptedRunIds,
    reason,
    warnings: [],
  };
}

function plannedIds(plan: { changes?: ProductCodeChange[] } | null | undefined): string[] {
  if (!plan || !Array.isArray(plan.changes)) return [];
  return plan.changes.map((change) => change?.id).filter((id): id is string => Boolean(id));
}

/**
 * The connected server, read from the open driver connection.
 * A database name is never taken from the caller.
 */
async function readMigrationTarget(notAttempted: string[]): Promise<
  | { ok: false; result: ProductCodeApplyResult }
  | { ok: true; evidence: ConnectedTargetEvidence }
> {
  const localHostnames = migrationRuntime.localHostnames();
  const before = evaluateTargetBeforeConnect({
    uri: migrationRuntime.uri(),
    nodeEnv: migrationRuntime.nodeEnv(),
    localHostnames,
  });
  if (!before.safe) {
    console.error('Product code migration refused:', before.reason);
    return { ok: false, result: rejectPlan(MIGRATION_TARGET_REFUSAL, notAttempted) };
  }
  let evidence: ConnectedTargetEvidence;
  try {
    evidence = await connectedTarget.read();
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('Product code migration refused: the connected server could not be identified:', detail);
    return { ok: false, result: rejectPlan(MIGRATION_TARGET_REFUSAL, notAttempted) };
  }
  const connected = evaluateConnectedTarget(evidence, localHostnames);
  if (!connected.safe) {
    console.error('Product code migration refused:', connected.reason);
    return { ok: false, result: rejectPlan(MIGRATION_TARGET_REFUSAL, notAttempted) };
  }
  return { ok: true, evidence };
}

function identifierStill(field: 'product_id' | 'sku' | 'barcode' | 'plu', value: string): Record<string, unknown> {
  if (value) return { [field]: value };
  return { $or: [{ [field]: '' }, { [field]: null }, { [field]: { $exists: false } }] };
}

function snapshotFilter(change: ProductCodeChange): Record<string, unknown> {
  const fields = ['product_id', 'sku', 'barcode', 'plu'] as const;
  return {
    _id: change.id,
    $and: fields.map((field) => identifierStill(field, change.before[field])),
  };
}

function writeMatched(result: { matchedCount?: number; modifiedCount?: number } | null | undefined): boolean {
  if (!result) return false;
  if (typeof result.matchedCount === 'number') return result.matchedCount > 0;
  return (result.modifiedCount ?? 0) > 0;
}

function proposalShape(change: ProductCodeChange): string | null {
  const allowed = new Set(['product_id', 'sku']);
  for (const key of Object.keys(change.set || {})) {
    if (!allowed.has(key)) return `Plan changes ${key}, which this migration is not allowed to write.`;
  }
  if (!change.before) return 'Plan is missing the current identifiers.';
  if (change.set.product_id && change.before.product_id) return 'Plan would overwrite an existing product_id.';
  if (change.set.sku && change.before.sku) return 'Plan would overwrite an existing SKU.';
  if (change.set.product_id !== undefined && !codeText(change.set.product_id)) return 'Plan has an empty product_id.';
  if (change.set.sku !== undefined && !codeText(change.set.sku)) return 'Plan has an empty SKU.';
  const fields = new Set(change.fields || []);
  if (change.set.product_id && !fields.has('product_id')) return 'Plan fields do not match the proposed product_id.';
  if (change.set.sku && !fields.has('sku')) return 'Plan fields do not match the proposed SKU.';
  for (const field of fields) {
    if (field !== 'product_id' && field !== 'sku') {
      return `Plan changes ${field}, which this migration is not allowed to write.`;
    }
    if (!change.set[field]) return 'Plan fields do not match the proposed values.';
  }
  return null;
}

/**
 * Writes an already approved plan and does not build a different one.
 * Rejects a missing, altered, stale, or destructive plan before any write.
 * Fills only an empty product_id or an empty sku. Never writes barcode, plu,
 * price, cost, stock, category, or image_url, and never unsets a field.
 *
 * The database target is read from the process environment and the open
 * driver connection. A caller cannot supply a database name to skip that check.
 *
 * Writes are not wrapped in a multi-document transaction. The only databases
 * this function may change are MongoDB servers on this machine, and a
 * standalone mongod rejects multi-document transactions. Each write matches
 * the planned snapshot. A miss or an error is not retried, and every product
 * after it is left unattempted so a later run can plan again from current data.
 * Progress is also written to a local journal. The journal is not a plan and
 * cannot authorize a write.
 */
export async function applyProductCodeMigration(
  plan: ProductCodeMigrationPlan,
  options?: { heldLock?: IdentifierLockRecord; skipSettle?: boolean }
): Promise<ProductCodeApplyResult> {
  if (!plan || !Array.isArray(plan.changes) || !Array.isArray(plan.reviews)) {
    return rejectPlan('Plan is missing. Nothing was written.');
  }
  const ids = plannedIds(plan);
  if (!plan.digest || plan.digest !== productCodePlanDigest(plan)) {
    return rejectPlan('Plan was altered or has no digest. Nothing was written.', ids);
  }

  const seenIds = new Set<string>();
  const seenProductIds = new Set<string>();
  const seenSkus = new Set<string>();
  for (const change of plan.changes) {
    if (!change?.id || seenIds.has(change.id)) return rejectPlan('Plan repeats a product. Nothing was written.', ids);
    seenIds.add(change.id);
    const shape = proposalShape(change);
    if (shape) return rejectPlan(`${shape} Nothing was written.`, ids);
    if (change.set.product_id) {
      if (seenProductIds.has(change.set.product_id)) {
        return rejectPlan('Plan proposes a duplicate product_id. Nothing was written.', ids);
      }
      seenProductIds.add(change.set.product_id);
    }
    if (change.set.sku) {
      if (seenSkus.has(change.set.sku)) return rejectPlan('Plan proposes a duplicate SKU. Nothing was written.', ids);
      seenSkus.add(change.set.sku);
    }
  }

  const target = await readMigrationTarget(ids);
  if (!target.ok) return target.result;
  const databaseName = (target.evidence.databaseName || '').trim();
  const connectionHost = (target.evidence.connectionHost || '').trim();

  let ownedLock: IdentifierLockRecord | null = null;
  const releaseOwnedLock = async () => {
    if (!ownedLock) return;
    const releasing = ownedLock;
    ownedLock = null;
    await identifierLock.release(releasing).catch(() => {
      console.error('Product identifier lock could not be released.');
    });
  };

  try {
  if (options?.heldLock) {
    const current = await identifierLock.read();
    if (!current || current.ownerRunId !== options.heldLock.ownerRunId) {
      return rejectPlan('The product identifier lock is not held by this run. Nothing was written.', ids);
    }
  } else {
    try {
      ownedLock = await identifierLock.acquire({ databaseName, purpose: 'product-code-migration' });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'The product identifier lock could not be acquired. Nothing was written.';
      return rejectPlan(msg, ids);
    }
  }

  let interruptedRunIds: string[] = [];
  if (!options?.skipSettle) {
    try {
      const interrupted = await migrationJournal.settle(databaseName);
      interruptedRunIds = interrupted.map((journal) => journal.runId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Product code migration journal could not be read:', msg);
      return rejectPlan('The execution journal could not be read. Nothing was written.', ids);
    }
  }

  for (const change of plan.changes) {
    const doc = (await Product.findById(change.id).select('_id product_id sku barcode plu').lean()) as LeanCodeProduct | null;
    if (!doc) return rejectPlan(`Plan is stale: product ${change.id} was not found. Nothing was written.`, ids, interruptedRunIds);
    if (!sameSnapshot(snapshotOf(doc), change.before)) {
      return rejectPlan(`Plan is stale for product ${change.id}. Nothing was written.`, ids, interruptedRunIds);
    }
    if (change.set.product_id) {
      const clash = await Product.findOne({ _id: { $ne: change.id }, product_id: change.set.product_id })
        .select('_id')
        .lean();
      if (clash) return rejectPlan('Proposed product_id is already used. Nothing was written.', ids, interruptedRunIds);
    }
    if (change.set.sku) {
      const clash = await Product.findOne({ _id: { $ne: change.id }, sku: change.set.sku }).select('_id').lean();
      if (clash) return rejectPlan('Proposed SKU is already used. Nothing was written.', ids, interruptedRunIds);
    }
  }

  if (plan.changes.length === 0) {
    return {
      applied: true,
      updated: 0,
      updatedIds: [],
      failed: [],
      notAttempted: [],
      interruptedRunIds,
      warnings: [],
    };
  }

  let journal: MigrationJournal;
  try {
    journal = await migrationJournal.begin({
      databaseName,
      connectionHost,
      planDigest: plan.digest,
      notAttempted: ids,
      entries: plan.changes.map((change) => ({
        id: change.id,
        before: { product_id: change.before.product_id, sku: change.before.sku },
        set: {
          ...(change.set.product_id ? { product_id: change.set.product_id } : {}),
          ...(change.set.sku ? { sku: change.set.sku } : {}),
        },
      })),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Product code migration journal could not be saved:', msg);
    return rejectPlan('The execution journal could not be saved. Nothing was written.', ids, interruptedRunIds);
  }

  const updatedIds: string[] = [];
  const journalFailure = 'The execution journal could not be saved. Remaining products were not changed and no write was retried.';
  for (let index = 0; index < plan.changes.length; index += 1) {
    const change = plan.changes[index];
    const remaining = plan.changes.slice(index + 1).map((item) => item.id);
    const $set: { product_id?: string; sku?: string; updated_at: Date } = { updated_at: new Date() };
    if (change.set.product_id) $set.product_id = change.set.product_id;
    if (change.set.sku) $set.sku = change.set.sku;
    try {
      const result = (await Product.updateOne(snapshotFilter(change), { $set })) as {
        matchedCount?: number;
        modifiedCount?: number;
      };
      if (!writeMatched(result)) {
        journal.status = 'partially_failed';
        journal.completedAt = new Date().toISOString();
        journal.updatedIds = [...updatedIds];
        journal.failed = [
          {
            id: change.id,
            reason: 'The product no longer matches the approved snapshot. The write was not retried.',
          },
        ];
        journal.notAttempted = remaining;
        await migrationJournal.record(journal).catch((error: unknown) => {
          console.error('Product code migration journal could not be saved:', error);
        });
        return {
          applied: false,
          updated: updatedIds.length,
          updatedIds,
          failed: journal.failed,
          notAttempted: remaining,
          interruptedRunIds,
          reason: 'A product no longer matches the plan. Remaining products were not changed.',
          warnings: [],
        };
      }
      updatedIds.push(change.id);
      journal.updatedIds = [...updatedIds];
      journal.notAttempted = remaining;
      try {
        await migrationJournal.record(journal);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Product code migration journal could not be saved:', msg);
        return {
          applied: false,
          updated: updatedIds.length,
          updatedIds,
          failed: [],
          notAttempted: remaining,
          interruptedRunIds,
          reason: journalFailure,
          warnings: [`[${change.id}] ${msg}`],
        };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      journal.status = 'partially_failed';
      journal.completedAt = new Date().toISOString();
      journal.updatedIds = [...updatedIds];
      journal.failed = [{ id: change.id, reason: msg }];
      journal.notAttempted = remaining;
      await migrationJournal.record(journal).catch((error: unknown) => {
        console.error('Product code migration journal could not be saved:', error);
      });
      return {
        applied: false,
        updated: updatedIds.length,
        updatedIds,
        failed: journal.failed,
        notAttempted: remaining,
        interruptedRunIds,
        reason: 'A write failed. The failed product was not retried and remaining products were not changed.',
        warnings: [`[${change.id}] Update failed: ${msg}`],
      };
    }
  }
  journal.status = 'completed';
  journal.completedAt = new Date().toISOString();
  journal.updatedIds = [...updatedIds];
  journal.notAttempted = [];
  try {
    await migrationJournal.record(journal);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Product code migration journal could not be saved:', msg);
    return {
      applied: false,
      updated: updatedIds.length,
      updatedIds,
      failed: [],
      notAttempted: [],
      interruptedRunIds,
      reason: 'The execution journal could not be saved after the product writes. No write was retried.',
      warnings: [msg],
    };
  }
  return {
    applied: true,
    updated: updatedIds.length,
    updatedIds,
    failed: [],
    notAttempted: [],
    interruptedRunIds,
    warnings: [],
  };
  } finally {
    await releaseOwnedLock();
  }
}

/**
 * Approved migration only. Target validation is repeated here. The lock is
 * acquired before journals are settled and before the plan is built. The lock
 * is released after the plan is applied, including when a step fails.
 * A dry run must not call this function.
 */
export async function executeApprovedProductCodeMigration(): Promise<{
  plan: ProductCodeMigrationPlan | null;
  applied: ProductCodeApplyResult;
}> {
  const gate = await readMigrationTarget([]);
  if (!gate.ok) return { plan: null, applied: gate.result };
  const databaseName = (gate.evidence.databaseName || '').trim();
  let lock: IdentifierLockRecord;
  try {
    lock = await identifierLock.acquire({ databaseName, purpose: 'product-code-migration' });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'The product identifier lock could not be acquired. Nothing was written.';
    return { plan: null, applied: rejectPlan(reason, []) };
  }
  try {
    let interruptedRunIds: string[] = [];
    try {
      const interrupted = await migrationJournal.settle(databaseName);
      interruptedRunIds = interrupted.map((journal) => journal.runId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Product code migration journal could not be read:', msg);
      return {
        plan: null,
        applied: rejectPlan('The execution journal could not be read. Nothing was written.', []),
      };
    }
    const plan = await planProductCodeMigration();
    const applied = await applyProductCodeMigration(plan, { heldLock: lock, skipSettle: true });
    if (interruptedRunIds.length > 0) applied.interruptedRunIds = interruptedRunIds;
    return { plan, applied };
  } finally {
    await identifierLock.release(lock).catch(() => {
      console.error('Product identifier lock could not be released.');
    });
  }
}

/**
 * Does not write. An old caller fails closed instead of migrating the
 * catalogue as a side effect of calling this function.
 */
export function migrateProductIdAndSku(): Promise<never> {
  return Promise.reject(
    new Error(
      'migrateProductIdAndSku no longer writes. Plan with planProductCodeMigration and apply that exact plan only after the backfill guard allows execution.'
    )
  );
}
