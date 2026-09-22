/* Task 03 fixture: create a single clearly-tagged development product with
 * distinct public vs internal fields so the privacy boundary is observable
 * in guest and admin responses. Refuses to run against any DB other than
 * `express_distributors_dev`. Idempotent: re-running upserts by slug. */
import '../load-env';
import mongoose from 'mongoose';
import connectDB from './connection';
import Product from '../models/Product';
import Category from '../models/Category';

async function main() {
  await connectDB();
  const dbName = mongoose.connection.name;
  if (dbName !== 'express_distributors_dev') {
    console.error(`Refusing to seed fixture: connected DB is "${dbName}", expected "express_distributors_dev"`);
    process.exit(3);
  }

  // Ensure a tagged dev category exists so the storefront category path can be tested too.
  const category = await Category.findOneAndUpdate(
    { slug: 'task03-fixture-category' },
    {
      $setOnInsert: {
        name: 'Task03 Fixture Category',
        slug: 'task03-fixture-category',
        description: 'Development-only category used by Task 03 verification. Safe to delete.',
      },
    },
    { new: true, upsert: true },
  );

  const slug = 'task03-fixture-product';
  await Product.findOneAndUpdate(
    { slug },
    {
      $set: {
        name: 'Task03 Fixture Widget',
        slug,
        description: 'Development-only fixture. Safe to delete.',
        product_type: 'inventory',
        // Distinct public vs internal numbers so any leak stands out clearly.
        price: 99.99,             // PUBLIC selling price
        cost_price: 42.42,        // INTERNAL — must never appear in guest response
        image_url: 'https://example.invalid/task03.png',
        product_id: 'T3FIX',
        sku: 'TASK03-SKU-001',
        barcode: 'TASK03-BARCODE-001',
        plu: 'TASK03PLU',         // INTERNAL — must never appear in guest response
        stock_quantity: 25,       // raw on-hand: internal to staff
        committed_quantity: 5,    // INTERNAL — reservation, must not appear public
        low_stock_threshold: 7,   // INTERNAL — inventory ops signal
        reorder_point: 3,         // INTERNAL — purchasing signal
        is_active: true,
        tax_rate: 8.5,
        category_id: category._id,
      },
    },
    { upsert: true, new: true },
  );

  console.log(JSON.stringify({
    status: 'ok',
    db: dbName,
    category_slug: category.slug,
    product_slug: slug,
  }));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('seed-privacy-fixture failed:', err);
    process.exit(1);
  });
