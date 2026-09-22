import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import Product from '../models/Product';
import Category from '../models/Category';
import SubCategory from '../models/SubCategory';
import { authenticateAdmin, optionalAuthenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { buildPreview, executeImport } from '../services/productImportService';
import {
  generateProductId,
  migrateProductIdAndSku,
} from '../utils/productCodes';
import { toPublicProduct, toStaffProduct } from '../utils/productProjection';

/**
 * Any response that contains internal product fields (cost_price, vendor_id,
 * reorder_point, committed_quantity, ...) must not be served through shared
 * caches. Storefront / guest responses are still cacheable by the default
 * upstream policy.
 */
function markStaffPrivate(res: express.Response) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Vary', 'Authorization');
}

const router = express.Router();

/** Treat legacy / bad data: only explicit false-like values hide from storefront. */
function isExplicitlyInactive(is_active: unknown): boolean {
  return is_active === false || is_active === 'false' || is_active === 0;
}

function normalizeVisibilityQuery(visibility: unknown): string {
  const raw = Array.isArray(visibility) ? visibility[0] : visibility;
  return typeof raw === 'string' ? raw : '';
}

const CATALOG_VISIBLE_MATCH = {
  $nor: [{ is_active: false }, { is_active: 'false' }, { is_active: 0 }],
};

/** Only return an ObjectId if the string is a valid 24-char hex; otherwise undefined (avoids Mongoose throw). */
function toObjectIdOrUndefined(id: string | undefined): mongoose.Types.ObjectId | undefined {
  if (!id || typeof id !== 'string' || id.length !== 24) return undefined;
  if (!/^[a-f0-9A-F]{24}$/.test(id)) return undefined;
  return new mongoose.Types.ObjectId(id);
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

router.get('/generate-id', authenticateAdmin, async (req, res) => {
  const product_id = await generateProductId();
  res.json({ product_id, item_id: product_id });
});

/** One-time / maintenance: assign product_id + move UPCs into sku for full catalog. */
router.post('/backfill-codes', authenticateAdmin, async (req, res) => {
  try {
    const result = await migrateProductIdAndSku();
    res.json({
      message: 'Backfill complete',
      updated: result.updated,
      examined: result.examined,
      skippedNoChange: result.skippedNoChange,
      warnings: result.warnings.slice(0, 100),
      warningCount: result.warnings.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Backfill failed';
    console.error('Backfill codes error:', e);
    res.status(500).json({ error: msg });
  }
});

// Multer for CSV upload (memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'text/csv' || file.originalname?.toLowerCase().endsWith('.csv');
    if (ok) cb(null, true);
    else cb(new Error('Only CSV files are allowed'));
  },
});

// Get all products (public, or admin with visibility=active|inactive|all)
router.get('/', optionalAuthenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { category, category_id: categoryIdParam, sub_category_id: subCategoryIdParam, search, page = 1, limit, visibility } = req.query;
    const limitNum = Math.min(Math.max(Number(limit) || 100, 1), 5000);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const isAdmin = req.userRole === 'admin';
    const vis = normalizeVisibilityQuery(visibility);

    if ((vis === 'inactive' || vis === 'all') && !isAdmin) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const andParts: any[] = [];
    if (!isAdmin) {
      // Storefront / guests: exclude explicitly inactive (boolean false, string "false", or 0)
      andParts.push({ $nor: [{ is_active: false }, { is_active: 'false' }, { is_active: 0 }] });
    } else if (vis === 'inactive') {
      andParts.push({ $or: [{ is_active: false }, { is_active: 'false' }, { is_active: 0 }] });
    } else if (vis === 'all') {
      // no is_active filter
    } else {
      // admin visibility=active or omitted: same as storefront
      andParts.push({ $nor: [{ is_active: false }, { is_active: 'false' }, { is_active: 0 }] });
    }

    // Filter by category slug (store) or category_id / sub_category_id (admin catalog)
    if (categoryIdParam && typeof categoryIdParam === 'string') {
      andParts.push({ category_id: categoryIdParam });
    } else if (subCategoryIdParam && typeof subCategoryIdParam === 'string') {
      andParts.push({ sub_category_id: subCategoryIdParam });
    } else if (category) {
      const categoryRaw = String(category);
      const categoryDecoded = decodeURIComponent(categoryRaw);
      const categoryNormalized = toSlug(categoryDecoded);
      const categoryDoc = await Category.findOne({
        $or: [
          { slug: categoryRaw },
          { slug: categoryDecoded },
          { slug: categoryNormalized },
          { name: new RegExp(`^${categoryDecoded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        ],
      });
      if (categoryDoc) {
        andParts.push({ category_id: categoryDoc._id });
      } else {
        return res.json({ products: [], pagination: { page: 1, limit: limitNum, total: 0, totalPages: 0 } });
      }
    }

    // Search filter (name, description, sku, barcode) — must not overwrite is_active (use $and)
    if (search) {
      const searchStr = String(search).trim();
      andParts.push({
        $or: [
          { name: { $regex: searchStr, $options: 'i' } },
          { description: { $regex: searchStr, $options: 'i' } },
          { product_id: searchStr },
          { sku: searchStr },
          { barcode: searchStr },
          { plu: searchStr },
        ],
      });
    }

    const query =
      andParts.length === 0
        ? {}
        : andParts.length === 1
          ? andParts[0]
          : { $and: andParts };

    const products = await Product.find(query)
      .populate('category_id', 'name slug')
      .populate('sub_category_id', 'name slug')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Product.countDocuments(query);

    // Authorization decision is server-side ONLY. `isAdmin` came from
    // `optionalAuthenticateAdmin` verifying the JWT above; we never trust
    // a client-supplied flag such as `?includeCost=` or a body/isAdmin field.
    const formattedProducts = isAdmin
      ? products.map((p) => toStaffProduct(p as any))
      : products.map((p) => toPublicProduct(p as any));

    if (isAdmin) markStaffPrivate(res);

    res.json({
      products: formattedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get product by barcode or SKU (for POS / scanner) — must be before GET /:id
router.get('/barcode/:barcode', authenticateAdmin, async (req, res) => {
  try {
    const code = req.params.barcode?.trim() || '';
    let product = await Product.findOne({
      $and: [{ sku: code }, CATALOG_VISIBLE_MATCH],
    })
      .populate('category_id', 'name slug')
      .lean();
    if (!product) {
      product = await Product.findOne({
        $and: [{ product_id: code }, CATALOG_VISIBLE_MATCH],
      })
        .populate('category_id', 'name slug')
        .lean();
    }
    if (!product) {
      product = await Product.findOne({
        $and: [{ barcode: code }, CATALOG_VISIBLE_MATCH],
      })
        .populate('category_id', 'name slug')
        .lean();
    }
    if (!product) {
      product = await Product.findOne({
        $and: [{ plu: code }, CATALOG_VISIBLE_MATCH],
      })
        .populate('category_id', 'name slug')
        .lean();
    }
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const p = product as any;
    // Admin-only route: response contains cost_price — must not be shared-cached.
    markStaffPrivate(res);
    res.json({
      id: p._id.toString(),
      name: p.name,
      price: p.price ?? 0,
      cost_price: p.cost_price != null ? Number(p.cost_price) : null,
      category_name: p.category_id?.name ?? '',
      product_id: p.product_id,
      sku: p.sku,
      barcode: p.barcode,
    });
  } catch (error) {
    console.error('Get product by barcode error:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Get product by ID
router.get('/:id', optionalAuthenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('category_id', 'name slug')
      .populate('sub_category_id', 'name slug')
      .lean();

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const isAdmin = req.userRole === 'admin';
    if (isExplicitlyInactive((product as any).is_active) && !isAdmin) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Explicit allowlist per role (no full-document spread).
    const body = isAdmin ? toStaffProduct(product as any) : toPublicProduct(product as any);
    if (isAdmin) markStaffPrivate(res);
    res.json(body);
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Admin: Import preview (parse + validate, no DB write)
router.post('/import/preview', authenticateAdmin, upload.single('file'), async (req: AuthRequest, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'No CSV file uploaded. Use form field name: file' });
  }
  try {
    const result = await buildPreview(req.file.buffer);
    res.json(result);
  } catch (error: any) {
    console.error('Import preview error:', error);
    res.status(500).json({ error: error.message || 'Failed to parse CSV' });
  }
});

// Admin: Execute product import (transaction, create categories/subcategories as needed)
router.post('/import', authenticateAdmin, upload.single('file'), async (req: AuthRequest, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'No CSV file uploaded. Use form field name: file' });
  }
  try {
    const result = await executeImport(req.file.buffer, { skipDuplicatesByNameInSubcategory: true });
    res.json(result);
  } catch (error: any) {
    console.error('Product import error:', error);
    res.status(500).json({ error: error.message || 'Import failed' });
  }
});

// Admin: Create product
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      sku: z.string().optional(),
      description: z.string().optional(),
      product_type: z.enum(['inventory', 'non_inventory', 'service']).optional(),
      price: z.union([z.coerce.number().min(0), z.null()]).optional(),
      category_id: z.string().optional().or(z.literal('')),
      sub_category_id: z.string().optional().or(z.literal('')),
      vendor_id: z.string().optional().or(z.literal('')),
      tax_rate: z.coerce.number().min(0).optional(),
      image_url: z.union([z.string().url(), z.literal('')]).optional(),
      barcode: z.string().optional(),
      cost_price: z.coerce.number().min(0).optional(),
      stock_quantity: z.coerce.number().int().min(0).optional(),
      low_stock_threshold: z.coerce.number().int().min(0).optional(),
      is_active: z.boolean().optional(),
    });

    const raw = schema.parse(req.body);
    const data = {
      ...raw,
      category_id: raw.category_id || undefined,
      sub_category_id: raw.sub_category_id || undefined,
      vendor_id: raw.vendor_id || undefined,
      stock_quantity: raw.stock_quantity ?? 0,
      low_stock_threshold: raw.low_stock_threshold ?? 10,
    };
    const slug = data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const price = (data.price != null && !Number.isNaN(Number(data.price))) ? Number(data.price) : 0;

    const categoryId = toObjectIdOrUndefined(data.category_id);
    const subCategoryId = toObjectIdOrUndefined(data.sub_category_id);
    const vendorId = toObjectIdOrUndefined(data.vendor_id);

    const product = await Product.create({
      name: data.name,
      slug,
      product_id: await generateProductId(),
      sku: data.sku?.trim() || undefined,
      description: data.description,
      product_type: data.product_type || 'inventory',
      price,
      cost_price: data.cost_price ?? undefined,
      category_id: categoryId,
      sub_category_id: subCategoryId,
      vendor_id: vendorId,
      tax_rate: data.tax_rate ?? 0,
      image_url: data.image_url || undefined,
      barcode: data.barcode || undefined,
      stock_quantity: data.stock_quantity ?? 0,
      low_stock_threshold: data.low_stock_threshold ?? 10,
      is_active: data.is_active !== false,
    });

    const obj = product.toObject();
    res.status(201).json({
      id: product._id.toString(),
      ...obj,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (error.code === 11000) {
      return res.status(400).json({ error: 'A product with this name or SKU/barcode already exists.' });
    }
    console.error('Create product error:', error);
    res.status(500).json({ error: error.message || 'Failed to create product' });
  }
});

// Admin: Update product
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      product_type: z.enum(['inventory', 'non_inventory', 'service']).optional(),
      price: z.number().min(0).optional(),
      category_id: z.union([z.string(), z.null()]).optional(),
      sub_category_id: z.union([z.string(), z.null()]).optional(),
      vendor_id: z.string().optional(),
      tax_rate: z.number().min(0).optional(),
      image_url: z.union([z.string().url(), z.literal('')]).optional(),
      barcode: z.string().optional(),
      sku: z.string().optional(),
      product_id: z.string().optional(),
      cost_price: z.number().min(0).optional(),
      stock_quantity: z.number().int().optional(),
      low_stock_threshold: z.number().int().min(0).optional(),
      is_active: z.boolean().optional(),
    });

    const data = schema.parse(req.body);
    const existing = await Product.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    // Product ID is permanent once assigned.
    if (data.product_id !== undefined) {
      const incoming = String(data.product_id).trim();
      const current = String((existing as any).product_id || '').trim();
      if (current && incoming && incoming !== current) {
        return res.status(400).json({ error: 'Product ID cannot be changed once assigned.' });
      }
    }

    const update: any = { updated_at: new Date() };
    const unset: any = {};
    if (data.category_id !== undefined) {
      if (data.category_id === null || data.category_id === '') unset.category_id = 1;
      else update.category_id = data.category_id;
    }
    if (data.sub_category_id !== undefined) {
      if (data.sub_category_id === null || data.sub_category_id === '') unset.sub_category_id = 1;
      else update.sub_category_id = data.sub_category_id;
    }
    const rest = { ...data };
    delete rest.category_id;
    delete rest.sub_category_id;
    // Client cannot set or change product_id; assign on first save if missing.
    const existingPid = String((existing as any).product_id || '').trim();
    delete (rest as any).product_id;
    if (!existingPid) {
      update.product_id = await generateProductId();
    }
    delete (rest as any).barcode;
    delete (rest as any).plu;
    Object.keys(rest).forEach((k) => {
      if ((rest as any)[k] !== undefined) update[k] = (rest as any)[k];
    });
    if (Object.keys(unset).length) update.$unset = unset;

    const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Audit log for price/product_type changes
    const AuditLog = (await import('../models/AuditLog')).default;
    const changed = (key: string) => (existing as any)[key] !== (product as any)[key];
    if (changed('price') || changed('product_type')) {
      await AuditLog.create({
        admin_id: req.userId,
        action: 'product_update',
        entity_type: 'Product',
        entity_id: product._id.toString(),
        old_value: { price: existing.price, product_type: (existing as any).product_type },
        new_value: { price: product.price, product_type: (product as any).product_type },
        details: 'Admin updated product',
      });
    }

    res.json({
      id: product._id.toString(),
      ...product.toObject(),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Admin: Delete product
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.id, { is_active: false });
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Admin: Bulk delete products (soft)
router.post('/bulk-delete', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({ ids: z.array(z.string()).min(1) });
    const { ids } = schema.parse(req.body);
    await Product.updateMany({ _id: { $in: ids } }, { is_active: false });
    res.json({ message: `${ids.length} product(s) deleted`, deleted: ids.length });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Bulk delete products error:', error);
    res.status(500).json({ error: 'Failed to delete products' });
  }
});

// Admin: Bulk set products active (show on website again)
router.post('/bulk-activate', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({ ids: z.array(z.string()).min(1) });
    const { ids } = schema.parse(req.body);
    const validIds = ids.filter((id) => /^[a-f0-9A-F]{24}$/.test(id));
    if (validIds.length === 0) return res.status(400).json({ error: 'No valid product IDs' });
    const result = await Product.updateMany({ _id: { $in: validIds } }, { is_active: true, updated_at: new Date() });
    res.json({ message: `${result.modifiedCount} product(s) activated`, modified: result.modifiedCount });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Bulk activate products error:', error);
    res.status(500).json({ error: 'Failed to activate products' });
  }
});

// Admin: Assign category (and optional subcategory) to many products at once
router.post('/bulk-assign-category', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      ids: z.array(z.string()).min(1),
      category_id: z.string().min(1),
      sub_category_id: z.string().optional(),
    });
    const { ids, category_id, sub_category_id } = schema.parse(req.body);

    const catOid = toObjectIdOrUndefined(category_id);
    if (!catOid) return res.status(400).json({ error: 'Invalid category_id' });
    const category = await Category.findById(catOid).lean();
    if (!category) return res.status(400).json({ error: 'Category not found' });

    const validIds = ids.filter((id) => /^[a-f0-9A-F]{24}$/.test(id));
    if (validIds.length === 0) return res.status(400).json({ error: 'No valid product IDs' });

    const update: Record<string, unknown> = { category_id: catOid, updated_at: new Date() };
    const unset: Record<string, 1> = {};

    const subTrim = sub_category_id?.trim();
    if (subTrim) {
      const subOid = toObjectIdOrUndefined(subTrim);
      if (!subOid) return res.status(400).json({ error: 'Invalid sub_category_id' });
      const sub = await SubCategory.findById(subOid).lean();
      if (!sub) return res.status(400).json({ error: 'Subcategory not found' });
      if (String(sub.category_id) !== String(catOid)) {
        return res.status(400).json({ error: 'Subcategory does not belong to the selected category' });
      }
      update.sub_category_id = subOid;
    } else {
      unset.sub_category_id = 1;
    }

    const mongoUpdate: mongoose.UpdateQuery<any> = { $set: update };
    if (Object.keys(unset).length) mongoUpdate.$unset = unset;

    const result = await Product.updateMany({ _id: { $in: validIds } }, mongoUpdate);
    res.json({
      message: `Updated ${result.modifiedCount} product(s)`,
      modified: result.modifiedCount,
      matched: result.matchedCount,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Bulk assign category error:', error);
    res.status(500).json({ error: 'Failed to assign category' });
  }
});

export default router;
