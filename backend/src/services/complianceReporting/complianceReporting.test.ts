/**
 * Compliance reporting rules. No database.
 *
 * Run with:
 *     npx tsx --test src/services/complianceReporting/complianceReporting.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toPreviewCsv } from './csvExport';
import { transitionReportingPeriod } from './periodWorkflow';
import { summarizeSalesTaxRecords } from './salesTaxAggregate';
import { assessRegisterDocument, filterTransactionRegister, pageRows } from './transactionRegister';
import { classifyInvoiceDocument, classifyLegacyOrder, classifyReceipt } from './sources';
import { buildRev772Preview, buildRev777Preview, type EstablishedPacks } from './tobaccoReports';

const cigarette = {
  tobaccoClass: 'cigarette' as const,
  stockUnit: 'pack' as const,
  packsPerStockUnit: 1,
  packSize: 20 as const,
  stamp: 'pennsylvania' as const,
};

test('quotations, POS slips, receipts, and legacy orders are not tax sales', () => {
  assert.equal(classifyInvoiceDocument({ invoice_type: 'quotation' }).includeInTaxPreview, false);
  assert.equal(classifyInvoiceDocument({ invoice_type: 'pos', source: 'POS' }).reason, 'pos_slip_is_not_a_second_sale');
  assert.equal(classifyReceipt().includeInTaxPreview, false);
  assert.equal(classifyLegacyOrder().includeInTaxPreview, false);
  assert.equal(classifyInvoiceDocument({ invoice_type: 'invoice', source: 'WHOLESALE' }).includeInTaxPreview, true);
});

test('a wholesale snapshot is summed and a missing snapshot is not turned into zero tax', () => {
  const summary = summarizeSalesTaxRecords({
    invoices: [
      {
        id: 'inv-complete',
        invoiceType: 'invoice',
        source: 'WHOLESALE',
        headerTax: 6,
        lines: [{ hasTaxableKey: true, taxable: true, subtotal: 100, taxAmount: 6 }],
      },
      {
        id: 'inv-gap',
        invoiceType: 'invoice',
        source: 'WHOLESALE',
        headerTax: 0,
        lines: [{ hasTaxableKey: false, subtotal: 50, taxAmount: 0 }],
      },
      {
        id: 'quote',
        invoiceType: 'quotation',
        source: 'WHOLESALE',
        lines: [{ hasTaxableKey: true, taxable: true, subtotal: 999, taxAmount: 99 }],
      },
      {
        id: 'slip',
        invoiceType: 'pos',
        source: 'POS',
        lines: [{ hasTaxableKey: true, taxable: true, subtotal: 20, taxAmount: 2 }],
      },
    ],
    legacyOrderCount: 3,
    receiptCount: 2,
  });
  assert.equal(summary.filingReady, false);
  assert.equal(summary.recordedTax.availability, 'recorded_preview');
  if (summary.recordedTax.availability === 'recorded_preview') assert.equal(summary.recordedTax.cents, 600);
  assert.equal(summary.taxable.availability, 'recorded_preview');
  if (summary.taxable.availability === 'recorded_preview') assert.equal(summary.taxable.cents, 10000);
  assert.equal(summary.excluded.quotations, 1);
  assert.equal(summary.excluded.posSlips, 1);
  assert.equal(summary.incompleteCount >= 1, true);
  assert.equal(summary.discrepancies.some((item) => item.id === 'inv-gap'), true);
});

test('POS line tax is recorded once and the taxable base stays unavailable', () => {
  const summary = summarizeSalesTaxRecords({
    posSales: [
      {
        id: 'sale-1',
        headerTax: 1.2,
        lines: [
          { tax: 0.6, price: 10, quantity: 1, discount: 0 },
          { tax: 0.6, price: 10, quantity: 1, discount: 0 },
        ],
      },
    ],
  });
  assert.equal(summary.recordedTax.availability, 'recorded_preview');
  if (summary.recordedTax.availability === 'recorded_preview') assert.equal(summary.recordedTax.cents, 120);
  assert.equal(summary.taxable.availability, 'unavailable');
});

function recordedPacks(value: EstablishedPacks, packs: number) {
  assert.equal(value.availability, 'recorded');
  if (value.availability === 'recorded') assert.equal(value.packs, packs);
}

function unavailablePacks(value: EstablishedPacks) {
  assert.equal(value.availability, 'unavailable');
}

test('REV-772 uses explicit pack conversions and refuses a missing close', () => {
  const balanced = buildRev772Preview([
    { id: 'open', movementType: 'opening', quantity: 10, ...cigarette },
    { id: 'in', movementType: 'receipt', quantity: 5, ...cigarette, packSize: 25, stockUnit: 'carton', packsPerStockUnit: 10 },
    { id: 'sold', movementType: 'sale', quantity: 4, ...cigarette },
    { id: 'close', movementType: 'closing', quantity: 56, ...cigarette },
  ]);
  assert.equal(balanced.filingReady, false);
  assert.equal(balanced.myPathLayoutVerified, false);
  recordedPacks(balanced.categories.opening, 10);
  recordedPacks(balanced.categories.receipts, 50);
  recordedPacks(balanced.categories.sales, 4);
  unavailablePacks(balanced.categories.supplierReturns);
  recordedPacks(balanced.buckets.pennsylvania20, 6);
  recordedPacks(balanced.buckets.pennsylvania25, 50);
  unavailablePacks(balanced.buckets.philadelphia20);
  recordedPacks(balanced.calculatedClosingPacks, 56);
  recordedPacks(balanced.statedClosingPacks, 56);
  recordedPacks(balanced.differencePacks, 0);
  assert.equal(balanced.status, 'preview');

  const missing = buildRev772Preview([
    {
      id: 'bad',
      movementType: 'sale',
      quantity: 1,
      tobaccoClass: 'cigarette',
      stockUnit: 'carton',
      packSize: 20,
      stamp: 'pennsylvania',
    },
  ]);
  assert.equal(missing.status, 'incomplete');
  assert.equal(missing.exceptions[0]?.reason, 'incomplete');
  assert.equal(missing.filingReady, false);
  unavailablePacks(missing.calculatedClosingPacks);
  unavailablePacks(missing.buckets.pennsylvania20);
});

test('REV-772 keeps a confirmed zero distinct from inventory that was not established', () => {
  const confirmed = buildRev772Preview([
    { id: 'open', movementType: 'opening', quantity: 0, ...cigarette },
    { id: 'close', movementType: 'closing', quantity: 0, ...cigarette },
  ]);
  recordedPacks(confirmed.categories.opening, 0);
  recordedPacks(confirmed.buckets.pennsylvania20, 0);
  recordedPacks(confirmed.calculatedClosingPacks, 0);
  recordedPacks(confirmed.statedClosingPacks, 0);
  recordedPacks(confirmed.differencePacks, 0);
  unavailablePacks(confirmed.buckets.philadelphia20);
  unavailablePacks(confirmed.categories.receipts);
  assert.equal(confirmed.filingReady, false);
  assert.equal(confirmed.status, 'preview');

  const noLedger = buildRev772Preview([]);
  unavailablePacks(noLedger.categories.opening);
  unavailablePacks(noLedger.calculatedClosingPacks);
  unavailablePacks(noLedger.statedClosingPacks);
  unavailablePacks(noLedger.buckets.pennsylvania20);
  assert.equal(noLedger.filingReady, false);
  assert.equal(noLedger.status, 'incomplete');

  const missingOpening = buildRev772Preview([{ id: 'sold', movementType: 'sale', quantity: 4, ...cigarette }]);
  recordedPacks(missingOpening.categories.sales, 4);
  unavailablePacks(missingOpening.categories.opening);
  unavailablePacks(missingOpening.calculatedClosingPacks);
  if (missingOpening.calculatedClosingPacks.availability === 'unavailable') {
    assert.equal(missingOpening.calculatedClosingPacks.reason, 'opening_not_established');
  }

  const missingClose = buildRev772Preview([{ id: 'open', movementType: 'opening', quantity: 10, ...cigarette }]);
  recordedPacks(missingClose.calculatedClosingPacks, 10);
  unavailablePacks(missingClose.statedClosingPacks);
  unavailablePacks(missingClose.differencePacks);
  assert.equal(missingClose.status, 'incomplete');

  const positive = buildRev772Preview([{ id: 'open', movementType: 'opening', quantity: 8, ...cigarette }]);
  recordedPacks(positive.categories.opening, 8);
  recordedPacks(positive.buckets.pennsylvania20, 8);
  unavailablePacks(positive.buckets.pennsylvania25);
});

test('REV-777 does not guess a shipping method or a destination', () => {
  const preview = buildRev777Preview([
    {
      id: 'sale-1',
      saleDate: '2026-03-02',
      invoiceNumber: 'INV-1',
      purchaserName: 'Shop',
      purchaserAddress: '1 Main St',
      destinationState: null,
      shipMethod: 'ground',
      quantity: 2,
      ...cigarette,
    },
  ]);
  assert.equal(preview.filingReady, false);
  assert.equal(preview.lines.length, 0);
  assert.equal(preview.exceptions.some((item) => item.reason === 'ship_method_unclassified'), true);
  assert.equal(preview.exceptions.some((item) => item.reason === 'destination_state_missing'), true);
  const empty = buildRev777Preview([]);
  assert.equal(empty.status, 'incomplete');
  assert.equal(empty.filingReady, false);
});

test('the register keeps POS taxable base unavailable and does not search excluded numbers into the list', () => {
  const wholesale = assessRegisterDocument({
    id: 'inv-1',
    source: 'wholesale',
    number: 'INV-2026-001',
    customer: 'Market',
    storedTotal: 106,
    invoice: {
      id: 'inv-1',
      invoiceNumber: 'INV-2026-001',
      invoiceType: 'invoice',
      source: 'WHOLESALE',
      headerTax: 6,
      lines: [{ hasTaxableKey: true, taxable: true, subtotal: 100, taxAmount: 6 }],
    },
  });
  const pos = assessRegisterDocument({
    id: 'pos-1',
    source: 'pos',
    number: 'POS-9',
    customer: 'Walk in',
    storedTotal: 11.2,
    pos: { id: 'pos-1', headerTax: 1.2, lines: [{ tax: 1.2, price: 10, quantity: 1 }] },
  });
  assert.equal(wholesale.complianceStatus, 'recorded');
  assert.equal(wholesale.recordedTax.availability === 'recorded_preview' && wholesale.recordedTax.cents, 600);
  assert.equal(wholesale.jurisdictionStatus, 'not_resolved');
  assert.equal(wholesale.filingReady, false);
  assert.equal(pos.complianceStatus, 'incomplete');
  assert.equal(pos.taxableBase.availability, 'unavailable');
  assert.equal(pos.reasons.includes('pos_taxable_base_unavailable'), true);
  const filtered = filterTransactionRegister([wholesale, pos], { source: 'pos', status: 'incomplete', q: 'walk' });
  assert.deepEqual(filtered.map((row) => row.id), ['pos-1']);
  assert.equal(pageRows(filtered, 1, 50).total, 1);
});

test('a period cannot be marked filed or filing-ready', () => {
  const filed = transitionReportingPeriod('approved', 'filed');
  const ready = transitionReportingPeriod('needs_review', 'filing_ready');
  const approved = transitionReportingPeriod('needs_review', 'approved');
  assert.equal(filed.ok, false);
  assert.equal(ready.ok, false);
  assert.equal(approved.ok, true);
  if (approved.ok) assert.equal(approved.filingReady, false);
});

test('csv exports identify themselves as previews', () => {
  const csv = toPreviewCsv({
    title: 'Sales tax',
    periodLabel: '2026-03',
    generatedAt: '2026-11-16T00:00:00.000Z',
    blockers: ['rounding_method'],
    headers: ['source', 'cents'],
    rows: [['wholesale', 600]],
  });
  assert.match(csv, /NOT AN OFFICIAL FILING/);
  assert.match(csv, /FILING READY","no/);
  assert.doesNotMatch(csv, /filing-ready","yes/i);
});
