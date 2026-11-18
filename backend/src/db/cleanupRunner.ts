import os from 'node:os';
import mongoose from 'mongoose';
import {
  ACKNOWLEDGE_CATALOGUE_DELETION_FLAG,
  AUDIT_LOG_COLLECTION,
  CONFIRM_DATABASE_FLAG,
  CleanupSafeguardError,
  IMAGE_REFERENCE_FIELDS,
  PROTECTED_PRODUCT_FIELDS,
  evaluateCleanupRequest,
  evaluateConnectedTarget,
  evaluateTargetBeforeConnect,
  isCatalogueCollection,
  type ConnectedTargetEvidence,
} from './cleanupSafeguards';

/**
 * Single execution path for every destructive database script.
 *
 * Order of work, each step gating the next:
 *   1. Script-specific preflight (static plan checks).
 *   2. Target gate before connecting (never connects to a remote database).
 *   3. Connect, then target gate on what was actually reached.
 *   4. Build the plan and reject anything the script is not allowed to do.
 *   5. Count and print the plan (read-only).
 *   6. Dry run unless this run carries every required confirmation.
 *   7. Execute, then check the script's invariants.
 *
 * This module never calls Cloudinary and never deletes remote images; only
 * database records are in scope.
 */

export type CleanupOperation = {
  /** Model or collection label shown to the operator. */
  label: string;
  /** MongoDB collection the operation acts on. */
  collection: string;
  kind: 'delete' | 'update';
  /** Plain-language description of the intended operation. */
  action: string;
  /** Fields written by an update operation. Required for `kind: 'update'`. */
  fields?: readonly string[];
  /** Consequence the operator should know about, e.g. dangling references. */
  note?: string;
  /** Documents the operation would affect. Read-only. */
  count: () => Promise<number>;
  /** Performs the operation and returns the number of documents affected. */
  run: () => Promise<number>;
};

export type CleanupInvariant = {
  label: string;
  read: () => Promise<number | string>;
  expect: 'unchanged' | 'not-decreased';
};

export type RawCollection = {
  countDocuments: () => Promise<number>;
  deleteMany: (filter: Record<string, never>) => Promise<{ deletedCount?: number }>;
};

export type CleanupContext = {
  listCollectionNames: () => Promise<string[]>;
  rawCollection: (name: string) => RawCollection;
};

export type CleanupConfig = {
  /** How the script is invoked, e.g. `npm run db:reset`. */
  command: string;
  title: string;
  /** Only scripts whose purpose is to delete catalogue records may do so. */
  allowsCatalogueDeletion: boolean;
  /** Only a full reset may delete audit history. */
  allowsAuditLogDeletion: boolean;
  /** When set, the script only runs against a database with exactly this name. */
  requiredDatabaseName?: string;
  preflight?: () => void;
  buildOperations: (context: CleanupContext) => Promise<CleanupOperation[]>;
  invariants?: readonly CleanupInvariant[];
  /** Printed after a successful execution. */
  afterExecute?: readonly string[];
};

export type CleanupDeps = CleanupContext & {
  argv: readonly string[];
  env: { MONGODB_URI?: string; NODE_ENV?: string; npm_lifecycle_script?: string };
  localHostnames: readonly string[];
  connect: () => Promise<unknown>;
  describeConnection: () => Promise<ConnectedTargetEvidence>;
  disconnect: () => Promise<unknown>;
  log: (line: string) => void;
  error: (line: string) => void;
};

type MongooseLikeModel = {
  collection: { name: string };
  countDocuments: (filter?: Record<string, unknown>) => PromiseLike<number>;
  deleteMany: (filter: Record<string, unknown>) => PromiseLike<{ deletedCount?: number }>;
};

/** "Delete every document" for a model. Catalogue and image impact are derived from its collection. */
export function deleteAllOperation(label: string, model: MongooseLikeModel, note?: string): CleanupOperation {
  return {
    label,
    collection: model.collection.name,
    kind: 'delete',
    action: 'delete all documents',
    ...(note ? { note } : {}),
    count: async () => model.countDocuments(),
    run: async () => (await model.deleteMany({})).deletedCount ?? 0,
  };
}

/** "Delete every document" for a collection that has no model. */
export function deleteAllRawOperation(name: string, collection: RawCollection): CleanupOperation {
  return {
    label: `unlisted collection ${name}`,
    collection: name,
    kind: 'delete',
    action: 'delete all documents',
    count: () => collection.countDocuments(),
    run: async () => (await collection.deleteMany({})).deletedCount ?? 0,
  };
}

function deletesCatalogue(operation: CleanupOperation): boolean {
  return operation.kind === 'delete' && isCatalogueCollection(operation.collection);
}

function catalogueImpact(operation: CleanupOperation): string {
  if (!isCatalogueCollection(operation.collection)) return 'no';
  if (operation.kind === 'delete') return 'YES - records DELETED';
  return `YES - field(s) ${(operation.fields || []).join(', ')} modified, records kept`;
}

function imageReferenceImpact(operation: CleanupOperation): string {
  const imageFields = IMAGE_REFERENCE_FIELDS[operation.collection];
  if (!imageFields) return 'no';
  if (operation.kind === 'delete') return `YES - ${imageFields.join(', ')} deleted with the records`;
  const touched = (operation.fields || []).filter((field) => imageFields.includes(field));
  return touched.length > 0 ? `YES - ${touched.join(', ')} modified` : 'no';
}

/** Rejects a plan that does more than its script is allowed to. Runs before anything is counted or changed. */
export function assertPlanIsAllowed(config: CleanupConfig, operations: readonly CleanupOperation[]): void {
  for (const operation of operations) {
    if (operation.collection === AUDIT_LOG_COLLECTION) {
      if (operation.kind !== 'delete' || !config.allowsAuditLogDeletion) {
        throw new CleanupSafeguardError(
          `Refusing to run: "${operation.label}" would ${operation.kind} audit history (${AUDIT_LOG_COLLECTION}).`
        );
      }
    }
    if (deletesCatalogue(operation) && !config.allowsCatalogueDeletion) {
      throw new CleanupSafeguardError(
        `Refusing to run: "${operation.label}" would delete product catalogue records (${operation.collection}).`
      );
    }
    if (operation.kind === 'update') {
      const fields = operation.fields || [];
      if (fields.length === 0) {
        throw new CleanupSafeguardError(
          `Refusing to run: update operation "${operation.label}" does not declare the fields it writes.`
        );
      }
      if (isCatalogueCollection(operation.collection)) {
        const protectedFields = fields.filter((field) => PROTECTED_PRODUCT_FIELDS.includes(field));
        if (protectedFields.length > 0) {
          throw new CleanupSafeguardError(
            `Refusing to run: "${operation.label}" would overwrite protected product field(s) ${protectedFields.join(', ')}.`
          );
        }
      }
    }
  }
}

function printRefusal(deps: CleanupDeps, config: CleanupConfig, reason: string): void {
  deps.error('');
  deps.error(`REFUSED: ${config.title} did not run. Nothing was deleted or changed.`);
  deps.error(`  Reason: ${reason}`);
}

function confirmationHint(config: CleanupConfig, needsAcknowledgement: boolean): string {
  const flags = [`${CONFIRM_DATABASE_FLAG}=<database name shown above>`];
  if (needsAcknowledgement) flags.push(ACKNOWLEDGE_CATALOGUE_DELETION_FLAG);
  // npm needs "--" to pass flags through to the script; a direct tsx invocation does not.
  const separator = config.command.startsWith('npm ') ? ' -- ' : ' ';
  return `${config.command}${separator}${flags.join(' ')}`;
}

/** Returns the process exit code. Never calls process.exit itself. */
export async function runGuardedCleanup(config: CleanupConfig, deps: CleanupDeps): Promise<number> {
  deps.log(`=== ${config.title} (${config.command}) ===`);

  config.preflight?.();

  const beforeConnect = evaluateTargetBeforeConnect({
    uri: deps.env.MONGODB_URI,
    nodeEnv: deps.env.NODE_ENV,
    localHostnames: deps.localHostnames,
  });
  if (!beforeConnect.safe) {
    printRefusal(deps, config, beforeConnect.reason);
    deps.error('  No database connection was opened.');
    deps.error('  Destructive scripts only run against a MongoDB server on this machine.');
    return 1;
  }

  await deps.connect();
  try {
    const evidence = await deps.describeConnection();
    const databaseName = (evidence.databaseName || '').trim();
    deps.log(`Connected database : ${databaseName || '(unknown)'}`);
    deps.log(`Connected host     : ${evidence.connectionHost || '(unknown)'}`);
    deps.log(
      `Server identity    : hosts=[${(evidence.serverReportedHosts || []).join(', ')}] machine=${evidence.serverHostname || '(unknown)'}`
    );

    const connected = evaluateConnectedTarget(evidence, deps.localHostnames);
    if (!connected.safe) {
      printRefusal(deps, config, connected.reason);
      deps.error('  Destructive scripts only run against a MongoDB server on this machine.');
      return 1;
    }
    deps.log('Target check       : MongoDB server is on this machine');

    if (config.requiredDatabaseName && databaseName !== config.requiredDatabaseName) {
      printRefusal(
        deps,
        config,
        `This script only runs against the database "${config.requiredDatabaseName}", not "${databaseName}".`
      );
      return 1;
    }

    const operations = await config.buildOperations({
      listCollectionNames: deps.listCollectionNames,
      rawCollection: deps.rawCollection,
    });
    assertPlanIsAllowed(config, operations);

    const counts: number[] = [];
    for (const operation of operations) {
      counts.push(await operation.count());
    }

    deps.log('');
    deps.log('Plan:');
    operations.forEach((operation, index) => {
      deps.log(`  ${index + 1}. ${operation.label} [${operation.collection}]`);
      deps.log(`       documents          : ${counts[index]}`);
      deps.log(`       operation          : ${operation.action}`);
      deps.log(`       product catalogue  : ${catalogueImpact(operation)}`);
      deps.log(`       image references   : ${imageReferenceImpact(operation)}`);
      if (operation.note) deps.log(`       note               : ${operation.note}`);
    });
    if (operations.length === 0) deps.log('  (nothing to do)');

    const catalogueDeleted = operations.filter(deletesCatalogue);
    const imageAffected = operations.filter((operation) => imageReferenceImpact(operation) !== 'no');
    deps.log('');
    deps.log(
      `Product catalogue records deleted : ${
        catalogueDeleted.length > 0 ? `YES (${catalogueDeleted.map((operation) => operation.label).join(', ')})` : 'no'
      }`
    );
    deps.log(
      `Image references affected         : ${
        imageAffected.length > 0 ? `YES (${imageAffected.map((operation) => operation.label).join(', ')})` : 'no'
      }`
    );
    deps.log('Cloudinary                        : no remote image is deleted by this script');

    const needsAcknowledgement = catalogueDeleted.length > 0;
    const decision = evaluateCleanupRequest({
      argv: deps.argv,
      databaseName,
      deletesCatalogue: needsAcknowledgement,
      npmLifecycleScript: deps.env.npm_lifecycle_script,
    });

    if (decision.mode === 'dry-run') {
      deps.log('');
      deps.log('DRY RUN: nothing was deleted or changed.');
      deps.log(`To execute, type on this run: ${confirmationHint(config, needsAcknowledgement)}`);
      return 0;
    }
    if (decision.mode === 'refused') {
      printRefusal(deps, config, decision.reason);
      deps.error(`  Required: ${confirmationHint(config, needsAcknowledgement)}`);
      return 1;
    }

    const invariants = config.invariants || [];
    const before: Array<number | string> = [];
    for (const invariant of invariants) {
      before.push(await invariant.read());
    }

    deps.log('');
    deps.log(`EXECUTING against database "${databaseName}"...`);
    let failed = false;
    for (const operation of operations) {
      try {
        const affected = await operation.run();
        deps.log(`  ${operation.label}: ${affected} document(s) ${operation.kind === 'delete' ? 'deleted' : 'updated'}`);
      } catch (err) {
        failed = true;
        deps.error(`  ${operation.label}: ERROR - ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    for (let index = 0; index < invariants.length; index += 1) {
      const invariant = invariants[index];
      const after = await invariant.read();
      const previous = before[index];
      const ok =
        invariant.expect === 'unchanged'
          ? after === previous
          : typeof after === 'number' && typeof previous === 'number' && after >= previous;
      if (!ok) {
        failed = true;
        deps.error(`  SAFETY CHECK FAILED: ${invariant.label} (before: ${previous}, after: ${after})`);
      } else {
        deps.log(`  Safety check passed: ${invariant.label}`);
      }
    }

    if (failed) {
      deps.error('');
      deps.error(`${config.title} finished WITH ERRORS. Review the output above.`);
      return 1;
    }
    deps.log('');
    deps.log(`${config.title} complete.`);
    for (const line of config.afterExecute || []) deps.log(line);
    return 0;
  } finally {
    await deps.disconnect();
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * What the already-open connection can prove about where the data lives.
 * Missing evidence is returned as undefined so the caller fails closed.
 * Never includes the connection string or credentials.
 */
export const connectedTarget = {
  read(): Promise<ConnectedTargetEvidence> {
    return readConnectedTargetEvidence();
  },
};

export async function readConnectedTargetEvidence(): Promise<ConnectedTargetEvidence> {
  const databaseName = mongoose.connection.name;
  const connectionHost = mongoose.connection.host;
  const db = mongoose.connection.db;
  if (!db) {
    return {
      databaseName,
      connectionHost,
      serverReportedHosts: undefined,
      serverHostname: undefined,
      isMongosRouter: false,
    };
  }

  const admin = db.admin();
  let serverReportedHosts: string[] | undefined;
  let isMongosRouter = false;
  try {
    const hello = await admin.command({ hello: 1 });
    isMongosRouter = hello.msg === 'isdbgrid';
    serverReportedHosts = [
      ...stringList(hello.hosts),
      ...stringList(hello.passives),
      ...stringList(hello.arbiters),
      ...stringList([hello.me, hello.primary]),
    ];
  } catch {
    serverReportedHosts = undefined;
  }
  let serverHostname: string | undefined;
  try {
    const hostInfo = await admin.command({ hostInfo: 1 });
    const hostname = hostInfo?.system?.hostname;
    serverHostname = typeof hostname === 'string' ? hostname : undefined;
  } catch {
    serverHostname = undefined;
  }
  return { databaseName, connectionHost, serverReportedHosts, serverHostname, isMongosRouter };
}

/** Real dependencies for a script entry point. `connect` is the app's own connection function. */
export function createCleanupDeps(connect: () => Promise<unknown>): CleanupDeps {
  const database = () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB connection has no database handle');
    return db;
  };

  return {
    argv: process.argv.slice(2),
    env: {
      MONGODB_URI: process.env.MONGODB_URI,
      NODE_ENV: process.env.NODE_ENV,
      npm_lifecycle_script: process.env.npm_lifecycle_script,
    },
    localHostnames: [os.hostname()].filter(Boolean),
    connect,
    describeConnection: () => connectedTarget.read(),
    listCollectionNames: async () => {
      const collections = await database().listCollections().toArray();
      return collections.map((collection) => collection.name);
    },
    rawCollection: (name: string) => {
      const collection = database().collection(name);
      return {
        countDocuments: () => collection.countDocuments(),
        deleteMany: (filter) => collection.deleteMany(filter),
      };
    },
    disconnect: () => mongoose.disconnect(),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  };
}
