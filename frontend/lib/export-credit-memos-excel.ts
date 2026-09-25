/**
 * Client-side Excel export for credit memos.
 * Serialises the list API payload; no figures are recomputed.
 */

export interface ExportableCreditMemoItem {
  product_name?: string;
  quantity?: number;
  unit_price?: number;
  total?: number;
}

export interface ExportableCreditMemo {
  id: string;
  credit_memo_number: string;
  type?: string;
  vendor_name?: string;
  customer_name?: string;
  reason?: string;
  status?: string;
  total_amount: number;
  created_at: string;
  items?: ExportableCreditMemoItem[];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

export async function exportCreditMemosToExcel(rows: ExportableCreditMemo[], filenameBase = 'credit-memos'): Promise<void> {
  const XLSX = await import('xlsx');

  const documents = rows.map((cm) => ({
    Number: cm.credit_memo_number,
    Date: new Date(cm.created_at),
    Type: cm.type || '',
    Party: cm.type === 'VENDOR' ? cm.vendor_name || '' : cm.customer_name || '',
    Reason: cm.reason || '',
    Status: cm.status || '',
    Amount: num(cm.total_amount),
    Items: (cm.items || []).length,
  }));

  const lines = rows.flatMap((cm) =>
    (cm.items || []).map((it) => ({
      Number: cm.credit_memo_number,
      Date: new Date(cm.created_at),
      Type: cm.type || '',
      Party: cm.type === 'VENDOR' ? cm.vendor_name || '' : cm.customer_name || '',
      Product: it.product_name || '',
      Quantity: num(it.quantity),
      'Unit price': num(it.unit_price),
      'Line total': it.total != null ? num(it.total) : num(it.quantity) * num(it.unit_price),
    })),
  );

  const wb = XLSX.utils.book_new();
  const docSheet = XLSX.utils.json_to_sheet(documents, { cellDates: true });
  docSheet['!cols'] = [16, 12, 10, 32, 16, 12, 12, 8].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, docSheet, 'Credit memos');

  if (lines.length > 0) {
    const lineSheet = XLSX.utils.json_to_sheet(lines, { cellDates: true });
    lineSheet['!cols'] = [16, 12, 10, 32, 48, 10, 12, 12].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, lineSheet, 'Line items');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filenameBase}-${stamp}.xlsx`, { bookType: 'xlsx', cellDates: true });
}
