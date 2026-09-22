'use client';

import { useEffect, useState } from 'react';
import { Plus, Edit, Search, Trash2, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface Receipt {
  id: string;
  trx_date: string;
  trx_id: string;
  customer_id?: string;
  customer_name: string;
  bank_account_id?: string;
  bank_account_name?: string;
  state?: string;
  city?: string;
  so_id?: string;
  invoice_num?: string;
  pmt_mode: string;
  amount_received: number;
}

interface ReceiptForm {
  trx_date: string;
  trx_time: string;
  trx_id: string;
  customer_id: string;
  customer_name: string;
  bank_account_id: string;
  state: string;
  city: string;
  so_id: string;
  invoice_num: string;
  so_balance: string;
  pmt_mode: string;
  amount_received: string;
}

interface CustomerOption {
  id: string;
  name: string;
  state?: string;
  city?: string;
}

const PMT_MODES = ['Cash', 'Cheque', 'Credit Card', 'COD', 'IBFT', 'Bank Transfer', 'Check'];

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [bankAccounts, setBankAccounts] = useState<{ id: string; name: string }[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [bankAccountFilter, setBankAccountFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Receipt | null>(null);
  const [form, setForm] = useState<ReceiptForm>({
    trx_date: new Date().toISOString().slice(0, 10),
    trx_time: '',
    trx_id: '',
    customer_id: '',
    customer_name: '',
    bank_account_id: '',
    state: '',
    city: '',
    so_id: '',
    invoice_num: '',
    so_balance: '',
    pmt_mode: 'Cash',
    amount_received: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchReceipts = async () => {
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (bankAccountFilter) params.bank_account_id = bankAccountFilter;
      const res = await adminApi.get('/receipts', { params });
      setReceipts(res.data.receipts || []);
    } catch {
      toast.error('Failed to load receipts');
    } finally {
      setLoading(false);
    }
  };

  const fetchCustomers = async () => {
    try {
      const res = await adminApi.get('/customers', { params: { limit: 500 } });
      setCustomers((res.data.customers || []).map((c: any) => ({ id: c.id, name: c.name, state: c.state, city: c.city })));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchReceipts();
  }, [search, bankAccountFilter]);

  useEffect(() => {
    adminApi.get('/bank-accounts').then((r) => setBankAccounts(Array.isArray(r.data) ? r.data : [])).catch(() => []);
  }, []);

  useEffect(() => {
    if (showModal) fetchCustomers();
  }, [showModal]);

  const generateTrxId = async () => {
    try {
      const res = await adminApi.get('/receipts/generate-id');
      setForm((f) => ({ ...f, trx_id: res.data.trx_id }));
    } catch {
      setForm((f) => ({ ...f, trx_id: 'RT' + Date.now().toString(36).toUpperCase().slice(-5) }));
    }
  };

  const handleCustomerSelect = (customerId: string) => {
    const c = customers.find((x) => x.id === customerId);
    if (c) {
      setForm((f) => ({
        ...f,
        customer_name: c.name,
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount_received || Number(form.amount_received) <= 0) {
      toast.error('Amount received is required');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        trx_date: form.trx_time ? `${form.trx_date}T${form.trx_time}` : form.trx_date,
        trx_id: form.trx_id || undefined,
        customer_name: form.customer_name,
        bank_account_id: form.bank_account_id || undefined,
        invoice_num: form.invoice_num || undefined,
        pmt_mode: form.pmt_mode,
        amount_received: Number(form.amount_received),
      };
      if (editing) {
        await adminApi.put(`/receipts/${editing.id}`, payload);
        toast.success('Receipt updated');
      } else {
        await adminApi.post('/receipts', payload);
        toast.success('Receipt created');
      }
      setShowModal(false);
      setEditing(null);
      setForm({
        trx_date: new Date().toISOString().slice(0, 10),
        trx_time: '',
        trx_id: '',
        customer_id: '',
        customer_name: '',
        bank_account_id: '',
        state: '',
        city: '',
        so_id: '',
        invoice_num: '',
        so_balance: '',
        pmt_mode: 'Cash',
        amount_received: '',
      });
      fetchReceipts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (r: Receipt) => {
    setEditing(r);
    setForm({
      trx_date: r.trx_date?.toString().slice(0, 10) || new Date().toISOString().slice(0, 10),
      trx_time: '',
      trx_id: r.trx_id,
      customer_id: r.customer_id || '',
      customer_name: r.customer_name || '',
      bank_account_id: r.bank_account_id || '',
      state: r.state || '',
      city: r.city || '',
      so_id: r.so_id || '',
      invoice_num: r.invoice_num || '',
      so_balance: '',
      pmt_mode: r.pmt_mode || 'Cash',
      amount_received: String(r.amount_received ?? ''),
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this receipt?')) return;
    try {
      await adminApi.delete(`/receipts/${id}`);
      toast.success('Receipt deleted');
      fetchReceipts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const formatDate = (d: string) => {
    if (!d) return '—';
    const x = new Date(d);
    return x.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Bank Transactions</h1>
          <p className="text-xs text-slate-400 mt-1">Record deposits, payments, credit reconciliations, and direct bank receipts.</p>
        </div>
      </div>

      <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-4 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search transaction, customer, or invoice..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 focus:bg-slate-950/80 transition-all font-semibold"
          />
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setForm({
                trx_date: new Date().toISOString().slice(0, 10),
                trx_time: '',
                trx_id: '',
                customer_id: '',
                customer_name: '',
                bank_account_id: bankAccounts[0]?.id || '',
                state: '',
                city: '',
                so_id: '',
                invoice_num: '',
                so_balance: '',
                pmt_mode: 'Cash',
                amount_received: '',
              });
              setShowModal(true);
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Add transaction
          </button>
          <select
            value={bankAccountFilter}
            onChange={(e) => setBankAccountFilter(e.target.value)}
            className="bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-200 font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="">All bank accounts</option>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                <tr>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Date</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Trx ID</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Bank Account</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Customer</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Invoice #</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Payment Mode</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Amount</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {receipts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-slate-500 text-xs font-semibold">
                      No bank transactions yet. Record an invoice payment or tap Add Transaction to specify deposits.
                    </td>
                  </tr>
                ) : (
                  receipts.map((r) => (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4 text-xs text-slate-350">{formatDate(r.trx_date)}</td>
                      <td className="py-3 px-4 text-xs font-mono font-bold text-teal-400">{r.trx_id}</td>
                      <td className="py-3 px-4 text-xs text-slate-300">{r.bank_account_name || '—'}</td>
                      <td className="py-3 px-4 text-xs font-semibold text-slate-200">{r.customer_name}</td>
                      <td className="py-3 px-4 text-xs font-mono text-slate-400">{r.invoice_num || '—'}</td>
                      <td className="py-3 px-4 text-xs">
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold border bg-slate-800/80 text-slate-300 border-white/10">{r.pmt_mode}</span>
                      </td>
                      <td className="py-3 px-4 text-xs text-right font-extrabold text-slate-100 font-mono">${Number(r.amount_received).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-right text-xs">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="px-2.5 py-1 text-teal-450 hover:text-teal-350 bg-white/5 hover:bg-white/10 rounded-lg transition-all font-semibold mr-2"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id)}
                          className="px-2.5 py-1 text-slate-400 hover:text-rose-400 bg-white/5 hover:bg-rose-500/10 rounded-lg transition-all font-semibold"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.4)] rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <h2 className="text-lg font-bold text-white">
                {editing ? 'Edit Bank Transaction' : 'Record Bank Transaction'}
              </h2>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Deposit Date *</label>
                  <input
                    type="date"
                    value={form.trx_date}
                    onChange={(e) => setForm((f) => ({ ...f, trx_date: e.target.value }))}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 focus:bg-slate-950/80 transition-all font-semibold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Deposit Time</label>
                  <input
                    type="time"
                    value={form.trx_time}
                    onChange={(e) => setForm((f) => ({ ...f, trx_time: e.target.value }))}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Transaction ID *</label>
                  <input
                    type="text"
                    value={form.trx_id}
                    onChange={(e) => setForm((f) => ({ ...f, trx_id: e.target.value }))}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 focus:bg-slate-950/80 transition-all font-semibold"
                    placeholder="e.g. DEP001"
                    required
                  />
                </div>
                <div>
                  <button
                    type="button"
                    onClick={generateTrxId}
                    className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-350 hover:text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
                  >
                    Generate
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Select Target Bank Account</label>
                <select
                  value={form.bank_account_id}
                  onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))}
                  className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="">Select Account</option>
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 mt-1.5 font-medium">To register bank accounts, navigate to Products → Brand/Tax Settings.</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Associate Customer</label>
                <div className="flex gap-2">
                  <select
                    value={customers.find((c) => c.name === form.customer_name)?.id || ''}
                    onChange={(e) => handleCustomerSelect(e.target.value)}
                    className="w-1/2 bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="">Select Link</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={form.customer_name}
                    onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
                    className="flex-1 bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                    placeholder="Or type customer name"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Invoice Number</label>
                  <input
                    type="text"
                    value={form.invoice_num}
                    onChange={(e) => setForm((f) => ({ ...f, invoice_num: e.target.value }))}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 placeholder-slate-505 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">SO Balance</label>
                  <input
                    type="number"
                    value={form.so_balance}
                    onChange={(e) => setForm((f) => ({ ...f, so_balance: e.target.value }))}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 placeholder-slate-505 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Payment Mode *</label>
                  <select
                    value={form.pmt_mode}
                    onChange={(e) => setForm((f) => ({ ...f, pmt_mode: e.target.value }))}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  >
                    {PMT_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Amount Received *</label>
                  <input
                    type="number"
                    value={form.amount_received}
                    onChange={(e) => setForm((f) => ({ ...f, amount_received: e.target.value }))}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 font-mono font-semibold"
                    required
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2.5 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold transition-all"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-40"
                >
                  Save Transaction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
