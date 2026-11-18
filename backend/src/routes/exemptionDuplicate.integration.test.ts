/**
 * Exemption duplicate protection against a disposable local replica set.
 *
 * Skipped unless COMPLIANCE_TEST_MONGODB_URI points at localhost.
 * The test creates and drops its own database. It does not read MONGODB_URI.
 *
 * Run with:
 *     COMPLIANCE_TEST_MONGODB_URI='mongodb://127.0.0.1:27961/?replicaSet=rsQa' \
 *       npx tsx --test src/routes/exemptionDuplicate.integration.test.ts
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog';
import SalesTaxExemption from '../models/SalesTaxExemption';
import { createExemptionDraft, DuplicateExemptionError } from '../services/exemptions/exemptionDraft';
import { ensureActiveExemptionIndex } from '../services/exemptions/exemptionIndexMigration';

const URI = process.env.COMPLIANCE_TEST_MONGODB_URI?.trim() || '';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DB_NAME = `compliance_exemption_it_${randomBytes(4).toString('hex')}`;

function localUri(uri: string): boolean {
  const match = uri.match(/^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/);
  if (!match) return false;
  return match[1].split(',').every((hostPort) => LOCAL_HOSTS.has(hostPort.replace(/:\d+$/, '').toLowerCase()));
}

const skip = !URI || !localUri(URI);

before(async () => {
  if (skip) return;
  await mongoose.connect(URI, { dbName: DB_NAME });
  assert.equal(mongoose.connection.name, DB_NAME);
  const hello = await mongoose.connection.db!.command({ hello: 1 });
  assert.equal(typeof hello.setName, 'string');
  assert.match(String(hello.me), /^(127\.0\.0\.1|localhost|\[::1])/);
  const created = await ensureActiveExemptionIndex(SalesTaxExemption.collection, { apply: true });
  assert.equal(created.outcome, 'created');
});

after(async () => {
  if (mongoose.connection.readyState === 0) return;
  if (mongoose.connection.name === DB_NAME) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

function transient(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: number; errorLabelSet?: Set<string> };
  return candidate.code === 24 || candidate.errorLabelSet?.has('TransientTransactionError') === true;
}

async function createWithRetry(input: Parameters<typeof createExemptionDraft>[0]) {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await createExemptionDraft(input);
    } catch (error) {
      last = error;
      if (!transient(error)) throw error;
    }
  }
  throw last;
}

test('identical sequential and concurrent exemption drafts conflict once', { skip: skip ? 'set COMPLIANCE_TEST_MONGODB_URI to a local replica set' : false }, async () => {
  const customerA = new mongoose.Types.ObjectId();
  const customerB = new mongoose.Types.ObjectId();
  const admin = new mongoose.Types.ObjectId();
  const first = await createWithRetry({
    customerId: customerA,
    certificateNumber: ' qa-cert-1 ',
    exemptionType: 'resale',
    effectiveOn: '2026-11-01',
    adminId: admin,
  });
  await assert.rejects(
    () => createWithRetry({
      customerId: customerA,
      certificateNumber: 'QA-CERT-1',
      exemptionType: 'government',
      effectiveOn: '2026-12-01',
      adminId: admin,
    }),
    DuplicateExemptionError
  );
  assert.equal(await SalesTaxExemption.countDocuments({ customer_id: customerA, certificate_key: 'QA-CERT-1' }), 1);
  assert.equal(await AuditLog.countDocuments({ action: 'sales_tax_exemption_draft_created', entity_id: String(first.id) }), 1);

  const concurrent = await Promise.allSettled([
    createWithRetry({ customerId: customerA, certificateNumber: 'QA-CONCURRENT', exemptionType: 'resale', adminId: admin }),
    createWithRetry({ customerId: customerA, certificateNumber: 'qa-concurrent', exemptionType: 'resale', adminId: admin }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((result) => result.status === 'rejected' && result.reason instanceof DuplicateExemptionError).length, 1);
  assert.equal(await SalesTaxExemption.countDocuments({ certificate_key: 'QA-CONCURRENT' }), 1);

  const otherCertificate = await createWithRetry({
    customerId: customerA,
    certificateNumber: 'QA-CERT-2',
    exemptionType: 'resale',
    adminId: admin,
  });
  const otherCustomer = await createWithRetry({
    customerId: customerB,
    certificateNumber: 'QA-CERT-1',
    exemptionType: 'resale',
    adminId: admin,
  });
  assert.notEqual(String(otherCertificate.id), String(first.id));
  assert.notEqual(String(otherCustomer.id), String(first.id));
  assert.equal(await SalesTaxExemption.countDocuments({ certificate_key: 'QA-CERT-1' }), 2);

  await SalesTaxExemption.updateOne({ _id: first.id }, { status: 'rejected' });
  const replacement = await createWithRetry({
    customerId: customerA,
    certificateNumber: 'QA-CERT-1',
    exemptionType: 'resale',
    adminId: admin,
  });
  assert.equal(replacement.status, 'draft');
  assert.equal(await SalesTaxExemption.countDocuments({ customer_id: customerA, certificate_key: 'QA-CERT-1', status: 'draft' }), 1);
});
