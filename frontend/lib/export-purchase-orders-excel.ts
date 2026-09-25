/**
 * Client-side Excel export for purchase orders.
 * Serialises the list API payload; no figures are recomputed.
 */

export interface ExportablePOItem {
  product_name?: string;
  quantity_ordered?: number;
  unit_cost?: number;
  subtotal?: number;
}

export interface ExportablePO {
  id: string;
  po_number: string;
  vendor_name?: string;
  supplier_id?: string;
  status?: string;
  total_amount: number;
  created_at: string;
  items?: ExportablePOItem[];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

export async function exportPurchaseOrdersToExcel(rows: ExportablePO[], filenameBase = 'purchase-orders'): Promise<void> {
  const XLSX = await import('xlsx');

  const documents = rows.map((po) => ({
    Number: po.po_number,
    Date: new Date(po.created_at),
    Supplier: po.vendor_name || '',
    'Supplier ID': po.supplier_id || '',
    Status: po.status || '',
    Amount: num(po.total_amount),
    Items: (po.items || []).length,
  }));

  const lines = rows.flatMap((po) =>
    (po.items || []).map((it) => ({
      Number: po.po_number,
      Date: new Date(po.created_at),
      Supplier: po.vendor_name || '',
      Product: it.product_name || '',
      Quantity: num(it.quantity_ordered),
      'Unit cost': num(it.unit_cost),
      'Line total': it.subtotal != null ? num(it.subtotal) : num(it.quantity_ordered) * num(it.unit_cost),
    })),
  );

  const wb = XLSX.utils.book_new();
  const docSheet = XLSX.utils.json_to_sheet(documents, { cellDates: true });
  docSheet['!cols'] = [14, 12, 32, 14, 12, 12, 8].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, docSheet, 'Purchase orders');

  if (lines.length > 0) {
    const lineSheet = XLSX.utils.json_to_sheet(lines, { cellDates: true });
    lineSheet['!cols'] = [14, 12, 32, 48, 10, 12, 12].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, lineSheet, 'Line items');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filenameBase}-${stamp}.xlsx`, { bookType: 'xlsx', cellDates: true });
}
