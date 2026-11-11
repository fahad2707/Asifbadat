/**
 * Short sequential document numbers, INV#001 style.
 * Prefix is the identifier; the counter is per prefix.
 */
export const DOC_PREFIX = {
  invoice: 'INV#',
  quotation: 'QTN#',
  quotationFromRfq: 'RQ#',
  quotationFromOnline: 'WQ#',
  invoiceFromQuotation: 'QI#',
  invoiceFromRfq: 'RI#',
  invoiceFromOnline: 'WI#',
  rfq: 'RFQ#',
  onlineOrder: 'WEB#',
  purchaseOrder: 'PO#',
  customerCreditMemo: 'CMC#',
  vendorCreditMemo: 'CMV#',
  shipment: 'SH#',
  returnShipment: 'RG#',
  expense: 'EXP#',
} as const;

export type QuotationOrigin = 'quotation' | 'rfq' | 'online';

const PREFIX_PATTERN = /^[A-Z]{2,4}#$/;

export function quotationPrefixForOrigin(origin: unknown): string {
  if (origin === 'rfq') return DOC_PREFIX.quotationFromRfq;
  if (origin === 'online') return DOC_PREFIX.quotationFromOnline;
  return DOC_PREFIX.quotation;
}

/** Converted invoices keep a different series from typed INV# documents. */
export function convertedInvoicePrefix(quoteNumber: unknown): string {
  const n = String(quoteNumber || '');
  if (n.startsWith(DOC_PREFIX.quotationFromRfq)) return DOC_PREFIX.invoiceFromRfq;
  if (n.startsWith(DOC_PREFIX.quotationFromOnline)) return DOC_PREFIX.invoiceFromOnline;
  return DOC_PREFIX.invoiceFromQuotation;
}

export function parseQuotationOrigin(raw: unknown): QuotationOrigin | undefined {
  if (raw === 'rfq' || raw === 'online' || raw === 'quotation') return raw;
  return undefined;
}

type Leanable = { lean?: () => Promise<unknown> };
type Selectable = Leanable & { select?: (fields: string) => Leanable };
type Findable = {
  find: (filter: Record<string, unknown>) => Selectable;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function nextPrefixedNumber(
  model: Findable,
  field: string,
  prefix: string,
  pad = 3
): Promise<string> {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Invalid document prefix: ${prefix}`);
  }
  const filter = { [field]: new RegExp(`^${escapeRegex(prefix)}\\d+$`) };
  const q = model.find(filter);
  const selected = typeof q.select === 'function' ? q.select(field) : q;
  const docs = ((await (typeof selected.lean === 'function' ? selected.lean() : [])) || []) as Array<
    Record<string, unknown>
  >;
  let max = 0;
  for (const d of docs) {
    const raw = String(d?.[field] ?? '');
    const n = parseInt(raw.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(pad, '0')}`;
}
