/**
 * Wipe operational records so admin/storefront can be retested on a LOCAL development database.
 * Does NOT delete: Products, Categories, SubCategories, Admins, StoreSettings, AuditLogs.
 * Does NOT change product image_url, prices, cost, SKU, or stock_quantity.
 * Clears committed_quantity only (open-order reservations become invalid after order wipe).
 * (Exact lists: OPERATIONAL_WIPE_MODELS and OPERATIONAL_KEEP_COLLECTIONS in cleanupPlans.ts.)
 *
 * It also deletes every collection that is not on the keep list, so a new
 * collection that must survive has to be added to OPERATIONAL_KEEP_COLLECTIONS.
 *
 * SAFEGUARDS
 *   npm run db:clear-ops
 *       Dry run (the default). Prints the database, host, every affected collection,
 *       its document count and what would happen. Changes nothing.
 *
 *   npm run db:clear-ops -- --confirm-database=<database name>
 *       Executes. The flag must equal the connected database name and must be typed
 *       on every run; a confirmation stored in the package.json script is refused.
 *
 * The script refuses to run if the product catalogue or audit history is ever added
 * to the wipe list or removed from the keep list, and it re-checks after the wipe
 * that product, category and subcategory counts and the protected product fields
 * are unchanged.
 *
 * It refuses, without opening a connection, when MONGODB_URI is not a MongoDB server
 * on this machine or NODE_ENV is "production". After connecting it refuses again
 * unless the server itself reports that it runs on this machine.
 * Cloudinary images are never deleted.
 */
import connectDB from './connection';
import { operationalCleanupConfig } from './cleanupPlans';
import { createCleanupDeps, runGuardedCleanup } from './cleanupRunner';

runGuardedCleanup(operationalCleanupConfig, createCleanupDeps(connectDB))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Failed to clear workflow data:', err);
    process.exit(1);
  });
