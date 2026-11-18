/**
 * Wholesale tax snapshot contract.
 *
 * Run with:
 *     npx tsx --test src/utils/wholesaleTaxSnapshot.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyLineTaxSnapshot, inheritLineTaxFromProduct, invoiceTaxTotals } from './invoiceLineTax';
import {
  attachWholesaleTaxSnapshots,
  buildWholesaleTaxSnapshot,
  postedTaxCentsFromLine,
  refreshWholesaleTaxSnapshot,
  STANDING_INCOMPLETE_REASONS,
} from './wholesaleTaxSnapshot';

const SRC = join(process.cwd(), 'src');
const GST_ID = '64b1c2d3e4f5a6b7c8d9e0f1';
const CAST_ID = '64b1c2d3e4f5a6b7c8d9e0f3';
const PRODUCT_A = '64c1c2d3e4f5a6b7c8d9e0a1';
const PRODUCT_B = '64c1c2d3e4f5a6b7c8d9e0a2';
const WHEN = new Date('2026-11-18T00:00:00.000Z');

const percentProduct = {
  name: 'ABC',
  tax_type_id: { _id: GST_ID, name: 'GST', rate: 18, rate_type: 'percent' },
};

function lineFrom(product: object, subtotal: number, customerExempt = false) {
  const tax = inheritLineTaxFromProduct(product, subtotal, { customerExempt });
  return {
    product_id: PRODUCT_A,
    product_name: 'ABC',
    quantity: 1,
    price: subtotal,
    subtotal,
    ...tax,
  };
}

test('explicit percent TaxType is confirmed taxable and uses the stored line tax', () => {
  const line = lineFrom(percentProduct, 4.99);
  assert.equal(line.tax_amount, 0.9);
  const snapshot = buildWholesaleTaxSnapshot({
    line,
    product: percentProduct,
    customerExempt: false,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  assert.equal(snapshot.money_decision, 'confirmed_taxable');
  assert.equal(snapshot.zero_confirmed, false);
  assert.equal(snapshot.rate_percent_points, 18);
  assert.equal(snapshot.posted_tax_cents, 90);
  assert.equal(snapshot.posted_tax_cents, postedTaxCentsFromLine(line.tax_amount));
  assert.equal(snapshot.certificate_decision, 'not_consulted');
  assert.equal(snapshot.certificate, null);
  assert.equal(snapshot.product_reread, false);
  assert.equal(snapshot.reporting_status, 'incomplete');
  assert.deepEqual(snapshot.incomplete_reasons, [...STANDING_INCOMPLETE_REASONS]);
});

test('explicit tax_type_id null is confirmed non-taxable', () => {
  const product = { name: 'XYZ', tax_type_id: null };
  const line = lineFrom(product, 7.5);
  const snapshot = buildWholesaleTaxSnapshot({
    line,
    product,
    customerExempt: false,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  assert.equal(line.tax_amount, 0);
  assert.equal(snapshot.money_decision, 'confirmed_non_taxable');
  assert.equal(snapshot.zero_confirmed, true);
  assert.equal(snapshot.posted_tax_cents, 0);
  assert.equal(snapshot.rate_percent_points, null);
  assert.equal(snapshot.tax_type.name, null);
});

test('missing tax_type_id stays incomplete and is not confirmed non-taxable', () => {
  const product = { name: 'Bare' };
  const line = lineFrom(product, 4.99);
  const snapshot = buildWholesaleTaxSnapshot({
    line,
    product,
    customerExempt: false,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  assert.equal(line.tax_amount, 0);
  assert.equal(line.tax_type_label, 'No Tax');
  assert.equal(snapshot.money_decision, 'incomplete');
  assert.equal(snapshot.zero_confirmed, false);
  assert.equal(snapshot.posted_tax_cents, 0);
  assert.equal(snapshot.incomplete_reasons[0], 'tax_assignment_missing');
});

test('unreadable TaxType stays incomplete', () => {
  const product = { name: 'ABC', tax_type_id: '64b1c2d3e4f5a6b7c8d9e0aa' };
  const line = lineFrom(product, 4.99);
  const snapshot = buildWholesaleTaxSnapshot({
    line,
    product,
    customerExempt: false,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  assert.equal(snapshot.money_decision, 'incomplete');
  assert.equal(snapshot.zero_confirmed, false);
  assert.equal(snapshot.incomplete_reasons[0], 'tax_type_unreadable');
  assert.equal(snapshot.tax_type.id, '64b1c2d3e4f5a6b7c8d9e0aa');
});

test('amount-based TaxType stays incomplete', () => {
  const product = { name: 'CAST item', tax_type_id: { _id: CAST_ID, name: 'CAST', rate: 2, rate_type: 'amount' } };
  const line = lineFrom(product, 10);
  const snapshot = buildWholesaleTaxSnapshot({
    line,
    product,
    customerExempt: false,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  assert.equal(line.tax_amount, 0);
  assert.equal(snapshot.money_decision, 'incomplete');
  assert.equal(snapshot.zero_confirmed, false);
  assert.equal(snapshot.incomplete_reasons[0], 'fixed_amount_tax_undefined');
  assert.equal(snapshot.tax_type.rate_type, 'amount');
  assert.equal(snapshot.rate_percent_points, null);
});

test('customer flag with a percent TaxType is customer_flag_zeroed and not a certificate', () => {
  const line = lineFrom(percentProduct, 10, true);
  const snapshot = buildWholesaleTaxSnapshot({
    line,
    product: percentProduct,
    customerExempt: true,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  assert.equal(line.tax_amount, 0);
  assert.equal(line.tax_rate, 18);
  assert.equal(snapshot.money_decision, 'customer_flag_zeroed');
  assert.equal(snapshot.customer_tax_exempt_flag, true);
  assert.equal(snapshot.zero_confirmed, false);
  assert.equal(snapshot.rate_percent_points, 18);
  assert.equal(snapshot.certificate_decision, 'not_consulted');
  assert.equal(snapshot.posted_tax_cents, postedTaxCentsFromLine(line.tax_amount));
});

test('customer flag with missing tax assignment does not become confirmed non-taxable', () => {
  const product = { name: 'Bare' };
  const line = lineFrom(product, 4, true);
  const snapshot = buildWholesaleTaxSnapshot({
    line,
    product,
    customerExempt: true,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  assert.equal(snapshot.money_decision, 'customer_flag_zeroed');
  assert.equal(snapshot.zero_confirmed, false);
  assert.equal(snapshot.incomplete_reasons[0], 'tax_assignment_missing');
  assert.equal(snapshot.certificate, null);
});

test('an approved certificate is not consulted or applied', () => {
  const snapshot = buildWholesaleTaxSnapshot({
    line: lineFrom(percentProduct, 10),
    product: percentProduct,
    customerExempt: false,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  assert.equal(snapshot.money_decision, 'confirmed_taxable');
  assert.equal(snapshot.posted_tax_cents, 180);
  assert.equal(snapshot.certificate_decision, 'not_consulted');
  assert.equal(snapshot.certificate, null);
  const source = readFileSync(join(SRC, 'utils/wholesaleTaxSnapshot.ts'), 'utf8');
  const route = readFileSync(join(SRC, 'routes/invoices.ts'), 'utf8');
  assert.equal(source.includes('SalesTaxExemption'), false);
  assert.equal(route.includes('SalesTaxExemption'), false);
});

test('product tax configuration changed after creation does not replace the snapshot', () => {
  const original = buildWholesaleTaxSnapshot({
    line: lineFrom(percentProduct, 10),
    product: percentProduct,
    customerExempt: false,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  const edited = applyLineTaxSnapshot(20, { ...lineFrom(percentProduct, 10) });
  const refreshed = refreshWholesaleTaxSnapshot(original, { ...edited, quantity: 2, price: 10, subtotal: 20 });
  assert.equal(edited.tax_amount, 3.6);
  assert.equal(refreshed.rate_percent_points, 18);
  assert.equal(refreshed.money_decision, 'confirmed_taxable');
  assert.equal(refreshed.capture_event, 'create');
  assert.equal(refreshed.captured_at, WHEN.toISOString());
  assert.equal(refreshed.posted_tax_cents, 360);
  assert.equal(refreshed.product_reread, false);
});

test('customer flag changed after creation does not replace the snapshot', () => {
  const original = buildWholesaleTaxSnapshot({
    line: lineFrom(percentProduct, 10, true),
    product: percentProduct,
    customerExempt: true,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  const refreshed = refreshWholesaleTaxSnapshot(original, { quantity: 2, price: 10, subtotal: 20, tax_amount: 0 });
  assert.equal(refreshed.customer_tax_exempt_flag, true);
  assert.equal(refreshed.money_decision, 'customer_flag_zeroed');
  assert.equal(refreshed.posted_tax_cents, 0);
  assert.equal(refreshed.capture_event, 'create');
});

test('editing an existing snapshotted line keeps the decision and matches the edited tax amount', () => {
  const created = lineFrom(percentProduct, 10);
  const stored = buildWholesaleTaxSnapshot({
    line: created,
    product: percentProduct,
    customerExempt: false,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  const edited = applyLineTaxSnapshot(4.99, created);
  const stamped = attachWholesaleTaxSnapshots({
    mode: 'edit',
    items: [{ ...created, quantity: 1, price: 4.99, subtotal: 4.99, ...edited }],
    existingItems: [{ ...created, tax_snapshot: stored }],
    productsById: new Map([[PRODUCT_A, { name: 'ABC', tax_type_id: { _id: GST_ID, name: 'GST', rate: 5, rate_type: 'percent' } }]]),
    customerExempt: true,
    documentType: 'invoice',
    documentTax: edited.tax_amount,
    capturedAt: new Date('2026-12-01T00:00:00.000Z'),
  });
  assert.equal(stamped.items[0].tax_amount, 0.9);
  assert.equal(stamped.items[0].tax_snapshot?.posted_tax_cents, 90);
  assert.equal(stamped.items[0].tax_snapshot?.rate_percent_points, 18);
  assert.equal(stamped.items[0].tax_snapshot?.customer_tax_exempt_flag, false);
  assert.equal(stamped.items[0].tax_snapshot?.captured_at, WHEN.toISOString());
});

test('a new line on a snapshotted invoice captures the current product', () => {
  const existing = lineFrom(percentProduct, 10);
  const stored = buildWholesaleTaxSnapshot({
    line: existing,
    product: percentProduct,
    customerExempt: false,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  const addedProduct = { name: 'New', tax_type_id: { _id: GST_ID, name: 'GST', rate: 6, rate_type: 'percent' } };
  const added = { ...lineFrom(addedProduct, 5), product_id: PRODUCT_B, product_name: 'New' };
  const stamped = attachWholesaleTaxSnapshots({
    mode: 'edit',
    items: [{ ...existing, tax_snapshot: stored }, added],
    existingItems: [{ ...existing, tax_snapshot: stored }],
    productsById: new Map([[PRODUCT_B, addedProduct]]),
    customerExempt: false,
    documentType: 'invoice',
    documentTax: existing.tax_amount + added.tax_amount,
    capturedAt: WHEN,
  });
  assert.equal(stamped.items[0].tax_snapshot?.capture_event, 'create');
  assert.equal(stamped.items[1].tax_snapshot?.capture_event, 'line_added');
  assert.equal(stamped.items[1].tax_snapshot?.rate_percent_points, 6);
  assert.equal(stamped.items[1].tax_snapshot?.posted_tax_cents, postedTaxCentsFromLine(added.tax_amount));
});

test('a legacy line is not given a snapshot', () => {
  const legacy = { product_id: PRODUCT_A, product_name: 'Old', quantity: 1, price: 10, subtotal: 10 };
  const stamped = attachWholesaleTaxSnapshots({
    mode: 'edit',
    items: [legacy],
    existingItems: [legacy],
    productsById: new Map([[PRODUCT_A, percentProduct]]),
    customerExempt: false,
    documentType: 'invoice',
    documentTax: 0,
    capturedAt: WHEN,
  });
  assert.equal(stamped.items[0].tax_snapshot, undefined);
  assert.equal(stamped.tax_reconciliation, undefined);
});

test('a legacy line that already has calculator tax is not backfilled', () => {
  const existing = lineFrom(percentProduct, 10);
  const stamped = attachWholesaleTaxSnapshots({
    mode: 'edit',
    items: [existing],
    existingItems: [existing],
    productsById: new Map([[PRODUCT_A, percentProduct]]),
    customerExempt: false,
    documentType: 'invoice',
    documentTax: existing.tax_amount,
    capturedAt: WHEN,
  });
  assert.equal(stamped.items[0].tax_snapshot, undefined);
  assert.equal(stamped.items[0].tax_amount, existing.tax_amount);
});

test('header tax above the line sum is recorded and not distributed', () => {
  const line = lineFrom(percentProduct, 10);
  const totals = invoiceTaxTotals([line], { usedLineTax: true, fallbackTaxAmount: 5 });
  assert.equal(totals.tax_amount, 5);
  const stamped = attachWholesaleTaxSnapshots({
    mode: 'create',
    items: [line],
    productsById: new Map([[PRODUCT_A, percentProduct]]),
    customerExempt: false,
    documentType: 'invoice',
    documentTax: totals.tax_amount,
    capturedAt: WHEN,
  });
  assert.equal(stamped.tax_reconciliation, 'header_exceeds_lines');
  assert.equal(stamped.items[0].tax_amount, 1.8);
  assert.equal(stamped.items[0].tax_snapshot?.posted_tax_cents, 180);
  assert.equal(stamped.items[0].tax_snapshot?.reporting_status, 'incomplete');
});

test('quotation snapshots are estimates and are excluded from sales reporting', () => {
  const line = lineFrom(percentProduct, 10);
  const stamped = attachWholesaleTaxSnapshots({
    mode: 'create',
    items: [line],
    productsById: new Map([[PRODUCT_A, percentProduct]]),
    customerExempt: false,
    documentType: 'quotation',
    documentTax: line.tax_amount,
    capturedAt: WHEN,
  });
  const snapshot = stamped.items[0].tax_snapshot;
  assert.equal(snapshot?.role, 'estimate');
  assert.equal(snapshot?.reporting, 'excluded');
  assert.equal(snapshot?.reporting_reason, 'quotations_are_not_sales');
  assert.equal(snapshot?.document_type, 'quotation');
  assert.equal(snapshot?.source, 'wholesale_invoice');
});

test('quotation conversion copies the stored decision and does not reread the product', () => {
  const line = lineFrom(percentProduct, 10);
  const estimate = buildWholesaleTaxSnapshot({
    line,
    product: percentProduct,
    customerExempt: false,
    documentType: 'quotation',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  const copied = applyLineTaxSnapshot(10, line);
  const stamped = attachWholesaleTaxSnapshots({
    mode: 'convert',
    items: [{ ...line, ...copied }],
    existingItems: [{ ...line, tax_snapshot: estimate }],
    productsById: new Map([[PRODUCT_A, { name: 'ABC', tax_type_id: { _id: GST_ID, name: 'GST', rate: 1, rate_type: 'percent' } }]]),
    documentType: 'invoice',
    documentTax: copied.tax_amount,
    estimateDocumentId: '64d1c2d3e4f5a6b7c8d9e0b1',
    capturedAt: new Date('2026-11-19T00:00:00.000Z'),
  });
  const snapshot = stamped.items[0].tax_snapshot;
  assert.equal(snapshot?.role, 'transaction');
  assert.equal(snapshot?.capture_event, 'quotation_conversion');
  assert.equal(snapshot?.product_reread, false);
  assert.equal(snapshot?.estimate_document_id, '64d1c2d3e4f5a6b7c8d9e0b1');
  assert.equal(snapshot?.rate_percent_points, 18);
  assert.equal(snapshot?.money_decision, 'confirmed_taxable');
  assert.equal(snapshot?.posted_tax_cents, postedTaxCentsFromLine(copied.tax_amount));
  assert.equal(estimate.role, 'estimate');
});

test('incomplete quotation conversion stays incomplete', () => {
  const product = { name: 'Bare' };
  const line = lineFrom(product, 8);
  const estimate = buildWholesaleTaxSnapshot({
    line,
    product,
    customerExempt: false,
    documentType: 'quotation',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  const stamped = attachWholesaleTaxSnapshots({
    mode: 'convert',
    items: [line],
    existingItems: [{ ...line, tax_snapshot: estimate }],
    productsById: new Map([[PRODUCT_A, percentProduct]]),
    documentType: 'invoice',
    documentTax: 0,
    estimateDocumentId: '64d1c2d3e4f5a6b7c8d9e0b2',
    capturedAt: WHEN,
  });
  assert.equal(stamped.items[0].tax_snapshot?.money_decision, 'incomplete');
  assert.equal(stamped.items[0].tax_snapshot?.zero_confirmed, false);
  assert.equal(stamped.items[0].tax_snapshot?.incomplete_reasons[0], 'tax_assignment_missing');
  assert.equal(stamped.items[0].tax_snapshot?.product_reread, false);
  assert.equal(stamped.items[0].tax_amount, 0);
});

test('snapshot cents follow the line tax amount even when that amount is not the percent math', () => {
  const line = { ...lineFrom(percentProduct, 10), tax_amount: 1.23 };
  const snapshot = buildWholesaleTaxSnapshot({
    line,
    product: percentProduct,
    customerExempt: false,
    documentType: 'invoice',
    captureEvent: 'create',
    capturedAt: WHEN,
  });
  assert.equal(snapshot.posted_tax_cents, 123);
  assert.notEqual(snapshot.posted_tax_cents, 180);
});

test('POS, online, and credit-memo production code do not take wholesale snapshots', () => {
  const pos = readFileSync(join(SRC, 'routes/pos.ts'), 'utf8');
  const online = readFileSync(join(SRC, 'routes/online-orders.ts'), 'utf8');
  const credit = readFileSync(join(SRC, 'modules/credit-memo/services/creditMemoFromInvoice.ts'), 'utf8');
  assert.equal(pos.includes('wholesaleTaxSnapshot'), false);
  assert.equal(pos.includes('tax_snapshot'), false);
  assert.equal(online.includes('wholesaleTaxSnapshot'), false);
  assert.equal(online.includes('tax_snapshot'), false);
  assert.equal(credit.includes('wholesaleTaxSnapshot'), false);
  assert.equal(credit.includes('tax_snapshot'), false);
});
