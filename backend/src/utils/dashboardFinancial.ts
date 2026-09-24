/**
 * Task 07D-04 — dashboard revenue/COGS parts.
 * POSSale is the only POS financial source. POS invoice slips contribute 0.
 */
import { isPosSaleInvoiceType, isQuotationType } from './documentType';
import { roundMoney } from '../services/paymentApplication';

export type DashboardMoneyDoc = {
  invoice_type?: unknown;
  total_amount?: unknown;
  items?: Array<{ product_id?: unknown; quantity?: unknown }>;
};

export function invoiceContributesToDashboardFinancials(invoiceType: unknown): boolean {
  return !isQuotationType(invoiceType) && !isPosSaleInvoiceType(invoiceType);
}

export function dashboardPosRevenue(posSales: Array<{ total_amount?: unknown }>): number {
  return roundMoney(posSales.reduce((sum, sale) => sum + (Number(sale.total_amount) || 0), 0));
}

export function dashboardInvoiceRevenue(invoices: DashboardMoneyDoc[]): number {
  return roundMoney(
    invoices.reduce((sum, inv) => {
      if (!invoiceContributesToDashboardFinancials(inv.invoice_type)) return sum;
      return sum + (Number(inv.total_amount) || 0);
    }, 0)
  );
}

export function dashboardItemCogs(
  rows: Array<{ items?: Array<{ product_id?: unknown; quantity?: unknown }> }>,
  costMap: Map<string, number>
): number {
  let cogs = 0;
  for (const row of rows) {
    for (const item of row.items || []) {
      const pid = item.product_id ? String(item.product_id) : '';
      cogs += (Number(item.quantity) || 0) * (costMap.get(pid) ?? 0);
    }
  }
  return roundMoney(cogs);
}

export function dashboardInvoiceCogs(invoices: DashboardMoneyDoc[], costMap: Map<string, number>): number {
  return dashboardItemCogs(
    invoices.filter((inv) => invoiceContributesToDashboardFinancials(inv.invoice_type)),
    costMap
  );
}
