import {
  evaluateCleanupRequest,
  evaluateConnectedTarget,
  evaluateTargetBeforeConnect,
  type ConnectedTargetEvidence,
} from '../db/cleanupSafeguards';
import { applySkuBarcodeChanges, type SkuBarcodePlan } from './skuBarcodeImport';
import { identifierLock } from './identifierLock';

/**
 * Target gate and write switch for the Excel SKU/barcode import.
 *
 * Uses the same three checks as the cleanup scripts and the product-code
 * backfill: the URI and NODE_ENV before connecting, the server the driver
 * actually reached, and `--confirm-database` typed on this run. `--apply`
 * does not skip any of those checks, and a confirmation without `--apply`
 * stays a dry run.
 */

export type SkuBarcodeExcelLoad = {
  plan: SkuBarcodePlan;
  errors: string[];
  skipped: string[];
};

export type SkuBarcodeExcelDeps = {
  argv: readonly string[];
  env: { MONGODB_URI?: string; NODE_ENV?: string; npm_lifecycle_script?: string };
  localHostnames: readonly string[];
  connect: () => Promise<unknown>;
  readEvidence: () => Promise<ConnectedTargetEvidence>;
  disconnect: () => Promise<unknown>;
  /** Reads products and classifies the sheet. Called only after the target is safe. */
  loadPlan: () => Promise<SkuBarcodeExcelLoad>;
  log: (line: string) => void;
  error: (line: string) => void;
};

function printLoaded(deps: SkuBarcodeExcelDeps, loaded: SkuBarcodeExcelLoad): void {
  const { plan } = loaded;
  deps.log('');
  deps.log('--- Plan (writes require --apply and --confirm-database) ---');
  deps.log(JSON.stringify(plan.changes.slice(0, 80), null, 2));
  if (plan.changes.length > 80) deps.log(`... and ${plan.changes.length - 80} more changes`);
  deps.log('');
  deps.log('--- Conflicts (left unchanged) ---');
  deps.log(JSON.stringify(plan.conflicts.slice(0, 80), null, 2));
  if (plan.conflicts.length > 80) deps.log(`... and ${plan.conflicts.length - 80} more conflicts`);
  if (loaded.errors.length) {
    deps.log('');
    deps.log(`Errors / blocked: ${loaded.errors.length}`);
    for (const line of loaded.errors.slice(0, 40)) deps.log(`  ${line}`);
    if (loaded.errors.length > 40) deps.log(`  ... ${loaded.errors.length - 40} more`);
  }
  if (loaded.skipped.length) {
    deps.log('');
    deps.log(`Skipped (info): ${Math.min(15, loaded.skipped.length)} of ${loaded.skipped.length}`);
    for (const line of loaded.skipped.slice(0, 15)) deps.log(`  ${line}`);
  }
}

/** Returns the process exit code. Does not call process.exit. */
export async function runSkuBarcodeExcelImport(deps: SkuBarcodeExcelDeps): Promise<number> {
  const before = evaluateTargetBeforeConnect({
    uri: deps.env.MONGODB_URI,
    nodeEnv: deps.env.NODE_ENV,
    localHostnames: deps.localHostnames,
  });
  if (!before.safe) {
    deps.error('REFUSED: SKU/barcode import did not run. No products were changed.');
    deps.error(`  Reason: ${before.reason}`);
    deps.error('  No database connection was opened.');
    return 1;
  }

  await deps.connect();
  try {
    let evidence: ConnectedTargetEvidence;
    try {
      evidence = await deps.readEvidence();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      deps.error('REFUSED: SKU/barcode import did not run. No products were changed.');
      deps.error(`  Reason: the connected server could not be identified (${detail}).`);
      return 1;
    }
    const databaseName = (evidence.databaseName || '').trim();
    const connected = evaluateConnectedTarget(evidence, deps.localHostnames);
    if (!connected.safe) {
      deps.error('REFUSED: SKU/barcode import did not run. No products were changed.');
      deps.error(`  Reason: ${connected.reason}`);
      return 1;
    }

    const requestedApply = deps.argv.includes('--apply');
    const decision = evaluateCleanupRequest({
      argv: deps.argv,
      databaseName,
      deletesCatalogue: false,
      npmLifecycleScript: deps.env.npm_lifecycle_script,
    });
    const execute = requestedApply && decision.mode === 'execute';
    if (!execute) {
      const loaded = await deps.loadPlan();
      printLoaded(deps, loaded);
      deps.log('');
      deps.log(`Connected database : ${databaseName || '(unknown)'}`);
      if (decision.mode === 'refused') {
        deps.error('REFUSED: SKU/barcode import did not run. No products were changed.');
        deps.error(`  Reason: ${decision.reason}`);
        return 1;
      }
      deps.log(
        `Summary: planned updates: ${loaded.plan.changes.length} | conflicts left unchanged: ${loaded.plan.conflicts.length} | applied: 0 | dry run: true`
      );
      if (requestedApply) {
        deps.log('--apply does not write unless this run also confirms the connected database.');
      }
      deps.log('DRY RUN: no products were changed.');
      deps.log(
        'To execute, type on this run: npm run db:apply-sku-excel -- --apply --confirm-database=<database name shown above>'
      );
      return 0;
    }

    let lock;
    try {
      lock = await identifierLock.acquire({ databaseName, purpose: 'sku-barcode-excel' });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'The product identifier lock could not be acquired.';
      deps.error('REFUSED: SKU/barcode import did not run. No products were changed.');
      deps.error(`  Reason: ${msg}`);
      return 1;
    }
    try {
      const loaded = await deps.loadPlan();
      printLoaded(deps, loaded);
      deps.log('');
      deps.log(`Connected database : ${databaseName || '(unknown)'}`);
      const result = await applySkuBarcodeChanges(loaded.plan.changes);
      deps.log(`Updated: ${result.updated.join(', ') || '(none)'}`);
      for (const failure of result.failed) deps.error(`Failed: ${failure.productId}: ${failure.reason}`);
      if (result.notAttempted.length > 0) deps.error(`Not attempted: ${result.notAttempted.join(', ')}`);
      deps.log(
        `Summary: planned updates: ${loaded.plan.changes.length} | conflicts left unchanged: ${loaded.plan.conflicts.length} | applied: ${result.updated.length} | dry run: false`
      );
      if (result.failed.length > 0 || result.notAttempted.length > 0) return 1;
      return 0;
    } finally {
      await identifierLock.release(lock).catch(() => {
        deps.error('The product identifier lock could not be released.');
      });
    }
  } finally {
    await deps.disconnect();
  }
}
