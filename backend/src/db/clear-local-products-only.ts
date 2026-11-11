/**
 * Delete products on the local MongoDB only.
 * Refuses to run against any database that is not express_distributors_dev on localhost.
 */
import mongoose from 'mongoose';
import connectDB from './connection';
import Product from '../models/Product';
import Category from '../models/Category';
import SubCategory from '../models/SubCategory';

async function main() {
  await connectDB();
  const uri = process.env.MONGODB_URI || '';
  const dbName = mongoose.connection.name;
  const host = mongoose.connection.host || '';
  const localHost = host === '127.0.0.1' || host === 'localhost';
  const localDb = dbName === 'express_distributors_dev';
  const looksAtlas = /mongodb\.net/i.test(uri) || /mongodb\.net/i.test(host);

  console.log(`Connected database: ${dbName}`);
  console.log(`Connected host: ${host}`);

  if (!localHost || !localDb || looksAtlas) {
    throw new Error(
      `Refusing to delete products: this is not the local database (db=${dbName}, host=${host})`
    );
  }

  const productsBefore = await Product.countDocuments();
  const categoriesBefore = await Category.countDocuments();
  const subcategoriesBefore = await SubCategory.countDocuments();
  console.log(`Before: products=${productsBefore} categories=${categoriesBefore} subcategories=${subcategoriesBefore}`);

  const deleted = await Product.deleteMany({});
  console.log(`Products deleted: ${deleted.deletedCount ?? 0}`);

  const productsAfter = await Product.countDocuments();
  const categoriesAfter = await Category.countDocuments();
  const subcategoriesAfter = await SubCategory.countDocuments();
  console.log(`After: products=${productsAfter} categories=${categoriesAfter} subcategories=${subcategoriesAfter}`);

  if (categoriesAfter !== categoriesBefore || subcategoriesAfter !== subcategoriesBefore) {
    throw new Error('Safety check failed: category counts changed');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
