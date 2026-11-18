/**
 * Fill a missing product_id, and copy barcode or PLU into sku only when sku
 * is empty. Never removes barcode or PLU, and never replaces a product_id
 * or SKU that is already set. Conflicts are reported for manual review.
 * Never deletes a product or an image.
 *
 *   npm run db:backfill-product-codes
 *       Dry run (the default). Prints how many products would change and which
 *       fields. Changes nothing, takes no lock, and does not settle journals.
 *
 *   npm run db:backfill-product-codes -- --confirm-database=<database name>
 *       Executes. The name must be the connected database and must be typed on
 *       this run. A confirmation stored in package.json is refused. The run
 *       takes the product identifier lock before it plans or writes.
 *
 *   npm run db:backfill-product-codes -- --inspect-lock
 *       Prints the product identifier lock. Does not change products or the lock.
 *
 *   npm run db:backfill-product-codes -- --release-lock --confirm-database=<database name> --owner-run-id=<inspected id>
 *       Releases the lock only when that owner process is not the same live
 *       process on this machine. Refuses when the process cannot be verified.
 *
 * Refuses, without connecting, when MONGODB_URI is not a MongoDB server on this
 * machine or NODE_ENV is "production". After connecting it refuses again unless
 * the server itself reports that it runs on this machine.
 * The live route POST /api/products/backfill-codes is dry-run unless its JSON
 * body confirms the database, and it refuses production targets too.
 */
import os from 'node:os';
import mongoose from 'mongoose';
import connectDB from './connection';
import { connectedTarget } from './cleanupRunner';
import { runProductCodeBackfill } from '../utils/productCodeBackfill';

runProductCodeBackfill({
  argv: process.argv.slice(2),
  env: {
    MONGODB_URI: process.env.MONGODB_URI,
    NODE_ENV: process.env.NODE_ENV,
    npm_lifecycle_script: process.env.npm_lifecycle_script,
  },
  localHostnames: [os.hostname()].filter(Boolean),
  connect: connectDB,
  readEvidence: () => connectedTarget.read(),
  disconnect: () => mongoose.disconnect(),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
})
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Product code backfill failed:', err);
    process.exit(1);
  });
