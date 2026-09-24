/**
 * Task 07D-10E-05 — POS reporting is return-aware.
 *
 * Isolated: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/utils/posFinancialReporting.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dashboardInvoiceCogs,
  dashboardInvoiceRevenue,
  dashboardPosCogs,
  dashboardPosRevenue,
  invoiceContributesToDashboardFinancials,
} from './dashboardFinancial';
import {
  applyPosReturnMerchandiseByDate,
  completedPosReturnMatch,
  hasSaleTimeCost,
  indexPosSalesById,
  isCompletedPosReturn,
  missingPosSaleIds,
  posGrossRevenue,
  posNetCogs,
  posNetRevenue,
  posReturnCogs,
  posReturnLineCogs,
  posReturnMerchandiseReversal,
  posSaleCogs,
  posSaleLineCogs,
  yearMonthKey,
} from './posFinancialReporting';

const PRODUCT_ID = '64b0000000000000000d0404';
const SALE_ID = '64b0000000000000000a0a0a';

function sale(overrides: Record<string, unknown> = {}) {
  return {
    _id: SALE_ID,
    total_amount: 110,
    created_at: new Date('2026-01-10T12:00:00.000Z'),
    items: [{ product_id: PRODUCT_ID, quantity: 2, cost_price: 40 }],
    ...overrides,
  };
}

function completedReturn(overrides: Record<string, unknown> = {}) {
  return {
    status: 'completed',
    settlement_status: 'unsettled',
    sale_id: SALE_ID,
    total_refund: 90,
    created_at: new Date('2026-01-15T12:00:00.000Z'),
    items: [{ product_id: PRODUCT_ID, quantity: 1, refundable_amount: 90 }],
    ...overrides,
  };
}

test('A — no returns: existing POS sales/revenue/COGS remain unchanged', () => {
  const sales = [sale()];
  const catalog = new Map<string, number>([[PRODUCT_ID, 99]]);
  assert.equal(posGrossRevenue(sales), 110);
  assert.equal(posNetRevenue(sales, []), 110);
  assert.equal(dashboardPosRevenue(sales), 110);
  assert.equal(posSaleCogs(sales, catalog), 80);
  assert.equal(posNetCogs(sales, [], catalog), 80);
  assert.equal(dashboardPosCogs(sales, catalog), 80);
});

test('B — full completed return reverses merchandise exactly once', () => {
  const sales = [sale({ total_amount: 110, items: [{ product_id: PRODUCT_ID, quantity: 1, cost_price: 40 }] })];
  const returns = [completedReturn({ total_refund: 100, items: [{ product_id: PRODUCT_ID, quantity: 1, refundable_amount: 100 }] })];
  assert.equal(posNetRevenue(sales, returns), 10);
  assert.equal(posReturnMerchandiseReversal(returns), 100);
});

test('C — partial completed return reverses only returned merchandise/qty', () => {
  const sales = [sale()];
  const returns = [completedReturn()];
  assert.equal(posNetRevenue(sales, returns), 20);
  assert.equal(posNetCogs(sales, returns, new Map(), indexPosSalesById(sales)), 40);
});

test('D — unsettled completed return still reverses reporting', () => {
  const sales = [sale()];
  const returns = [completedReturn({ settlement_status: 'unsettled' })];
  assert.equal(isCompletedPosReturn(returns[0]), true);
  assert.equal(posNetRevenue(sales, returns), 20);
});

test('E — settlement afterward does not reverse a second time', () => {
  const sales = [sale()];
  const sameReturn = completedReturn({ settlement_status: 'settled' });
  assert.equal(posNetRevenue(sales, [sameReturn]), 20);
  assert.equal(posReturnMerchandiseReversal([sameReturn]), 90);
});

test('F — non-completed return does not affect reporting', () => {
  const sales = [sale()];
  const pending = completedReturn({ status: 'pending', total_refund: 90 });
  assert.equal(isCompletedPosReturn(pending), false);
  assert.equal(posNetRevenue(sales, [pending]), 110);
  assert.equal(posReturnCogs([pending], indexPosSalesById(sales)), 0);
});

test('G — historical POSSale without cost_price does not use current catalog for return COGS', () => {
  const historical = sale({ items: [{ product_id: PRODUCT_ID, quantity: 2 }] });
  const returns = [completedReturn({ items: [{ product_id: PRODUCT_ID, quantity: 1 }] })];
  const catalog = new Map<string, number>([[PRODUCT_ID, 99]]);
  assert.equal(hasSaleTimeCost(historical.items[0]), false);
  assert.equal(posSaleLineCogs(historical.items[0], catalog), 198);
  assert.equal(posReturnLineCogs(1, historical.items[0]), 0);
  assert.equal(posReturnCogs(returns, indexPosSalesById([historical])), 0);
  assert.equal(posNetCogs([historical], returns, catalog), 198);
});

test('H — new POSSale cost_price is used even after catalog cost changes', () => {
  const sales = [sale({ items: [{ product_id: PRODUCT_ID, quantity: 2, cost_price: 40 }] })];
  const returns = [completedReturn({ items: [{ product_id: PRODUCT_ID, quantity: 1 }] })];
  const catalog = new Map<string, number>([[PRODUCT_ID, 99]]);
  assert.equal(posSaleCogs(sales, catalog), 80);
  assert.equal(posReturnCogs(returns, indexPosSalesById(sales)), 40);
  assert.equal(posNetCogs(sales, returns, catalog), 40);
});

test('I — multiple completed returns against one sale are aggregated once each', () => {
  const sales = [sale({ total_amount: 330, items: [{ product_id: PRODUCT_ID, quantity: 3, cost_price: 40 }] })];
  const returns = [
    completedReturn({ total_refund: 90, items: [{ product_id: PRODUCT_ID, quantity: 1 }] }),
    completedReturn({ total_refund: 90, items: [{ product_id: PRODUCT_ID, quantity: 1 }] }),
  ];
  assert.equal(posNetRevenue(sales, returns), 150);
  assert.equal(posNetCogs(sales, returns, new Map(), indexPosSalesById(sales)), 40);
});

test('J — wholesale and legacy sources are unchanged by POS return helpers', () => {
  const invoices = [
    { invoice_type: 'invoice', total_amount: 200, items: [{ product_id: PRODUCT_ID, quantity: 2 }] },
  ];
  const catalog = new Map<string, number>([[PRODUCT_ID, 25]]);
  assert.equal(dashboardInvoiceRevenue(invoices), 200);
  assert.equal(dashboardInvoiceCogs(invoices, catalog), 50);
  assert.equal(invoiceContributesToDashboardFinancials('invoice'), true);
});

test('K — POS Invoice is not a second financial source', () => {
  const posSales = [{ total_amount: 110 }];
  const invoices = [{ invoice_type: 'pos', total_amount: 110, items: [{ product_id: PRODUCT_ID, quantity: 2 }] }];
  const catalog = new Map<string, number>([[PRODUCT_ID, 40]]);
  assert.equal(dashboardPosRevenue(posSales, []), 110);
  assert.equal(dashboardInvoiceRevenue(invoices), 0);
  assert.equal(dashboardInvoiceCogs(invoices, catalog), 0);
  assert.equal(invoiceContributesToDashboardFinancials('pos'), false);
});

test('L — sale stays on POSSale.created_at; return reversal uses Return.created_at', () => {
  const buckets = new Map<string, { revenue: number }>([['2026-01', { revenue: 110 }]]);
  applyPosReturnMerchandiseByDate(
    buckets,
    [completedReturn({ created_at: new Date('2026-02-02T00:00:00.000Z'), total_refund: 90 })],
    yearMonthKey,
    () => ({ revenue: 0 })
  );
  assert.equal(buckets.get('2026-01')?.revenue, 110);
  assert.equal(buckets.get('2026-02')?.revenue, -90);
  assert.equal(yearMonthKey(new Date('2026-01-10T12:00:00.000Z')), '2026-01');
  const match = completedPosReturnMatch(new Date('2026-02-01'), new Date('2026-02-28'));
  assert.equal(match.status, 'completed');
  assert.ok(match.created_at.$gte);
  assert.ok(match.created_at.$lte);
});

test('missing original sale ids are collected for return COGS lookup', () => {
  const returns = [completedReturn({ sale_id: SALE_ID })];
  assert.deepEqual(missingPosSaleIds(returns, new Map()), [SALE_ID]);
  assert.deepEqual(missingPosSaleIds(returns, indexPosSalesById([sale()])), []);
});

test('tax-inclusive sale total minus merchandise-only refund leaves original tax', () => {
  const sales = [sale({ total_amount: 110 })];
  const returns = [completedReturn({ total_refund: 100 })];
  assert.equal(posNetRevenue(sales, returns), 10);
});

test('live reporting surfaces use completed-return helpers', () => {
  const admin = readFileSync(join(process.cwd(), 'src/routes/admin.ts'), 'utf8');
  assert.match(admin, /completedPosReturnMatch/);
  assert.match(admin, /dashboardPosCogs/);
  assert.match(admin, /dashboardPosRevenue/);
  assert.equal(admin.includes('PosReturnSettlement'), false);

  const reports = readFileSync(join(process.cwd(), 'src/modules/reports/services/financialReportService.ts'), 'utf8');
  assert.match(reports, /posNetCogs/);
  assert.match(reports, /posReturnMerchandiseReversal/);
  assert.match(reports, /completedPosReturnMatch/);
  assert.equal(reports.includes('settlement_status'), false);

  const analytics = readFileSync(join(process.cwd(), 'src/routes/analytics.ts'), 'utf8');
  assert.match(analytics, /applyPosReturnMerchandiseByDate/);
  assert.match(analytics, /completedPosReturnMatch/);
});
