import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import mongoose from 'mongoose';
import connectDB from './connection';
import Category from '../models/Category';
import Product from '../models/Product';
import {
  shouldWriteOpeningStockMovement,
  writeOpeningStockMovement,
} from '../utils/openingStockMovement';

/** Turn `automotive` → `Automotive`; keep `Candy and Snacks` as-is. */
export function prettyCategoryName(filenameBase: string): string {
  const s = filenameBase.replace(/_/g, ' ').trim();
  if (s.length === 0) return filenameBase;
  if (s !== s.toLowerCase() && /[A-Z]/.test(s)) return s;
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

async function ensureUniqueSku(baseSku: string): Promise<string> {
  let s = baseSku;
  let n = 0;
  while (await Product.findOne({ sku: s })) {
    n += 1;
    s = `${baseSku}-${n}`;
  }
  return s;
}

export type ImportCategoryXlsResult = {
  totalProducts: number;
  totalErrors: number;
  categoryStats: Record<string, number>;
};

/**
 * Import QuickBooks-style product XLS files. One category per file (name/slug from filename).
 */
export async function importCategoryXlsFiles(
  absolutePaths: string[],
  options?: { printSummary?: boolean }
): Promise<ImportCategoryXlsResult> {
  const printSummary = options?.printSummary !== false;
  await connectDB();

  let totalProducts = 0;
  let totalErrors = 0;
  const categoryStats: Record<string, number> = {};

  for (const filePath of absolutePaths) {
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      continue;
    }

    const filenameBase = path.parse(filePath).name;
    const categoryName = prettyCategoryName(filenameBase);
    const categorySlug = slugify(categoryName);

    let category = await Category.findOne({ slug: categorySlug });
    if (!category) {
      category = await Category.create({
        name: categoryName,
        slug: categorySlug,
      });
      console.log(`Created Category: ${categoryName}`);
    } else {
      console.log(`Found Category: ${categoryName}`);
    }
    const categoryId = category._id as mongoose.Types.ObjectId;
    categoryStats[categoryName] = categoryStats[categoryName] || 0;

    console.log(`\nReading XLS file: ${filePath}`);
    const file = fs.readFileSync(filePath);
    const workbook = xlsx.read(file, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = xlsx.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });

    let fileCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      if (!row || row.length === 0 || row[0] == null || row[0] === '') continue;

      if (typeof row[0] === 'string' && row[0].startsWith('NOTE:')) continue;

      try {
        const rawName = String(row[0]);
        let productName = rawName;
        if (rawName.includes(':')) {
          const parts = rawName.split(':');
          productName = parts[parts.length - 1].trim();
        }

        let skuStr = row[2] != null ? String(row[2]).trim() : '';
        if (!skuStr || skuStr.includes('E+')) {
          skuStr = `GEN-${categorySlug}-${i}-${Date.now().toString(36)}`;
        }
        const sku = await ensureUniqueSku(skuStr);

        const price = parseFloat(String(row[4])) || 0;
        const costPrice = parseFloat(String(row[8])) || 0;
        const quantity = parseInt(String(row[10]), 10);
        const stockQty = Number.isFinite(quantity) ? quantity : 10;

        const descRaw = row[1];
        const description = descRaw != null && descRaw !== '' ? String(descRaw) : '';

        const textForImage = encodeURIComponent((productName || 'Product').substring(0, 20));
        const imageUrl = `https://placehold.co/400x400/eeeeee/333333?text=${textForImage}`;

        let productSlug =
          slugify(productName) || `product-${Date.now().toString(36)}-${i}`;

        if (await Product.findOne({ slug: productSlug })) {
          productSlug = `${productSlug}-${Math.floor(Math.random() * 100000)}`;
        }

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
          const created = await Product.create(
            [
              {
                name: productName,
                slug: productSlug,
                description,
                product_type: 'inventory',
                price,
                cost_price: costPrice,
                category_id: categoryId,
                image_url: imageUrl,
                sku,
                stock_quantity: stockQty,
                committed_quantity: 0,
                low_stock_threshold: 5,
                is_active: true,
                tax_rate: 0,
              },
            ],
            { session }
          );
          const product = Array.isArray(created) ? created[0] : created;
          if (shouldWriteOpeningStockMovement('inventory', stockQty)) {
            await writeOpeningStockMovement({
              productId: product._id,
              openingQty: stockQty,
              session,
            });
          }
          await session.commitTransaction();
        } catch (txnErr) {
          await session.abortTransaction();
          throw txnErr;
        } finally {
          session.endSession();
        }

        fileCount++;
        totalProducts++;
        categoryStats[categoryName]++;
      } catch (err: unknown) {
        totalErrors++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error processing row containing ${row[0]}: ${msg}`);
      }
    }
    console.log(`-> Imported ${fileCount} products for ${categoryName}`);
  }

  if (printSummary) {
    console.log('\n--- Final Import Summary ---');
    console.log('Products per category:');
    for (const [cat, num] of Object.entries(categoryStats)) {
      console.log(`  - ${cat}: ${num}`);
    }
    console.log('\n--- Overall Database Stats ---');
    const allCategoriesCount = await Category.countDocuments();
    const allProductsCount = await Product.countDocuments();
    console.log(`Total Products in Database: ${allProductsCount}`);
    console.log(`Total Categories in Database: ${allCategoriesCount}\n`);
    console.log('Database breakdown by category:');
    const aggregate = await Product.aggregate([
      { $group: { _id: '$category_id', count: { $sum: 1 } } },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'category',
        },
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    ]);
    aggregate.forEach((r) => {
      console.log(`  - ${r.category?.name || 'Unknown'}: ${r.count}`);
    });
  }

  return { totalProducts, totalErrors, categoryStats };
}
