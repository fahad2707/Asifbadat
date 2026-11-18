import { createHash } from 'node:crypto';
import AuditLog from '../models/AuditLog';
import Category from '../models/Category';
import Product from '../models/Product';
import StoreSettings from '../models/StoreSettings';
import SubCategory from '../models/SubCategory';

/**
 * Safeguards shared by the database cleanup scripts.
 *
 * Two kinds of data must never be lost by accident:
 * - Audit history (evidence).
 * - The product catalogue: Product, Category and SubCategory records, including
 *   prices, SKUs, stock quantities and image URLs.
 *
 * Rules enforced here:
 * - Operational cleanup never deletes either.
 * - Any destructive run is a dry run unless the operator names the target
 *   database on that run, and additionally acknowledges catalogue deletion
 *   when Product, Category or SubCategory records would be deleted.
 * - Destructive runs are only allowed against a MongoDB server that is
 *   positively established to be on this machine. Anything else, including
 *   anything that cannot be determined, is refused. NODE_ENV alone never
 *   makes a target safe.
 *
 * Pure decision logic only: nothing here connects to MongoDB or changes data.
 */

/** MongoDB collection that holds audit history (`auditlogs`). */
export const AUDIT_LOG_COLLECTION: string = AuditLog.collection.name;

export const PRODUCT_COLLECTION: string = Product.collection.name;
export const CATEGORY_COLLECTION: string = Category.collection.name;
export const SUBCATEGORY_COLLECTION: string = SubCategory.collection.name;

/** Collections that make up the product catalogue. */
export const CATALOGUE_COLLECTIONS: readonly string[] = [
  PRODUCT_COLLECTION,
  CATEGORY_COLLECTION,
  SUBCATEGORY_COLLECTION,
];

/** Collections whose records carry image URLs, and the fields that hold them. */
export const IMAGE_REFERENCE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  [PRODUCT_COLLECTION]: ['image_url'],
  [CATEGORY_COLLECTION]: ['image_url'],
  [StoreSettings.collection.name]: ['logo_url'],
};

/** Product fields an operational cleanup must never change. */
export const PROTECTED_PRODUCT_FIELDS: readonly string[] = [
  'image_url',
  'sku',
  'price',
  'cost_price',
  'stock_quantity',
];

export class CleanupSafeguardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CleanupSafeguardError';
  }
}

export function isCatalogueCollection(collectionName: string): boolean {
  return CATALOGUE_COLLECTIONS.includes(collectionName);
}

export function isProtectedFromOperationalCleanup(collectionName: string): boolean {
  return collectionName === AUDIT_LOG_COLLECTION || isCatalogueCollection(collectionName);
}

type WipeTarget = { name: string; model: unknown };

function collectionNameOf(model: unknown): string | undefined {
  const name = (model as { collection?: { name?: unknown } } | null | undefined)?.collection?.name;
  return typeof name === 'string' ? name : undefined;
}

function targetsAuditLog(model: unknown): boolean {
  return model === AuditLog || collectionNameOf(model) === AUDIT_LOG_COLLECTION;
}

/**
 * Throws unless an operational cleanup plan leaves audit history alone:
 * AuditLog must not be in the wipe list, and its collection must be in the
 * keep list so a "delete every other collection" sweep skips it.
 */
export function assertCleanupPreservesAuditLog(plan: {
  wipeModels: readonly WipeTarget[];
  keepCollections: ReadonlySet<string>;
}): void {
  const offending = plan.wipeModels.find((target) => targetsAuditLog(target.model));
  if (offending) {
    throw new CleanupSafeguardError(
      `Refusing to run: "${offending.name}" would delete audit history (${AUDIT_LOG_COLLECTION}).`
    );
  }
  if (!plan.keepCollections.has(AUDIT_LOG_COLLECTION)) {
    throw new CleanupSafeguardError(
      `Refusing to run: "${AUDIT_LOG_COLLECTION}" must be in the keep list so audit history is not swept.`
    );
  }
}

/**
 * Throws unless an operational cleanup plan leaves the product catalogue alone:
 * Product, Category and SubCategory must not be in the wipe list, and their
 * collections must be in the keep list.
 */
export function assertCleanupPreservesCatalogue(plan: {
  wipeModels: readonly WipeTarget[];
  keepCollections: ReadonlySet<string>;
}): void {
  for (const target of plan.wipeModels) {
    const collection = collectionNameOf(target.model);
    if (collection && isCatalogueCollection(collection)) {
      throw new CleanupSafeguardError(
        `Refusing to run: "${target.name}" would delete product catalogue records (${collection}).`
      );
    }
  }
  for (const collection of CATALOGUE_COLLECTIONS) {
    if (!plan.keepCollections.has(collection)) {
      throw new CleanupSafeguardError(
        `Refusing to run: "${collection}" must be in the keep list so the product catalogue is not swept.`
      );
    }
  }
}

/** Operational cleanup must preserve both audit history and the product catalogue. */
export function assertOperationalCleanupIsSafe(plan: {
  wipeModels: readonly WipeTarget[];
  keepCollections: ReadonlySet<string>;
}): void {
  assertCleanupPreservesAuditLog(plan);
  assertCleanupPreservesCatalogue(plan);
}

/* ------------------------------------------------------------------ */
/* Target verification                                                 */
/* ------------------------------------------------------------------ */

export type CleanupTargetDecision = { safe: true } | { safe: false; reason: string };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Lower-cased host with any port and IPv6 brackets removed. */
export function hostWithoutPort(raw: string): string {
  const host = raw.trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 0 ? host.slice(1, end) : host;
  }
  if ((host.match(/:/g) || []).length > 1) return host;
  return host.replace(/:\d+$/, '');
}

function shortHostname(host: string): string {
  return hostWithoutPort(host).split('.')[0];
}

/** True for loopback addresses and for this machine's own hostname. */
export function isLocalHost(host: string, localHostnames: readonly string[] = []): boolean {
  const normalized = hostWithoutPort(host);
  if (!normalized) return false;
  if (LOOPBACK_HOSTS.has(normalized)) return true;
  return localHostnames.some((name) => {
    const local = hostWithoutPort(name);
    return local !== '' && local === normalized;
  });
}

/**
 * Hosts named in a MongoDB connection string, without credentials.
 * Returns null when the string cannot be understood.
 */
export function describeMongoUri(uri: string): { srv: boolean; hosts: string[] } | null {
  const match = uri.trim().match(/^mongodb(\+srv)?:\/\/([^/?#]*)/i);
  if (!match) return null;
  const authority = match[2];
  const hostList = authority.slice(authority.lastIndexOf('@') + 1);
  const hosts = hostList
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  if (hosts.length === 0) return null;
  return { srv: Boolean(match[1]), hosts };
}

function isProductionNodeEnv(nodeEnv: string | undefined): boolean {
  return (nodeEnv || '').trim().toLowerCase() === 'production';
}

/**
 * First gate, evaluated BEFORE any connection is opened, so a destructive
 * script never even connects to a remote database.
 *
 * `uri` is MONGODB_URI as configured. When it is unset the connection module
 * falls back to its localhost default, and the post-connection gate verifies
 * what was actually reached.
 */
export function evaluateTargetBeforeConnect(input: {
  uri: string | undefined;
  nodeEnv: string | undefined;
  localHostnames?: readonly string[];
}): CleanupTargetDecision {
  if (isProductionNodeEnv(input.nodeEnv)) {
    return { safe: false, reason: 'NODE_ENV is "production".' };
  }
  const uri = (input.uri || '').trim();
  if (!uri) return { safe: true };

  const described = describeMongoUri(uri);
  if (!described) {
    return { safe: false, reason: 'MONGODB_URI could not be understood, so the target cannot be verified.' };
  }
  if (described.srv) {
    return {
      safe: false,
      reason: `MONGODB_URI is a mongodb+srv connection to "${described.hosts.join(', ')}", which is not a local database.`,
    };
  }
  const remote = described.hosts.filter((host) => !isLocalHost(host, input.localHostnames));
  if (remote.length > 0) {
    return {
      safe: false,
      reason: `MONGODB_URI points at "${remote.join(', ')}", which is not this machine.`,
    };
  }
  return { safe: true };
}

export type ConnectedTargetEvidence = {
  databaseName: string | undefined;
  /** Host the driver connected to. */
  connectionHost: string | undefined;
  /** Hosts the server names for itself and its replica set; undefined when it could not be asked. */
  serverReportedHosts: readonly string[] | undefined;
  /** Hostname of the machine the MongoDB server runs on; undefined when it could not be asked. */
  serverHostname: string | undefined;
  /** True when connected through a mongos router. */
  isMongosRouter: boolean;
};

/**
 * Second gate, evaluated AFTER connecting and before anything is read or
 * changed. Every piece of evidence must say "this machine"; anything missing
 * or different is a refusal.
 *
 * The server's own hostname is checked because a port-forward or SSH tunnel
 * makes a remote database look like localhost in the connection string.
 */
export function evaluateConnectedTarget(
  evidence: ConnectedTargetEvidence,
  localHostnames: readonly string[]
): CleanupTargetDecision {
  if (!(evidence.databaseName || '').trim()) {
    return { safe: false, reason: 'The connected database name could not be determined.' };
  }
  const connectionHost = (evidence.connectionHost || '').trim();
  if (!connectionHost) {
    return { safe: false, reason: 'The connected host could not be determined.' };
  }
  if (!isLocalHost(connectionHost, localHostnames)) {
    return { safe: false, reason: `Connected to "${connectionHost}", which is not this machine.` };
  }
  if (evidence.isMongosRouter) {
    return {
      safe: false,
      reason: 'Connected through a mongos router, so where the data lives cannot be verified.',
    };
  }
  if (!evidence.serverReportedHosts) {
    return { safe: false, reason: 'The server did not report its hosts, so the target cannot be verified.' };
  }
  const remote = evidence.serverReportedHosts.filter((host) => !isLocalHost(host, localHostnames));
  if (remote.length > 0) {
    return {
      safe: false,
      reason: `The server identifies itself as "${remote.join(', ')}", which is not this machine.`,
    };
  }
  const serverHostname = (evidence.serverHostname || '').trim();
  if (!serverHostname) {
    return {
      safe: false,
      reason: 'The server did not report which machine it runs on, so the target cannot be verified.',
    };
  }
  const localShortNames = localHostnames.map(shortHostname).filter(Boolean);
  if (localShortNames.length === 0) {
    return { safe: false, reason: 'This machine’s hostname could not be determined.' };
  }
  if (!localShortNames.includes(shortHostname(serverHostname))) {
    return {
      safe: false,
      reason: `The MongoDB server runs on "${serverHostname}", not on this machine ("${localHostnames.join(', ')}").`,
    };
  }
  return { safe: true };
}

/* ------------------------------------------------------------------ */
/* Per-run confirmation                                                */
/* ------------------------------------------------------------------ */

/** `--confirm-database=<database name>`: names the database this run may change. */
export const CONFIRM_DATABASE_FLAG = '--confirm-database';
/** Acknowledges that Product, Category and/or SubCategory records will be permanently deleted. */
export const ACKNOWLEDGE_CATALOGUE_DELETION_FLAG = '--acknowledge-catalogue-deletion';
/** Forces a dry run even when confirmations are present. */
export const DRY_RUN_FLAG = '--dry-run';

export const CONFIRMATION_FLAGS: readonly string[] = [
  CONFIRM_DATABASE_FLAG,
  ACKNOWLEDGE_CATALOGUE_DELETION_FLAG,
];

export type CleanupRequestDecision =
  | { mode: 'dry-run' }
  | { mode: 'execute' }
  | { mode: 'refused'; reason: string };

/**
 * Decides whether a run is a dry run, an execution, or a refusal.
 *
 * - No confirmation flags: dry run.
 * - Any confirmation flag: every requirement must be met or the run is refused.
 * - Confirmations are read only from this run's arguments. A confirmation
 *   stored in the package.json script that launched the run is refused.
 */
export function evaluateCleanupRequest(input: {
  argv: readonly string[];
  databaseName: string | undefined;
  deletesCatalogue: boolean;
  npmLifecycleScript?: string;
}): CleanupRequestDecision {
  const lifecycle = input.npmLifecycleScript || '';
  const baked = CONFIRMATION_FLAGS.find((flag) => lifecycle.includes(flag));
  if (baked) {
    return {
      mode: 'refused',
      reason: `${baked} is stored in the package.json script. Confirmations must be typed on each run.`,
    };
  }

  if (input.argv.includes(DRY_RUN_FLAG)) return { mode: 'dry-run' };

  const prefix = `${CONFIRM_DATABASE_FLAG}=`;
  const confirmations = input.argv.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length));
  const bareConfirmation = input.argv.includes(CONFIRM_DATABASE_FLAG);
  const acknowledged = input.argv.includes(ACKNOWLEDGE_CATALOGUE_DELETION_FLAG);

  if (confirmations.length === 0 && !bareConfirmation && !acknowledged) return { mode: 'dry-run' };

  const databaseName = (input.databaseName || '').trim();
  if (!databaseName) {
    return { mode: 'refused', reason: 'Could not determine the connected database name.' };
  }
  if (confirmations.length === 0) {
    return { mode: 'refused', reason: `Missing ${CONFIRM_DATABASE_FLAG}=<database name>.` };
  }
  if (!confirmations.every((value) => value === databaseName)) {
    return {
      mode: 'refused',
      reason: `${CONFIRM_DATABASE_FLAG} does not match the connected database "${databaseName}".`,
    };
  }
  if (input.deletesCatalogue && !acknowledged) {
    return {
      mode: 'refused',
      reason:
        `Missing ${ACKNOWLEDGE_CATALOGUE_DELETION_FLAG}. This run permanently deletes product catalogue records ` +
        '(Product, Category and/or SubCategory).',
    };
  }
  return { mode: 'execute' };
}

/* ------------------------------------------------------------------ */
/* Catalogue fingerprint                                               */
/* ------------------------------------------------------------------ */

/**
 * Order-independent digest of the protected product fields. Operational
 * cleanup compares it before and after to prove image URLs, SKUs, prices,
 * costs and stock quantities were not touched.
 */
export function catalogueFieldFingerprint(products: readonly Record<string, unknown>[]): string {
  const lines = products
    .map((product) =>
      JSON.stringify([
        String(product._id),
        ...PROTECTED_PRODUCT_FIELDS.map((field) => {
          const value = product[field];
          return value === undefined || value === null ? null : String(value);
        }),
      ])
    )
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}
