/**
 * Transaction-bound AuditLog write contract — REAL MongoDB transactions.
 *
 * Opt-in. Skipped unless AUDIT_LOG_TEST_MONGODB_URI points at a disposable
 * local replica set (transactions need a replica set). The tests:
 * - refuse any host that is not localhost / 127.0.0.1 / [::1];
 * - ignore the database in the URI and use their own `audit_log_it_*` database;
 * - drop only that database when they finish.
 * They never read MONGODB_URI and never touch the application database.
 *
 * Run with:
 *     AUDIT_LOG_TEST_MONGODB_URI='mongodb://127.0.0.1:27947/?replicaSet=rs0' \
 *       npx tsx --test src/utils/auditLog.integration.test.ts
 */
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog';
import { AuditLogWriteError, writeAuditLogInTransaction } from './auditLog';

const URI = process.env.AUDIT_LOG_TEST_MONGODB_URI?.trim() || '';
const SKIP: string | false = URI
  ? false
  : 'set AUDIT_LOG_TEST_MONGODB_URI to a disposable local replica set to run real-transaction tests';

const DB_PREFIX = 'audit_log_it_';
const DB_NAME = `${DB_PREFIX}${randomBytes(6).toString('hex')}`;
const BUSINESS_COLLECTION = 'audit_it_business';
const ADMIN_ID = '64b0000000000000000a0001';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function assertLocalUri(uri: string) {
  const match = uri.match(/^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/);
  assert.ok(match, 'AUDIT_LOG_TEST_MONGODB_URI must be a mongodb:// URI (mongodb+srv is refused)');
  for (const hostPort of match[1].split(',')) {
    const host = hostPort.replace(/:\d+$/, '').toLowerCase();
    assert.ok(LOCAL_HOSTS.has(host), `integration tests only run against a local MongoDB, got host "${host}"`);
  }
}

function business() {
  return mongoose.connection.collection(BUSINESS_COLLECTION);
}

/** The caller pattern documented on the helper. */
async function inTransaction<T>(work: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    await session.endSession();
  }
}

before(async () => {
  if (SKIP) return;
  assertLocalUri(URI);
  await mongoose.connect(URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 5000 });
  assert.equal(mongoose.connection.name, DB_NAME);
  await AuditLog.init();
  await mongoose.connection.createCollection(BUSINESS_COLLECTION);
});

afterEach(() => {
  mock.restoreAll();
});

after(async () => {
  if (SKIP) return;
  if (mongoose.connection.readyState === 1) {
    if (mongoose.connection.name === DB_NAME && DB_NAME.startsWith(DB_PREFIX)) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }
});

test('REAL: commit persists the business write and the audit record together', { skip: SKIP }, async () => {
  const entityId = new mongoose.Types.ObjectId();
  const after = { tobacco_compliance: { buyer_type: 'retailer', licenses: [{ license_number: 'EX-1' }] } };

  await inTransaction(async (session) => {
    await business().insertOne({ _id: entityId, buyer_type: 'retailer' }, { session });
    const record = await writeAuditLogInTransaction(session, {
      action: 'it_commit',
      entityType: 'Customer',
      entityId,
      adminId: ADMIN_ID,
      before: { tobacco_compliance: { buyer_type: 'unknown', licenses: [] } },
      after,
      details: 'integration commit',
      ip: '127.0.0.1',
    });

    assert.strictEqual(
      (record as unknown as mongoose.Document).$session(),
      session,
      'the record is bound to the caller’s session'
    );
    assert.equal(
      await AuditLog.countDocuments({ entity_id: String(entityId) }),
      0,
      'uncommitted audit record is invisible outside the transaction'
    );
  });

  assert.equal(await business().countDocuments({ _id: entityId }), 1);
  const stored = await AuditLog.findOne({ entity_id: String(entityId) }).lean();
  assert.ok(stored);
  assert.equal(stored.action, 'it_commit');
  assert.equal(stored.entity_type, 'Customer');
  assert.equal(String(stored.admin_id), ADMIN_ID);
  assert.deepEqual(stored.old_value, { tobacco_compliance: { buyer_type: 'unknown', licenses: [] } });
  assert.deepEqual(stored.new_value, after);
  assert.equal(stored.details, 'integration commit');
  assert.equal(stored.ip, '127.0.0.1');
  assert.ok(stored.created_at instanceof Date);
});

test('REAL: abort rolls back the business write and the audit record together', { skip: SKIP }, async () => {
  const entityId = new mongoose.Types.ObjectId();

  await assert.rejects(
    () =>
      inTransaction(async (session) => {
        await business().insertOne({ _id: entityId }, { session });
        await writeAuditLogInTransaction(session, {
          action: 'it_abort',
          entityType: 'Customer',
          entityId,
          adminId: ADMIN_ID,
          after: { buyer_type: 'retailer' },
        });
        throw new Error('caller failed after audit write');
      }),
    /caller failed after audit write/
  );

  assert.equal(await business().countDocuments({ _id: entityId }), 0);
  assert.equal(await AuditLog.countDocuments({ entity_id: String(entityId) }), 0);
});

test('REAL: a refused audit entry aborts the business write', { skip: SKIP }, async () => {
  const entityId = new mongoose.Types.ObjectId();

  await assert.rejects(
    () =>
      inTransaction(async (session) => {
        await business().insertOne({ _id: entityId }, { session });
        await writeAuditLogInTransaction(session, {
          action: 'it_refused',
          entityType: 'Vendor',
          entityId,
          adminId: ADMIN_ID,
          after: { bank_details: { account_number: '1' } },
        });
      }),
    (err: unknown) => err instanceof AuditLogWriteError
  );

  assert.equal(await business().countDocuments({ _id: entityId }), 0);
  assert.equal(await AuditLog.countDocuments({ entity_id: String(entityId) }), 0);
});

test('REAL transaction, STUBBED audit insert failure: the business write is rolled back', { skip: SKIP }, async () => {
  const entityId = new mongoose.Types.ObjectId();
  const failure = new Error('audit insert failed');
  mock.method(AuditLog, 'create', async () => {
    throw failure;
  });

  await assert.rejects(
    () =>
      inTransaction(async (session) => {
        await business().insertOne({ _id: entityId }, { session });
        await writeAuditLogInTransaction(session, {
          action: 'it_insert_failure',
          entityType: 'Customer',
          entityId,
          adminId: ADMIN_ID,
        });
      }),
    (err: unknown) => err === failure
  );
  mock.restoreAll();

  assert.equal(await business().countDocuments({ _id: entityId }), 0);
  assert.equal(await AuditLog.countDocuments({ entity_id: String(entityId) }), 0);
});

test('REAL: a session without a started transaction is refused and nothing is written', { skip: SKIP }, async () => {
  const entityId = new mongoose.Types.ObjectId();
  const session = await mongoose.startSession();
  try {
    await assert.rejects(
      () =>
        writeAuditLogInTransaction(session, {
          action: 'it_no_transaction',
          entityType: 'Customer',
          entityId,
          adminId: ADMIN_ID,
        }),
      (err: unknown) => err instanceof AuditLogWriteError && /no active transaction/.test(err.message)
    );
  } finally {
    await session.endSession();
  }

  assert.equal(await AuditLog.countDocuments({ entity_id: String(entityId) }), 0);
});

test('REAL: a session whose transaction already committed is refused', { skip: SKIP }, async () => {
  const entityId = new mongoose.Types.ObjectId();
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await business().insertOne({ _id: entityId }, { session });
    await session.commitTransaction();

    await assert.rejects(
      () =>
        writeAuditLogInTransaction(session, {
          action: 'it_after_commit',
          entityType: 'Customer',
          entityId,
          adminId: ADMIN_ID,
        }),
      (err: unknown) => err instanceof AuditLogWriteError && /no active transaction/.test(err.message)
    );
  } finally {
    await session.endSession();
  }

  assert.equal(await AuditLog.countDocuments({ entity_id: String(entityId) }), 0);
});
