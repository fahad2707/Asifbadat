/**
 * Active exemption index migration against a disposable local replica set.
 *
 * Skipped unless COMPLIANCE_TEST_MONGODB_URI points at localhost.
 * Each test uses its own database. MONGODB_URI is not read by the migration.
 *
 * Run with:
 *     COMPLIANCE_TEST_MONGODB_URI='mongodb://127.0.0.1:27963/?replicaSet=rsIdx1' \
 *       npx tsx --test src/routes/exemptionIndexMigration.integration.test.ts \
 *       src/routes/exemptionDuplicate.integration.test.ts
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog';
import SalesTaxExemption, { ACTIVE_CUSTOMER_CERTIFICATE_INDEX } from '../models/SalesTaxExemption';
import { createExemptionDraft, DuplicateExemptionError } from '../services/exemptions/exemptionDraft';
import {
  ensureActiveExemptionIndex,
  ExemptionIndexConflictError,
  ExemptionIndexMismatchError,
} from '../services/exemptions/exemptionIndexMigration';

const execFileAsync = promisify(execFile);
const backendRoot = path.resolve(__dirname, '../..');
const URI = process.env.COMPLIANCE_TEST_MONGODB_URI?.trim() || '';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PREFIX = `exemption_index_mig_${randomBytes(4).toString('hex')}`;

function localUri(uri: string): boolean {
  const match = uri.match(/^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/);
  if (!match) return false;
  return match[1].split(',').every((hostPort) => LOCAL_HOSTS.has(hostPort.replace(/:\d+$/, '').toLowerCase()));
}

const skip = !URI || !localUri(URI);
const owned: string[] = [];

async function useDatabase(name: string) {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await mongoose.connect(URI, { dbName: name, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  assert.equal(mongoose.connection.name, name);
  if (!owned.includes(name)) owned.push(name);
  return mongoose.connection.db!;
}

before(async () => {
  if (skip) return;
  await mongoose.connect(URI, { dbName: 'admin', autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  const hello = await mongoose.connection.db!.command({ hello: 1 });
  assert.equal(typeof hello.setName, 'string');
  assert.match(String(hello.me), /^(127\.0\.0\.1|localhost|\[::1])/);
  await mongoose.disconnect();
});

after(async () => {
  if (mongoose.connection.readyState === 0 && owned.length === 0) return;
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(URI, { dbName: 'admin', autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  }
  for (const name of owned) {
    const client = mongoose.connection.getClient();
    const database = client.db(name);
    if (database.databaseName === name && name.startsWith(PREFIX)) await database.dropDatabase();
  }
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

test('migration creates the partial unique index and a second run leaves it', { skip: skip ? 'set COMPLIANCE_TEST_MONGODB_URI to a local replica set' : false }, async () => {
  const name = `${PREFIX}_create`;
  const database = await useDatabase(name);
  const unrelated = await database.collection('products').insertOne({ sku: 'KEEP-1', stock_quantity: 40, price: 10 });
  const invoice = await database.collection('invoices').insertOne({ invoice_number: 'KEEP-INV', total: 106 });
  const preview = await ensureActiveExemptionIndex(SalesTaxExemption.collection, { apply: false });
  assert.equal(preview.outcome, 'preflight_only');
  assert.equal((await SalesTaxExemption.collection.indexes().catch(() => [])).some((index) => index.name === 'active_customer_certificate'), false);
  const first = await ensureActiveExemptionIndex(SalesTaxExemption.collection, { apply: true });
  const second = await ensureActiveExemptionIndex(SalesTaxExemption.collection, { apply: true });
  assert.equal(first.outcome, 'created');
  assert.equal(second.outcome, 'already_present');
  const indexes = await SalesTaxExemption.collection.indexes();
  const created = indexes.find((index) => index.name === 'active_customer_certificate');
  assert.ok(created);
  assert.equal(created.unique, true);
  assert.deepEqual(created.key, { customer_id: 1, certificate_key: 1 });
  assert.deepEqual(created.partialFilterExpression, ACTIVE_CUSTOMER_CERTIFICATE_INDEX.options.partialFilterExpression);
  const product = await database.collection('products').findOne({ _id: unrelated.insertedId });
  const storedInvoice = await database.collection('invoices').findOne({ _id: invoice.insertedId });
  assert.equal(product?.sku, 'KEEP-1');
  assert.equal(product?.stock_quantity, 40);
  assert.equal(product?.price, 10);
  assert.equal(storedInvoice?.invoice_number, 'KEEP-INV');
  assert.equal(storedInvoice?.total, 106);
  assert.equal(await database.collection('products').countDocuments(), 1);
  assert.equal(await database.collection('invoices').countDocuments(), 1);
});

test('conflicts stop index creation and leave both exemption rows unchanged', { skip: skip ? 'set COMPLIANCE_TEST_MONGODB_URI to a local replica set' : false }, async () => {
  const name = `${PREFIX}_conflict`;
  const database = await useDatabase(name);
  const customerId = new mongoose.Types.ObjectId();
  await SalesTaxExemption.collection.insertMany([
    { customer_id: customerId, certificate_number: 'QA-SAME', certificate_key: 'QA-SAME', status: 'draft' },
    { customer_id: customerId, certificate_number: 'qa-same', certificate_key: 'QA-SAME', status: 'approved' },
    { customer_id: customerId, certificate_number: 'QA-OLD', certificate_key: 'QA-OLD', status: 'rejected' },
  ]);
  const before = await SalesTaxExemption.collection.find({}, { projection: { certificate_key: 1, status: 1, certificate_number: 1 } }).sort({ _id: 1 }).toArray();
  await assert.rejects(
    () => ensureActiveExemptionIndex(SalesTaxExemption.collection, { apply: true }),
    (error: unknown) => {
      assert.ok(error instanceof ExemptionIndexConflictError);
      assert.equal(error.conflicts.length, 1);
      assert.equal(error.conflicts[0]?.certificateKey, 'QA-SAME');
      assert.equal(error.conflicts[0]?.ids.length, 2);
      return true;
    }
  );
  const names = (await SalesTaxExemption.collection.indexes()).map((index) => index.name);
  assert.equal(names.includes('active_customer_certificate'), false);
  const after = await SalesTaxExemption.collection.find({}, { projection: { certificate_key: 1, status: 1, certificate_number: 1 } }).sort({ _id: 1 }).toArray();
  assert.deepEqual(after, before);
  assert.equal(await database.collection('salestaxexemptions').countDocuments(), 3);
});

test('legacy key warnings do not block the index or change the rows', { skip: skip ? 'set COMPLIANCE_TEST_MONGODB_URI to a local replica set' : false }, async () => {
  const name = `${PREFIX}_warnings`;
  const database = await useDatabase(name);
  const customerA = new mongoose.Types.ObjectId();
  const customerB = new mongoose.Types.ObjectId();
  await SalesTaxExemption.collection.insertMany([
    { customer_id: customerA, certificate_number: 'ABC-123', certificate_key: 'ABC-123', status: 'approved' },
    { customer_id: customerA, certificate_number: 'abc-123', certificate_key: 'abc-123', status: 'draft' },
    { customer_id: customerA, status: 'pending_review' },
    { customer_id: customerB, certificate_number: 'abc-123', certificate_key: 'abc-123', status: 'approved' },
    { customer_id: customerA, certificate_number: 'OLD', status: 'rejected' },
  ]);
  const before = await database.collection('salestaxexemptions').find().sort({ _id: 1 }).toArray();
  const preview = await ensureActiveExemptionIndex(SalesTaxExemption.collection, { apply: false });
  assert.equal(preview.outcome, 'preflight_only');
  assert.equal(preview.warnings.missingCertificateKey.count, 2);
  assert.equal(preview.warnings.missingCertificateKey.activeCount, 1);
  assert.equal(preview.warnings.caseVariantGroups.length, 1);
  assert.deepEqual(preview.warnings.caseVariantGroups[0]?.storedKeys, ['ABC-123', 'abc-123']);
  const created = await ensureActiveExemptionIndex(SalesTaxExemption.collection, { apply: true });
  assert.equal(created.outcome, 'created');
  const named = (await SalesTaxExemption.collection.indexes()).find((index) => index.name === 'active_customer_certificate');
  assert.equal(named?.unique, true);
  const after = await database.collection('salestaxexemptions').find().sort({ _id: 1 }).toArray();
  assert.deepEqual(after, before);
});

test('a differently defined index with the same name is not dropped', { skip: skip ? 'set COMPLIANCE_TEST_MONGODB_URI to a local replica set' : false }, async () => {
  const name = `${PREFIX}_mismatch`;
  await useDatabase(name);
  await SalesTaxExemption.collection.createIndex(
    { customer_id: 1 },
    { name: 'active_customer_certificate', unique: true }
  );
  await assert.rejects(
    () => ensureActiveExemptionIndex(SalesTaxExemption.collection, { apply: true }),
    ExemptionIndexMismatchError
  );
  const indexes = await SalesTaxExemption.collection.indexes();
  const named = indexes.find((index) => index.name === 'active_customer_certificate');
  assert.deepEqual(named?.key, { customer_id: 1 });
  assert.equal(named?.partialFilterExpression, undefined);
});

test('duplicate policy holds after the migration, including replacement and a rejected duplicate', { skip: skip ? 'set COMPLIANCE_TEST_MONGODB_URI to a local replica set' : false }, async () => {
  const name = `${PREFIX}_policy`;
  await useDatabase(name);
  await ensureActiveExemptionIndex(SalesTaxExemption.collection, { apply: true });
  const customerA = new mongoose.Types.ObjectId();
  const customerB = new mongoose.Types.ObjectId();
  const admin = new mongoose.Types.ObjectId();
  const first = await createWithRetry({
    customerId: customerA,
    certificateNumber: 'QA-CERT-1',
    exemptionType: 'resale',
    adminId: admin,
  });
  const auditsAfterFirst = await AuditLog.countDocuments({ action: 'sales_tax_exemption_draft_created' });
  await assert.rejects(
    () => createWithRetry({ customerId: customerA, certificateNumber: 'qa-cert-1', exemptionType: 'other', adminId: admin }),
    DuplicateExemptionError
  );
  assert.equal(await SalesTaxExemption.countDocuments({ customer_id: customerA, certificate_key: 'QA-CERT-1' }), 1);
  assert.equal(await AuditLog.countDocuments({ action: 'sales_tax_exemption_draft_created' }), auditsAfterFirst);

  const concurrent = await Promise.allSettled([
    createWithRetry({ customerId: customerA, certificateNumber: 'QA-CONCURRENT', exemptionType: 'resale', adminId: admin }),
    createWithRetry({ customerId: customerA, certificateNumber: 'qa-concurrent', exemptionType: 'resale', adminId: admin }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((result) => result.status === 'rejected' && result.reason instanceof DuplicateExemptionError).length, 1);
  assert.equal(await SalesTaxExemption.countDocuments({ certificate_key: 'QA-CONCURRENT' }), 1);

  await createWithRetry({ customerId: customerA, certificateNumber: 'QA-CERT-2', exemptionType: 'resale', adminId: admin });
  await createWithRetry({ customerId: customerB, certificateNumber: 'QA-CERT-1', exemptionType: 'resale', adminId: admin });
  assert.equal(await SalesTaxExemption.countDocuments({ certificate_key: 'QA-CERT-1' }), 2);

  for (const status of ['rejected', 'revoked', 'expired'] as const) {
    const certificateNumber = `QA-${status.toUpperCase()}`;
    const original = await createWithRetry({
      customerId: customerA,
      certificateNumber,
      exemptionType: 'resale',
      adminId: admin,
    });
    await SalesTaxExemption.updateOne({ _id: original.id }, { status });
    const replacement = await createWithRetry({
      customerId: customerA,
      certificateNumber,
      exemptionType: 'resale',
      adminId: admin,
    });
    assert.equal(replacement.status, 'draft');
    assert.equal(await SalesTaxExemption.countDocuments({ customer_id: customerA, certificate_key: certificateNumber, status: 'draft' }), 1);
    assert.equal(await SalesTaxExemption.countDocuments({ _id: original.id, status }), 1);
  }
  assert.equal(String(first.id).length > 0, true);
});

test('the command ignores MONGODB_URI and can be applied twice', { skip: skip ? 'set COMPLIANCE_TEST_MONGODB_URI to a local replica set' : false }, async () => {
  const markerName = `${PREFIX}_marker`;
  const targetName = `${PREFIX}_cli`;
  const markerDb = await useDatabase(markerName);
  await markerDb.collection('products').insertOne({ sku: 'MARKER', stock_quantity: 7 });
  const hello = await mongoose.connection.db!.command({ hello: 1 });
  const host = String(hello.me);
  const refused = await execFileAsync('npx', ['tsx', 'src/db/ensure-active-exemption-index.ts'], {
    cwd: backendRoot,
    env: { ...process.env, MONGODB_URI: `${URI.replace(/\/$/, '')}/${markerName}`, EXEMPTION_INDEX_MONGODB_URI: '' },
    timeout: 15000,
  }).then(() => ({ code: 0, stderr: '' }), (error: { code?: number; stderr?: string }) => ({ code: error.code ?? 1, stderr: String(error.stderr ?? '') }));
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /MONGODB_URI is not used/);
  assert.equal(await markerDb.collection('products').countDocuments({ sku: 'MARKER', stock_quantity: 7 }), 1);
  assert.equal(await markerDb.collection('salestaxexemptions').countDocuments().catch(() => 0), 0);

  const args = [
    'tsx',
    'src/db/ensure-active-exemption-index.ts',
    `--confirm-database=${targetName}`,
    `--confirm-host=${host}`,
  ];
  const env = { ...process.env, EXEMPTION_INDEX_MONGODB_URI: URI, MONGODB_URI: `${URI.replace(/\/$/, '')}/${markerName}` };
  const applied = await execFileAsync('npx', [...args, '--apply'], { cwd: backendRoot, env, timeout: 20000 });
  assert.match(applied.stdout, /"outcome":"created"/);
  const repeated = await execFileAsync('npx', [...args, '--apply'], { cwd: backendRoot, env, timeout: 20000 });
  assert.match(repeated.stdout, /"outcome":"already_present"/);
  owned.push(targetName);
  const target = mongoose.connection.getClient().db(targetName);
  const indexes = await target.collection('salestaxexemptions').indexes();
  const created = indexes.find((index) => index.name === 'active_customer_certificate');
  assert.equal(created?.unique, true);
  assert.deepEqual(created?.key, { customer_id: 1, certificate_key: 1 });
  assert.equal(await markerDb.collection('products').countDocuments({ sku: 'MARKER', stock_quantity: 7 }), 1);
});
