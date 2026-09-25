'use client';

import { useEffect, useState } from 'react';
import { Plus, Edit, Trash2, X, Wallet, TrendingUp, Tag, Award, Search } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import toast from 'react-hot-toast';

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className={adminUi.pageTitle}>Expenses</h1>
          <p className="text-xs text-slate-400 mt-1">Manage, categorize, register and audit daily operating expenses (OPEX) and capital expenses (CAPEX).</p>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search expenses by number, type, description, vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 focus:bg-slate-950/80 transition-all font-semibold"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
        </div>
      ) : (
        <>
          {/* Top cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-[#E2E8F0] rounded-lg p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-teal-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Expenses (This Month)</p>
                  <p className="text-xl font-extrabold text-slate-100 font-mono">${Number(summary.total).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>
              </div>
            </div>
            <div className="bg-white border border-[#E2E8F0] rounded-lg p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <Tag className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Fixed Expenditures</p>
                  <p className="text-xl font-extrabold text-slate-100 font-mono">${Number(summary.fixed).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>
              </div>
            </div>
            <div className="bg-white border border-[#E2E8F0] rounded-lg p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Variable Expenditures</p>
                  <p className="text-xl font-extrabold text-slate-100 font-mono">${Number(summary.variable).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>
              </div>
            </div>
            <div className="bg-white border border-[#E2E8F0] rounded-lg p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                  <Award className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Peak Category</p>
                  <p className="text-sm font-bold text-slate-200 mt-1 truncate">
                    {summary.highestCategory ? `${summary.highestCategory.name} ($${Number(summary.highestCategory.amount).toFixed(2)})` : '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Filters + Add + Table */}
          <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] p-3 rounded-2xl flex flex-wrap items-center gap-3">
            <input type="date" value={filters.start} onChange={(e) => setFilters((f) => ({ ...f, start: e.target.value }))} className="bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-205 focus:outline-none focus:ring-1 focus:ring-teal-500" />
            <input type="date" value={filters.end} onChange={(e) => setFilters((f) => ({ ...f, end: e.target.value }))} className="bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-205 focus:outline-none focus:ring-1 focus:ring-teal-500" />
            <input type="text" value={filters.expense_type} onChange={(e) => setFilters((f) => ({ ...f, expense_type: e.target.value }))} className="bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-205 focus:outline-none focus:ring-1 focus:ring-teal-500 w-44" placeholder="Filter by expense type" />
            <select value={filters.payment_mode} onChange={(e) => setFilters((f) => ({ ...f, payment_mode: e.target.value }))} className="bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-205 focus:outline-none focus:ring-1 focus:ring-teal-500">
              <option value="">All payment modes</option>
              {paymentModes.map((m) => (
                <option key={m} value={m}>{paymentModeLabel(m)}</option>
              ))}
            </select>
            <button onClick={openAdd} className="bg-[#0F9F8F] hover:bg-[#0B8275] border-transparent text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Expense
            </button>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                  <tr>
                    <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Number</th>
                    <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Date</th>
                    <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Type / Category</th>
                    <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Description</th>
                    <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Amount</th>
                    <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Payment Mode</th>
                    <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-slate-500 text-xs font-semibold">No expense records found.</td>
                    </tr>
                  ) : (
                    filteredExpenses.map((e) => (
                      <tr key={e.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-4 text-xs font-mono font-bold text-teal-400">{e.expense_number}</td>
                        <td className="py-3 px-4 text-xs text-slate-350">{formatDate(e.date)}</td>
                        <td className="py-3 px-4 text-xs font-semibold text-slate-200">{e.expense_type}</td>
                        <td className="py-3 px-4 text-xs text-slate-400 max-w-xs truncate">{e.description || '—'}</td>
                        <td className="py-3 px-4 text-xs text-right font-extrabold text-slate-100 font-mono">${Number(e.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td className="py-3 px-4 text-xs">
                          <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold border border-white/10 bg-slate-800/80 text-slate-350">{paymentModeLabel(e.payment_mode)}</span>
                        </td>
                        <td className="py-3 px-4 text-right text-xs">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => openEdit(e)} className="p-1.5 text-teal-450 hover:text-teal-350 hover:bg-white/5 rounded-lg transition-all" title="Edit">
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(e.id)} className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
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
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-slate-955/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <h2 className="text-lg font-bold text-white">{editing ? 'Edit Corporate Expense' : 'Log Corporate Expense'}</h2>
              <button type="button" onClick={() => setShowModal(false)} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Transaction Date *</label>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-202 focus:outline-none focus:ring-1 focus:ring-teal-500" required />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Expense Category *</label>
                <input type="text" value={form.expense_type} onChange={(e) => setForm((f) => ({ ...f, expense_type: e.target.value }))} className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="e.g. WiFi, Shipping, Electricity, Transport, Rental" required />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Description</label>
                <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none" placeholder="Optional" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Grand Amount (USD) *</label>
                <input type="number" min={0} step={0.01} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="w-full bg-slate-955/65 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-100 font-mono font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500" required />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Mode of payment *</label>
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
                    className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  >
                    {Array.from(new Set([...paymentModes, form.payment_mode].filter(Boolean))).map((m) => (
                      <option key={m} value={m}>{paymentModeLabel(m)}</option>
                    ))}
                    <option value={ADD_PAYMENT_MODE}>+ Add payment mode</option>
                  </select>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newPaymentMode}
                      onChange={(e) => setNewPaymentMode(e.target.value)}
                      placeholder="e.g. Wire transfer"
                      className="flex-1 bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
                      autoFocus
                    />
                    <button type="button" onClick={handleAddPaymentMode} disabled={savingPaymentMode} className="px-3 py-2 bg-[#0F9F8F] text-white rounded-xl text-xs font-bold disabled:opacity-40">
                      {savingPaymentMode ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => { setAddingPaymentMode(false); setNewPaymentMode(''); }} className="px-3 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Vendor recipient name</label>
                <input type="text" value={form.vendor_name} onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" placeholder="e.g. Warehouse Landlord" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Attachment / Receipt Link</label>
                <input type="url" value={form.attachment} onChange={(e) => setForm((f) => ({ ...f, attachment: e.target.value }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none" placeholder="e.g. https://s3.aws.receipt.pdf" />
              </div>
              <div className="flex items-center gap-4 bg-slate-950/40 border border-white/5 p-3 rounded-xl">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input type="checkbox" checked={form.is_recurring} onChange={(e) => setForm((f) => ({ ...f, is_recurring: e.target.checked }))} className="rounded border-white/10 bg-slate-950/60 text-teal-600 focus:ring-0 w-4 h-4" />
                  <span className="text-xs text-slate-350 font-bold uppercase tracking-wider">Mark Recurring Expense</span>
                </label>
                {form.is_recurring && (
                  <select value={form.recurrence_type} onChange={(e) => setForm((f) => ({ ...f, recurrence_type: e.target.value }))} className="bg-slate-950/60 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none">
                    <option value="MONTHLY">Monthly cycle</option>
                    <option value="YEARLY">Yearly cycle</option>
                  </select>
                )}
              </div>
              <div className="flex justify-end gap-2.5 pt-4 border-t border-white/5">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] border-transparent text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-40">Save Expense</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
