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
