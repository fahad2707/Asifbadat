'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, Trash2, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import toast from 'react-hot-toast';
import NumberInput from '@/components/admin/NumberInput';
import ExpenseStatement from '@/components/admin/ExpenseStatement';
import { STATEMENT_PERIODS, type StatementPeriod } from '@/components/admin/statementPeriods';
import { moneyOut } from '@/lib/moneyTone';

interface Expense {
  id: string;
  expense_number: string;
  date: string;
  expense_type: string;
  description?: string;
  amount: number;
  payment_mode: string;
  vendor_name?: string;
  attachment?: string;
  is_recurring: boolean;
  recurrence_type: string;
  created_at: string;
}

const DEFAULT_PAYMENT_MODES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CREDIT_CARD', label: 'Credit card' },
];

const ADD_PAYMENT_MODE = '__add_payment_mode__';

function paymentModeKey(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, '_');
}

function paymentModeLabel(value: string): string {
  const found = DEFAULT_PAYMENT_MODES.find((m) => m.value === value);
  if (found) return found.label;
  if (value === 'CARD') return 'Credit card';
  if (value === 'CHECK') return 'Cheque';
  return value;
}

export default function ExpensesPage() {
  const [summary, setSummary] = useState<{
    total: number;
    fixed: number;
    variable: number;
    highestCategory?: { name: string; amount: number };
  }>({ total: 0, fixed: 0, variable: 0 });
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    expense_type: '',
    description: '',
    amount: '',
    payment_mode: 'CASH',
    vendor_name: '',
    attachment: '',
    is_recurring: false,
    recurrence_type: 'NONE' as string,
  });
  const [filters, setFilters] = useState({ start: '', end: '', expense_type: '', payment_mode: '' });
  const [submitting, setSubmitting] = useState(false);
  const [paymentModes, setPaymentModes] = useState<string[]>(DEFAULT_PAYMENT_MODES.map((m) => m.value));
  const [addingPaymentMode, setAddingPaymentMode] = useState(false);
  const [newPaymentMode, setNewPaymentMode] = useState('');
  const [savingPaymentMode, setSavingPaymentMode] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<StatementPeriod>('month');
  const [statementOpen, setStatementOpen] = useState(false);

  const thisMonthStart = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  };
  const thisMonthEnd = () => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  };

  const fetchSummary = async () => {
    try {
      const start = filters.start || thisMonthStart();
      const end = filters.end || thisMonthEnd();
      const res = await adminApi.get('/expenses/summary', { params: { start, end } });
      setSummary(res.data);
    } catch {
      setSummary({ total: 0, fixed: 0, variable: 0 });
    }
  };

  const fetchExpenses = async () => {
    try {
      const params: any = { page: 1, limit: 100 };
      if (filters.start) params.start = filters.start;
      if (filters.end) params.end = filters.end;
      if (filters.expense_type) params.expense_type = filters.expense_type;
      if (filters.payment_mode) params.payment_mode = filters.payment_mode;
      const res = await adminApi.get('/expenses', { params });
      setExpenses(res.data.expenses || []);
    } catch {
      setExpenses([]);
    }
  };

  const fetchPaymentModes = async () => {
    try {
      const res = await adminApi.get('/payment-methods');
      const list = Array.isArray(res.data) ? res.data : [];
      const extras = list
        .map((p: any) => String(p.name || '').trim())
        .filter(Boolean)
        .filter((name: string) => !DEFAULT_PAYMENT_MODES.some((d) => paymentModeKey(d.value) === paymentModeKey(name) || paymentModeKey(d.label) === paymentModeKey(name)));
      setPaymentModes([...DEFAULT_PAYMENT_MODES.map((m) => m.value), ...extras]);
    } catch {
      setPaymentModes(DEFAULT_PAYMENT_MODES.map((m) => m.value));
    }
  };

  const handleAddPaymentMode = async () => {
    const name = newPaymentMode.trim();
    if (!name) {
      toast.error('Enter a payment mode name');
      return;
    }
    setSavingPaymentMode(true);
    try {
      await adminApi.post('/payment-methods', { name });
      toast.success('Payment mode added');
      setNewPaymentMode('');
      setAddingPaymentMode(false);
      await fetchPaymentModes();
      setForm((f) => ({ ...f, payment_mode: name }));
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add payment mode');
    } finally {
      setSavingPaymentMode(false);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchSummary(), fetchExpenses(), fetchPaymentModes()]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    fetchSummary();
    fetchExpenses();
  }, [filters.start, filters.end, filters.expense_type, filters.payment_mode]);

  const openAdd = () => {
    setEditing(null);
    setForm({
      date: new Date().toISOString().slice(0, 10),
      expense_type: '',
      description: '',
      amount: '',
      payment_mode: 'CASH',
      vendor_name: '',
      attachment: '',
      is_recurring: false,
      recurrence_type: 'NONE',
    });
    setAddingPaymentMode(false);
    setNewPaymentMode('');
    setShowModal(true);
  };

  const openEdit = (e: Expense) => {
    setEditing(e);
    setForm({
      date: e.date?.toString().slice(0, 10) || new Date().toISOString().slice(0, 10),
      expense_type: e.expense_type || '',
      description: e.description || '',
      amount: String(e.amount ?? ''),
      payment_mode: e.payment_mode || 'CASH',
      vendor_name: e.vendor_name || '',
      attachment: e.attachment || '',
      is_recurring: e.is_recurring || false,
      recurrence_type: e.recurrence_type || 'NONE',
    });
    setAddingPaymentMode(false);
    setNewPaymentMode('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const typeTrim = (form.expense_type || '').trim();
    if (!typeTrim) {
      toast.error('Enter expense type (e.g. Electricity, WiFi, Shipping, Transport)');
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      toast.error('Enter amount');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        date: form.date,
        expense_type: typeTrim,
        description: form.description || undefined,
        amount: Number(form.amount),
        payment_mode: form.payment_mode,
        vendor_name: form.vendor_name || undefined,
        attachment: form.attachment || undefined,
        is_recurring: form.is_recurring,
        recurrence_type: form.recurrence_type,
      };
      if (editing) {
        await adminApi.put(`/expenses/${editing.id}`, payload);
        toast.success('Expense updated');
      } else {
        await adminApi.post('/expenses', payload);
        toast.success('Expense added');
      }
      setShowModal(false);
      fetchSummary();
      fetchExpenses();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this expense? (Soft delete)')) return;
    try {
      await adminApi.delete(`/expenses/${id}`);
      toast.success('Expense deleted');
      fetchSummary();
      fetchExpenses();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const formatDate = (d: string) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '—');

  const filteredExpenses = expenses.filter((e) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      e.expense_number.toLowerCase().includes(term) ||
      e.expense_type.toLowerCase().includes(term) ||
      (e.description || '').toLowerCase().includes(term) ||
      (e.vendor_name || '').toLowerCase().includes(term)
    );
  });
  const PAGE_SIZE = 25;
  const totalDocs = filteredExpenses.length;
  const totalPages = Math.max(1, Math.ceil(totalDocs / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredExpenses.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className={adminUi.pageTitle}>Pay bills</h1>
        <div className="flex items-center gap-2">
          <select aria-label="Statement period" value={period} onChange={(e) => setPeriod(e.target.value as StatementPeriod)} className={adminUi.filter}>
            {STATEMENT_PERIODS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <button type="button" onClick={() => setStatementOpen(true)} className={adminUi.btnSecondary}>Statement</button>
          <button type="button" onClick={openAdd} className={adminUi.btnPrimary}>
            <Plus className="w-4 h-4" /> Add expense
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 overflow-hidden rounded-md border border-[#E3E5E8] md:grid-cols-2">
            <div className="px-5 py-4 bg-[#FDECEC]">
              <p className={`text-[26px] leading-tight font-normal tabular-nums ${moneyOut}`}>${Number(summary.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              <p className="text-xs text-[#6B6C72] mt-1">Spent in the selected dates</p>
              <div className="mt-3 h-1.5 rounded-full bg-[#C81916]" />
            </div>
            <div className="px-5 py-4 bg-[#FFF4E5]">
              <p className="text-[26px] leading-tight font-normal text-[#1A1A1A] truncate">{summary.highestCategory ? summary.highestCategory.name : '—'}</p>
              <p className="text-xs text-[#6B6C72] mt-1">{summary.highestCategory ? `Largest type · $${Number(summary.highestCategory.amount).toFixed(2)}` : 'Largest type'}</p>
              <div className="mt-3 h-1.5 rounded-full bg-[#F5A623]" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#E2E8F0] bg-white p-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8D9096]" />
              <input
                type="text"
                placeholder="Search by number, type, payee, or description"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className={adminUi.filterSearch}
              />
            </div>
            <input aria-label="From date" type="date" value={filters.start} onChange={(e) => { setFilters((f) => ({ ...f, start: e.target.value })); setPage(1); }} className={`${adminUi.filter} w-[9.5rem]`} />
            <input aria-label="To date" type="date" value={filters.end} onChange={(e) => { setFilters((f) => ({ ...f, end: e.target.value })); setPage(1); }} className={`${adminUi.filter} w-[9.5rem]`} />
            <input aria-label="Expense type" type="text" value={filters.expense_type} onChange={(e) => { setFilters((f) => ({ ...f, expense_type: e.target.value })); setPage(1); }} className={`${adminUi.filter} w-32`} placeholder="Type" />
            <select aria-label="Payment mode" value={filters.payment_mode} onChange={(e) => { setFilters((f) => ({ ...f, payment_mode: e.target.value })); setPage(1); }} className={adminUi.filter}>
              <option value="">All payment modes</option>
              {paymentModes.map((m) => (
                <option key={m} value={m}>{paymentModeLabel(m)}</option>
              ))}
            </select>
          </div>

          <div className={`${adminUi.panel} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-auto">
                <thead className={adminUi.tableHead}>
                  <tr>
                    <th className="text-left px-3 py-2 font-medium whitespace-nowrap w-[1%]">Number</th>
                    <th className="text-left px-3 py-2 font-medium whitespace-nowrap w-[1%]">Date</th>
                    <th className="text-left px-3 py-2 font-medium whitespace-nowrap w-[1%]">Type</th>
                    <th className="text-left px-3 py-2 font-medium">Description</th>
                    <th className="text-right px-3 py-2 font-medium whitespace-nowrap w-[1%]">Amount</th>
                    <th className="text-left px-3 py-2 font-medium whitespace-nowrap w-[1%]">Payment</th>
                    <th className="text-right px-3 py-2 font-medium whitespace-nowrap w-[1%]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-sm text-[#6B6C72]">No expenses yet.</td>
                    </tr>
                  ) : (
                    pageRows.map((e) => (
                      <tr key={e.id} className={`border-t border-[#E3E5E8] ${adminUi.tableRowHover}`}>
                        <td className="px-3 py-2 text-sm font-medium text-[#0077C5] whitespace-nowrap">{e.expense_number}</td>
                        <td className="px-3 py-2 text-sm text-[#1A1A1A] whitespace-nowrap">{formatDate(e.date)}</td>
                        <td className="px-3 py-2 text-sm text-[#1A1A1A] whitespace-nowrap">{e.expense_type}</td>
                        <td className="px-3 py-2 text-sm text-[#1A1A1A] max-w-[18rem] truncate">{e.description || '—'}</td>
                        <td className={`px-3 py-2 text-right text-sm tabular-nums whitespace-nowrap ${moneyOut}`}>${Number(e.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="px-3 py-2 text-sm whitespace-nowrap"><span className={adminUi.badge}>{paymentModeLabel(e.payment_mode)}</span></td>
                        <td className="px-3 py-2 text-right text-sm whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <button type="button" onClick={() => openEdit(e)} className="text-sm text-[#0077C5] hover:underline">View/Edit</button>
                            <button type="button" onClick={() => handleDelete(e.id)} className={adminUi.btnIcon} title="Delete" aria-label="Delete">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {!loading && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
              <p className={adminUi.meta}>{totalDocs === 0 ? '0 expenses' : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, totalDocs)} of ${totalDocs}`}</p>
              <div className="flex items-center gap-2">
                <button type="button" className={adminUi.btnSecondary} disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} aria-label="Previous page"><ChevronLeft className="w-4 h-4" />Previous</button>
                <span className="min-w-[3.5rem] text-center text-sm tabular-nums text-[#1A1A1A]">{safePage} / {totalPages}</span>
                <button type="button" className={adminUi.btnSecondary} disabled={safePage >= totalPages} onClick={() => setPage((current) => current + 1)} aria-label="Next page">Next<ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </>
      )}

      {statementOpen && <ExpenseStatement period={period} onClose={() => setStatementOpen(false)} />}

      {showModal && (
        <div className={adminUi.modalBackdrop} onClick={() => setShowModal(false)}>
          <div className={`${adminUi.modal} max-w-lg w-full`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-[#E3E5E8]">
              <h2 className="text-lg font-medium text-[#1A1A1A]">{editing ? 'Edit expense' : 'Add expense'}</h2>
              <button type="button" onClick={() => setShowModal(false)} className={adminUi.btnIcon} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className={adminUi.label}>Date</label>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={`${adminUi.field} mt-1`} required />
              </div>
              <div>
                <label className={adminUi.label}>Type</label>
                <input type="text" value={form.expense_type} onChange={(e) => setForm((f) => ({ ...f, expense_type: e.target.value }))} className={`${adminUi.field} mt-1`} placeholder="Electricity, shipping, rent" required />
              </div>
              <div>
                <label className={adminUi.label}>Description</label>
                <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={`${adminUi.field} mt-1`} placeholder="Optional" />
              </div>
              <div>
                <label className={adminUi.label}>Amount</label>
                <NumberInput min={0} step={0.01} value={form.amount} onValueChange={(n) => setForm((f) => ({ ...f, amount: n === '' ? '' : String(n) }))} className={`${adminUi.field} mt-1`} required />
              </div>
              <div>
                <label className={adminUi.label}>Payment mode</label>
                {!addingPaymentMode ? (
                  <select
                    value={form.payment_mode}
                    onChange={(e) => {
                      if (e.target.value === ADD_PAYMENT_MODE) {
                        setAddingPaymentMode(true);
                        setNewPaymentMode('');
                        return;
                      }
                      setForm((f) => ({ ...f, payment_mode: e.target.value }));
                    }}
                    className={`${adminUi.field} mt-1`}
                  >
                    {Array.from(new Set([...paymentModes, form.payment_mode].filter(Boolean))).map((m) => (
                      <option key={m} value={m}>{paymentModeLabel(m)}</option>
                    ))}
                    <option value={ADD_PAYMENT_MODE}>+ Add payment mode</option>
                  </select>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <input type="text" value={newPaymentMode} onChange={(e) => setNewPaymentMode(e.target.value)} placeholder="Wire transfer" className={adminUi.field} autoFocus />
                    <button type="button" onClick={handleAddPaymentMode} disabled={savingPaymentMode} className={adminUi.btnPrimary}>{savingPaymentMode ? 'Saving…' : 'Save'}</button>
                    <button type="button" onClick={() => { setAddingPaymentMode(false); setNewPaymentMode(''); }} className={adminUi.btnSecondary}>Cancel</button>
                  </div>
                )}
              </div>
              <div>
                <label className={adminUi.label}>Payee</label>
                <input type="text" value={form.vendor_name} onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))} className={`${adminUi.field} mt-1`} placeholder="Who was paid" />
              </div>
              <div>
                <label className={adminUi.label}>Receipt link</label>
                <input type="url" value={form.attachment} onChange={(e) => setForm((f) => ({ ...f, attachment: e.target.value }))} className={`${adminUi.field} mt-1`} placeholder="https://" />
              </div>
              <div className="flex items-center gap-4 rounded-md border border-[#E3E5E8] p-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_recurring} onChange={(e) => setForm((f) => ({ ...f, is_recurring: e.target.checked }))} className="h-4 w-4 accent-black" />
                  <span className="text-sm text-[#1A1A1A]">Recurring</span>
                </label>
                {form.is_recurring && (
                  <select value={form.recurrence_type} onChange={(e) => setForm((f) => ({ ...f, recurrence_type: e.target.value }))} className={adminUi.field}>
                    <option value="MONTHLY">Monthly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-[#E3E5E8]">
                <button type="button" onClick={() => setShowModal(false)} className={adminUi.btnSecondary}>Cancel</button>
                <button type="submit" disabled={submitting} className={`${adminUi.btnPrimary} disabled:opacity-40`}>{submitting ? 'Saving…' : 'Save expense'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
