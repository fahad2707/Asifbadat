import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import mongoose from 'mongoose';

/**
 * One MongoDB document blocks every bulk workflow that writes product
 * identifiers. The document id is the lock. There is no TTL and no automatic
 * takeover. A failed insert writes nothing else.
 *
 * Interactive product create, update, and ensureInternalSkuForProduct do not
 * take this lock. Those requests are single-product conditional updates. Holding
 * this catalogue lock on them would stop ordinary edits for the whole migration.
 * Their protection is the conditional filter plus the unique indexes declared
 * on the product schema. Those indexes are not assumed to exist on a database
 * until a read-only census confirms them.
 */

export const PRODUCT_IDENTIFIER_LOCK_ID = 'product-identifier-writes';

export type IdentifierLockPurpose =
  | 'product-code-migration'
  | 'sku-barcode-excel'
  | 'product-csv-import'
  | 'category-xls-import';

export type IdentifierLockRecord = {
  ownerRunId: string;
  ownerPid: number;
  ownerHost: string;
  ownerStartedAt: string;
  databaseName: string;
  purpose: IdentifierLockPurpose;
  acquiredAt: string;
};

type IdentifierLockDocument = IdentifierLockRecord & {
  _id: typeof PRODUCT_IDENTIFIER_LOCK_ID;
};

export type IdentifierLockStore = {
  insertOne(doc: IdentifierLockDocument): Promise<unknown>;
  findOne(filter: { _id: typeof PRODUCT_IDENTIFIER_LOCK_ID }): Promise<IdentifierLockDocument | null>;
  deleteOne(filter: {
    _id: typeof PRODUCT_IDENTIFIER_LOCK_ID;
    ownerRunId: string;
  }): Promise<{ deletedCount?: number }>;
};

export class IdentifierLockHeldError extends Error {
  readonly lock: IdentifierLockRecord | null;

  constructor(lock: IdentifierLockRecord | null) {
    const detail = lock
      ? `Product identifier writes are already locked by ${lock.purpose} run ${lock.ownerRunId}. No products were changed.`
      : 'Product identifier writes are already locked. No products were changed.';
    super(detail);
    this.name = 'IdentifierLockHeldError';
    this.lock = lock;
  }
}

export type ProcessIdentity = {
  pid(): number;
  host(): string;
  isAlive(pid: number): boolean;
  startedAt(pid: number): Promise<string | null>;
};

function shortHost(hostname: string): string {
  const host = hostname.trim().split('.')[0];
  return host || hostname.trim();
}

export const processIdentity: ProcessIdentity = {
  pid(): number {
    return process.pid;
  },
  host(): string {
    return shortHost(os.hostname());
  },
  isAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: unknown) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      return code !== 'ESRCH';
    }
  },
  startedAt(pid: number): Promise<string | null> {
    if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      execFile('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 2000 }, (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const value = stdout.trim();
        resolve(value || null);
      });
    });
  },
};

function duplicateKey(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ((error as { code?: unknown }).code === 11000) return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('E11000');
}

function asRecord(doc: IdentifierLockDocument | null): IdentifierLockRecord | null {
  if (!doc || doc._id !== PRODUCT_IDENTIFIER_LOCK_ID) return null;
  if (typeof doc.ownerRunId !== 'string' || typeof doc.purpose !== 'string') return null;
  return {
    ownerRunId: doc.ownerRunId,
    ownerPid: doc.ownerPid,
    ownerHost: doc.ownerHost,
    ownerStartedAt: doc.ownerStartedAt,
    databaseName: doc.databaseName,
    purpose: doc.purpose,
    acquiredAt: doc.acquiredAt,
  };
}

export async function acquireIdentifierLock(
  store: IdentifierLockStore,
  input: { databaseName: string; purpose: IdentifierLockPurpose },
  identity: ProcessIdentity = processIdentity
): Promise<IdentifierLockRecord> {
  const ownerPid = identity.pid();
  const record: IdentifierLockRecord = {
    ownerRunId: randomUUID(),
    ownerPid,
    ownerHost: identity.host(),
    ownerStartedAt: (await identity.startedAt(ownerPid)) || '',
    databaseName: input.databaseName,
    purpose: input.purpose,
    acquiredAt: new Date().toISOString(),
  };
  try {
    await store.insertOne({ _id: PRODUCT_IDENTIFIER_LOCK_ID, ...record });
    return record;
  } catch (error: unknown) {
    if (!duplicateKey(error)) {
      throw new Error('The product identifier lock could not be acquired. No products were changed.');
    }
    let existing: IdentifierLockDocument | null = null;
    try {
      existing = await store.findOne({ _id: PRODUCT_IDENTIFIER_LOCK_ID });
    } catch {
      existing = null;
    }
    throw new IdentifierLockHeldError(asRecord(existing));
  }
}

/** Deletes only the document whose ownerRunId matches. A mismatch deletes nothing. */
export async function releaseIdentifierLock(
  store: IdentifierLockStore,
  lock: Pick<IdentifierLockRecord, 'ownerRunId'>
): Promise<boolean> {
  const result = await store.deleteOne({
    _id: PRODUCT_IDENTIFIER_LOCK_ID,
    ownerRunId: lock.ownerRunId,
  });
  return (result.deletedCount ?? 0) === 1;
}

export async function readIdentifierLock(store: IdentifierLockStore): Promise<IdentifierLockRecord | null> {
  const doc = await store.findOne({ _id: PRODUCT_IDENTIFIER_LOCK_ID });
  return asRecord(doc);
}

export type ManualReleaseDecision = {
  allow: boolean;
  reason: string;
};

/**
 * Manual recovery. Allowed only when the connected database was confirmed,
 * the ownerRunId is the one that was inspected, and the recorded process is
 * not the same live process on this machine. An unverifiable process is refused.
 */
export async function decideManualRelease(input: {
  lock: IdentifierLockRecord | null;
  databaseName: string;
  ownerRunId: string;
  localHost: string;
  isAlive: (pid: number) => boolean;
  startedAt: (pid: number) => Promise<string | null>;
}): Promise<ManualReleaseDecision> {
  const lock = input.lock;
  if (!lock) {
    return { allow: false, reason: 'No product identifier lock is held. Nothing was released.' };
  }
  if (input.databaseName !== lock.databaseName) {
    return {
      allow: false,
      reason: 'The confirmed database does not match the lock. Nothing was released.',
    };
  }
  if (input.ownerRunId !== lock.ownerRunId) {
    return {
      allow: false,
      reason: 'The ownerRunId does not match the lock. Nothing was released.',
    };
  }
  if (lock.ownerHost !== input.localHost) {
    return {
      allow: false,
      reason: `The lock is owned on ${lock.ownerHost}. This machine is ${input.localHost}, so the owner process cannot be verified and the lock was not released.`,
    };
  }
  if (input.isAlive(lock.ownerPid)) {
    const started = await input.startedAt(lock.ownerPid);
    if (!started || !lock.ownerStartedAt) {
      return {
        allow: false,
        reason: `The owner process ${lock.ownerPid} is alive, but its start time could not be verified. The lock was not released.`,
      };
    }
    if (started === lock.ownerStartedAt) {
      return {
        allow: false,
        reason: `The owner process ${lock.ownerPid} is still the same live process on ${lock.ownerHost}. The lock was not released.`,
      };
    }
    return {
      allow: true,
      reason: 'The recorded pid belongs to a different process. The original owner is not live.',
    };
  }
  return { allow: true, reason: 'The recorded owner process is not running.' };
}

function collectionStore(): IdentifierLockStore {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('The product identifier lock is not available because the database is not connected. No products were changed.');
  }
  const collection = db.collection('migration_locks');
  return {
    insertOne: (doc) => collection.insertOne(doc as never),
    findOne: (filter) => collection.findOne(filter as never) as Promise<IdentifierLockDocument | null>,
    deleteOne: (filter) => collection.deleteOne(filter as never),
  };
}

export const identifierLock = {
  store(): IdentifierLockStore {
    return collectionStore();
  },
  acquire(input: { databaseName: string; purpose: IdentifierLockPurpose }): Promise<IdentifierLockRecord> {
    return acquireIdentifierLock(identifierLock.store(), input);
  },
  release(lock: Pick<IdentifierLockRecord, 'ownerRunId'>): Promise<boolean> {
    return releaseIdentifierLock(identifierLock.store(), lock);
  },
  read(): Promise<IdentifierLockRecord | null> {
    return readIdentifierLock(identifierLock.store());
  },
};
