/**
 * Task 03B regression tests for dashboard display rules.
 *
 * Uses Node's built-in `node:test` + `node:assert` — no new test-framework
 * dependencies. Run with:
 *     npx tsx --test lib/dashboard-metrics.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UNAVAILABLE,
  CALCULATION_UNDER_REVIEW,
  buildActivityPanels,
  buildMetricCards,
  displayCount,
  displayFinancial,
  displayMoney,
  resolveDashboardViewState,
} from './dashboard-metrics';

test('valid numeric zero is displayed as zero, not a default', () => {
  assert.equal(displayCount(0), '0');
  assert.equal(displayMoney(0), '$0.00');
  const cards = buildMetricCards({ totalSales: 0, orders: 0, lowStockCount: 0 });
  assert.equal(cards.find((c) => c.id === 'sales')?.value, '$0.00');
  assert.equal(cards.find((c) => c.id === 'orders')?.value, '0');
  assert.equal(cards.find((c) => c.id === 'lowStock')?.value, '0');
});

test('nonzero supported values display unchanged', () => {
  assert.equal(displayCount(847), '847');
  assert.equal(displayMoney(1240.5), '$1,240.50');
  const cards = buildMetricCards({
    totalSales: 1240.5,
    orders: 12,
    lowStockCount: 847,
  });
  assert.equal(cards.find((c) => c.id === 'sales')?.value, '$1,240.50');
  assert.equal(cards.find((c) => c.id === 'orders')?.value, '12');
  assert.equal(cards.find((c) => c.id === 'lowStock')?.value, '847');
});

test('missing or invalid values display Unavailable, not zero', () => {
  assert.equal(displayCount(undefined), UNAVAILABLE);
  assert.equal(displayCount(null), UNAVAILABLE);
  assert.equal(displayCount(NaN), UNAVAILABLE);
  assert.equal(displayCount(Infinity), UNAVAILABLE);
  assert.equal(displayCount('12'), UNAVAILABLE);
  assert.equal(displayMoney(undefined), UNAVAILABLE);
  assert.equal(displayMoney(null), UNAVAILABLE);
  const cards = buildMetricCards({});
  assert.equal(cards.find((c) => c.id === 'sales')?.value, UNAVAILABLE);
  assert.equal(cards.find((c) => c.id === 'orders')?.value, UNAVAILABLE);
  assert.equal(cards.find((c) => c.id === 'lowStock')?.value, UNAVAILABLE);
});

test('known-defective financial aggregates are under review, not shown as amounts', () => {
  assert.equal(displayFinancial('totalReceivable', 840), CALCULATION_UNDER_REVIEW);
  assert.equal(displayFinancial('totalReceivable', 0), CALCULATION_UNDER_REVIEW);
  assert.equal(displayFinancial('netProfit', 99.5), CALCULATION_UNDER_REVIEW);
  assert.equal(displayFinancial('totalCOGS', 10), CALCULATION_UNDER_REVIEW);
  assert.equal(displayFinancial('totalPayable', 50), CALCULATION_UNDER_REVIEW);
  const cards = buildMetricCards({ totalReceivable: 840 });
  const receivable = cards.find((c) => c.id === 'receivable');
  assert.equal(receivable?.value, CALCULATION_UNDER_REVIEW);
  assert.equal(receivable?.label, 'Period receivable');
  assert.match(receivable?.caption || '', /not an overdue/i);
});

test('unsupported cards stay Unavailable and are not invented from other fields', () => {
  const cards = buildMetricCards({ lowStockCount: 847, totalSales: 100, orders: 3 });
  for (const id of ['quotes', 'dispatch', 'returns', 'collections']) {
    assert.equal(cards.find((c) => c.id === id)?.value, UNAVAILABLE);
  }
});

test('sales prefers totalSales over revenue and does not divide by 30', () => {
  const cards = buildMetricCards({ totalSales: 300, revenue: 999 });
  assert.equal(cards.find((c) => c.id === 'sales')?.value, '$300.00');
  assert.equal(cards.find((c) => c.id === 'sales')?.label, '30-day sales');
});

test('activity panels have no sample rows and do not claim empty activity', () => {
  const panels = buildActivityPanels();
  assert.ok(panels.length >= 6);
  for (const panel of panels) {
    assert.equal(panel.status, 'unavailable');
    assert.equal(panel.message, UNAVAILABLE);
    assert.notEqual(panel.message, 'No activity');
  }
});

test('load states: initial error, refresh stale, success clears error path', () => {
  assert.deepEqual(
    resolveDashboardViewState({ hasData: false, loading: true, refreshing: false, error: null }),
    { kind: 'loading' }
  );
  assert.deepEqual(
    resolveDashboardViewState({
      hasData: false,
      loading: false,
      refreshing: false,
      error: 'Failed to load dashboard',
    }),
    { kind: 'error', message: 'Failed to load dashboard' }
  );
  assert.deepEqual(
    resolveDashboardViewState({
      hasData: true,
      loading: false,
      refreshing: false,
      error: 'Failed to load dashboard',
    }),
    {
      kind: 'stale',
      stale: true,
      refreshing: false,
      message: 'Failed to load dashboard',
    }
  );
  assert.deepEqual(
    resolveDashboardViewState({ hasData: true, loading: false, refreshing: true, error: null }),
    { kind: 'ready', stale: false, refreshing: true }
  );
});

test('dashboard page source contains no fabricated business figures or sample events', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../app/admin/dashboard/page.tsx'), 'utf8');
  const forbidden = [
    '1240.50',
    '1240.5',
    "'840'",
    '"840"',
    'lowStockCount ?? 0) / 2',
    'lowStockCount * 0.4',
    '+12% vs yest',
    'Today Revenue',
    'Collections Today',
    'Orion B2B Traders',
    'Apex General Merchants',
    'Zodiac Supplies',
    'ABC Traders',
    'WEB-0021',
    'RFQ-209',
    'INV-0128',
    'INV-0010',
    'Docket #990-281',
    'Universal Cargo Inc',
    'Metro Courier',
    'PA Warehouse SKU',
    'No activity',
  ];
  for (const needle of forbidden) {
    assert.equal(page.includes(needle), false, `page still contains fabricated text: ${needle}`);
  }
  assert.equal(page.includes('Overdue'), false, 'totalReceivable must not be labeled Overdue');
});
