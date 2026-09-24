/**
 * Task 07D-10E-05 — POS reporting adjustments for completed returns.
 *
 * Live POS sales/revenue metrics use POSSale.total_amount, which includes tax.
 * Return.total_refund is merchandise-only. Net POS sales therefore keep the
 * original tax and subtract only completed return merchandise.
 *
 * Date convention: sales stay on POSSale.created_at; return reversals use
 * Return.created_at. Settlement state is ignored.
 */
import { roundMoney } from '../services/paymentApplication';

export const POS_REPORTING_COMPLETED_STATUS = 'completed';

export type PosReportingSale = {
  _id?: unknown;
  total_amount?: unknown;
  created_at?: unknown;
  items?: Array<{
    product_id?: unknown;
    quantity?: unknown;
    cost_price?: unknown;
  }>;
};

export type PosReportingReturnItem = {
  product_id?: unknown;
  quantity?: unknown;
  refundable_amount?: unknown;
};

export type PosReportingReturn = {
  status?: unknown;
  settlement_status?: unknown;
  total_refund?: unknown;
  created_at?: unknown;
  sale_id?: unknown;
  items?: PosReportingReturnItem[];
};

export function isCompletedPosReturn(ret: { status?: unknown } | null | undefined): boolean {
  return ret?.status === POS_REPORTING_COMPLETED_STATUS;
}

export function completedPosReturnMatch(startDate: Date, endDate?: Date) {
  const created_at: { $gte: Date; $lte?: Date } = { $gte: startDate };
  if (endDate) created_at.$lte = endDate;
  return {
    status: POS_REPORTING_COMPLETED_STATUS,
    created_at,
  };
}

export function posGrossRevenue(posSales: Array<{ total_amount?: unknown }>): number {
  return roundMoney(posSales.reduce((sum, sale) => sum + (Number(sale.total_amount) || 0), 0));
}

export function posReturnMerchandiseReversal(returns: PosReportingReturn[]): number {
  return roundMoney(
    returns.reduce((sum, ret) => {
      if (!isCompletedPosReturn(ret)) return sum;
      return sum + (Number(ret.total_refund) || 0);
    }, 0)
  );
}

/** Tax-inclusive POSSale totals minus merchandise-only completed returns. */
export function posNetRevenue(
  posSales: Array<{ total_amount?: unknown }>,
  returns: PosReportingReturn[]
): number {
  return roundMoney(posGrossRevenue(posSales) - posReturnMerchandiseReversal(returns));
}

export function hasSaleTimeCost(item: { cost_price?: unknown } | null | undefined): boolean {
  if (!item || item.cost_price == null || item.cost_price === '') return false;
  return Number.isFinite(Number(item.cost_price));
}

/**
 * Sale-line COGS. Prefers immutable sale-time cost_price.
 * Historical lines without a snapshot keep the prior catalog fallback so
 * existing sale COGS does not silently drop to zero.
 */
export function posSaleLineCogs(
  item: { product_id?: unknown; quantity?: unknown; cost_price?: unknown },
  catalogCostMap: Map<string, number>
): number {
  const qty = Number(item.quantity) || 0;
  if (hasSaleTimeCost(item)) {
    return qty * Number(item.cost_price);
  }
  const pid = item.product_id ? String(item.product_id) : '';
  return qty * (catalogCostMap.get(pid) ?? 0);
}

export function posSaleCogs(
  sales: Array<{ items?: Array<{ product_id?: unknown; quantity?: unknown; cost_price?: unknown }> }>,
  catalogCostMap: Map<string, number>
): number {
  let cogs = 0;
  for (const sale of sales) {
    for (const item of sale.items || []) {
      cogs += posSaleLineCogs(item, catalogCostMap);
    }
  }
  return roundMoney(cogs);
}

export function indexPosSalesById(sales: PosReportingSale[]): Map<string, PosReportingSale> {
  const map = new Map<string, PosReportingSale>();
  for (const sale of sales) {
    if (sale._id == null) continue;
    map.set(String(sale._id), sale);
  }
  return map;
}

function saleLineForProduct(
  sale: PosReportingSale | undefined,
  productId: unknown
): { product_id?: unknown; quantity?: unknown; cost_price?: unknown } | undefined {
  if (!sale || productId == null) return undefined;
  const pid = String(productId);
  return (sale.items || []).find((item) => item.product_id && String(item.product_id) === pid);
}

/**
 * Return COGS uses only the original sale-line snapshot.
 * Missing historical cost_price contributes 0 — never current Product.cost_price.
 */
export function posReturnLineCogs(
  returnedQty: unknown,
  saleLine: { cost_price?: unknown } | undefined
): number {
  if (!hasSaleTimeCost(saleLine)) return 0;
  return (Number(returnedQty) || 0) * Number(saleLine?.cost_price);
}

export function posReturnCogs(
  returns: PosReportingReturn[],
  salesById: Map<string, PosReportingSale>
): number {
  let cogs = 0;
  for (const ret of returns) {
    if (!isCompletedPosReturn(ret)) continue;
    const sale = ret.sale_id != null ? salesById.get(String(ret.sale_id)) : undefined;
    for (const item of ret.items || []) {
      const saleLine = saleLineForProduct(sale, item.product_id);
      cogs += posReturnLineCogs(item.quantity, saleLine);
    }
  }
  return roundMoney(cogs);
}

export function posNetCogs(
  sales: PosReportingSale[],
  returns: PosReportingReturn[],
  catalogCostMap: Map<string, number>,
  salesById?: Map<string, PosReportingSale>
): number {
  const byId = salesById ?? indexPosSalesById(sales);
  return roundMoney(posSaleCogs(sales, catalogCostMap) - posReturnCogs(returns, byId));
}

export function applyPosReturnMerchandiseByDate<T extends { revenue: number }>(
  buckets: Map<string, T>,
  returns: PosReportingReturn[],
  dateKey: (createdAt: unknown) => string,
  createBucket: () => T
): Map<string, T> {
  for (const ret of returns) {
    if (!isCompletedPosReturn(ret)) continue;
    const key = dateKey(ret.created_at);
    const existing = buckets.get(key) || createBucket();
    existing.revenue = roundMoney(existing.revenue - (Number(ret.total_refund) || 0));
    buckets.set(key, existing);
  }
  return buckets;
}

export function missingPosSaleIds(
  returns: PosReportingReturn[],
  salesById: Map<string, PosReportingSale>
): string[] {
  const ids = new Set<string>();
  for (const ret of returns) {
    if (!isCompletedPosReturn(ret) || ret.sale_id == null) continue;
    const id = String(ret.sale_id);
    if (!salesById.has(id)) ids.add(id);
  }
  return [...ids];
}

export function yearMonthKey(value: unknown): string {
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
