export type TaxTypeOption = {
  id: string;
  name: string;
  rate: number;
  rate_type?: string;
};

export function formatTaxTypeLabel(t: { name: string; rate: number; rate_type?: string }): string {
  const name = String(t.name || '').trim() || 'Tax';
  const rate = Number(t.rate);
  const safeRate = Number.isFinite(rate) ? rate : 0;
  if (t.rate_type === 'amount') {
    const dollars = Number.isInteger(safeRate) ? String(safeRate) : safeRate.toFixed(2).replace(/\.?0+$/, '');
    return `${name} — $${dollars}`;
  }
  return `${name} — ${safeRate}%`;
}

export function productTaxLabel(product: {
  tax_type_configured?: boolean;
  tax_type_id?: string | null;
  tax_type_label?: string;
  tax_type?: TaxTypeOption | null;
}): string {
  if (product.tax_type_label) return product.tax_type_label;
  if (product.tax_type) return formatTaxTypeLabel(product.tax_type);
  if (product.tax_type_configured && !product.tax_type_id) return 'No Tax';
  return 'Not configured';
}

export type InvoiceLineTaxIssue = 'not_configured' | 'amount_unsupported' | null;

export const CUSTOMER_EXEMPT_TAX_LABEL = 'Customer Exempt';

export type InvoiceLineTaxState = {
  taxable: boolean;
  tax_type_configured: boolean;
  tax_type_id: string | null;
  tax_type_name: string | null;
  tax_rate_type: 'percent' | 'amount' | null;
  tax_rate: number;
  tax_amount: number;
  tax_type_label: string;
  tax_exempt?: boolean;
  total: number;
  issue: InvoiceLineTaxIssue;
};

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function computePercentLineTax(subtotal: number, rate: number): number {
  return roundMoney((Number(subtotal) || 0) * ((Number(rate) || 0) / 100));
}

export function emptyInvoiceLineTax(subtotal = 0): InvoiceLineTaxState {
  const sub = roundMoney(subtotal);
  return {
    taxable: false,
    tax_type_configured: false,
    tax_type_id: null,
    tax_type_name: null,
    tax_rate_type: null,
    tax_rate: 0,
    tax_amount: 0,
    tax_type_label: '',
    total: sub,
    issue: null,
  };
}

export function inheritInvoiceLineTax(
  product: {
    name?: string;
    tax_type_configured?: boolean;
    tax_type_id?: string | null;
    tax_type_label?: string;
    tax_type?: TaxTypeOption | null;
  },
  subtotal: number,
  customerExempt = false
): InvoiceLineTaxState {
  const sub = roundMoney(subtotal);
  const configured = product.tax_type_configured === true;
  if (!configured) {
    return {
      ...emptyInvoiceLineTax(sub),
      tax_type_label: 'Not configured',
      issue: 'not_configured',
    };
  }
  if (!product.tax_type_id) {
    const none: InvoiceLineTaxState = {
      taxable: false,
      tax_type_configured: true,
      tax_type_id: null,
      tax_type_name: 'No Tax',
      tax_rate_type: null,
      tax_rate: 0,
      tax_amount: 0,
      tax_type_label: customerExempt ? CUSTOMER_EXEMPT_TAX_LABEL : 'No Tax',
      tax_exempt: customerExempt || undefined,
      total: sub,
      issue: null,
    };
    return none;
  }
  const taxType = product.tax_type;
  if (taxType?.rate_type === 'amount') {
    return {
      taxable: false,
      tax_type_configured: true,
      tax_type_id: String(product.tax_type_id),
      tax_type_name: taxType.name || null,
      tax_rate_type: 'amount',
      tax_rate: Number(taxType.rate) || 0,
      tax_amount: 0,
      tax_type_label: productTaxLabel(product),
      total: sub,
      issue: 'amount_unsupported',
    };
  }
  const rate = Number(taxType?.rate) || 0;
  if (customerExempt) {
    return {
      taxable: false,
      tax_type_configured: true,
      tax_type_id: String(product.tax_type_id),
      tax_type_name: taxType?.name || null,
      tax_rate_type: 'percent',
      tax_rate: rate,
      tax_amount: 0,
      tax_type_label: CUSTOMER_EXEMPT_TAX_LABEL,
      tax_exempt: true,
      total: sub,
      issue: null,
    };
  }
  const tax_amount = computePercentLineTax(sub, rate);
  return {
    taxable: true,
    tax_type_configured: true,
    tax_type_id: String(product.tax_type_id),
    tax_type_name: taxType?.name || null,
    tax_rate_type: 'percent',
    tax_rate: rate,
    tax_amount,
    tax_type_label: productTaxLabel(product),
    total: roundMoney(sub + tax_amount),
    issue: null,
  };
}

export function recalculateInvoiceLineTax(
  subtotal: number,
  line: Partial<InvoiceLineTaxState>
): InvoiceLineTaxState {
  const sub = roundMoney(subtotal);
  if (line.tax_exempt === true) {
    return {
      taxable: false,
      tax_type_configured: true,
      tax_type_id: line.tax_type_id ?? null,
      tax_type_name: line.tax_type_name ?? null,
      tax_rate_type: line.tax_rate_type ?? null,
      tax_rate: Number(line.tax_rate) || 0,
      tax_amount: 0,
      tax_type_label: CUSTOMER_EXEMPT_TAX_LABEL,
      tax_exempt: true,
      total: sub,
      issue: null,
    };
  }
  if (line.issue === 'not_configured' || line.issue === 'amount_unsupported') {
    return {
      taxable: false,
      tax_type_configured: line.issue !== 'not_configured',
      tax_type_id: line.tax_type_id ?? null,
      tax_type_name: line.tax_type_name ?? null,
      tax_rate_type: line.tax_rate_type ?? null,
      tax_rate: Number(line.tax_rate) || 0,
      tax_amount: 0,
      tax_type_label: line.tax_type_label || (line.issue === 'not_configured' ? 'Not configured' : ''),
      total: sub,
      issue: line.issue,
    };
  }
  const taxable = line.taxable === true;
  const rate = Number(line.tax_rate) || 0;
  const tax_amount = taxable && line.tax_rate_type === 'percent' ? computePercentLineTax(sub, rate) : 0;
  return {
    taxable,
    tax_type_configured: line.tax_type_configured !== false && (line.taxable !== undefined || Boolean(line.tax_type_label)),
    tax_type_id: line.tax_type_id ?? null,
    tax_type_name: line.tax_type_name ?? (taxable ? null : 'No Tax'),
    tax_rate_type: line.tax_rate_type ?? null,
    tax_rate: taxable ? rate : 0,
    tax_amount,
    tax_type_label: line.tax_type_label || (taxable ? 'Tax' : line.taxable === false ? 'No Tax' : ''),
    total: roundMoney(sub + tax_amount),
    issue: null,
  };
}
