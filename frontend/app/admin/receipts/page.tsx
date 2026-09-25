'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, Plus, Printer, Search, Trash2, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import toast from 'react-hot-toast';
import { adminUi } from '@/lib/admin-ui';
import { exportBankTransactionsToExcel } from '@/lib/export-bank-transactions-excel';
import { printBankTransactions } from '@/lib/print-bank-transactions';

interface Receipt {
  id: string;
  trx_date: string;
  trx_id: string;
  customer_id?: string;
  customer_name: string;
  bank_account_id?: string;
  bank_account_name?: string;
  so_id?: string;
  invoice_num?: string;
  pmt_mode: string;
  amount_received: number;
  deposit_status?: 'pending' | 'deposited' | 'archived';
  deposited_at?: string;
}

interface ExpenseRow {
  id: string;
  expense_number: string;
  date: string;
  expense_type: string;
  description?: string;
  amount: number;
  payment_mode: string;
  vendor_name?: string;
  bank_account_id?: string;
  deposit_status?: 'pending' | 'deposited' | 'archived';
  deposited_at?: string;
}

interface BankAccount {
  id: string;
  name: string;
}

interface OverviewBank {
  id: string;
  name: string;
  amount: number;
  count: number;
}

interface Overview {
  period: string;
  total_deposited: number;
  deposited_count: number;
  pending_total: number;
  pending_count: number;
  banks: OverviewBank[];
}

type Tab = 'pending' | 'deposited' | 'archived';
type Period = 'today' | 'week' | '2weeks' | 'month' | '2months';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last week' },
  { key: '2weeks', label: 'Two weeks' },
  { key: 'month', label: 'One month' },
  { key: '2months', label: 'Two months' },
];

const PMT_MODES = ['Cash', 'Cheque', 'Credit Card', 'COD', 'IBFT', 'Bank Transfer', 'Check'];

function money(n: number) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d?: string) {
  if (!d) return '—';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(d?: string) {
  if (!d) return '—';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  return x.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ReceiptsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" /></div>}>
      <ReceiptsPageInner />
    </Suspense>
  );
}

function ReceiptsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>('pending');
  const [period, setPeriod] = useState<Period>('today');
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [depositTarget, setDepositTarget] = useState<{ kind: 'receipt' | 'expense'; id: string; label: string; amount: number } | null>(null);
  const [depositBank, setDepositBank] = useState('');
  const [depositDate, setDepositDate] = useState(new Date().toISOString().slice(0, 10));
  const [depositTime, setDepositTime] = useState(new Date().toISOString().slice(11, 16));
  const [depositing, setDepositing] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const [form, setForm] = useState({
    trx_date: new Date().toISOString().slice(0, 10),
    trx_time: '',
    trx_id: '',
    customer_name: '',
    bank_account_id: '',
    invoice_num: '',
    pmt_mode: 'Cash',
    amount_received: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const [recRes, expRes, ovRes] = await Promise.all([
        adminApi.get('/receipts', { params: { search: search || undefined } }),
        adminApi.get('/expenses', { params: { limit: 200 } }),
        adminApi.get('/receipts/overview', { params: { period } }),
      ]);
      setReceipts(recRes.data.receipts || []);
      setExpenses(expRes.data.expenses || []);
      setOverview(ovRes.data);
    } catch (error) {
      if (isAdminAuthRedirectError(error)) return;
      toast.error('Failed to load bank transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, period]);

  useEffect(() => {
    adminApi.get('/bank-accounts').then((r) => setBankAccounts(Array.isArray(r.data) ? r.data : [])).catch(() => []);
  }, []);

  useEffect(() => {
    const create = searchParams?.get('create');
    const nextTab = searchParams?.get('tab');
    if (nextTab === 'pending' || nextTab === 'deposited' || nextTab === 'archived') setTab(nextTab);
    if (create === '1') {
      setForm({
        trx_date: new Date().toISOString().slice(0, 10),
        trx_time: '',
        trx_id: '',
        customer_name: '',
        bank_account_id: '',
        invoice_num: '',
        pmt_mode: 'Cash',
        amount_received: '',
      });
      setShowCreate(true);
      router.replace('/admin/receipts', { scroll: false });
    }
  }, [searchParams, router]);

  const bankName = (id?: string) => bankAccounts.find((b) => b.id === id)?.name;

  const rows = useMemo(() => {
    const incoming = receipts.map((r) => ({
      kind: 'receipt' as const,
      id: r.id,
      date: r.trx_date,
      trx_id: r.trx_id,
      party: r.customer_name || '—',
      reference: r.invoice_num || 'Received payment',
      pmt_mode: r.pmt_mode,
      amount: Number(r.amount_received) || 0,
      direction: 'in' as const,
      bank_account_id: r.bank_account_id,
      bank_account_name: r.bank_account_name,
      comment: r.so_id,
      deposit_status: (r.deposit_status || (r.bank_account_id ? 'deposited' : 'pending')) as Tab,
      deposited_at: r.deposited_at,
    }));
    const bills = expenses.map((e) => ({
      kind: 'expense' as const,
      id: e.id,
      date: e.date,
      trx_id: e.expense_number,
      party: e.vendor_name || e.expense_type || 'Paid bill',
      reference: e.description || e.expense_type || 'Paid bill',
      pmt_mode: e.payment_mode,
      amount: Number(e.amount) || 0,
      direction: 'out' as const,
      bank_account_id: e.bank_account_id,
      bank_account_name: bankName(e.bank_account_id),
      comment: e.description,
      deposit_status: (e.deposit_status || 'pending') as Tab,
      deposited_at: e.deposited_at,
    }));
    const q = search.trim().toLowerCase();
    return [...incoming, ...bills]
      .filter((row) => row.deposit_status === tab)
      .filter((row) => {
        if (!q) return true;
        return [row.trx_id, row.party, row.reference, row.pmt_mode, row.comment].some((v) => String(v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [receipts, expenses, tab, search, bankAccounts]);

  const pendingBills = expenses.filter((e) => (e.deposit_status || 'pending') === 'pending').length;
  const pendingReceipts = receipts.filter((r) => (r.deposit_status || (r.bank_account_id ? 'deposited' : 'pending')) === 'pending').length;
  const archivedCount =
    receipts.filter((r) => r.deposit_status === 'archived').length +
    expenses.filter((e) => e.deposit_status === 'archived').length;

  const rowKey = (row: { kind: string; id: string }) => `${row.kind}:${row.id}`;
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selectedKeys.has(rowKey(r)));
  const someVisibleSelected = rows.some((r) => selectedKeys.has(rowKey(r)));
  const selectedRows = rows.filter((r) => selectedKeys.has(rowKey(r)));

  const toggleOne = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedKeys((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        rows.forEach((r) => next.delete(rowKey(r)));
        return next;
      }
      const next = new Set(prev);
      rows.forEach((r) => next.add(rowKey(r)));
      return next;
    });
  };

  const clearSelection = () => setSelectedKeys(new Set());

  const handleExport = async (list: typeof rows) => {
    if (list.length === 0 || exporting) return;
    setExporting(true);
    try {
      await exportBankTransactionsToExcel(list, tab === 'pending' ? 'bank-pending' : tab === 'archived' ? 'bank-archived' : 'bank-deposited');
      toast.success(`Exported ${list.length} ${list.length === 1 ? 'row' : 'rows'} to Excel`);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = (list: typeof rows) => {
    if (list.length === 0) return;
    printBankTransactions(list, `Bank transactions — ${tab}`);
  };

  const handleArchiveSelected = async () => {
    if (selectedRows.length === 0 || bulkBusy) return;
    if (!confirm(`Archive ${selectedRows.length} selected ${selectedRows.length === 1 ? 'transaction' : 'transactions'}?\n\nThey leave this list. Invoice paid amounts stay the same.`)) return;
    setBulkBusy(true);
    let ok = 0;
    const failures: string[] = [];
    for (const row of selectedRows) {
      try {
        await adminApi.post(row.kind === 'receipt' ? `/receipts/${row.id}/archive` : `/expenses/${row.id}/archive`);
        ok += 1;
      } catch (error: any) {
        failures.push(error?.response?.data?.error || `Could not archive ${row.trx_id}`);
      }
    }
    setBulkBusy(false);
    if (ok) toast.success(`Archived ${ok}`);
    if (failures.length) toast.error(failures.slice(0, 3).join(' · '));
    clearSelection();
    await load();
  };

  const handleDeleteSelected = async () => {
    if (selectedRows.length === 0 || bulkBusy) return;
    if (!confirm(`Delete ${selectedRows.length} selected ${selectedRows.length === 1 ? 'transaction' : 'transactions'}?\n\nIf a received payment was applied to an invoice, that invoice’s paid amount will be reversed. Archive instead if you only want to hide the row.`)) return;
    setBulkBusy(true);
    let ok = 0;
    const failures: string[] = [];
    for (const row of selectedRows) {
      try {
        await adminApi.delete(row.kind === 'receipt' ? `/receipts/${row.id}` : `/expenses/${row.id}`);
        ok += 1;
      } catch (error: any) {
        failures.push(error?.response?.data?.error || `Could not delete ${row.trx_id}`);
      }
    }
    setBulkBusy(false);
    if (ok) toast.success(`Deleted ${ok}`);
    if (failures.length) toast.error(failures.slice(0, 3).join(' · '));
    clearSelection();
    await load();
  };

  const openDeposit = (row: { kind: 'receipt' | 'expense'; id: string; trx_id: string; amount: number }) => {
    setDepositTarget({ kind: row.kind, id: row.id, label: row.trx_id, amount: row.amount });
    setDepositBank(bankAccounts[0]?.id || '');
    setDepositDate(new Date().toISOString().slice(0, 10));
    setDepositTime(new Date().toTimeString().slice(0, 5));
  };

  const submitDeposit = async () => {
    if (!depositTarget) return;
    if (!depositBank) {
      toast.error('Select a bank');
      return;
    }
    setDepositing(true);
    try {
      const path = depositTarget.kind === 'receipt' ? `/receipts/${depositTarget.id}/deposit` : `/expenses/${depositTarget.id}/deposit`;
      await adminApi.post(path, { bank_account_id: depositBank, deposit_date: depositDate, deposit_time: depositTime });
      toast.success('Marked as deposited');
      setDepositTarget(null);
      setTab('deposited');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not mark as deposited');
    } finally {
      setDepositing(false);
    }
  };

  const generateTrxId = async () => {
    try {
      const res = await adminApi.get('/receipts/generate-id');
      setForm((f) => ({ ...f, trx_id: res.data.trx_id }));
    } catch {
      setForm((f) => ({ ...f, trx_id: 'RT' + Date.now().toString(36).toUpperCase().slice(-5) }));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount_received || Number(form.amount_received) <= 0) {
      toast.error('Amount received is required');
      return;
    }
    setSubmitting(true);
    try {
      await adminApi.post('/receipts', {
        trx_date: form.trx_time ? `${form.trx_date}T${form.trx_time}` : form.trx_date,
        trx_id: form.trx_id || undefined,
        customer_name: form.customer_name,
        bank_account_id: form.bank_account_id || undefined,
        invoice_num: form.invoice_num || undefined,
        pmt_mode: form.pmt_mode,
        amount_received: Number(form.amount_received),
      });
      toast.success(form.bank_account_id ? 'Deposited' : 'Saved to pending');
      setShowCreate(false);
      setTab(form.bank_account_id ? 'deposited' : 'pending');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    clearSelection();
    router.replace(`/admin/receipts?tab=${next}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className={adminUi.pageTitle}>Bank transactions</h1>
          <p className={adminUi.meta}>Received payments and paid bills sit in Pending until you deposit them to a bank.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className={adminUi.btnPrimary}
        >
          <Plus className="w-4 h-4" />
          Add transaction
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
              period === p.key ? 'bg-black text-white border-black' : 'bg-white text-[#393A3D] border-[#C7C7C7] hover:bg-[#F4F5F8]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-md border border-[#E3E5E8] bg-[#E5F6E3] px-5 py-4">
          <p className="text-[26px] leading-tight tabular-nums">{money(overview?.total_deposited || 0)}</p>
          <p className="text-xs text-[#6B6C72] mt-1">
            Deposited {period === 'today' ? 'today' : PERIODS.find((p) => p.key === period)?.label.toLowerCase()}
            {overview ? ` · ${overview.deposited_count} ${overview.deposited_count === 1 ? 'deposit' : 'deposits'}` : ''}
          </p>
          <div className="mt-3 h-1.5 bg-[#2CA01C] rounded-full" />
        </div>
        <div className="rounded-md border border-[#E3E5E8] bg-[#FFF4E5] px-5 py-4">
          <p className="text-[26px] leading-tight tabular-nums">{money(overview?.pending_total || 0)}</p>
          <p className="text-xs text-[#6B6C72] mt-1">
            Pending deposit · {pendingReceipts} received{pendingBills ? ` · ${pendingBills} paid bills` : ''}
          </p>
          <div className="mt-3 h-1.5 bg-[#F5A623] rounded-full" />
        </div>
      </div>

      {bankAccounts.length > 0 && (
        <div className={`${adminUi.panel} p-4`}>
          <h2 className={adminUi.sectionTitle}>All banks</h2>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {bankAccounts.map((b) => {
              const stat = overview?.banks.find((x) => x.id === b.id);
              return (
                <div key={b.id} className="rounded-md border border-[#E3E5E8] px-3 py-2">
                  <p className="text-sm text-[#1A1A1A]">{b.name}</p>
                  <p className="text-lg tabular-nums font-medium">{money(stat?.amount || 0)}</p>
                  <p className={adminUi.helper}>{stat?.count ? `${stat.count} deposited` : 'No deposits in this period'}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex border-b border-[#E3E5E8]">
        {([
          { key: 'pending', label: `Pending (${pendingReceipts + pendingBills})` },
          { key: 'deposited', label: 'Deposited' },
          { key: 'archived', label: `Archived${archivedCount ? ` (${archivedCount})` : ''}` },
        ] as { key: Tab; label: string }[]).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTab(t.key)}
            className={`py-3 px-4 text-sm font-medium border-b-2 ${
              tab === t.key ? 'border-black text-[#1A1A1A]' : 'border-transparent text-[#6B6C72] hover:text-[#1A1A1A]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8D9096]" />
          <input
            type="text"
            placeholder="Search customer, invoice, bill, or trx ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${adminUi.field} pl-9`}
          />
        </div>
        <button
          type="button"
          onClick={() => handleExport(rows)}
          disabled={exporting || rows.length === 0}
          className={`${adminUi.btnSecondary} ml-auto disabled:opacity-50`}
        >
          <Download className="w-4 h-4" />
          Export all ({rows.length})
        </button>
        <button
          type="button"
          onClick={() => handlePrint(rows)}
          disabled={rows.length === 0}
          className={`${adminUi.btnSecondary} disabled:opacity-50`}
        >
          <Printer className="w-4 h-4" />
          Print all
        </button>
      </div>

      {selectedKeys.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#E3E5E8] bg-[#F4F5F8] px-4 py-2.5">
          <span className="text-sm font-medium text-[#1A1A1A]">{selectedKeys.size} selected</span>
          <button type="button" onClick={() => handleExport(selectedRows)} disabled={exporting} className={`${adminUi.btnPrimary} disabled:opacity-50`}>
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting…' : 'Export selected'}
          </button>
          <button type="button" onClick={() => handlePrint(selectedRows)} className={adminUi.btnSecondary}>
            <Printer className="w-4 h-4" />
            Print selected
          </button>
          {tab !== 'archived' && (
            <button type="button" onClick={handleArchiveSelected} disabled={bulkBusy} className={`${adminUi.btnSecondary} disabled:opacity-50`}>
              {bulkBusy ? 'Working…' : 'Archive selected'}
            </button>
          )}
          <button type="button" onClick={handleDeleteSelected} disabled={bulkBusy} className={`${adminUi.btnDanger} disabled:opacity-50`}>
            <Trash2 className="w-4 h-4" />
            {bulkBusy ? 'Deleting…' : 'Delete selected'}
          </button>
          <button type="button" onClick={clearSelection} className={adminUi.btnGhost}>
            Clear selection
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
        </div>
      ) : (
        <div className={`${adminUi.panel} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={adminUi.tableHead}>
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allVisibleSelected}
                      ref={(el) => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected; }}
                      onChange={toggleAllVisible}
                      className="h-4 w-4 rounded border-[#C7C7C7] accent-black cursor-pointer"
                    />
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Ref</th>
                  <th className="text-left px-4 py-3 font-medium">Party</th>
                  <th className="text-left px-4 py-3 font-medium">{tab === 'pending' ? 'Method' : 'Bank / deposited'}</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  <th className="text-right px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-[#6B6C72]">
                      {tab === 'pending'
                        ? 'Nothing pending. Received payments and paid bills will show here until deposited.'
                        : tab === 'archived'
                          ? 'Nothing archived.'
                          : 'No deposits in this list yet.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={`${row.kind}-${row.id}`} className={`border-t border-[#E3E5E8] ${adminUi.tableRowHover} ${selectedKeys.has(rowKey(row)) ? 'bg-[#F4F5F8]' : ''}`}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.trx_id}`}
                          checked={selectedKeys.has(rowKey(row))}
                          onChange={() => toggleOne(rowKey(row))}
                          className="h-4 w-4 rounded border-[#C7C7C7] accent-black cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDate(row.date)}</td>
                      <td className="px-4 py-3">
                        <span className={row.direction === 'in' ? adminUi.badgePaid : adminUi.badge}>{row.direction === 'in' ? 'Received' : 'Paid bill'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#1A1A1A]">{row.trx_id}</p>
                        <p className={adminUi.helper}>{row.reference}</p>
                      </td>
                      <td className="px-4 py-3">{row.party}</td>
                      <td className="px-4 py-3">
                        {tab === 'pending' ? (
                          <span className={adminUi.badge}>{row.pmt_mode}</span>
                        ) : (
                          <>
                            <p>{row.bank_account_name || '—'}</p>
                            <p className={adminUi.helper}>{fmtDateTime(row.deposited_at)}</p>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                        {row.direction === 'out' ? `−${money(row.amount)}` : money(row.amount)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {tab === 'pending' ? (
                          <button type="button" onClick={() => openDeposit(row)} className="text-[#0077C5] hover:underline">
                            Mark as deposited
                          </button>
                        ) : tab === 'archived' ? (
                          <span className={adminUi.badgeDraft}>Archived</span>
                        ) : (
                          <span className={adminUi.badgePaid}>Deposited</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {depositTarget && (
        <div className={adminUi.modalBackdrop} onClick={() => setDepositTarget(null)}>
          <div className={`${adminUi.modal} max-w-md w-full p-6`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-medium">Mark as deposited</h3>
                <p className={adminUi.meta}>{depositTarget.label} · {money(depositTarget.amount)}</p>
              </div>
              <button type="button" onClick={() => setDepositTarget(null)} className={adminUi.btnIcon} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className={adminUi.label}>Bank</label>
                <select value={depositBank} onChange={(e) => setDepositBank(e.target.value)} className={`${adminUi.field} mt-1`}>
                  <option value="">Select bank</option>
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={adminUi.label}>Date</label>
                  <input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} className={`${adminUi.field} mt-1`} />
                </div>
                <div>
                  <label className={adminUi.label}>Time</label>
                  <input type="time" value={depositTime} onChange={(e) => setDepositTime(e.target.value)} className={`${adminUi.field} mt-1`} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setDepositTarget(null)} className={adminUi.btnSecondary}>Cancel</button>
              <button type="button" onClick={submitDeposit} disabled={depositing} className={`${adminUi.btnPrimary} disabled:opacity-50`}>
                {depositing ? 'Saving…' : 'Mark deposited'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className={adminUi.modalBackdrop} onClick={() => setShowCreate(false)}>
          <div className={`${adminUi.modal} max-w-lg w-full p-6`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <h3 className="text-lg font-medium">Record bank transaction</h3>
              <button type="button" onClick={() => setShowCreate(false)} className={adminUi.btnIcon} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={adminUi.label}>Date</label>
                  <input type="date" value={form.trx_date} onChange={(e) => setForm((f) => ({ ...f, trx_date: e.target.value }))} className={`${adminUi.field} mt-1`} required />
                </div>
                <div>
                  <label className={adminUi.label}>Time</label>
                  <input type="time" value={form.trx_time} onChange={(e) => setForm((f) => ({ ...f, trx_time: e.target.value }))} className={`${adminUi.field} mt-1`} />
                </div>
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className={adminUi.label}>Transaction ID</label>
                  <input type="text" value={form.trx_id} onChange={(e) => setForm((f) => ({ ...f, trx_id: e.target.value }))} className={`${adminUi.field} mt-1`} required />
                </div>
                <button type="button" onClick={generateTrxId} className={adminUi.btnSecondary}>Generate</button>
              </div>
              <div>
                <label className={adminUi.label}>Bank (optional — skip to leave in Pending)</label>
                <select value={form.bank_account_id} onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))} className={`${adminUi.field} mt-1`}>
                  <option value="">Pending — deposit later</option>
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={adminUi.label}>Customer</label>
                <input type="text" value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))} className={`${adminUi.field} mt-1`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={adminUi.label}>Invoice #</label>
                  <input type="text" value={form.invoice_num} onChange={(e) => setForm((f) => ({ ...f, invoice_num: e.target.value }))} className={`${adminUi.field} mt-1`} />
                </div>
                <div>
                  <label className={adminUi.label}>Payment mode</label>
                  <select value={form.pmt_mode} onChange={(e) => setForm((f) => ({ ...f, pmt_mode: e.target.value }))} className={`${adminUi.field} mt-1`}>
                    {PMT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={adminUi.label}>Amount</label>
                <input type="number" min="0" step="0.01" value={form.amount_received} onChange={(e) => setForm((f) => ({ ...f, amount_received: e.target.value }))} className={`${adminUi.field} mt-1`} required />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className={adminUi.btnSecondary}>Cancel</button>
                <button type="submit" disabled={submitting} className={`${adminUi.btnPrimary} disabled:opacity-50`}>{submitting ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
