/**
 * Display-only tax marks for invoices. Does not change stored tax amounts.
 */

export function taxMarkFromName(name?: string | null, taxable?: boolean): string {
  if (taxable !== true) return '';
  const letters = String(name || 'TAX').replace(/[^A-Za-z]/g, '').toUpperCase();
  return (letters || 'TAX').slice(0, 6);
}

export type LineTaxInput = {
  product_name?: string;
  taxable?: boolean;
  tax_type_name?: string | null;
  tax_type_label?: string | null;
  tax_amount?: number;
};

export type TaxGroupRow = {
  mark: string;
  name: string;
  amount: number;
};

const round = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function summarizeInvoiceTaxes(items: LineTaxInput[]): TaxGroupRow[] {
  const groups = new Map<string, TaxGroupRow>();
  for (const item of items || []) {
    const amount = round(item.tax_amount);
    if (item.taxable !== true && amount === 0) continue;
    const name = String(item.tax_type_name || item.tax_type_label || 'Tax').trim() || 'Tax';
    const mark = taxMarkFromName(item.tax_type_name || name, true);
    const current = groups.get(name) || { mark, name, amount: 0 };
    current.amount = round(current.amount + amount);
    groups.set(name, current);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
