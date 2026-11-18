/**
 * Wholesale tax snapshot persistence against a disposable local replica set.
 *
 * Skipped unless COMPLIANCE_TEST_MONGODB_URI points at localhost.
 * The test creates and drops its own database. It does not read MONGODB_URI.
 *
 * Run with:
 *     COMPLIANCE_TEST_MONGODB_URI='mongodb://127.0.0.1:27966/?replicaSet=rsSnap1' \
 *       npx tsx --test src/routes/wholesaleTaxSnapshot.integration.test.ts
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice';
import SalesTaxExemption from '../models/SalesTaxExemption';
import { createWholesaleInvoiceWithInventory, convertQuotationWithInventory } from '../services/wholesaleInvoiceInventoryService';
import { inheritLineTaxFromProduct } from '../utils/invoiceLineTax';
import { attachWholesaleTaxSnapshots, buildWholesaleTaxSnapshot } from '../utils/wholesaleTaxSnapshot';

const URI = process.env.COMPLIANCE_TEST_MONGODB_URI?.trim() || '';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DB_NAME = `wholesale_tax_snapshot_${randomBytes(4).toString('hex')}`;

function localUri(uri: string): boolean {
  const match = uri.match(/^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/);
  if (!match) return false;
  return match[1].split(',').every((hostPort) => LOCAL_HOSTS.has(hostPort.replace(/:\d+$/, '').toLowerCase()));
}

const skip = !URI || !localUri(URI);
const GST_ID = new mongoose.Types.ObjectId();
const PRODUCT_ID = new mongoose.Types.ObjectId();
const CUSTOMER_ID = new mongoose.Types.ObjectId();

before(async () => {
  if (skip) return;
  await mongoose.connect(URI, { dbName: DB_NAME, autoIndex: false, autoCreate: false });
  assert.equal(mongoose.connection.name, DB_NAME);
  const hello = await mongoose.connection.db!.command({ hello: 1 });
  assert.equal(typeof hello.setName, 'string');
  assert.match(String(hello.me), /^(127\.0\.0\.1|localhost|\[::1])/);
  await Invoice.collection.createIndex({ invoice_number: 1 }, { unique: true, name: 'invoice_number_1' });
});

after(async () => {
  if (skip || mongoose.connection.readyState !== 1) return;
  if (mongoose.connection.name === DB_NAME) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});

test('a failed invoice insert rolls the snapshot back with the invoice', { skip: skip ? 'set COMPLIANCE_TEST_MONGODB_URI to a local replica set' : false }, async () => {
  const kept = {
    invoice_number: `SNAP-KEEP-${DB_NAME}`,
    invoice_type: 'invoice',
    source: 'WHOLESALE' as const,
    payment_status: 'unpaid',
    total_amount: 10,
    tax_amount: 0,
    subtotal_amount: 10,
    items: [{
      product_name: 'Kept',
      quantity: 1,
      price: 10,
      subtotal: 10,
      tax_snapshot: { version: 1, posted_tax_cents: 0, capture_event: 'create' },
    }],
  };
  await createWholesaleInvoiceWithInventory(kept);
  await assert.rejects(() =>
    createWholesaleInvoiceWithInventory({
      ...kept,
      items: [{
        product_name: 'Rolled back',
        quantity: 1,
        price: 10,
        subtotal: 10,
        tax_snapshot: { version: 1, posted_tax_cents: 99, capture_event: 'should-not-persist' },
      }],
    })
  );
  const docs = await Invoice.find({ invoice_number: kept.invoice_number }).lean();
  const keptSnap = docs[0].items?.[0].tax_snapshot as { capture_event?: string } | undefined;
  assert.equal(docs.length, 1);
  assert.equal(keptSnap?.capture_event, 'create');
  assert.notEqual(keptSnap?.capture_event, 'should-not-persist');
});

test('quotation conversion stores a new invoice snapshot and leaves the quotation unchanged', { skip: skip ? 'set COMPLIANCE_TEST_MONGODB_URI to a local replica set' : false }, async () => {
  const product = { name: 'ABC', tax_type_id: { _id: GST_ID, name: 'GST', rate: 18, rate_type: 'percent' } };
  const line = {
    product_id: PRODUCT_ID,
    product_name: 'ABC',
    quantity: 1,
    price: 10,
    subtotal: 10,
    ...inheritLineTaxFromProduct(product, 10),
  };
  const estimate = buildWholesaleTaxSnapshot({
    line,
    product,
    customerExempt: false,
    documentType: 'quotation',
    captureEvent: 'create',
    capturedAt: new Date('2026-11-18T00:00:00.000Z'),
  });
  const quote = await Invoice.create({
    invoice_number: `SNAP-Q-${DB_NAME}`,
    invoice_type: 'quotation',
    source: 'WHOLESALE',
    payment_status: 'unpaid',
    customer_id: CUSTOMER_ID,
    total_amount: 11.8,
    tax_amount: 1.8,
    subtotal_amount: 10,
    items: [{ ...line, tax_snapshot: estimate }],
  });
  const stamped = attachWholesaleTaxSnapshots({
    mode: 'convert',
    items: [{ ...line }],
    existingItems: quote.items || [],
    documentType: 'invoice',
    documentTax: 1.8,
    estimateDocumentId: quote._id.toString(),
    capturedAt: new Date('2026-11-19T00:00:00.000Z'),
  });
  const invoice = await convertQuotationWithInventory({
    quoteId: quote._id,
    invoiceNumber: `SNAP-I-${DB_NAME}`,
    invoiceFields: {
      invoice_number: `SNAP-I-${DB_NAME}`,
      invoice_type: 'invoice',
      source: 'WHOLESALE',
      payment_status: 'unpaid',
      customer_id: CUSTOMER_ID,
      total_amount: 11.8,
      tax_amount: 1.8,
      subtotal_amount: 10,
      items: stamped.items,
      tax_reconciliation: stamped.tax_reconciliation,
    },
  });
  const savedQuote = await Invoice.findById(quote._id).lean();
  const quoteSnap = savedQuote?.items?.[0].tax_snapshot as { role?: string; capture_event?: string; rate_percent_points?: number } | undefined;
  assert.equal(savedQuote?.invoice_type, 'quotation');
  assert.equal(quoteSnap?.role, 'estimate');
  assert.equal(quoteSnap?.capture_event, 'create');
  assert.equal(quoteSnap?.rate_percent_points, 18);
  assert.equal(savedQuote?.items?.[0].tax_amount, 1.8);
  assert.equal(savedQuote?.shipping_type, `converted:SNAP-I-${DB_NAME}`);
  const savedInvoice = await Invoice.findById(invoice._id).lean();
  const invoiceSnap = savedInvoice?.items?.[0].tax_snapshot as {
    role?: string;
    capture_event?: string;
    product_reread?: boolean;
    estimate_document_id?: string;
  } | undefined;
  assert.equal(invoiceSnap?.role, 'transaction');
  assert.equal(invoiceSnap?.capture_event, 'quotation_conversion');
  assert.equal(invoiceSnap?.product_reread, false);
  assert.equal(invoiceSnap?.estimate_document_id, quote._id.toString());
  assert.equal(savedInvoice?.items?.[0].tax_amount, 1.8);
  assert.equal(savedInvoice?.inventory_applied, false);
});

test('an approved exemption row is not consulted and is not modified', { skip: skip ? 'set COMPLIANCE_TEST_MONGODB_URI to a local replica set' : false }, async () => {
  const exemption = await SalesTaxExemption.create({
    customer_id: CUSTOMER_ID,
    certificate_number: 'QA-SNAP-1',
    certificate_key: 'QA-SNAP-1',
    status: 'approved',
  });
  const before = exemption.toObject();
  const product = { name: 'ABC', tax_type_id: { _id: GST_ID, name: 'GST', rate: 18, rate_type: 'percent' } };
  const line = {
    product_id: PRODUCT_ID,
    product_name: 'ABC',
    quantity: 1,
    price: 10,
    subtotal: 10,
    ...inheritLineTaxFromProduct(product, 10),
  };
  const stamped = attachWholesaleTaxSnapshots({
    mode: 'create',
    items: [line],
    productsById: new Map([[String(PRODUCT_ID), product]]),
    customerExempt: false,
    documentType: 'invoice',
    documentTax: line.tax_amount,
  });
  assert.equal(stamped.items[0].tax_snapshot?.certificate_decision, 'not_consulted');
  assert.equal(stamped.items[0].tax_snapshot?.money_decision, 'confirmed_taxable');
  assert.equal(stamped.items[0].tax_amount, 1.8);
  const after = await SalesTaxExemption.findById(exemption._id).lean();
  assert.equal(after?.status, 'approved');
  assert.equal(after?.certificate_number, before.certificate_number);
  assert.equal(await SalesTaxExemption.countDocuments({}), 1);
});

test('a stored legacy invoice is not given a snapshot', { skip: skip ? 'set COMPLIANCE_TEST_MONGODB_URI to a local replica set' : false }, async () => {
  const legacy = await Invoice.create({
    invoice_number: `SNAP-LEGACY-${DB_NAME}`,
    invoice_type: 'invoice',
    source: 'WHOLESALE',
    payment_status: 'unpaid',
    total_amount: 4,
    tax_amount: 0,
    subtotal_amount: 4,
    items: [{ product_id: PRODUCT_ID, product_name: 'Legacy', quantity: 1, price: 4, subtotal: 4 }],
  });
  const reloaded = await Invoice.findById(legacy._id).lean();
  assert.equal(reloaded?.items?.[0].tax_snapshot, undefined);
  assert.equal(reloaded?.tax_reconciliation, undefined);
  assert.equal(reloaded?.tax_amount, 0);
  assert.equal(reloaded?.total_amount, 4);
});
