'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Printer, Search, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import { formatApiError } from '@/lib/format-api-error';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import ReceivePaymentLightbox from '@/components/admin/ReceivePaymentLightbox';
import PaymentsStatement, { PAYMENT_PERIODS } from '@/components/admin/PaymentsStatement';

type Payment = {
  id: string;
  trx_date?: string;
  trx_id: string;
  customer_name?: string;
  invoice_num?: string;
  pmt_mode?: string;
  amount_received?: number;
  deposit_status?: 'pending' | 'deposited' | 'archived';
  settlement?: 'full' | 'partial' | null;
  remaining?: number | null;
  invoice_total?: number | null;
  invoice_balance?: number | null;
  comment?: string;
};

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

function csvCell(value: string | number) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function depositLabel(row: Payment) {
  if (row.deposit_status === 'deposited') {
    return row.invoice_balance && row.invoice_balance > 0 ? `Deposited · ${money(row.invoice_balance)} left` : 'Deposited';
  }
  if (row.deposit_status === 'archived') return 'Archived';
  return row.invoice_balance != null ? `Remaining ${money(row.invoice_balance)}` : 'Not deposited';
}

export default function PaymentsPage() {
  const [rows, setRows] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [period, setPeriod] = useState<(typeof PAYMENT_PERIODS)[number]['id']>('month');
  const [statementOpen, setStatementOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    try {
      const res = await adminApi.get('/receipts', { params: { limit: 1000 } });
      setRows(res.data?.receipts || []);
    } catch (error) {
      if (isAdminAuthRedirectError(error)) return;
      toast.error(formatApiError(error, 'Failed to load payments'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => [row.trx_id, row.customer_name, row.invoice_num, row.pmt_mode, row.comment, row.settlement].join(' ').toLowerCase().includes(q));
  }, [rows, search]);

  const chosen = visible.filter((row) => selected.has(row.id));

  const exportRows = (list: Payment[]) => {
    const header = ['Date', 'Type', 'Invoice', 'Reference', 'Customer', 'Amount', 'Paid', 'Method', 'Deposit'];
    const body = list.map((row) => [
      row.trx_date ? new Date(row.trx_date).toLocaleDateString() : '',
      row.settlement || '',
      row.invoice_num || '',
      row.trx_id,
      row.customer_name || '',
      row.invoice_total ?? '',
      row.amount_received ?? 0,
      row.pmt_mode || '',
      depositLabel(row),
    ]);
    const csv = [header, ...body].map((line) => line.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'received-payments.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const printRows = (list: Payment[]) => {
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) {
      toast.error('Allow pop-ups to print these payments.');
      return;
    }
    const body = list.map((row) => `<tr><td>${row.trx_date ? new Date(row.trx_date).toLocaleDateString() : ''}</td><td>${row.settlement || ''}</td><td>${row.invoice_num || ''}</td><td>${row.trx_id}</td><td>${row.customer_name || ''}</td><td>${money(row.invoice_total || 0)}</td><td>${money(row.amount_received || 0)}</td><td>${row.pmt_mode || ''}</td><td>${depositLabel(row)}</td></tr>`).join('');
    popup.document.write(`<!doctype html><html><head><title>Received payments</title><style>body{font-family:Georgia,serif;padding:24px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}</style></head><body><h1>Received payments</h1><table><thead><tr><th>Date</th><th>Type</th><th>Invoice</th><th>Reference</th><th>Customer</th><th>Amount</th><th>Paid</th><th>Method</th><th>Deposit</th></tr></thead><tbody>${body}</tbody></table><script>window.print()<\/script></body></html>`);
    popup.document.close();
  };

  const removeSelected = async () => {
    if (chosen.length === 0 || deleting) return;
    if (!confirm(`Delete ${chosen.length} payment${chosen.length === 1 ? '' : 's'}? Invoice balances are put back.`)) return;
    setDeleting(true);
    let failed = 0;
    for (const row of chosen) {
      try {
        await adminApi.delete(`/receipts/${row.id}`);
      } catch {
        failed += 1;
      }
    }
    setDeleting(false);
    setSelected(new Set());
    if (failed) toast.error(`${failed} payment${failed === 1 ? '' : 's'} could not be deleted`);
    else toast.success('Payments deleted');
    void load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={adminUi.pageTitle}>Received payments</h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setStatementOpen(true)} className={adminUi.btnSecondary}>Statement</button>
          <button type="button" onClick={() => setReceiveOpen(true)} className={adminUi.btnPrimary}>Receive payment</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#E2E8F0] bg-white p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference, invoice, customer, or method"
            className="w-full rounded-lg border border-[#E2E8F0] bg-white py-2 pl-9 pr-3 text-xs text-[#0F172A] focus:border-[#0F9F8F] focus:outline-none focus:ring-1 focus:ring-[#0F9F8F]"
          />
        </div>
        <select aria-label="Statement period" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A]">
          {PAYMENT_PERIODS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>

      {chosen.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[#E3E5E8] bg-[#F4F5F8] px-4 py-2">
          <span className="text-sm font-medium">{chosen.length} selected</span>
          <div className="flex items-center gap-1">
            <button type="button" className={`${adminUi.btnIcon} disabled:opacity-40`} title="Delete" aria-label="Delete selected" disabled={deleting} onClick={() => void removeSelected()}><Trash2 className="h-4 w-4" /></button>
            <button type="button" className={adminUi.btnIcon} title="Export" aria-label="Export selected" onClick={() => exportRows(chosen)}><Download className="h-4 w-4" /></button>
            <button type="button" className={adminUi.btnIcon} title="Print" aria-label="Print selected" onClick={() => printRows(chosen)}><Printer className="h-4 w-4" /></button>
            <button type="button" className={adminUi.btnIcon} title="Clear selection" aria-label="Clear selection" onClick={() => setSelected(new Set())}><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-black border-t-transparent" /></div>
      ) : visible.length === 0 ? (
        <div className={`${adminUi.panel} p-12 text-center`}><p className="text-sm">No payments yet.</p></div>
      ) : (
        <div className={`${adminUi.panel} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={adminUi.tableHead}>
                <tr>
                  <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select all" checked={visible.length > 0 && visible.every((row) => selected.has(row.id))} onChange={() => setSelected((prev) => {
                    const next = new Set(prev);
                    const all = visible.every((row) => next.has(row.id));
                    visible.forEach((row) => { if (all) next.delete(row.id); else next.add(row.id); });
                    return next;
                  })} className="h-4 w-4 accent-black" /></th>
                  <th className="px-3 py-3 text-left">Date</th>
                  <th className="px-3 py-3 text-left">Type</th>
                  <th className="px-3 py-3 text-left">Invoice</th>
                  <th className="px-3 py-3 text-left">Reference</th>
                  <th className="px-3 py-3 text-left">Customer</th>
                  <th className="px-3 py-3 text-right">Amount</th>
                  <th className="px-3 py-3 text-right">Paid</th>
                  <th className="px-3 py-3 text-left">Method</th>
                  <th className="px-3 py-3 text-left">Deposit</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className={`border-t border-[#E3E5E8] ${selected.has(row.id) ? 'bg-[#F4F5F8]' : ''}`}>
                    <td className="px-4 py-3"><input type="checkbox" aria-label={`Select ${row.trx_id}`} checked={selected.has(row.id)} onChange={() => setSelected((prev) => { const next = new Set(prev); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })} className="h-4 w-4 accent-black" /></td>
                    <td className="whitespace-nowrap px-3 py-3">{row.trx_date ? new Date(row.trx_date).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-3 capitalize">{row.settlement === 'full' ? 'Full' : row.settlement === 'partial' ? 'Partial' : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3">{row.invoice_num || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3">{row.trx_id}</td>
                    <td className="px-3 py-3">{row.customer_name || '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.invoice_total == null ? '—' : money(row.invoice_total)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(row.amount_received || 0)}</td>
                    <td className="px-3 py-3">{row.pmt_mode || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3">{depositLabel(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ReceivePaymentLightbox
        isOpen={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        onRecorded={() => { void load(); }}
      />
      {statementOpen && <PaymentsStatement period={period} onClose={() => setStatementOpen(false)} />}
    </div>
  );
}
