/**
 * Task 07D-04 — POS invoice slips must not add dashboard revenue or COGS.
 *
 * Run with:
 *     npx tsx --test src/utils/dashboardFinancial.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dashboardInvoiceCogs,
  dashboardInvoiceRevenue,
  dashboardItemCogs,
  dashboardPosCogs,
  dashboardPosRevenue,
  invoiceContributesToDashboardFinancials,
} from './dashboardFinancial';

test('completed POS sale contributes revenue once from POSSale, not the slip', () => {
  const posSales = [{ total_amount: 100 }];
  const invoices = [
    { invoice_type: 'pos', total_amount: 100 },
    { invoice_type: 'invoice', total_amount: 0 },
  ];

  assert.equal(dashboardPosRevenue(posSales), 100);
  assert.equal(dashboardInvoiceRevenue(invoices), 0);
  assert.equal(invoiceContributesToDashboardFinancials('pos'), false);
  assert.equal(invoiceContributesToDashboardFinancials('website'), false);
  assert.equal(invoiceContributesToDashboardFinancials('store_pickup'), false);
  assert.equal(invoiceContributesToDashboardFinancials('invoice'), true);
});

test('POS COGS is counted from POSSale items only', () => {
  const productId = 'prod-cost-1';
  const costMap = new Map<string, number>([[productId, 40]]);
  const posSales = [{ items: [{ product_id: productId, quantity: 2 }] }];
  const invoices = [
    {
      invoice_type: 'pos',
      items: [{ product_id: productId, quantity: 2 }],
    },
    {
      invoice_type: 'invoice',
      items: [{ product_id: productId, quantity: 1 }],
    },
  ];

  assert.equal(dashboardItemCogs(posSales, costMap), 80);
  assert.equal(dashboardInvoiceCogs(invoices, costMap), 40);
  assert.equal(
    dashboardPosCogs(
      [{ _id: 'sale-1', items: [{ product_id: productId, quantity: 2, cost_price: 40 }] }],
      new Map([[productId, 99]]),
      [{ status: 'completed', sale_id: 'sale-1', items: [{ product_id: productId, quantity: 1 }] }]
    ),
    40
  );
});

test('dashboard route uses wholesale invoice match and POSSale helpers', () => {
  const admin = readFileSync(join(process.cwd(), 'src/routes/admin.ts'), 'utf8');
  assert.match(admin, /dashboardWholesaleInvoiceMatch/);
  assert.match(admin, /dashboardPosRevenue/);
  assert.match(admin, /dashboardInvoiceRevenue/);
  assert.match(admin, /dashboardPosCogs/);
  assert.match(admin, /dashboardInvoiceCogs/);
  assert.match(admin, /completedPosReturnMatch/);
});
