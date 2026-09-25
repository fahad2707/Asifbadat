/**
 * Client-side Excel export for bank transactions.
 * Serialises the rows already on screen — no amounts are recomputed.
 */

export interface ExportableBankRow {
  date: string;
  kind: 'receipt' | 'expense';
  trx_id: string;
  party: string;
  reference: string;
  pmt_mode: string;
  amount: number;
  direction: 'in' | 'out';
  bank_account_name?: string;
  deposit_status?: string;
  deposited_at?: string;
  comment?: string;
}

export async function exportBankTransactionsToExcel(rows: ExportableBankRow[], filenameBase = 'bank-transactions'): Promise<void> {
  const XLSX = await import('xlsx');
  const sheet = rows.map((r) => ({
    Date: r.date ? new Date(r.date) : '',
    Type: r.direction === 'in' ? 'Received' : 'Paid bill',
    Ref: r.trx_id,
    Reference: r.reference || '',
    Party: r.party || '',
    Method: r.pmt_mode || '',
    Amount: r.direction === 'out' ? -Math.abs(Number(r.amount) || 0) : Number(r.amount) || 0,
    Bank: r.bank_account_name || '',
    Status: r.deposit_status || '',
    Deposited: r.deposited_at ? new Date(r.deposited_at) : '',
    Comment: r.comment || '',
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheet, { cellDates: true });
  ws['!cols'] = [12, 12, 16, 24, 28, 14, 12, 16, 12, 18, 32].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
  XLSX.writeFile(wb, `${filenameBase}-${new Date().toISOString().slice(0, 10)}.xlsx`, { bookType: 'xlsx', cellDates: true });
}
