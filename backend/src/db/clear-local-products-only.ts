/**
 * Delete products on the local MongoDB only. Categories and subcategories are kept.
 * Refuses to run against any database that is not express_distributors_dev on this machine.
 *
 * SAFEGUARDS
 *   npx tsx src/db/clear-local-products-only.ts
 *       Dry run (the default). Prints the database, host, document count and what
 *       would happen. Changes nothing.
 *
 *   npx tsx src/db/clear-local-products-only.ts --confirm-database=express_distributors_dev --acknowledge-catalogue-deletion
 *       Executes. Both flags are required and must be typed on every run.
 *
 * It refuses, without opening a connection, when MONGODB_URI is not a MongoDB server
 * on this machine or NODE_ENV is "production". After connecting it refuses again
 * unless the server itself reports that it runs on this machine.
 * Cloudinary images are never deleted; only the image URLs stored on the records.
 */
import connectDB from './connection';
import { localProductsOnlyCleanupConfig } from './cleanupPlans';
import { createCleanupDeps, runGuardedCleanup } from './cleanupRunner';

runGuardedCleanup(localProductsOnlyCleanupConfig, createCleanupDeps(connectDB))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Failed to clear local products:', err);
    process.exit(1);
  });
