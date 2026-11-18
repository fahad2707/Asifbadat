/**
 * Clear admin portal data for fresh testing on a LOCAL development database.
 * Deletes: Invoices, Customers, Vendors (suppliers), Receipts, Categories, SubCategories.
 * Does NOT delete: Admin users, Products, Orders, or other data.
 *
 * Products are kept, but deleting Categories and SubCategories leaves their
 * category_id / sub_category_id values pointing at nothing, and the category
 * image URLs are deleted with the category records.
 *
 * SAFEGUARDS
 *   npm run clear-admin-data
 *       Dry run (the default). Prints the database, host, each collection, its
 *       document count and what would happen. Changes nothing.
 *
 *   npm run clear-admin-data -- --confirm-database=<database name> --acknowledge-catalogue-deletion
 *       Executes. Both flags are required (Categories and SubCategories are part of
 *       the product catalogue) and must be typed on every run; a confirmation
 *       stored in the package.json script is refused.
 *
 * It refuses, without opening a connection, when MONGODB_URI is not a MongoDB server
 * on this machine or NODE_ENV is "production". After connecting it refuses again
 * unless the server itself reports that it runs on this machine.
 * Cloudinary images are never deleted.
 */
import connectDB from './connection';
import { adminDataCleanupConfig } from './cleanupPlans';
import { createCleanupDeps, runGuardedCleanup } from './cleanupRunner';

runGuardedCleanup(adminDataCleanupConfig, createCleanupDeps(connectDB))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Failed to clear admin data:', err);
    process.exit(1);
  });
