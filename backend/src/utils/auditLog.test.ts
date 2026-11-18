/**
 * Transaction-bound AuditLog write contract — MOCKED session, no Mongo connection.
 *
 * These tests prove what the helper passes to AuditLog.create and when it
 * refuses to write. They do NOT prove MongoDB rollback; that is covered by
 * auditLog.integration.test.ts against a real replica set.
 *
 * Run with:
 *     npx tsx --test src/utils/auditLog.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog';
import {
  AuditLogWriteError,
  writeAuditLogInTransaction,
  type TransactionalAuditEntry,
} from './auditLog';

const ADMIN_ID = '64b0000000000000000a0001';
const CUSTOMER_ID = '64b0000000000000000c0001';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'audit helper tests must not open a MongoDB connection');
}

function createFakeSession(opts: { inTransaction?: boolean; hasEnded?: boolean } = {}) {
  return {
    hasEnded: opts.hasEnded ?? false,
    inTransaction: mock.fn(() => opts.inTransaction ?? true),
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
}

function asSession(session: unknown): mongoose.ClientSession {
  return session as mongoose.ClientSession;
}

type CapturedCreate = {
  calls: Array<{ docs: Record<string, unknown>[]; options: Record<string, unknown> | undefined }>;
};

function stubCreate(): CapturedCreate {
  const captured: CapturedCreate = { calls: [] };
  mock.method(AuditLog, 'create', async (docs: unknown, options?: unknown) => {
    const list = docs as Record<string, unknown>[];
    captured.calls.push({ docs: list, options: options as Record<string, unknown> | undefined });
    return list.map((doc) => ({ ...doc, _id: new mongoose.Types.ObjectId() }));
  });
  return captured;
}

function baseEntry(overrides: Partial<TransactionalAuditEntry> = {}): TransactionalAuditEntry {
  return {
    action: 'customer_tobacco_compliance_update',
    entityType: 'Customer',
    entityId: CUSTOMER_ID,
    adminId: ADMIN_ID,
    before: { buyer_type: 'unknown' },
    after: { buyer_type: 'retailer' },
    details: 'Buyer type changed',
    ip: '203.0.113.7',
    ...overrides,
  };
}

async function assertRefused(run: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof AuditLogWriteError, `expected AuditLogWriteError, got ${String(err)}`);
    assert.match(err.message, pattern);
    return true;
  });
}

test('writes one audit record through AuditLog.create using the supplied session', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();
  const session = createFakeSession();

  const record = await writeAuditLogInTransaction(asSession(session), baseEntry());

  assert.equal(captured.calls.length, 1);
  assert.equal(captured.calls[0].docs.length, 1);
  assert.ok(record._id, 'the created record is returned to the caller');
});

test('the session passed to AuditLog.create is the caller’s session object, not a copy or a new one', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();
  const startSession = mock.method(mongoose, 'startSession', async () => {
    throw new Error('helper must not start its own session');
  });
  const session = createFakeSession();
  const otherSession = createFakeSession();

  await writeAuditLogInTransaction(asSession(session), baseEntry());

  const options = captured.calls[0].options;
  assert.ok(options, 'create must receive options');
  assert.deepEqual(Object.keys(options), ['session']);
  assert.strictEqual(options.session, session);
  assert.notStrictEqual(options.session, otherSession);
  assert.equal(startSession.mock.callCount(), 0);
});

test('helper does not start, commit, abort or end the caller’s transaction', async () => {
  assertNoMongoConnection();
  stubCreate();
  const session = createFakeSession();

  await writeAuditLogInTransaction(asSession(session), baseEntry());

  assert.equal(session.startTransaction.mock.callCount(), 0);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(session.abortTransaction.mock.callCount(), 0);
  assert.equal(session.endSession.mock.callCount(), 0);
});

test('actor, entity, action, before/after, details and ip are persisted on existing schema fields', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await writeAuditLogInTransaction(asSession(createFakeSession()), baseEntry());

  const doc = captured.calls[0].docs[0];
  assert.ok(doc.admin_id instanceof mongoose.Types.ObjectId);
  assert.equal(String(doc.admin_id), ADMIN_ID);
  assert.equal(doc.action, 'customer_tobacco_compliance_update');
  assert.equal(doc.entity_type, 'Customer');
  assert.equal(doc.entity_id, CUSTOMER_ID);
  assert.deepEqual(doc.old_value, { buyer_type: 'unknown' });
  assert.deepEqual(doc.new_value, { buyer_type: 'retailer' });
  assert.equal(doc.details, 'Buyer type changed');
  assert.equal(doc.ip, '203.0.113.7');
  assert.deepEqual(
    Object.keys(doc).sort(),
    ['action', 'admin_id', 'details', 'entity_id', 'entity_type', 'ip', 'new_value', 'old_value']
  );
});

test('an ObjectId entity id is stored as its string form', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await writeAuditLogInTransaction(
    asSession(createFakeSession()),
    baseEntry({ entityId: new mongoose.Types.ObjectId(CUSTOMER_ID) })
  );

  assert.equal(captured.calls[0].docs[0].entity_id, CUSTOMER_ID);
});

test('nested objects, arrays, dates and ObjectIds in before/after are preserved', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();
  const reviewedBy = new mongoose.Types.ObjectId(ADMIN_ID);
  const expires = new Date('2027-02-28T00:00:00.000Z');
  const before = {
    tobacco_compliance: {
      buyer_type: 'unknown',
      licenses: [] as unknown[],
    },
  };
  const after = {
    tobacco_compliance: {
      buyer_type: 'retailer',
      licenses: [
        {
          license_type: 'example',
          license_number: 'EX-1',
          expiration_date: expires,
          review: { status: 'reviewed', reviewed_by: reviewedBy, flags: ['a', 'b'] },
        },
      ],
    },
  };

  await writeAuditLogInTransaction(asSession(createFakeSession()), baseEntry({ before, after }));

  const doc = captured.calls[0].docs[0];
  assert.deepEqual(doc.old_value, before);
  assert.deepEqual(doc.new_value, after);
  const storedLicense = (doc.new_value as typeof after).tobacco_compliance.licenses[0];
  assert.strictEqual(storedLicense.expiration_date, expires);
  assert.strictEqual(storedLicense.review.reviewed_by, reviewedBy);
});

test('the document the helper builds passes the real AuditLog schema unchanged', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();
  const after = { tobacco_compliance: { licenses: [{ license_number: 'EX-1', nested: { deep: [1, 2] } }] } };

  await writeAuditLogInTransaction(asSession(createFakeSession()), baseEntry({ after }));

  const model = new AuditLog(captured.calls[0].docs[0]);
  assert.equal(model.validateSync(), undefined);
  assert.equal(String(model.admin_id), ADMIN_ID);
  assert.equal(model.entity_id, CUSTOMER_ID);
  assert.deepEqual(model.toObject().new_value, after);
});

test('adminId null writes no actor; the helper never invents one', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await writeAuditLogInTransaction(asSession(createFakeSession()), baseEntry({ adminId: null }));

  assert.equal('admin_id' in captured.calls[0].docs[0], false);
});

test('omitted adminId is refused so a missing actor is never silent', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();
  const entry = baseEntry() as Partial<TransactionalAuditEntry>;
  delete entry.adminId;

  await assertRefused(
    () => writeAuditLogInTransaction(asSession(createFakeSession()), entry as TransactionalAuditEntry),
    /adminId must be passed explicitly/
  );
  assert.equal(captured.calls.length, 0);
});

test('an adminId that is not a valid id is refused, not dropped', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await assertRefused(
    () => writeAuditLogInTransaction(asSession(createFakeSession()), baseEntry({ adminId: 'not-an-admin-id' })),
    /not a valid admin id/
  );
  assert.equal(captured.calls.length, 0);
});

test('optional before, after, details and ip are omitted when absent', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await writeAuditLogInTransaction(
    asSession(createFakeSession()),
    baseEntry({ before: null, after: undefined, details: '   ', ip: null })
  );

  assert.deepEqual(
    Object.keys(captured.calls[0].docs[0]).sort(),
    ['action', 'admin_id', 'entity_id', 'entity_type']
  );
});

test('an AuditLog.create failure propagates to the caller as the original error', async () => {
  assertNoMongoConnection();
  const failure = new Error('audit insert failed');
  const create = mock.method(AuditLog, 'create', async () => {
    throw failure;
  });

  await assert.rejects(
    () => writeAuditLogInTransaction(asSession(createFakeSession()), baseEntry()),
    (err: unknown) => {
      assert.strictEqual(err, failure);
      return true;
    }
  );
  assert.equal(create.mock.callCount(), 1, 'no retry and no second write');
});

test('after a failed write the helper does not retry without the session', async () => {
  assertNoMongoConnection();
  const seenOptions: unknown[] = [];
  mock.method(AuditLog, 'create', async (_docs: unknown, options?: unknown) => {
    seenOptions.push(options);
    throw new Error('audit insert failed');
  });
  const session = createFakeSession();

  await assert.rejects(() => writeAuditLogInTransaction(asSession(session), baseEntry()));

  assert.equal(seenOptions.length, 1);
  assert.strictEqual((seenOptions[0] as { session: unknown }).session, session);
});

test('an empty create result is treated as a failed write', async () => {
  assertNoMongoConnection();
  mock.method(AuditLog, 'create', async () => []);

  await assertRefused(
    () => writeAuditLogInTransaction(asSession(createFakeSession()), baseEntry()),
    /returned no record/
  );
});

test('missing session is refused and nothing is written', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  for (const missing of [undefined, null, {}, 'session']) {
    await assertRefused(
      () => writeAuditLogInTransaction(asSession(missing), baseEntry()),
      /ClientSession is required/
    );
  }
  assert.equal(captured.calls.length, 0);
});

test('a session with no active transaction is refused and nothing is written', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();
  const session = createFakeSession({ inTransaction: false });

  await assertRefused(
    () => writeAuditLogInTransaction(asSession(session), baseEntry()),
    /no active transaction/
  );
  assert.equal(captured.calls.length, 0);
  assert.equal(session.startTransaction.mock.callCount(), 0, 'helper must not start one itself');
});

test('an ended session is refused and nothing is written', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await assertRefused(
    () => writeAuditLogInTransaction(asSession(createFakeSession({ hasEnded: true })), baseEntry()),
    /already ended/
  );
  assert.equal(captured.calls.length, 0);
});

test('missing action, entity type or entity id is refused and nothing is written', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();
  const session = asSession(createFakeSession());

  await assertRefused(() => writeAuditLogInTransaction(session, baseEntry({ action: '  ' })), /action is required/);
  await assertRefused(() => writeAuditLogInTransaction(session, baseEntry({ entityType: '' })), /entityType is required/);
  await assertRefused(() => writeAuditLogInTransaction(session, baseEntry({ entityId: '' })), /entityId is required/);
  assert.equal(captured.calls.length, 0);
});

test('snapshots carrying credentials or bank details are refused at any depth', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();
  const session = asSession(createFakeSession());
  const unsafe: Array<Record<string, unknown>> = [
    { password: 'x' },
    { password_hash: 'x' },
    { resetToken: 'x' },
    { api_key: 'x' },
    { otp: '123456' },
    { bank_details: { bank_name: 'x' } },
    { vendor: { payout: { account_number: '1' } } },
    { vendor: { payout: [{ ifsc: 'x' }] } },
    { Authorization: 'Bearer x' },
  ];

  for (const snapshot of unsafe) {
    await assertRefused(
      () => writeAuditLogInTransaction(session, baseEntry({ after: snapshot })),
      /credential or bank detail/
    );
    await assertRefused(
      () => writeAuditLogInTransaction(session, baseEntry({ before: snapshot })),
      /credential or bank detail/
    );
  }
  assert.equal(captured.calls.length, 0);
});

test('tobacco field names that merely contain a short sensitive word are accepted', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();
  const after = { otp_wholesaler: 'unknown', shipping_state: 'PA', license_number: 'EX-1', tobacco_class: 'otp' };

  await writeAuditLogInTransaction(asSession(createFakeSession()), baseEntry({ after }));

  assert.deepEqual(captured.calls[0].docs[0].new_value, after);
});

test('whole documents and other non-plain values are refused as snapshots', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();
  const session = asSession(createFakeSession());
  const hydrated = new AuditLog({ action: 'a', entity_type: 'Customer', entity_id: CUSTOMER_ID });
  const circular: Record<string, unknown> = { name: 'loop' };
  circular.self = circular;

  await assertRefused(
    () => writeAuditLogInTransaction(session, baseEntry({ after: hydrated as unknown as Record<string, unknown> })),
    /plain object of the changed fields/
  );
  await assertRefused(
    () => writeAuditLogInTransaction(session, baseEntry({ after: { nested: hydrated } })),
    /must be plain data/
  );
  await assertRefused(
    () => writeAuditLogInTransaction(session, baseEntry({ after: { file: Buffer.from('x') } })),
    /must be plain data/
  );
  await assertRefused(
    () => writeAuditLogInTransaction(session, baseEntry({ after: circular })),
    /circular reference/
  );
  assert.equal(captured.calls.length, 0);
});
