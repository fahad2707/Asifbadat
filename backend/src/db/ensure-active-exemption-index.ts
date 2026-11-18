/**
 * Create the active sales-tax exemption unique index.
 *
 * This is not application startup and it is not `npm run migrate`.
 * MONGODB_URI is ignored, including a value loaded from the environment,
 * so the client database is not selected accidentally.
 *
 *   EXEMPTION_INDEX_MONGODB_URI='mongodb://127.0.0.1:27017/?replicaSet=rs' \
 *     npm run db:ensure-active-exemption-index -- \
 *     --confirm-database=<connected database name> \
 *     --confirm-host=<hello.me host:port>
 *
 * That command is a read-only preflight. It reports blocking conflicts and
 * non-blocking legacy-key warnings. It does not create the index. Add
 * `--apply` to create the index when there is no blocking conflict.
 * Warnings do not change records and do not stop the index.
 *
 * Conflicting active certificates stop the command. Records are not deleted,
 * merged, or edited. An index with the same name but a different definition
 * is left in place. Running a completed migration again is a no-op.
 */
import mongoose from 'mongoose';
import SalesTaxExemption from '../models/SalesTaxExemption';
import { ensureActiveExemptionIndex, formatExemptionIndexWarnings } from '../services/exemptions/exemptionIndexMigration';

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  const value = found?.slice(prefix.length).trim();
  return value ? value : null;
}

async function main(): Promise<number> {
  const uri = process.env.EXEMPTION_INDEX_MONGODB_URI?.trim() || '';
  if (!uri) {
    console.error('Refusing to connect. Set EXEMPTION_INDEX_MONGODB_URI. MONGODB_URI is not used.');
    return 1;
  }
  const databaseName = option('confirm-database');
  const host = option('confirm-host');
  if (!databaseName || !host) {
    console.error('Refusing to connect. Pass --confirm-database=<name> and --confirm-host=<host:port>.');
    return 1;
  }
  await mongoose.connect(uri, {
    dbName: databaseName,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });
  try {
    const hello = await mongoose.connection.db!.command({ hello: 1 });
    if (mongoose.connection.name !== databaseName) {
      console.error(`Refusing to continue. Connected database is ${mongoose.connection.name}.`);
      return 1;
    }
    if (String(hello.me) !== host) {
      console.error(`Refusing to continue. Server hello.me is ${String(hello.me)}.`);
      return 1;
    }
    const result = await ensureActiveExemptionIndex(SalesTaxExemption.collection, {
      apply: process.argv.includes('--apply'),
    });
    for (const line of formatExemptionIndexWarnings(result.warnings)) console.error(line);
    console.log(JSON.stringify({
      database: mongoose.connection.name,
      host: String(hello.me),
      ...result,
    }));
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Active exemption index migration failed.';
    console.error(message);
    process.exit(1);
  });
