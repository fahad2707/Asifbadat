/**
 * Client-side Excel export for invoices / quotations.
 * Purely presentational: it serialises what the list API already returned,
 * so no financial figures are recomputed here.
 */

export interface ExportableInvoiceItem {
  product_name?: string;
  quantity?: number;
  price?: number;
  subtotal?: number;
}

export interface ExportableInvoice {
  id: string;
  invoice_number: string;
  invoice_type?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  total_amount: number;
  amount_paid?: number;
  payment_status?: string;
  created_at: string;
  invoice_date?: string;
  items?: ExportableInvoiceItem[];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const dateOf = (inv: ExportableInvoice) => new Date(inv.invoice_date || inv.created_at);

export async function exportInvoicesToExcel(invoices: ExportableInvoice[], filenameBase = 'invoices'): Promise<void> {
  // Lazy-load so the (large) SheetJS bundle is only fetched when someone exports.
  const XLSX = await import('xlsx');

  const documents = invoices.map((inv) => {
    const quotation = inv.invoice_type === 'quotation';
    const total = num(inv.total_amount);
    const paid = quotation ? null : num(inv.amount_paid);
    return {
      Type: quotation ? 'Quotation' : 'Invoice',
      Number: inv.invoice_number,
      Date: dateOf(inv),
      Customer: inv.customer_name || '',
      Phone: inv.customer_phone || '',
      Email: inv.customer_email || '',
      Amount: total,
      Paid: paid,
      Balance: quotation ? null : total - num(inv.amount_paid),
      Status: quotation ? 'Quote' : (inv.payment_status || 'unpaid').toLowerCase() === 'paid' ? 'Paid' : 'Unpaid',
      Items: (inv.items || []).length,
    };
  });

  const lines = invoices.flatMap((inv) =>
    (inv.items || []).map((it) => ({
      Type: inv.invoice_type === 'quotation' ? 'Quotation' : 'Invoice',
      Number: inv.invoice_number,
      Date: dateOf(inv),
      Customer: inv.customer_name || '',
      Product: it.product_name || '',
      Quantity: num(it.quantity),
      'Unit price': num(it.price),
      'Line total': it.subtotal != null ? num(it.subtotal) : num(it.quantity) * num(it.price),
    })),
  );

  const wb = XLSX.utils.book_new();

  const docSheet = XLSX.utils.json_to_sheet(documents, { cellDates: true });
  docSheet['!cols'] = [10, 12, 12, 32, 16, 28, 12, 12, 12, 10, 8].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, docSheet, 'Documents');

  if (lines.length > 0) {
    const lineSheet = XLSX.utils.json_to_sheet(lines, { cellDates: true });
    lineSheet['!cols'] = [10, 12, 12, 32, 48, 10, 12, 12].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, lineSheet, 'Line items');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filenameBase}-${stamp}.xlsx`, { bookType: 'xlsx', cellDates: true });
}
