import mongoose from 'mongoose';
import AuditLog, { IAuditLog } from '../models/AuditLog';

/**
 * Transaction-bound AuditLog write contract.
 *
 * Use this when a business change and its audit record must succeed or fail
 * together. The caller owns the transaction:
 *
 *     const session = await mongoose.startSession();
 *     session.startTransaction();
 *     try {
 *       await Model.updateOne(filter, update, { session });
 *       await writeAuditLogInTransaction(session, { ... });
 *       await session.commitTransaction();
 *     } catch (err) {
 *       await session.abortTransaction();
 *       throw err;
 *     } finally {
 *       session.endSession();
 *     }
 *
 * Guarantees:
 * - Writes with exactly the session it is given. It never starts, commits,
 *   aborts or ends a session, and never falls back to a session-less write.
 * - Refuses to write unless that session has an active transaction.
 * - Never swallows errors. Driver errors are re-thrown unchanged so the
 *   caller's abort / retry handling still sees the original error.
 * - Refuses snapshots that carry credentials or bank details. Pass only the
 *   fields that changed, never a whole document.
 *
 * The AuditLog schema is unchanged; this helper only maps onto existing fields.
 */

export class AuditLogWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditLogWriteError';
  }
}

export type AuditSnapshot = Record<string, unknown>;

export type TransactionalAuditEntry = {
  /** Event name, e.g. `customer_tobacco_compliance_update`. */
  action: string;
  /** Model name of the changed record, e.g. `Customer`. */
  entityType: string;
  entityId: mongoose.Types.ObjectId | string;
  /**
   * The authenticated admin who made the change. Required on purpose: pass
   * `null` only when there is genuinely no admin actor. Never pass a
   * placeholder or default identity.
   */
  adminId: mongoose.Types.ObjectId | string | null;
  /** Changed fields before the change (stored as `old_value`). */
  before?: AuditSnapshot | null;
  /** Changed fields after the change (stored as `new_value`). */
  after?: AuditSnapshot | null;
  details?: string | null;
  ip?: string | null;
};

/** Compared against keys lower-cased with separators removed. */
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'apikey',
  'privatekey',
  'bankdetails',
  'accountnumber',
  'routingnumber',
  'ifsc',
  'iban',
  'cardnumber',
  'cvv',
];

/** Short names matched whole, so `otp_wholesaler` or `shipping` are not caught. */
const SENSITIVE_EXACT_KEYS = new Set(['otp', 'pin', 'jwt', 'ssn']);

const MAX_SNAPSHOT_DEPTH = 20;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SENSITIVE_EXACT_KEYS.has(normalized)) return true;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isAllowedLeaf(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return true;
  return value instanceof Date || value instanceof mongoose.Types.ObjectId;
}

function assertSnapshotValue(value: unknown, path: string, ancestors: object[]): void {
  if (isAllowedLeaf(value)) return;

  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(value)) {
    throw new AuditLogWriteError(
      `Audit snapshot ${path} must be plain data (objects, arrays, strings, numbers, booleans, dates, ObjectIds). ` +
        'Convert documents with .toObject() or .lean() and pass only the changed fields.'
    );
  }

  const node = value as object;
  if (ancestors.includes(node)) {
    throw new AuditLogWriteError(`Audit snapshot ${path} contains a circular reference.`);
  }
  if (ancestors.length >= MAX_SNAPSHOT_DEPTH) {
    throw new AuditLogWriteError(`Audit snapshot ${path} is nested too deeply.`);
  }
  const nextAncestors = [...ancestors, node];

  if (isArray) {
    (value as unknown[]).forEach((item, index) => {
      assertSnapshotValue(item, `${path}[${index}]`, nextAncestors);
    });
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      throw new AuditLogWriteError(
        `Audit snapshot ${path}.${key} looks like a credential or bank detail and must not be stored in the audit log.`
      );
    }
    assertSnapshotValue(child, `${path}.${key}`, nextAncestors);
  }
}

function normalizeSnapshot(field: 'before' | 'after', value: unknown): AuditSnapshot | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new AuditLogWriteError(
      `Audit ${field} must be a plain object of the changed fields. ` +
        'Convert documents with .toObject() or .lean() and pass only the changed fields.'
    );
  }
  assertSnapshotValue(value, field, []);
  return value;
}

function requiredString(field: string, value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new AuditLogWriteError(`Audit ${field} is required.`);
  }
  return trimmed;
}

function optionalString(field: string, value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new AuditLogWriteError(`Audit ${field} must be a string.`);
  }
  return value.trim() || undefined;
}

function entityIdString(value: unknown): string {
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  return requiredString('entityId', value);
}

function actorObjectId(entry: TransactionalAuditEntry): mongoose.Types.ObjectId | undefined {
  const value: unknown = entry.adminId;
  if (value === undefined) {
    throw new AuditLogWriteError(
      'Audit adminId must be passed explicitly. Use null only when there is no admin actor.'
    );
  }
  if (value === null) return undefined;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  throw new AuditLogWriteError('Audit adminId is not a valid admin id.');
}

function assertActiveTransaction(session: unknown): asserts session is mongoose.ClientSession {
  const candidate = session as { inTransaction?: unknown; hasEnded?: unknown } | null | undefined;
  if (!candidate || typeof candidate !== 'object' || typeof candidate.inTransaction !== 'function') {
    throw new AuditLogWriteError(
      'A MongoDB ClientSession is required: the audit record must be written inside the caller’s transaction.'
    );
  }
  if (candidate.hasEnded === true) {
    throw new AuditLogWriteError('The supplied MongoDB session has already ended.');
  }
  if ((candidate as mongoose.ClientSession).inTransaction() !== true) {
    throw new AuditLogWriteError(
      'The supplied MongoDB session has no active transaction. Call session.startTransaction() before writing the audit record.'
    );
  }
}

export async function writeAuditLogInTransaction(
  session: mongoose.ClientSession,
  entry: TransactionalAuditEntry
): Promise<IAuditLog> {
  assertActiveTransaction(session);
  if (!entry || typeof entry !== 'object') {
    throw new AuditLogWriteError('An audit entry is required.');
  }

  const doc: Record<string, unknown> = {
    action: requiredString('action', entry.action),
    entity_type: requiredString('entityType', entry.entityType),
    entity_id: entityIdString(entry.entityId),
  };

  const adminId = actorObjectId(entry);
  if (adminId) doc.admin_id = adminId;

  const before = normalizeSnapshot('before', entry.before);
  const after = normalizeSnapshot('after', entry.after);
  if (before) doc.old_value = before;
  if (after) doc.new_value = after;

  const details = optionalString('details', entry.details);
  const ip = optionalString('ip', entry.ip);
  if (details) doc.details = details;
  if (ip) doc.ip = ip;

  const created = await AuditLog.create([doc], { session });
  const record = Array.isArray(created) ? created[0] : undefined;
  if (!record || !record._id) {
    throw new AuditLogWriteError('AuditLog write returned no record.');
  }
  return record;
}
