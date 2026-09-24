/**
 * Task 07D-04 — dashboard revenue/COGS parts.
 * POSSale is the only POS financial source. POS invoice slips contribute 0.
 * Task 07D-10E-05 — POS net sales/COGS subtract completed returns once.
 */
import { isPosSaleInvoiceType, isQuotationType } from './documentType';
import { roundMoney } from '../services/paymentApplication';
import { posNetCogs, posNetRevenue, posSaleCogs, type PosReportingReturn, type PosReportingSale } from './posFinancialReporting';

export type DashboardMoneyDoc = {
  invoice_type?: unknown;
  total_amount?: unknown;
  items?: Array<{ product_id?: unknown; quantity?: unknown; cost_price?: unknown }>;
};

export function invoiceContributesToDashboardFinancials(invoiceType: unknown): boolean {
  return !isQuotationType(invoiceType) && !isPosSaleInvoiceType(invoiceType);
}

export function dashboardPosRevenue(
  posSales: Array<{ total_amount?: unknown }>,
  returns: PosReportingReturn[] = []
): number {
  return posNetRevenue(posSales, returns);
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
  rows: Array<{ items?: Array<{ product_id?: unknown; quantity?: unknown; cost_price?: unknown }> }>,
  costMap: Map<string, number>
): number {
  return posSaleCogs(rows, costMap);
}

export function dashboardPosCogs(
  posSales: PosReportingSale[],
  costMap: Map<string, number>,
  returns: PosReportingReturn[] = [],
  salesById?: Map<string, PosReportingSale>
): number {
  return posNetCogs(posSales, returns, costMap, salesById);
}

export function dashboardInvoiceCogs(invoices: DashboardMoneyDoc[], costMap: Map<string, number>): number {
  return dashboardItemCogs(
    invoices.filter((inv) => invoiceContributesToDashboardFinancials(inv.invoice_type)),
    costMap
  );
}
