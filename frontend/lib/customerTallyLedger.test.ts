/**
 * Task 07C-05 — Tally Ledger excludes quotations from sales debits.
 *
 * Run with:
 *     npx tsx --test lib/customerTallyLedger.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCustomerTallyCsvStatement,
  buildCustomerTallyLedgerItems,
  withTallyRunningBalances,
} from './customerTallyLedger';

const invoice100 = {
  invoice_number: 'INV#100',
  invoice_type: 'invoice',
  invoice_date: '2026-01-01',
  total_amount: 100,
};

const invoice50 = {
  invoice_number: 'INV#050',
  invoice_type: 'invoice',
  invoice_date: '2026-01-02',
  total_amount: 50,
};

const quotation = {
  invoice_number: 'QTN#001',
  invoice_type: 'quotation',
  invoice_date: '2026-01-03',
  total_amount: 16.99,
};

const receipt40 = {
  trx_id: 'RT001',
  trx_date: '2026-01-04',
  amount_received: 40,
};

test('invoice 100 + quotation 16.99 + receipt 40 → debit 100, credit 40, running 60', () => {
  const rows = withTallyRunningBalances(
    buildCustomerTallyLedgerItems([invoice100, quotation], [receipt40])
  );
  assert.equal(rows.reduce((s, row) => s + row.debit, 0), 100);
  assert.equal(rows.reduce((s, row) => s + row.credit, 0), 40);
  assert.equal(rows[rows.length - 1]?.runningBalance, 60);
  assert.equal(rows.some((row) => row.memo.includes('QTN#001')), false);

  const csv = buildCustomerTallyCsvStatement([invoice100, quotation], [receipt40]);
  assert.deepEqual(csv.map((row) => row[2]), ['100.00', '0.00']);
  assert.deepEqual(csv.map((row) => row[3]), ['0.00', '40.00']);
  assert.equal(csv[csv.length - 1]?.[4], '60.00');
  assert.equal(csv.some((row) => row[1].includes('QTN#001')), false);
});

test('quotation-only customer has no quotation ledger or CSV row', () => {
  const items = buildCustomerTallyLedgerItems([quotation], []);
  const csv = buildCustomerTallyCsvStatement([quotation], []);
  assert.deepEqual(items, []);
  assert.deepEqual(csv, []);
});

test('quotation never affects running balance across multiple invoices', () => {
  const rows = withTallyRunningBalances(
    buildCustomerTallyLedgerItems([invoice100, invoice50, quotation], [receipt40])
  );
  assert.equal(rows.reduce((s, row) => s + row.debit, 0), 150);
  assert.equal(rows[rows.length - 1]?.runningBalance, 110);
  assert.equal(rows.some((row) => /QTN#/.test(row.memo)), false);
});

test('invoice and receipt rows keep existing memo semantics', () => {
  const items = buildCustomerTallyLedgerItems([invoice100], [receipt40]);
  assert.equal(items[0]?.memo, 'INV#100 B2B Invoice');
  assert.equal(items[1]?.memo, 'Receipt RT001 Voucher');

  const csv = buildCustomerTallyCsvStatement([invoice100], [receipt40]);
  assert.equal(csv[0]?.[1], 'INV#100 Invoice');
  assert.equal(csv[1]?.[1], 'RT001 Payment Recv');
});

test('customer detail page ledger and CSV use saleInvoices', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../app/admin/customers/[id]/page.tsx'), 'utf8');
  assert.match(page, /buildCustomerTallyLedgerItems\(saleInvoices/);
  assert.match(page, /buildCustomerTallyCsvStatement\(saleInvoices/);
  const ledgerAt = page.indexOf('Tab 5: Ledger');
  const ledgerSlice = page.slice(ledgerAt, page.indexOf('Tab 6: RFQs'));
  assert.equal(ledgerSlice.includes('...invoices.map'), false);
  assert.equal(ledgerSlice.includes('invoices.map(i =>'), false);
});
