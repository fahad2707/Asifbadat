/**
 * Clear ALL data from the database for a full reset.
 * Use when you want to start completely fresh on a LOCAL development database.
 *
 * Deletes: products, customers, categories, subcategories, vendors (suppliers),
 * invoices, receipts, orders, credit memos, purchase orders, expenses, shipments,
 * stock movements, payments, ledger, audit logs, bank accounts, tax types,
 * payment methods, POS sales, returns, users, OTPs, store settings, and admins.
 * (Exact list: FULL_RESET_MODELS in cleanupPlans.ts.)
 *
 * After running: run `npm run seed` (from backend folder) to create the default admin again.
 *
 * DESTRUCTIVE-DATA SAFEGUARDS
 * This permanently deletes the product catalogue and audit history, which cannot
 * be recreated. Cloudinary images are never deleted; only database records.
 *
 *   npm run db:reset
 *       Dry run (the default). Prints the database, host, every collection, its
 *       document count and what would happen. Changes nothing.
 *
 *   npm run db:reset -- --confirm-database=<database name> --acknowledge-catalogue-deletion
 *       Executes. Both flags are required on every run:
 *         --confirm-database              must equal the connected database name
 *         --acknowledge-catalogue-deletion  acknowledges that Product, Category and
 *                                         SubCategory records are permanently deleted
 *
 * The script refuses, without opening a connection, when MONGODB_URI is not a
 * MongoDB server on this machine or NODE_ENV is "production". After connecting it
 * refuses again unless the server itself reports that it runs on this machine.
 * Setting NODE_ENV=development does not bypass either check.
 * Never put the flags in package.json or a wrapper script; a confirmation stored in
 * the package.json script is refused.
 */
import connectDB from './connection';
import { fullResetConfig } from './cleanupPlans';
import { createCleanupDeps, runGuardedCleanup } from './cleanupRunner';

runGuardedCleanup(fullResetConfig, createCleanupDeps(connectDB))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Full reset failed:', err);
    process.exit(1);
  });
