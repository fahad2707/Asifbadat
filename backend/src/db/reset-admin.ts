/**
 * Single admin only: admin@edinc.com / Admin1234. LOCAL development databases only.
 * - Deletes the old admin (admin@expressdistributors.com) if it exists
 * - Ensures one admin exists with admin@edinc.com / Admin1234 (overwrites its password)
 *
 * SAFEGUARDS
 *   npx tsx src/db/reset-admin.ts
 *       Dry run (the default). Prints the database, host and what would happen.
 *       Changes nothing.
 *
 *   npx tsx src/db/reset-admin.ts --confirm-database=<database name>
 *       Executes. The flag must equal the connected database name and must be typed
 *       on every run.
 *
 * It refuses, without opening a connection, when MONGODB_URI is not a MongoDB server
 * on this machine or NODE_ENV is "production". After connecting it refuses again
 * unless the server itself reports that it runs on this machine. This keeps a live
 * admin password from being overwritten with the documented default.
 */
import connectDB from './connection';
import { adminResetConfig } from './cleanupPlans';
import { createCleanupDeps, runGuardedCleanup } from './cleanupRunner';

runGuardedCleanup(adminResetConfig, createCleanupDeps(connectDB))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Reset failed:', err);
    process.exit(1);
  });
