/**
 * Enterprise product CSV import: parse, transform, validate, bulk insert.
 * Supports both canonical schema (product-import-sample.csv) and structured format
 * (Category, Subcategory, Product_Name, Price_USD, etc.).
 */

import { parseCsvRecords } from '../utils/csvParseRecords';
import mongoose from 'mongoose';
import Product from '../models/Product';
import { generateProductId } from '../utils/productCodes';
import Category from '../models/Category';
import SubCategory from '../models/SubCategory';
import { shouldWriteOpeningStockMovement, writeOpeningStockMovement } from '../utils/openingStockMovement';

// ----- Canonical row (after normalization) -----
export interface CanonicalProductRow {
  category: string;       // category name
  subcategory: string;    // subcategory name (can be empty)
  name: string;
  description?: string;
  price: number;
  cost_price: number;
  sku: string | null;
  barcode: string | null;
  plu: string | null;
  stock_quantity: number;
  tax_rate: number;
  is_active: boolean;
  low_stock_threshold: number;
}

export interface ImportRowResult {
  rowIndex: number;
  data: CanonicalProductRow | null;
  errors: string[];
  status: 'valid' | 'invalid' | 'duplicate_skipped';
}

export interface ImportPreviewResult {
  rows: ImportRowResult[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    duplicate_skipped: number;
  };
}

export interface ImportExecuteResult {
  imported: number;
  failed: number;
  duplicate_skipped: number;
  total: number;
  errors: { row: number; message: string }[];
  duplicate_skipped_rows?: { row: number; message: string }[];
  categories_created: number;
  subcategories_created: number;
}

// ----- Column mapping: multiple possible headers → canonical key -----
// QuickBooks-compatible: Product/Service Name, SKU, Sales Price/Rate, Taxable, Purchase Cost, (optional) Type, Sales Description, Quantity On Hand. No PLU, Barcode, or picture.
const COLUMN_ALIASES: Record<string, string> = {
  category: 'category',
  'category name': 'category',
  subcategory: 'subcategory',
  'sub category': 'subcategory',
  sub_category: 'subcategory',
  product_name: 'name',
  'product name': 'name',
  'product/service name': 'name',
  name: 'name',
  price_usd: 'price',
  'price (usd)': 'price',
  'sales price/rate': 'price',
  selling_price: 'price',
  price: 'price',
  cost_price: 'cost_price',
  'cost price': 'cost_price',
  'purchase cost': 'cost_price',
  cost: 'cost_price',
  sku: 'sku',
  barcode: 'barcode',
  plu: 'plu',
  stock_quantity: 'stock_quantity',
  'stock quantity': 'stock_quantity',
  'quantity on hand': 'stock_quantity',
  stock: 'stock_quantity',
  tax_rate: 'tax_rate',
  'tax rate': 'tax_rate',
  taxable: 'tax_rate',
  tax: 'tax_rate',
  status: 'status',
  description: 'description',
  'sales description': 'description',
  'purchase description': 'description',
  low_stock_threshold: 'low_stock_threshold',
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_');
}

/** Get product name from raw row (same column mapping as normalizeRow). Used to skip blank rows before any validation. */
function getRowName(row: Record<string, string>): string {
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const n = normalizeHeader(k);
    const canon = COLUMN_ALIASES[n] ?? n.replace(/\s+/g, '_');
    if (!map[canon]) map[canon] = (v ?? '').toString().trim();
  }
  return ((map['name'] || map['product_name'] || '').toString().trim());
}

function getCell(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** Parse CSV buffer into array of keyed rows (first row = headers). */
export async function parseCsv(buffer: Buffer): Promise<Record<string, string>[]> {
  const raw = buffer.toString('utf-8');
  if (!raw.trim()) return [];
  return parseCsvRecords<Record<string, string>>(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
    cast: false,
  });
}

/** Normalize a raw CSV row to canonical shape. Handles both sample format and structured format. */
export function normalizeRow(row: Record<string, string>, rowIndex: number): { data: CanonicalProductRow; errors: string[] } {
  const errors: string[] = [];
  const get = (...keys: string[]) => getCell(row, ...keys);

  // Map headers: try exact keys first, then normalized (lowercase, underscores)
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const n = normalizeHeader(k);
    const canon = COLUMN_ALIASES[n] ?? n.replace(/\s+/g, '_');
    if (!map[canon]) map[canon] = v ?? '';
  }
  const cell = (canonKey: string, ...alt: string[]) => {
    let v = map[canonKey];
    for (const a of alt) {
      if (v !== undefined && v !== '') break;
      v = map[a];
    }
    return (v !== undefined && v !== null ? String(v).trim() : '') as string;
  };

  const category = cell('category') || cell('category_slug');
  const subcategory = cell('subcategory', 'sub_category');
  const name = cell('name', 'product_name');
  const priceStr = (cell('price', 'price_usd', 'selling_price') || '').replace(/[$,\s]/g, '');
  const costStr = (cell('cost_price', 'cost') || '').replace(/[$,\s]/g, '');
  const sku = (cell('sku') || '').trim() || null;
  const barcode = (cell('barcode') || '').trim() || null;
  const plu = (cell('plu') || '').trim() || null;
  const stockStr = cell('stock_quantity', 'stock') || '0';
  const taxStr = cell('tax_rate', 'tax') || '0';
  const statusStr = (cell('status') || 'active').toLowerCase();
  const description = cell('description') || undefined;
  const lowStockStr = cell('low_stock_threshold') || '10';

  // Row is a valid product only if name and price are present/valid. Validate in that order.
  if (!name || name === '-') {
    errors.push('Missing product name');
    return { data: null as any, errors };
  }
  const price = parseFloat(priceStr);
  if (Number.isNaN(price) || price < 0) {
    errors.push('Invalid or missing price (must be numeric, non-negative)');
    return { data: null as any, errors };
  }
  const cost_price = costStr ? parseFloat(costStr) : 0;
  if (Number.isNaN(cost_price) || cost_price < 0) errors.push('Invalid cost price (using 0)');
  // stock_quantity: accept positive, zero, negative (backorders); NaN → 0; store as integer. No rejection of 0 or negative.
  const stockNum = Number(stockStr);
  const stock_quantity = Number.isNaN(stockNum) ? 0 : Math.floor(stockNum);
  const tax_rate = taxStr ? parseFloat(taxStr) : 0;
  if (Number.isNaN(tax_rate) || tax_rate < 0) errors.push('Invalid tax rate (using 0)');
  const low_stock_threshold = parseInt(lowStockStr, 10) || 10;
  const is_active = ['active', '1', 'true', 'yes'].includes(statusStr) || statusStr === '';

  const data: CanonicalProductRow = {
    category: category || 'Uncategorized',
    subcategory: subcategory || '',
    name: name.trim(),
    description: description || undefined,
    price: Math.round(price * 100) / 100,
    cost_price: Math.round((Number.isNaN(cost_price) ? 0 : cost_price) * 100) / 100,
    sku: sku ?? null,
    barcode: barcode ?? null,
    plu: plu ?? null,
    stock_quantity,
    tax_rate: Math.round((Number.isNaN(tax_rate) ? 0 : tax_rate) * 100) / 100,
    is_active,
    low_stock_threshold,
  };
  return { data, errors };
}

/** Generate unique slug from name and used set. */
function makeSlug(name: string, used: Set<string>): string {
  const base = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'product';
  let slug = base;
  let n = 0;
  while (used.has(slug)) {
    n++;
    slug = `${base}-${n}`;
  }
  used.add(slug);
  return slug;
}

/** Generate next EDI-XXXX SKU. */
function nextSku(used: Set<string>): string {
  let n = 1;
  while (used.has(`EDI-${String(n).padStart(4, '0')}`)) n++;
  const sku = `EDI-${String(n).padStart(4, '0')}`;
  used.add(sku);
  return sku;
}

/** Generate unique 12-digit numeric barcode. */
function nextBarcode(used: Set<string>): string {
  let n = 100000000000;
  while (used.has(String(n))) n++;
  used.add(String(n));
  return String(n);
}

/**
 * Build preview: parse CSV, normalize each row, validate, detect duplicates (by name+subcategory).
 * Does not touch the database (except optionally for duplicate check - we'll do duplicate check in execute using session).
 */
export async function buildPreview(buffer: Buffer): Promise<ImportPreviewResult> {
  const records = await parseCsv(buffer);
  const rows: ImportRowResult[] = [];
  const seenKey = new Set<string>(); // "category|subcategory|name" for duplicate detection within file
  let valid = 0;
  let invalid = 0;
  let duplicate_skipped = 0;

  for (let i = 0; i < records.length; i++) {
    const rowIndex = i + 2; // 1-based + header
    const row = records[i];
    // Skip blank rows entirely: do not validate, do not mark invalid, do not count in invalid.
    const rowName = getRowName(row);
    if (!rowName || rowName === '-') {
      continue;
    }
    const { data, errors } = normalizeRow(row, rowIndex);

    if (errors.length > 0) {
      rows.push({ rowIndex, data: null, errors, status: 'invalid' });
      invalid++;
      continue;
    }

    const key = `${(data.category || '').toLowerCase()}|${(data.subcategory || '').toLowerCase()}|${data.name.toLowerCase()}`;
    if (seenKey.has(key)) {
      rows.push({ rowIndex, data, errors: ['Duplicate product name in same category/subcategory within file'], status: 'duplicate_skipped' });
      duplicate_skipped++;
      continue;
    }
    seenKey.add(key);

    rows.push({ rowIndex, data, errors: [], status: 'valid' });
    valid++;
  }

  return {
    rows,
    summary: {
      total: records.length,
      valid,
      invalid,
      duplicate_skipped,
    },
  };
}

/**
 * Execute import inside a transaction: create categories/subcategories as needed, insert products.
 * Uses normalized rows (from preview or re-parsed). Applies SKU/barcode auto-generation, slug, duplicate skip.
 */
export async function executeImport(
  buffer: Buffer,
  options: { skipDuplicatesByNameInSubcategory?: boolean } = {}
): Promise<ImportExecuteResult> {
  const preview = await buildPreview(buffer);
  const { skipDuplicatesByNameInSubcategory = true } = options;

  const errors: { row: number; message: string }[] = [];
  const duplicateSkippedRows: { row: number; message: string }[] = [];
  let imported = 0;
  let duplicate_skipped = 0;
  let categories_created = 0;
  let subcategories_created = 0;

  const validRows = preview.rows.filter((r) => r.status === 'valid' && r.data) as (ImportRowResult & { data: CanonicalProductRow })[];
  if (validRows.length === 0) {
    return {
      imported: 0,
      failed: preview.summary.invalid + preview.summary.duplicate_skipped,
      duplicate_skipped: preview.summary.duplicate_skipped,
      total: preview.summary.total,
      errors: preview.rows.filter((r) => r.errors.length).flatMap((r) => r.errors.map((e) => ({ row: r.rowIndex, message: e }))),
      categories_created: 0,
      subcategories_created: 0,
    };
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  const usedSlugs = new Set<string>(await Product.distinct('slug', {}, { session }));
  const usedSkus = new Set<string>((await Product.distinct('sku', { sku: { $exists: true, $nin: [null, ''] } }, { session })) as string[]);
  const usedBarcodes = new Set<string>((await Product.distinct('barcode', { barcode: { $exists: true, $nin: [null, ''] } }, { session })) as string[]);
  const usedPlus = new Set<string>((await Product.distinct('plu', { plu: { $exists: true, $nin: [null, ''] } }, { session })) as string[]);

  const categoryByName = new Map<string, mongoose.Types.ObjectId>();
  const subcategoryByKey = new Map<string, mongoose.Types.ObjectId>(); // "categoryId|subName"

  async function getOrCreateCategory(name: string): Promise<mongoose.Types.ObjectId> {
    const n = name.trim().toLowerCase();
    if (categoryByName.has(n)) return categoryByName.get(n)!;
    let cat = await Category.findOne({ $or: [{ name: new RegExp(`^${name.trim()}$`, 'i') }, { slug: n.replace(/\s+/g, '-') }] }).session(session).lean();
    if (cat) {
      categoryByName.set(n, cat._id);
      return cat._id;
    }
    let slug = n.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'category';
    let exists = await Category.findOne({ slug }).session(session);
    let i = 1;
    while (exists) {
      slug = `${slug}-${i++}`;
      exists = await Category.findOne({ slug }).session(session);
    }
    const [newCat] = await Category.create([{ name: name.trim(), slug }], { session });
    categoryByName.set(n, newCat._id);
    categories_created++;
    return newCat._id;
  }

  async function getOrCreateSubCategory(categoryId: mongoose.Types.ObjectId, subName: string): Promise<mongoose.Types.ObjectId | null> {
    if (!subName.trim()) return null;
    const key = `${categoryId.toString()}|${subName.trim().toLowerCase()}`;
    if (subcategoryByKey.has(key)) return subcategoryByKey.get(key)!;
    let slug = subName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'sub';
    let sub = await SubCategory.findOne({ category_id: categoryId, $or: [{ name: new RegExp(`^${subName.trim()}$`, 'i') }, { slug }] }).session(session).lean();
    if (sub) {
      subcategoryByKey.set(key, sub._id);
      return sub._id;
    }
    slug = `${slug}-${categoryId.toString().slice(-6)}`;
    const [newSub] = await SubCategory.create([{ name: subName.trim(), slug, category_id: categoryId }], { session });
    subcategoryByKey.set(key, newSub._id);
    subcategories_created++;
    return newSub._id;
  }

  let committed = false;
  let transactionAborted = false; // set when any op in the transaction throws (we must not call commit)
  try {
    const existingByKey = new Set<string>();
    if (skipDuplicatesByNameInSubcategory) {
      const existing = await Product.find({}).select('name category_id sub_category_id').session(session).lean();
      for (const p of existing as any[]) {
        const catId = p.category_id?.toString() ?? '';
        const subId = p.sub_category_id?.toString() ?? '';
        existingByKey.add(`${catId}|${subId}|${(p.name || '').toLowerCase()}`);
      }
    }

    for (const { rowIndex, data } of validRows) {
      if (transactionAborted) break;
      try {
        const categoryId = await getOrCreateCategory(data.category);
        const subCategoryId = data.subcategory ? await getOrCreateSubCategory(categoryId, data.subcategory) : null;
        const key = `${categoryId}|${subCategoryId ?? ''}|${data.name.toLowerCase()}`;
        if (skipDuplicatesByNameInSubcategory && existingByKey.has(key)) {
          duplicate_skipped++;
          duplicateSkippedRows.push({ row: rowIndex, message: 'Duplicate product name in same category/subcategory (skipped)' });
          continue;
        }

        const slug = makeSlug(data.name, usedSlugs);
        const skuCandidate =
          (data.barcode && data.barcode.trim()) ||
          (data.sku && data.sku.trim()) ||
          (data.plu && data.plu.trim()) ||
          null;
        let sku: string | undefined;
        if (skuCandidate && !usedSkus.has(skuCandidate)) {
          usedSkus.add(skuCandidate);
          sku = skuCandidate;
        } else if (skuCandidate) {
          sku = skuCandidate;
        }
        const product_id = await generateProductId();

        const created = await Product.create(
          [
            {
              name: data.name,
              slug,
              product_id,
              description: data.description,
              product_type: 'inventory',
              price: data.price,
              cost_price: data.cost_price,
              category_id: categoryId,
              sub_category_id: subCategoryId ?? undefined,
              sku,
              stock_quantity: data.stock_quantity,
              low_stock_threshold: data.low_stock_threshold,
              tax_rate: data.tax_rate,
              is_active: data.is_active,
            },
          ],
          { session }
        );
        const product = Array.isArray(created) ? created[0] : created;
        const productType = (product as { product_type?: unknown }).product_type || 'inventory';
        if (shouldWriteOpeningStockMovement(productType, data.stock_quantity)) {
          await writeOpeningStockMovement({
            productId: (product as { _id: mongoose.Types.ObjectId })._id,
            openingQty: data.stock_quantity,
            session,
          });
        }
        existingByKey.add(key);
        imported++;
      } catch (err: any) {
        const msg = err.code === 11000 ? 'Duplicate barcode, PLU, or SKU' : (err.message || 'Insert failed');
        errors.push({ row: rowIndex, message: msg });
        transactionAborted = true;
        break;
      }
    }

    if (transactionAborted) {
      await session.abortTransaction().catch(() => {});
    } else {
      await session.commitTransaction();
      committed = true;
    }
  } catch (e) {
    if (!committed) {
      await session.abortTransaction().catch(() => {});
    }
    throw e;
  } finally {
    session.endSession();
  }

  return {
    imported: transactionAborted ? 0 : imported,
    failed: errors.length,
    duplicate_skipped,
    total: preview.summary.total,
    errors: errors.slice(0, 100),
    duplicate_skipped_rows: duplicateSkippedRows.slice(0, 50),
    categories_created: transactionAborted ? 0 : categories_created,
    subcategories_created: transactionAborted ? 0 : subcategories_created,
  };
}
