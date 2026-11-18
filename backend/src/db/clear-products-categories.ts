/**
 * Delete the product catalogue: Products, Categories, SubCategories, and customer
 * product prices. LOCAL development databases only.
 *
 * SAFEGUARDS
 *   npm run db:clear-products-categories
 *       Dry run (the default). Prints the database, host, each collection, its
 *       document count and what would happen. Changes nothing.
 *
 *   npm run db:clear-products-categories -- --confirm-database=<database name> --acknowledge-catalogue-deletion
 *       Executes. Both flags are required and must be typed on every run; a
 *       confirmation stored in the package.json script is refused.
 *
 * It refuses, without opening a connection, when MONGODB_URI is not a MongoDB server
 * on this machine or NODE_ENV is "production". After connecting it refuses again
 * unless the server itself reports that it runs on this machine.
 * Cloudinary images are never deleted; only the image URLs stored on the records.
 */
import connectDB from './connection';
import { productsAndCategoriesCleanupConfig } from './cleanupPlans';
import { createCleanupDeps, runGuardedCleanup } from './cleanupRunner';

runGuardedCleanup(productsAndCategoriesCleanupConfig, createCleanupDeps(connectDB))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Failed to clear products and categories:', err);
    process.exit(1);
  });
