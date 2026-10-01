import mongoose from 'mongoose';

/**
 * Product → TaxType assignment helpers.
 *
 * tax_type_id missing / undefined  → not configured (legacy products)
 * tax_type_id === null             → explicit No Tax
 * tax_type_id === ObjectId         → assigned TaxType
 *
 * Does not read or write Product.tax_rate or Product.price.
 */

export type TaxTypeRateKind = 'percent' | 'amount';

export type TaxTypeSummary = {
  id: string;
  name: string;
  rate: number;
  rate_type: TaxTypeRateKind;
};

export type ParsedTaxTypeAssignment =
  | { kind: 'omit' }
  | { kind: 'no_tax' }
  | { kind: 'assigned'; id: mongoose.Types.ObjectId };

export function formatTaxTypeLabel(input: {
  name: string;
  rate: number;
  rate_type?: string;
}): string {
  const name = String(input.name || '').trim() || 'Tax';
  const rate = Number(input.rate);
  const safeRate = Number.isFinite(rate) ? rate : 0;
  if (input.rate_type === 'amount') {
    const dollars = Number.isInteger(safeRate) ? String(safeRate) : safeRate.toFixed(2).replace(/\.?0+$/, '');
    return `${name} — $${dollars}`;
  }
  return `${name} — ${safeRate}%`;
}

export function hasExplicitTaxTypeField(product: object): boolean {
  return Object.prototype.hasOwnProperty.call(product, 'tax_type_id');
}

export function parseTaxTypeIdInput(raw: unknown): ParsedTaxTypeAssignment {
  if (raw === undefined) return { kind: 'omit' };
  if (raw === null) return { kind: 'no_tax' };
  if (typeof raw !== 'string') {
    throw new Error('Invalid tax_type_id');
  }
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '__no_tax__') return { kind: 'no_tax' };
  if (!/^[a-f0-9A-F]{24}$/.test(trimmed)) {
    throw new Error('Invalid tax_type_id');
  }
  return { kind: 'assigned', id: new mongoose.Types.ObjectId(trimmed) };
}

export function summarizePopulatedTaxType(value: unknown): TaxTypeSummary | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    return { id: value, name: '', rate: 0, rate_type: 'percent' };
  }
  if (typeof value !== 'object') return null;
  const doc = value as {
    _id?: unknown;
    id?: unknown;
    name?: unknown;
    rate?: unknown;
    rate_type?: unknown;
    toString?: () => string;
  };
  const id =
    doc._id != null
      ? String(doc._id)
      : doc.id != null
        ? String(doc.id)
        : typeof doc.toString === 'function'
          ? doc.toString()
          : '';
  if (!id) return null;
  return {
    id,
    name: typeof doc.name === 'string' ? doc.name : '',
    rate: Number(doc.rate) || 0,
    rate_type: doc.rate_type === 'amount' ? 'amount' : 'percent',
  };
}

export function staffTaxTypeFields(product: { tax_type_id?: unknown }) {
  const configured = hasExplicitTaxTypeField(product);
  if (!configured) {
    return {
      tax_type_configured: false,
      tax_type_id: null as string | null,
      tax_type: null as TaxTypeSummary | null,
      tax_type_label: 'Not configured',
    };
  }
  if (product.tax_type_id == null) {
    return {
      tax_type_configured: true,
      tax_type_id: null as string | null,
      tax_type: null as TaxTypeSummary | null,
      tax_type_label: 'No Tax',
    };
  }
  const summary = summarizePopulatedTaxType(product.tax_type_id);
  if (!summary) {
    return {
      tax_type_configured: true,
      tax_type_id: String(product.tax_type_id),
      tax_type: null as TaxTypeSummary | null,
      tax_type_label: 'Not configured',
    };
  }
  return {
    tax_type_configured: true,
    tax_type_id: summary.id,
    tax_type: summary,
    tax_type_label: summary.name ? formatTaxTypeLabel(summary) : 'Not configured',
  };
}
