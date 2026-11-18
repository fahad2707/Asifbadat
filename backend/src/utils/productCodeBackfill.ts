import os from 'node:os';
import mongoose from 'mongoose';
import {
  evaluateCleanupRequest,
  evaluateConnectedTarget,
  evaluateTargetBeforeConnect,
  type ConnectedTargetEvidence,
} from '../db/cleanupSafeguards';
import { connectedTarget } from '../db/cleanupRunner';
import { migrationJournal } from './migrationJournal';
import {
  decideManualRelease,
  identifierLock,
  processIdentity,
} from './identifierLock';
import {
  executeApprovedProductCodeMigration,
  planProductCodeMigration,
  type ProductCodeField,
  type ProductCodeMigrationPlan,
} from './productCodes';

/**
 * Guards for the product-code migration.
 *
 * A write is allowed only when both are true:
 * - the connected MongoDB server is positively on this machine (the same
 *   rule as the cleanup scripts; production and anything uncertain are refused);
 * - this request names that database. On the CLI that is `--confirm-database`.
 *   On the API it is the JSON field `confirmDatabase`. A query parameter never counts.
 *
 * Planning only reads product codes. Applying fills an empty product_id or an
 * empty sku from the approved plan. It never changes barcode, PLU, price,
 * cost, stock, category, or an image, and it never deletes a product.
 */

export type BackfillTargetAssessment = {
  safe: boolean;
  /** Present when it could be read. Never a connection string. */
  databaseName?: string;
  /** Detail for server logs and the CLI. Not returned by the API. */
  reason?: string;
};

export type BackfillIntent =
  | { kind: 'dry-run' }
  | { kind: 'execute'; confirmDatabase: string }
  | { kind: 'refused'; status: number; reason: string };

const QUERY_EXECUTION_KEYS = new Set([
  'confirmdatabase',
  'confirm_database',
  'confirm-database',
  'execute',
  'apply',
  'confirm',
]);

export type ProductCodePlanSummary = {
  examined: number;
  wouldUpdate: number;
  skippedNoChange: number;
  manualReview: number;
  fields: Record<ProductCodeField, number>;
  reviews: Array<{ id: string; reason: string }>;
  warnings: string[];
};

export function summarizeProductCodePlan(plan: ProductCodeMigrationPlan): ProductCodePlanSummary {
  const fields: Record<ProductCodeField, number> = { product_id: 0, sku: 0 };
  for (const change of plan.changes) {
    for (const field of change.fields) fields[field] += 1;
  }
  return {
    examined: plan.examined,
    wouldUpdate: plan.changes.length,
    skippedNoChange: plan.skippedNoChange,
    manualReview: plan.reviews.length,
    fields,
    reviews: plan.reviews.map((review) => ({ id: review.id, reason: review.reason })),
    warnings: plan.warnings,
  };
}

function queryAttemptsExecution(query: unknown): boolean {
  if (!query || typeof query !== 'object') return false;
  return Object.keys(query as Record<string, unknown>).some((key) => QUERY_EXECUTION_KEYS.has(key.toLowerCase()));
}

function bodyRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/**
 * Decides dry-run, execute, or refuse from an HTTP request.
 * Confirmation is read only from the JSON body. Query parameters are rejected
 * when they are the only execution attempt, and ignored when the body speaks.
 */
export function readBackfillIntent(body: unknown, query: unknown): BackfillIntent {
  const record = bodyRecord(body);
  const forceDryRun = record?.dryRun === true || record?.dry_run === true;
  const confirmKey = record && ('confirmDatabase' in record || 'confirm_database' in record);
  const confirmRaw = record ? (record.confirmDatabase ?? record.confirm_database) : undefined;
  const confirmDatabase = typeof confirmRaw === 'string' ? confirmRaw.trim() : '';
  const executeFlag = record?.execute === true || record?.apply === true;
  const bodyAttempts = Boolean(confirmKey || executeFlag);

  if (queryAttemptsExecution(query) && !bodyAttempts) {
    return {
      kind: 'refused',
      status: 400,
      reason: 'A query parameter cannot authorize this write. Send confirmDatabase in the JSON body.',
    };
  }
  if (forceDryRun || !bodyAttempts) return { kind: 'dry-run' };
  if (!confirmDatabase) {
    return {
      kind: 'refused',
      status: 400,
      reason: 'Missing confirmDatabase. Execution requires the connected database name in the JSON body.',
    };
  }
  return { kind: 'execute', confirmDatabase };
}

/** Shown to API clients. Deliberately contains no host, URI, or credential. */
export const PUBLIC_TARGET_REFUSAL =
  'This database target is not a confirmed local development database, so no products were changed.';

export async function assessBackfillTarget(input: {
  uri: string | undefined;
  nodeEnv: string | undefined;
  localHostnames: readonly string[];
  connectedDatabaseName?: string;
  readEvidence: () => Promise<ConnectedTargetEvidence>;
}): Promise<BackfillTargetAssessment> {
  const before = evaluateTargetBeforeConnect({
    uri: input.uri,
    nodeEnv: input.nodeEnv,
    localHostnames: input.localHostnames,
  });
  if (!before.safe) {
    return { safe: false, reason: before.reason, databaseName: input.connectedDatabaseName };
  }
  const evidence = await input.readEvidence();
  const databaseName = (evidence.databaseName || '').trim() || undefined;
  const connected = evaluateConnectedTarget(evidence, input.localHostnames);
  if (!connected.safe) return { safe: false, reason: connected.reason, databaseName };
  return { safe: true, databaseName };
}

export const backfillRuntime = {
  assess(): Promise<BackfillTargetAssessment> {
    return assessBackfillTarget({
      uri: process.env.MONGODB_URI,
      nodeEnv: process.env.NODE_ENV,
      localHostnames: [os.hostname()].filter(Boolean),
      connectedDatabaseName: mongoose.connection.name,
      readEvidence: () => connectedTarget.read(),
    });
  },
};

export type BackfillCliDeps = {
  argv: readonly string[];
  env: { MONGODB_URI?: string; NODE_ENV?: string; npm_lifecycle_script?: string };
  localHostnames: readonly string[];
  connect: () => Promise<unknown>;
  readEvidence: () => Promise<ConnectedTargetEvidence>;
  disconnect: () => Promise<unknown>;
  log: (line: string) => void;
  error: (line: string) => void;
};

function printPlan(log: (line: string) => void, plan: ProductCodeMigrationPlan, databaseName: string): void {
  const summary = summarizeProductCodePlan(plan);
  log(`Connected database : ${databaseName || '(unknown)'}`);
  log(`Examined            : ${summary.examined}`);
  log(`Would update        : ${summary.wouldUpdate}`);
  log(`Already in shape    : ${summary.skippedNoChange}`);
  log(`Manual review       : ${summary.manualReview}`);
  log('Fields that would be filled:');
  log(`  product_id : ${summary.fields.product_id}`);
  log(`  sku        : ${summary.fields.sku}`);
  log('Barcode, PLU, price, cost, stock, category and image_url are not changed.');
  const sample = plan.changes.slice(0, 30);
  if (sample.length > 0) {
    log('Products:');
    for (const change of sample) log(`  ${change.id}: ${change.fields.join(', ')}`);
    if (plan.changes.length > sample.length) log(`  ... and ${plan.changes.length - sample.length} more`);
  }
  const reviewSample = summary.reviews.slice(0, 30);
  if (reviewSample.length > 0) {
    log('Manual review:');
    for (const review of reviewSample) log(`  ${review.id}: ${review.reason}`);
    if (summary.reviews.length > reviewSample.length) log(`  ... and ${summary.reviews.length - reviewSample.length} more`);
  }
  if (summary.warnings.length > 0) {
    log(`Warnings: ${summary.warnings.length}`);
    for (const warning of summary.warnings.slice(0, 20)) log(`  ${warning}`);
  }
}

/** CLI entry. Returns the process exit code and never calls process.exit. */
export async function runProductCodeBackfill(deps: BackfillCliDeps): Promise<number> {
  const before = evaluateTargetBeforeConnect({
    uri: deps.env.MONGODB_URI,
    nodeEnv: deps.env.NODE_ENV,
    localHostnames: deps.localHostnames,
  });
  if (!before.safe) {
    deps.error('REFUSED: product code backfill did not run. No products were changed.');
    deps.error(`  Reason: ${before.reason}`);
    deps.error('  No database connection was opened.');
    return 1;
  }

  await deps.connect();
  try {
    const evidence = await deps.readEvidence();
    const databaseName = (evidence.databaseName || '').trim();
    const connected = evaluateConnectedTarget(evidence, deps.localHostnames);
    if (!connected.safe) {
      deps.error('REFUSED: product code backfill did not run. No products were changed.');
      deps.error(`  Reason: ${connected.reason}`);
      return 1;
    }

    if (deps.argv.includes('--inspect-lock')) {
      let current;
      try {
        current = await identifierLock.read();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        deps.error('REFUSED: the product identifier lock could not be read. No products were changed.');
        deps.error(`  Reason: ${msg}`);
        return 1;
      }
      if (!current) {
        deps.log('No product identifier lock is held.');
        return 0;
      }
      deps.log(`Lock key        : product-identifier-writes`);
      deps.log(`ownerRunId      : ${current.ownerRunId}`);
      deps.log(`ownerPid        : ${current.ownerPid}`);
      deps.log(`ownerHost       : ${current.ownerHost}`);
      deps.log(`ownerStartedAt  : ${current.ownerStartedAt || '(not recorded)'}`);
      deps.log(`databaseName    : ${current.databaseName}`);
      deps.log(`purpose         : ${current.purpose}`);
      deps.log(`acquiredAt      : ${current.acquiredAt}`);
      return 0;
    }

    if (deps.argv.includes('--release-lock')) {
      const ownerFlag = deps.argv.find((arg) => arg.startsWith('--owner-run-id='));
      const ownerRunId = ownerFlag ? ownerFlag.slice('--owner-run-id='.length) : '';
      const decision = evaluateCleanupRequest({
        argv: deps.argv,
        databaseName,
        deletesCatalogue: false,
        npmLifecycleScript: deps.env.npm_lifecycle_script,
      });
      if (decision.mode !== 'execute' || !ownerRunId) {
        deps.error('REFUSED: the product identifier lock was not released. No products were changed.');
        deps.error(
          '  Reason: manual release requires --confirm-database=<exact database name> and --owner-run-id=<inspected ownerRunId>.'
        );
        return 1;
      }
      let current;
      try {
        current = await identifierLock.read();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        deps.error('REFUSED: the product identifier lock could not be read. No products were changed.');
        deps.error(`  Reason: ${msg}`);
        return 1;
      }
      const verdict = await decideManualRelease({
        lock: current,
        databaseName,
        ownerRunId,
        localHost: processIdentity.host(),
        isAlive: (pid) => processIdentity.isAlive(pid),
        startedAt: (pid) => processIdentity.startedAt(pid),
      });
      if (!verdict.allow || !current) {
        deps.error('REFUSED: the product identifier lock was not released. No products were changed.');
        deps.error(`  Reason: ${verdict.reason}`);
        return 1;
      }
      const released = await identifierLock.release(current);
      if (!released) {
        deps.error('REFUSED: the product identifier lock was not released. No products were changed.');
        deps.error('  Reason: the lock no longer matches the inspected owner.');
        return 1;
      }
      deps.log('Released the product identifier lock. No products were changed.');
      return 0;
    }

    const decision = evaluateCleanupRequest({
      argv: deps.argv,
      databaseName,
      deletesCatalogue: false,
      npmLifecycleScript: deps.env.npm_lifecycle_script,
    });
    if (decision.mode === 'dry-run') {
      let running;
      try {
        running = await migrationJournal.listRunning(databaseName);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        deps.error('REFUSED: the execution journal could not be read. No products were changed.');
        deps.error(`  Reason: ${msg}`);
        return 1;
      }
      for (const journal of running) {
        deps.error(
          `RUNNING JOURNAL ${journal.runId}: updated ${journal.updatedIds.join(', ') || '(none)'}; ` +
            `failed ${journal.failed.map((failure) => failure.id).join(', ') || '(none)'}; ` +
            `not attempted ${journal.notAttempted.join(', ') || '(none)'}. ` +
            'This dry run did not change that journal and did not replay its plan.'
        );
      }
      const plan = await planProductCodeMigration();
      printPlan(deps.log, plan, databaseName);
      deps.log('');
      deps.log('DRY RUN: no products were changed.');
      deps.log(
        'To execute, type on this run: npm run db:backfill-product-codes -- --confirm-database=<database name shown above>'
      );
      return 0;
    }
    if (decision.mode === 'refused') {
      const plan = await planProductCodeMigration();
      printPlan(deps.log, plan, databaseName);
      deps.error('');
      deps.error('REFUSED: product code backfill did not run. No products were changed.');
      deps.error(`  Reason: ${decision.reason}`);
      return 1;
    }

    const executed = await executeApprovedProductCodeMigration();
    if (executed.plan) printPlan(deps.log, executed.plan, databaseName);
    for (const journalId of executed.applied.interruptedRunIds) {
      deps.error(
        `INTERRUPTED RUN ${journalId}: the saved plan was not replayed. A new plan was built while the identifier lock was held.`
      );
    }
    const applied = executed.applied;
    if (!applied.applied) {
      deps.error('');
      deps.error(
        applied.updated === 0
          ? 'REFUSED: product code backfill did not run. No products were changed.'
          : 'STOPPED: product code backfill wrote some products, then stopped. Those writes were not retried.'
      );
      deps.error(`  Reason: ${applied.reason}`);
      if (applied.updatedIds.length > 0) deps.error(`  Updated: ${applied.updatedIds.join(', ')}`);
      for (const failure of applied.failed) deps.error(`  Failed: ${failure.id}: ${failure.reason}`);
      if (applied.notAttempted.length > 0) deps.error(`  Not attempted: ${applied.notAttempted.join(', ')}`);
      for (const warning of applied.warnings.slice(0, 20)) deps.error(`  ${warning}`);
      return 1;
    }
    deps.log('');
    deps.log(`Product code backfill applied to ${applied.updated} product(s).`);
    if (applied.updatedIds.length > 0) deps.log(`  Updated: ${applied.updatedIds.join(', ')}`);
    for (const warning of applied.warnings.slice(0, 20)) deps.error(`  ${warning}`);
    return 0;
  } finally {
    await deps.disconnect();
  }
}
