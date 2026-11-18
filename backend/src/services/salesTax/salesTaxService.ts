/**
 * Sales-tax preview.
 *
 * The caller must supply the jurisdiction, the rate in basis points, and a
 * rounding policy. This service does not read Product.tax_rate, TaxType, or
 * StoreSettings.default_tax_rate, and it does not default a missing rate to
 * zero or to 6%.
 *
 * Verified treatments used only when the caller classifies the amount:
 * - A purchase-price discount reduces the base. A prompt-payment discount does not.
 *   61 Pa. Code § 33.2.
 * - Seller-billed delivery follows the taxability of the sale. Third-party freight
 *   billed by someone other than the seller is excluded. 61 Pa. Code § 54.1.
 * - Seller-billed delivery on a mixed invoice is split by net merchandise.
 *
 * postingAllowed and filingReady stay false until the decision register is
 * resolved. REV-717 bracket rounding is not implemented.
 */

import { allocateIntegerCents, isIntegerCents, rateTaxHalfAwayFromZero } from './money';
import { salesTaxPostingBlockers } from './decisions';

export const SALES_TAX_PREVIEW_VERSION = 'sales-tax-preview-1';

export type RoundingPolicyRequest = 'half_away_from_zero_cents' | 'pa_rev717_bracket';

export type ProductTaxability = 'taxable' | 'exempt' | 'non_taxable' | 'unconfigured';

export type ExemptionApproval = 'none' | 'pending' | 'approved' | 'revoked';

export type SalesTaxExemptionInput = {
  approval: ExemptionApproval;
  effectiveOn?: string | null;
  expiresOn?: string | null;
};

export type SalesTaxLineInput = {
  lineId: string;
  /** Tax-exclusive merchandise, integer cents, before discounts. */
  merchandiseCents: number;
  purchasePriceDiscountCents?: number;
  promptPaymentDiscountCents?: number;
  /** Discount whose tax effect has not been classified. */
  unclassifiedDiscountCents?: number;
  sellerBilledShippingCents?: number;
  thirdPartyFreightCents?: number;
  /** Freight whose tax effect has not been classified. */
  unclassifiedShippingCents?: number;
  taxability: ProductTaxability;
  exemption?: SalesTaxExemptionInput | null;
};

export type SalesTaxPreviewInput = {
  /** Calendar date YYYY-MM-DD. Compared as a date, not as a server-local timestamp. */
  transactionDate: string;
  jurisdictionCode?: string | null;
  /** 600 means 6.00%. Null or omitted means the rate was not supplied. */
  rateBasisPoints?: number | null;
  roundingPolicy?: RoundingPolicyRequest | null;
  /** Allocated across lines by net merchandise when no line already has seller freight. */
  headerSellerShippingCents?: number;
  lines: SalesTaxLineInput[];
};

export type SalesTaxIssue = {
  code: string;
  lineId?: string;
};

export type SalesTaxLinePreview = {
  lineId: string;
  merchandiseCents: number;
  purchasePriceDiscountCents: number;
  promptPaymentDiscountCents: number;
  sellerBilledShippingCents: number;
  thirdPartyFreightCents: number;
  taxableBaseCents: number;
  exemptBaseCents: number;
  nonTaxableBaseCents: number;
  taxCents: number;
  treatment: 'taxable' | 'exempt' | 'non_taxable' | 'customer_exempt';
};

export type SalesTaxTotals = {
  merchandiseCents: number;
  purchasePriceDiscountCents: number;
  promptPaymentDiscountCents: number;
  sellerBilledShippingCents: number;
  thirdPartyFreightCents: number;
  taxableBaseCents: number;
  exemptBaseCents: number;
  nonTaxableBaseCents: number;
  taxCents: number;
};

export type SalesTaxPreviewResult =
  | {
      status: 'incomplete';
      version: typeof SALES_TAX_PREVIEW_VERSION;
      postingAllowed: false;
      filingReady: false;
      issues: SalesTaxIssue[];
    }
  | {
      status: 'preview';
      version: typeof SALES_TAX_PREVIEW_VERSION;
      postingAllowed: false;
      filingReady: false;
      postingBlockers: string[];
      jurisdictionCode: string;
      rateBasisPoints: number;
      roundingPolicy: 'half_away_from_zero_cents';
      lines: SalesTaxLinePreview[];
      totals: SalesTaxTotals;
      warnings: SalesTaxIssue[];
    };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function incomplete(issues: SalesTaxIssue[]): SalesTaxPreviewResult {
  return {
    status: 'incomplete',
    version: SALES_TAX_PREVIEW_VERSION,
    postingAllowed: false,
    filingReady: false,
    issues,
  };
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function nonNegative(value: number | undefined, code: string, lineId: string, issues: SalesTaxIssue[]): number {
  const amount = value ?? 0;
  if (!isIntegerCents(amount) || amount < 0) {
    issues.push({ code, lineId });
    return 0;
  }
  return amount;
}

function netMerchandise(merchandiseCents: number, purchasePriceDiscountCents: number): number {
  return merchandiseCents - purchasePriceDiscountCents;
}

export function calculateSalesTaxPreview(input: SalesTaxPreviewInput): SalesTaxPreviewResult {
  const issues: SalesTaxIssue[] = [];
  if (!isIsoDate(input.transactionDate)) issues.push({ code: 'transaction_date_invalid' });

  const jurisdiction = typeof input.jurisdictionCode === 'string' ? input.jurisdictionCode.trim() : '';
  if (!jurisdiction) issues.push({ code: 'jurisdiction_missing' });

  const rate = input.rateBasisPoints;
  if (rate == null) issues.push({ code: 'rate_missing' });
  else if (!isIntegerCents(rate) || rate < 0 || rate > 10000) issues.push({ code: 'rate_invalid' });

  if (input.roundingPolicy == null) issues.push({ code: 'rounding_policy_missing' });
  else if (input.roundingPolicy === 'pa_rev717_bracket') issues.push({ code: 'rounding_policy_pa_bracket_not_encoded' });
  else if (input.roundingPolicy !== 'half_away_from_zero_cents') issues.push({ code: 'rounding_policy_invalid' });

  if (!Array.isArray(input.lines) || input.lines.length === 0) issues.push({ code: 'no_lines' });

  const headerShipping = input.headerSellerShippingCents ?? 0;
  if (!isIntegerCents(headerShipping) || headerShipping < 0) {
    issues.push({ code: 'header_shipping_invalid' });
  }

  const prepared = (input.lines || []).map((line) => {
    const merchandiseCents = nonNegative(line.merchandiseCents, 'merchandise_invalid', line.lineId, issues);
    const purchasePriceDiscountCents = nonNegative(
      line.purchasePriceDiscountCents,
      'discount_invalid',
      line.lineId,
      issues
    );
    const promptPaymentDiscountCents = nonNegative(
      line.promptPaymentDiscountCents,
      'discount_invalid',
      line.lineId,
      issues
    );
    const unclassifiedDiscountCents = nonNegative(
      line.unclassifiedDiscountCents,
      'discount_invalid',
      line.lineId,
      issues
    );
    const sellerBilledShippingCents = nonNegative(
      line.sellerBilledShippingCents,
      'shipping_invalid',
      line.lineId,
      issues
    );
    const thirdPartyFreightCents = nonNegative(
      line.thirdPartyFreightCents,
      'shipping_invalid',
      line.lineId,
      issues
    );
    const unclassifiedShippingCents = nonNegative(
      line.unclassifiedShippingCents,
      'shipping_invalid',
      line.lineId,
      issues
    );
    if (unclassifiedDiscountCents > 0) issues.push({ code: 'discount_unclassified', lineId: line.lineId });
    if (unclassifiedShippingCents > 0) issues.push({ code: 'shipping_unclassified', lineId: line.lineId });
    if (purchasePriceDiscountCents > merchandiseCents) {
      issues.push({ code: 'discount_exceeds_merchandise', lineId: line.lineId });
    }
    if (line.taxability === 'unconfigured') issues.push({ code: 'taxability_unconfigured', lineId: line.lineId });
    else if (line.taxability !== 'taxable' && line.taxability !== 'exempt' && line.taxability !== 'non_taxable') {
      issues.push({ code: 'taxability_invalid', lineId: line.lineId });
    }
    const exemptionIssue = exemptionIssueFor(line, input.transactionDate);
    if (exemptionIssue) issues.push(exemptionIssue);
    return {
      line,
      merchandiseCents,
      purchasePriceDiscountCents,
      promptPaymentDiscountCents,
      sellerBilledShippingCents,
      thirdPartyFreightCents,
    };
  });

  if (headerShipping > 0 && prepared.some((row) => row.sellerBilledShippingCents > 0)) {
    issues.push({ code: 'shipping_double_counted' });
  }

  let allocatedHeader = new Map<string, number>();
  if (headerShipping > 0 && issues.length === 0) {
    const allocation = allocateIntegerCents(
      headerShipping,
      prepared.map((row) => ({
        id: row.line.lineId,
        weightCents: netMerchandise(row.merchandiseCents, row.purchasePriceDiscountCents),
      }))
    );
    if (!allocation.ok) issues.push({ code: 'shipping_allocation_failed' });
    else allocatedHeader = new Map(allocation.shares.map((share) => [share.id, share.cents]));
  }

  if (issues.length > 0) return incomplete(issues);

  const warnings: SalesTaxIssue[] = [];
  const lines: SalesTaxLinePreview[] = prepared.map((row) => {
    const sellerShipping = row.sellerBilledShippingCents + (allocatedHeader.get(row.line.lineId) ?? 0);
    const net = netMerchandise(row.merchandiseCents, row.purchasePriceDiscountCents);
    const customerExempt = exemptionApplies(row.line.exemption, input.transactionDate);
    if (row.line.exemption && row.line.exemption.approval === 'pending') {
      warnings.push({ code: 'exemption_not_approved', lineId: row.line.lineId });
    }
    if (row.line.exemption && row.line.exemption.approval === 'revoked') {
      warnings.push({ code: 'exemption_revoked', lineId: row.line.lineId });
    }
    if (row.line.exemption?.approval === 'approved' && !customerExempt) {
      warnings.push({ code: 'exemption_outside_effective_dates', lineId: row.line.lineId });
    }
    let treatment: SalesTaxLinePreview['treatment'];
    let taxableBaseCents = 0;
    let exemptBaseCents = 0;
    let nonTaxableBaseCents = 0;
    if (customerExempt || row.line.taxability === 'exempt') {
      treatment = customerExempt ? 'customer_exempt' : 'exempt';
      exemptBaseCents = net + sellerShipping;
    } else if (row.line.taxability === 'non_taxable') {
      treatment = 'non_taxable';
      nonTaxableBaseCents = net + sellerShipping;
    } else {
      treatment = 'taxable';
      taxableBaseCents = net + sellerShipping;
    }
    const taxCents =
      treatment === 'taxable' ? rateTaxHalfAwayFromZero(taxableBaseCents, rate as number) : 0;
    return {
      lineId: row.line.lineId,
      merchandiseCents: row.merchandiseCents,
      purchasePriceDiscountCents: row.purchasePriceDiscountCents,
      promptPaymentDiscountCents: row.promptPaymentDiscountCents,
      sellerBilledShippingCents: sellerShipping,
      thirdPartyFreightCents: row.thirdPartyFreightCents,
      taxableBaseCents,
      exemptBaseCents,
      nonTaxableBaseCents,
      taxCents,
      treatment,
    };
  });

  const totals = lines.reduce<SalesTaxTotals>(
    (sum, line) => ({
      merchandiseCents: sum.merchandiseCents + line.merchandiseCents,
      purchasePriceDiscountCents: sum.purchasePriceDiscountCents + line.purchasePriceDiscountCents,
      promptPaymentDiscountCents: sum.promptPaymentDiscountCents + line.promptPaymentDiscountCents,
      sellerBilledShippingCents: sum.sellerBilledShippingCents + line.sellerBilledShippingCents,
      thirdPartyFreightCents: sum.thirdPartyFreightCents + line.thirdPartyFreightCents,
      taxableBaseCents: sum.taxableBaseCents + line.taxableBaseCents,
      exemptBaseCents: sum.exemptBaseCents + line.exemptBaseCents,
      nonTaxableBaseCents: sum.nonTaxableBaseCents + line.nonTaxableBaseCents,
      taxCents: sum.taxCents + line.taxCents,
    }),
    {
      merchandiseCents: 0,
      purchasePriceDiscountCents: 0,
      promptPaymentDiscountCents: 0,
      sellerBilledShippingCents: 0,
      thirdPartyFreightCents: 0,
      taxableBaseCents: 0,
      exemptBaseCents: 0,
      nonTaxableBaseCents: 0,
      taxCents: 0,
    }
  );

  return {
    status: 'preview',
    version: SALES_TAX_PREVIEW_VERSION,
    postingAllowed: false,
    filingReady: false,
    postingBlockers: salesTaxPostingBlockers().map((item) => item.id),
    jurisdictionCode: jurisdiction,
    rateBasisPoints: rate as number,
    roundingPolicy: 'half_away_from_zero_cents',
    lines,
    totals,
    warnings,
  };
}

function exemptionIssueFor(line: SalesTaxLineInput, transactionDate: string): SalesTaxIssue | null {
  const exemption = line.exemption;
  if (!exemption || exemption.approval !== 'approved') return null;
  if (!exemption.effectiveOn || !isIsoDate(exemption.effectiveOn)) {
    return { code: 'exemption_dates_missing', lineId: line.lineId };
  }
  if (exemption.expiresOn != null && exemption.expiresOn !== '' && !isIsoDate(exemption.expiresOn)) {
    return { code: 'exemption_dates_invalid', lineId: line.lineId };
  }
  if (!isIsoDate(transactionDate)) return null;
  return null;
}

function exemptionApplies(exemption: SalesTaxExemptionInput | null | undefined, transactionDate: string): boolean {
  if (!exemption || exemption.approval !== 'approved') return false;
  if (!exemption.effectiveOn || !isIsoDate(exemption.effectiveOn) || !isIsoDate(transactionDate)) return false;
  if (transactionDate < exemption.effectiveOn) return false;
  if (exemption.expiresOn != null && exemption.expiresOn !== '' && transactionDate > exemption.expiresOn) return false;
  return true;
}
