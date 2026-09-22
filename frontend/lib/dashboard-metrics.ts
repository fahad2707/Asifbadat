/**
 * Dashboard display rules (Task 03B).
 *
 * Only values actually supplied by GET /admin/dashboard may be shown as
 * business figures. Valid numeric zeros stay zero. Missing or invalid
 * values become "Unavailable". Known-defective financial aggregates are
 * never presented as verified amounts.
 */

export const UNAVAILABLE = 'Unavailable';
export const CALCULATION_UNDER_REVIEW = 'Calculation under review';
export const DASHBOARD_PERIOD_DAYS = 30;

/** Backend financial fields whose current calculation is not trustworthy. */
export const UNDER_REVIEW_FINANCIAL_FIELDS = [
  'netProfit',
  'totalCOGS',
  'totalReceivable',
  'totalPayable',
] as const;

export type UnderReviewFinancialField = (typeof UNDER_REVIEW_FINANCIAL_FIELDS)[number];

export type DashboardPayload = Record<string, unknown>;

export type MetricCard = {
  id: string;
  label: string;
  value: string;
  caption?: string;
};

export type ActivityPanel = {
  id: string;
  title: string;
  status: 'unavailable';
  message: typeof UNAVAILABLE;
};

export function isPresentNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isUnderReviewFinancialField(field: string): field is UnderReviewFinancialField {
  return (UNDER_REVIEW_FINANCIAL_FIELDS as readonly string[]).includes(field);
}

/** Count / integer metrics: 0 stays "0"; missing/invalid → Unavailable. */
export function displayCount(value: unknown): string {
  if (!isPresentNumber(value)) return UNAVAILABLE;
  return String(value);
}

/** Money metrics: 0 stays $0.00; missing/invalid → Unavailable. */
export function displayMoney(value: unknown): string {
  if (!isPresentNumber(value)) return UNAVAILABLE;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Financial aggregate display. Known-defective fields never render as an
 * amount, even when the API sent a number.
 */
export function displayFinancial(field: string, value: unknown): string {
  if (isUnderReviewFinancialField(field)) return CALCULATION_UNDER_REVIEW;
  return displayMoney(value);
}

export function buildMetricCards(data: DashboardPayload): MetricCard[] {
  const sales = data.totalSales !== undefined ? data.totalSales : data.revenue;

  return [
    {
      id: 'sales',
      label: '30-day sales',
      value: displayMoney(sales),
    },
    {
      id: 'orders',
      label: 'Orders (30 days)',
      value: displayCount(data.orders),
    },
    {
      id: 'quotes',
      label: 'Pending quotes',
      value: UNAVAILABLE,
    },
    {
      id: 'dispatch',
      label: 'Pending dispatch',
      value: UNAVAILABLE,
    },
    {
      id: 'receivable',
      label: 'Period receivable',
      value: displayFinancial('totalReceivable', data.totalReceivable),
      caption: 'Not an overdue or all-time balance',
    },
    {
      id: 'lowStock',
      label: 'Low stock',
      value: displayCount(data.lowStockCount),
    },
    {
      id: 'returns',
      label: 'Returns',
      value: UNAVAILABLE,
    },
    {
      id: 'collections',
      label: 'Collections',
      value: UNAVAILABLE,
    },
  ];
}

/** Panels with no authentic data source on this endpoint. */
export function buildActivityPanels(): ActivityPanel[] {
  return [
    { id: 'recent-orders', title: 'Recent Sales Orders', status: 'unavailable', message: UNAVAILABLE },
    { id: 'approvals', title: 'Pending Approvals', status: 'unavailable', message: UNAVAILABLE },
    { id: 'stock-checks', title: 'Stock Procurement Checks', status: 'unavailable', message: UNAVAILABLE },
    { id: 'dispatch', title: 'Dispatch & Deliveries', status: 'unavailable', message: UNAVAILABLE },
    { id: 'follow-ups', title: 'Pending Follow-ups', status: 'unavailable', message: UNAVAILABLE },
    { id: 'feeds', title: 'Enterprise Feeds', status: 'unavailable', message: UNAVAILABLE },
  ];
}

export type DashboardViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; stale: false; refreshing: boolean }
  | { kind: 'stale'; stale: true; refreshing: boolean; message: string };

export function resolveDashboardViewState(input: {
  hasData: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}): DashboardViewState {
  if (input.loading && !input.hasData) return { kind: 'loading' };
  if (!input.hasData) {
    return { kind: 'error', message: input.error || 'Failed to load dashboard' };
  }
  if (input.error) {
    return {
      kind: 'stale',
      stale: true,
      refreshing: input.refreshing,
      message: input.error,
    };
  }
  return { kind: 'ready', stale: false, refreshing: input.refreshing };
}
