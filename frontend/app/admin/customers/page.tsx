'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Edit, Search, User, Trash2, FileDown, X, FileText, DollarSign, ChevronDown } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import ReceivePaymentLightbox from '@/components/admin/ReceivePaymentLightbox';

interface CustomerDoc {
  name: string;
  url: string;
}

interface Customer {
  id: string;
  customer_code?: string;
  name: string;
  company?: string;
  phone: string;
  email?: string;
  address?: string;
  billing_address?: string;
  city?: string;
  state?: string;
  zip?: string;
  payment_terms?: string;
  credit_limit?: number;
  notes?: string;
  documents?: CustomerDoc[];
}

interface InvoiceSummary {
  id: string;
  invoice_number: string;
  invoice_date?: string;
  due_date?: string;
  total_amount: number;
  amount_paid?: number;
  payment_status: string;
  invoice_type?: string;
}

interface InvoiceSummaryStats {
  overdueTotal?: number;
  overdueCount?: number;
  openTotal?: number;
  openCount?: number;
  paidCount?: number;
  recentlyPaidTotal?: number;
  totalPaid?: number;
  totalUnpaid?: number;
}

export default function CustomersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editIdFromUrl = searchParams?.get('edit');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<Partial<Customer>>({ name: '', phone: '', email: '', company: '', address: '', billing_address: '', city: '', state: '', zip: '', payment_terms: '', notes: '', customer_code: '' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [detailInvoices, setDetailInvoices] = useState<InvoiceSummary[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [customerFormDirty, setCustomerFormDirty] = useState(false);
  const [showCustomerCloseConfirm, setShowCustomerCloseConfirm] = useState(false);
  const [summary, setSummary] = useState<InvoiceSummaryStats | null>(null);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [receivePaymentOpen, setReceivePaymentOpen] = useState(false);
  const [receivePaymentCustomerId, setReceivePaymentCustomerId] = useState<string | undefined>();
  const [actionDropdownId, setActionDropdownId] = useState<string | null>(null);
  const [actionDropdownAnchor, setActionDropdownAnchor] = useState<DOMRect | null>(null);
  const apiBase = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') : '';

  const fetchCustomers = async () => {
    try {
      const res = await adminApi.get('/customers', { params: { ...(search ? { search } : {}), limit: 500 } });
      setCustomers(res.data.customers || []);
    } catch {
      toast.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await adminApi.get('/invoices/summary');
      setSummary(res.data);
    } catch {
      setSummary(null);
    }
  };

  const fetchBalances = async () => {
    try {
      const res = await adminApi.get('/customers/balances');
      const map: Record<string, number> = {};
      (res.data.balances || []).forEach((b: { customer_id: string; open_balance: number }) => {
        if (b.customer_id) map[b.customer_id] = b.open_balance ?? 0;
      });
      setBalances(map);
    } catch {
      setBalances({});
    }
  };

  const refreshDetailCustomer = async (customerId: string) => {
    try {
      const res = await adminApi.get(`/customers/${customerId}`);
      setDetailCustomer(res.data);
    } catch {
      // ignore
    }
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>, customerId: string) => {
    const file = e.target.files?.[0];
    if (!file || !customerId) return;
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await adminApi.post(`/customers/${customerId}/documents`, fd);
      toast.success('Document uploaded');
      await refreshDetailCustomer(customerId);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploadingDoc(false);
      e.target.value = '';
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [search]);

  useEffect(() => {
    fetchSummary();
    fetchBalances();
  }, []);

  useEffect(() => {
    if (!editIdFromUrl || customers.length === 0) return;
    const c = customers.find((x) => String(x.id) === String(editIdFromUrl));
    if (c) {
      openEdit(c);
      router.replace('/admin/customers', { scroll: false });
    }
  }, [editIdFromUrl, customers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name?.trim() || !form.phone?.trim()) {
      toast.error('Name and phone are required');
      return;
    }
    try {
      if (editing) {
        await adminApi.put(`/customers/${editing.id}`, form);
        toast.success('Customer updated');
      } else {
        const res = await adminApi.post('/customers', { ...form, email: form.email || undefined });
        const created = res.data;
        const fileInput = document.getElementById('customer-docs-form') as HTMLInputElement;
        if (fileInput?.files?.length) {
          for (let i = 0; i < fileInput.files.length; i++) {
            const fd = new FormData();
            fd.append('file', fileInput.files[i]);
            await adminApi.post(`/customers/${created.id}/documents`, fd);
          }
        }
        if (fileInput) fileInput.value = '';
        toast.success('Customer created');
      }
      setShowModal(false);
      setEditing(null);
      setCustomerFormDirty(false);
      setShowCustomerCloseConfirm(false);
      setForm({ name: '', phone: '', email: '', company: '', address: '', billing_address: '', city: '', state: '', zip: '', payment_terms: '', notes: '', customer_code: '' });
      fetchCustomers();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    }
  };

  const generateCustomerCode = () => {
    adminApi.get('/customers/generate-id').then((r) => {
      setForm((f) => ({ ...f, customer_code: r.data.customer_code || '' }));
      setCustomerFormDirty(true);
    }).catch(() => toast.error('Failed to generate customer code'));
  };

  const handleCustomerModalClose = () => {
    if (customerFormDirty) {
      setShowCustomerCloseConfirm(true);
      return;
    }
    setShowModal(false);
    setEditing(null);
    setForm({ name: '', phone: '', email: '', company: '', address: '', billing_address: '', city: '', state: '', zip: '', payment_terms: '', notes: '', customer_code: '' });
  };

  const handleCustomerCloseWithoutSaving = () => {
    setShowCustomerCloseConfirm(false);
    setCustomerFormDirty(false);
    setShowModal(false);
    setEditing(null);
    setForm({ name: '', phone: '', email: '', company: '', address: '', billing_address: '', city: '', state: '', zip: '', payment_terms: '', notes: '', customer_code: '' });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === customers.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(customers.map((c) => c.id)));
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Deactivate ${selectedIds.size} selected customer(s)?`)) return;
    try {
      await adminApi.post('/customers/bulk-delete', { ids: Array.from(selectedIds) });
      toast.success(`${selectedIds.size} customer(s) deactivated`);
      setSelectedIds(new Set());
      fetchCustomers();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleExportSelected = () => {
    if (selectedIds.size === 0) return;
    const rows = customers.filter((c) => selectedIds.has(c.id));
    const headers = ['Name', 'Company', 'Phone', 'Email', 'Address', 'City', 'State', 'ZIP', 'Payment Terms'];
    const csvRows = [
      headers.join(','),
      ...rows.map((c) =>
        [
          `"${(c.name || '').replace(/"/g, '""')}"`,
          `"${(c.company || '').replace(/"/g, '""')}"`,
          `"${(c.phone || '').replace(/"/g, '""')}"`,
          `"${(c.email || '').replace(/"/g, '""')}"`,
          `"${(c.address || '').replace(/"/g, '""')}"`,
          `"${(c.city || '').replace(/"/g, '""')}"`,
          `"${(c.state || '').replace(/"/g, '""')}"`,
          `"${(c.zip || '').replace(/"/g, '""')}"`,
          `"${(c.payment_terms || '').replace(/"/g, '""')}"`,
        ].join(',')
      ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} customer(s). Open in Excel.`);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setCustomerFormDirty(false);
    setForm({
      name: c.name,
      customer_code: c.customer_code,
      company: c.company,
      phone: c.phone,
      email: c.email,
      address: c.address,
      billing_address: c.billing_address,
      city: c.city,
      state: c.state,
      zip: c.zip,
      payment_terms: c.payment_terms,
      credit_limit: c.credit_limit,
      notes: c.notes,
    });
    setShowModal(true);
  };

  const openDetail = (c: Customer) => {
    router.push(`/admin/customers/${c.id}`);
  };

  const openReceivePayment = (customerId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionDropdownId(null);
    setReceivePaymentCustomerId(customerId);
    setReceivePaymentOpen(true);
  };

  const openCreateInvoice = (c: Customer, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionDropdownId(null);
    router.push(`/admin/customers/${c.id}?newInvoice=1`);
  };

  const detailSaleInvoices = detailInvoices.filter((i) => i.invoice_type !== 'quotation');
  const detailPaid = detailSaleInvoices.filter((i) => (i.payment_status || '').toLowerCase() === 'paid').reduce((s, i) => s + (i.total_amount || 0), 0);
  const detailUnpaid = detailSaleInvoices.filter((i) => (i.payment_status || '').toLowerCase() !== 'paid').reduce((s, i) => s + ((i.total_amount || 0) - (i.amount_paid || 0)), 0);

  const getOpenBalance = (customerId: string) => balances[customerId] ?? 0;

  // Liquid Glass Aesthetic Classes
  const glassPanelClass = `bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.1)] rounded-2xl p-5`;
  const glassCardClass = `bg-slate-950/40 border border-white/[0.04] border-t-white/[0.12] rounded-xl p-4`;
  const glassInputClass = `w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500`;
  const glassButtonClass = `inline-flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-b from-white/[0.10] to-white/[0.02] border border-white/[0.08] hover:bg-white/[0.06] active:scale-[0.98] rounded-xl text-xs font-semibold text-white transition-all cursor-pointer`;
  const glassPrimaryBtn = `inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 active:scale-[0.98] rounded-xl text-xs font-bold text-white transition-all shadow-md shadow-teal-500/10 cursor-pointer`;

  return (
    <div className="space-y-6">
      
      {/* Title block */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Customers</h1>
          <p className="text-slate-400 text-xs mt-1">Manage B2B Customer Profiles, credit accounts, and statements.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setEditing(null);
              setCustomerFormDirty(false);
              setForm({ name: '', phone: '', email: '', company: '', address: '', billing_address: '', city: '', state: '', zip: '', payment_terms: '', notes: '', customer_code: '' });
              setShowModal(true);
            }}
            className={glassPrimaryBtn}
          >
            <Plus className="w-4 h-4" />
            New Customer
          </button>
        </div>
      </div>

      {/* Payment status bar */}
      {summary && (
        <div className={glassPanelClass}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-3">
            <div className="text-center p-3 rounded-lg bg-slate-950/40 border border-white/5">
              <p className="text-xl font-black text-white">$0.00</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">0 estimates</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-slate-950/40 border border-white/5">
              <p className="text-xl font-black text-white">$0.00</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">Unbilled income</p>
            </div>
            <button type="button" onClick={() => router.push('/admin/invoices?unpaid_only=1')} className="text-center p-3 rounded-lg bg-purple-950/20 border border-purple-500/25 hover:bg-purple-950/30 transition-all">
              <p className="text-xl font-black text-purple-400">${Number(summary.overdueTotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
              <p className="text-[10px] text-purple-300/80 font-bold uppercase tracking-wider mt-0.5">{(summary.overdueCount ?? 0)} overdue invoices</p>
            </button>
            <button type="button" onClick={() => router.push('/admin/invoices?unpaid_only=1')} className="text-center p-3 rounded-lg bg-amber-950/20 border border-amber-500/25 hover:bg-amber-950/30 transition-all">
              <p className="text-xl font-black text-amber-400">${Number(summary.openTotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
              <p className="text-[10px] text-amber-300/80 font-bold uppercase tracking-wider mt-0.5">{(summary.openCount ?? 0)} open invoices</p>
            </button>
            <div className="text-center p-3 rounded-lg bg-teal-950/20 border border-teal-500/25">
              <p className="text-xl font-black text-teal-400">${Number(summary.recentlyPaidTotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
              <p className="text-[10px] text-teal-300/80 font-bold uppercase tracking-wider mt-0.5">{(summary.paidCount ?? 0)} recently paid</p>
            </div>
          </div>
          <div className="h-2 rounded-full overflow-hidden flex bg-slate-950 border border-white/5">
            {(() => {
              const total = (Number(summary.openTotal) || 0) + (Number(summary.recentlyPaidTotal) || 0) || 1;
              const overdueW = ((Number(summary.overdueTotal) || 0) / total) * 100;
              const openW = ((Number(summary.openTotal) || 0) - (Number(summary.overdueTotal) || 0)) / total * 100;
              const recentW = (Number(summary.recentlyPaidTotal) || 0) / total * 100;
              return (
                <>
                  <div className="bg-purple-600 h-full transition-all" style={{ width: `${Math.max(0, overdueW)}%` }} />
                  <div className="bg-amber-600 h-full transition-all" style={{ width: `${Math.max(0, openW)}%` }} />
                  <div className="bg-teal-600 h-full flex-1 transition-all" style={{ width: `${Math.max(0, recentW)}%` }} />
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Search block */}
      <div className={`${glassPanelClass} flex flex-wrap items-center gap-4 py-3.5`}>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name, company, phone, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${glassInputClass} pl-10`}
          />
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400 font-bold">{selectedIds.size} selected</span>
            <button type="button" onClick={handleExportSelected} className={glassButtonClass}>
              <FileDown className="w-3.5 h-3.5 text-teal-400" /> Export Excel
            </button>
            <button type="button" onClick={handleBulkDelete} className="inline-flex items-center gap-1.5 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 rounded-xl text-xs font-semibold cursor-pointer active:scale-95 transition-all">
              <Trash2 className="w-3.5 h-3.5" /> Deactivate
            </button>
            <button type="button" onClick={() => setSelectedIds(new Set())} className="text-slate-500 hover:text-slate-200 text-xs font-semibold">Clear</button>
          </div>
        )}
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-teal-500 border-t-transparent" />
        </div>
      ) : (
        <div className={`${glassPanelClass} !p-0 overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                <tr>
                  <th className="w-12 py-3.5 px-4 text-left">
                    <input type="checkbox" checked={customers.length > 0 && selectedIds.size === customers.length} onChange={toggleSelectAll} className="rounded bg-slate-900 border-white/10 text-teal-500 focus:ring-teal-500" />
                  </th>
                  <th className="text-left py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">NAME</th>
                  <th className="text-left py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">COMPANY NAME</th>
                  <th className="text-left py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">PHONE</th>
                  <th className="text-right py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">OPEN BALANCE</th>
                  <th className="text-right py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {customers.map((c) => {
                  const openBal = getOpenBalance(c.id);
                  return (
                    <tr key={c.id} className="hover:bg-white/[0.02] cursor-pointer transition-colors" onClick={() => openDetail(c)}>
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} className="rounded bg-slate-900 border-white/10 text-teal-500 focus:ring-teal-500" />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-teal-400 shrink-0" />
                          <span className="font-bold text-white hover:text-teal-400 transition-colors">{c.name}</span>
                          {c.customer_code && <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono font-medium">({c.customer_code})</span>}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-semibold">{c.company || '—'}</td>
                      <td className="py-3 px-4 text-slate-400 font-medium">{c.phone}</td>
                      <td className="py-3 px-4 text-right font-bold text-slate-200">${openBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="relative inline-block">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (actionDropdownId === c.id) {
                                setActionDropdownId(null);
                                setActionDropdownAnchor(null);
                              } else {
                                setActionDropdownId(c.id);
                                setActionDropdownAnchor(e.currentTarget.getBoundingClientRect());
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0f766e] text-white hover:bg-[#0d6b63]"
                          >
                            {openBal > 0 ? 'Receive payment' : 'Create invoice'}
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {customers.length === 0 && (
            <div className="text-center py-12 text-slate-500 font-semibold">No customers found. Add your first customer above.</div>
          )}
        </div>
      )}

      {/* Action options drop-down menu overlay */}
      {typeof document !== 'undefined' && actionDropdownId && actionDropdownAnchor && (() => {
        const c = customers.find((x) => x.id === actionDropdownId);
        if (!c) return null;
        const openBal = getOpenBalance(c.id);
        const closeDropdown = () => { setActionDropdownId(null); setActionDropdownAnchor(null); };
        return createPortal(
          <>
            <div className="fixed inset-0 z-[100]" aria-hidden onClick={(e) => { e.stopPropagation(); closeDropdown(); }} />
            <div
              className="fixed z-[101] py-1.5 bg-slate-950 border border-white/10 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.55)] min-w-[170px] backdrop-filter backdrop-blur-xl text-xs font-semibold"
              style={{ top: actionDropdownAnchor.bottom + 4, right: typeof window !== 'undefined' ? window.innerWidth - actionDropdownAnchor.right : 0 }}
            >
              {openBal > 0 && (
                <button type="button" onClick={(e) => { openReceivePayment(c.id, e); closeDropdown(); }} className="w-full text-left px-4 py-2.5 text-slate-200 hover:bg-white/5 transition-colors">
                  Receive payment
                </button>
              )}
              <button type="button" onClick={(e) => { openCreateInvoice(c, e); closeDropdown(); }} className="w-full text-left px-4 py-2.5 text-slate-200 hover:bg-white/5 transition-colors">
                Create invoice
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(c); closeDropdown(); }} className="w-full text-left px-4 py-2.5 text-slate-200 hover:bg-white/5 transition-colors">
                Edit customer info
              </button>
            </div>
          </>,
          document.body
        );
      })()}

      {/* Customer Form Modal Dialog */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={handleCustomerModalClose}>
          <div className="bg-slate-950/95 border border-white/10 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col relative text-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-white/10 shrink-0">
              <h2 className="text-lg font-black">{editing ? 'Edit B2B Customer' : 'Add B2B Customer'}</h2>
              <button type="button" onClick={handleCustomerModalClose} className="p-2 rounded-xl bg-slate-900 border border-white/5 text-slate-450 hover:text-white" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <form id="customer-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs font-semibold">
              <div>
                <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">Name *</label>
                <input
                  type="text"
                  value={form.name || ''}
                  onChange={(e) => { setForm({ ...form, name: e.target.value }); setCustomerFormDirty(true); }}
                  className={glassInputClass}
                  required
                />
              </div>
              {!editing && (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">Customer ID</label>
                    <input
                      type="text"
                      value={form.customer_code || ''}
                      onChange={(e) => { setForm({ ...form, customer_code: e.target.value }); setCustomerFormDirty(true); }}
                      placeholder="Auto-generated if left blank"
                      className={glassInputClass}
                    />
                  </div>
                  <div className="pt-5.5">
                    <button type="button" onClick={generateCustomerCode} className={glassButtonClass}>Generate</button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">Phone *</label>
                  <input
                    type="text"
                    value={form.phone || ''}
                    onChange={(e) => { setForm({ ...form, phone: e.target.value }); setCustomerFormDirty(true); }}
                    className={glassInputClass}
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">Email</label>
                  <input
                    type="email"
                    value={form.email || ''}
                    onChange={(e) => { setForm({ ...form, email: e.target.value }); setCustomerFormDirty(true); }}
                    className={glassInputClass}
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">Company</label>
                <input
                  type="text"
                  value={form.company || ''}
                  onChange={(e) => { setForm({ ...form, company: e.target.value }); setCustomerFormDirty(true); }}
                  className={glassInputClass}
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">Address / Bill to</label>
                <textarea
                  value={form.address || ''}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  rows={2}
                  className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">Billing address (if different)</label>
                <input
                  type="text"
                  value={form.billing_address || ''}
                  onChange={(e) => { setForm({ ...form, billing_address: e.target.value }); setCustomerFormDirty(true); }}
                  className={glassInputClass}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">City</label>
                  <input
                    type="text"
                    value={form.city || ''}
                    onChange={(e) => { setForm({ ...form, city: e.target.value }); setCustomerFormDirty(true); }}
                    className={glassInputClass}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">State</label>
                  <input
                    type="text"
                    value={form.state || ''}
                    onChange={(e) => { setForm({ ...form, state: e.target.value }); setCustomerFormDirty(true); }}
                    className={glassInputClass}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">ZIP</label>
                  <input
                    type="text"
                    value={form.zip || ''}
                    onChange={(e) => { setForm({ ...form, zip: e.target.value }); setCustomerFormDirty(true); }}
                    className={glassInputClass}
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">Payment terms</label>
                <select
                  value={form.payment_terms || ''}
                  onChange={(e) => { setForm({ ...form, payment_terms: e.target.value }); setCustomerFormDirty(true); }}
                  className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                >
                  <option value="">Select payment terms</option>
                  <option value="Due on receipt">Due on receipt</option>
                  <option value="Net 7">Net 7</option>
                  <option value="Net 15">Net 15</option>
                  <option value="Net 30">Net 30</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">Notes</label>
                <textarea
                  value={form.notes || ''}
                  onChange={(e) => { setForm({ ...form, notes: e.target.value }); setCustomerFormDirty(true); }}
                  rows={2}
                  className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              {!editing && (
                <div>
                  <label className="block text-slate-400 mb-1.5 uppercase font-bold tracking-wider">Upload documents (PDF, JPG)</label>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple className="w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border file:border-white/10 file:bg-slate-900 file:text-white" id="customer-docs-form" />
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button type="submit" className="flex-1 px-5 py-3 rounded-xl bg-gradient-to-tr from-teal-600 to-teal-500 text-xs font-bold text-white shadow-md shadow-teal-500/10 hover:from-teal-500 hover:to-teal-400 transition-all cursor-pointer">
                  {editing ? 'Update Customer' : 'Create Customer'}
                </button>
                <button
                  type="button"
                  onClick={handleCustomerModalClose}
                  className={glassButtonClass}
                >
                  Cancel
                </button>
              </div>
            </form>
            {showCustomerCloseConfirm && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-2xl z-10 p-4">
                <div className="bg-slate-950 border border-white/10 rounded-xl p-4 max-w-sm w-full">
                  <p className="text-white font-medium mb-3">You have unsaved changes.</p>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={handleCustomerCloseWithoutSaving} className="px-3 py-2 text-slate-400 hover:text-white rounded-lg text-xs font-semibold">Discard Changes</button>
                    <button type="button" onClick={() => { setShowCustomerCloseConfirm(false); const f = document.getElementById('customer-form'); if (f) (f as HTMLFormElement).requestSubmit(); }} className="px-3 py-2 bg-teal-500 hover:bg-teal-400 text-white rounded-lg text-xs font-bold">Save and close</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {detailCustomer && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm flex justify-end z-50" onClick={() => setDetailCustomer(null)}>
          <div className="bg-slate-950 border-l border-white/10 w-full max-w-xl shadow-2xl overflow-y-auto text-white" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-white/10 flex items-center justify-between sticky top-0 bg-slate-950/90 backdrop-blur">
              <h2 className="text-lg font-black">Customer Details Summary</h2>
              <button type="button" onClick={() => setDetailCustomer(null)} className="p-2 rounded-xl bg-slate-900 border border-white/5 text-slate-450 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-6 text-xs font-semibold">
              <div>
                <h3 className="font-bold text-sm text-teal-400">{detailCustomer.name}</h3>
                {detailCustomer.customer_code && <p className="text-[10px] text-slate-500 font-mono mt-0.5">ID: {detailCustomer.customer_code}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs font-semibold">
                <div><span className="text-slate-500 block text-[10px]">Phone</span>{detailCustomer.phone}</div>
                <div><span className="text-slate-500 block text-[10px]">Email</span>{detailCustomer.email || '—'}</div>
                <div className="col-span-2"><span className="text-slate-500 block text-[10px]">Company</span>{detailCustomer.company || '—'}</div>
                <div className="col-span-2"><span className="text-slate-500 block text-[10px]">Address</span>{[detailCustomer.address, detailCustomer.city, detailCustomer.state, detailCustomer.zip].filter(Boolean).join(', ') || '—'}</div>
                <div className="col-span-2"><span className="text-slate-500 block text-[10px]">Payment terms</span>{detailCustomer.payment_terms || '—'}</div>
                {detailCustomer.notes && <div className="col-span-2"><span className="text-slate-500 block text-[10px]">Notes</span><p className="text-slate-300 italic">{detailCustomer.notes}</p></div>}
              </div>
              <div className="flex gap-4 py-2 border-t border-b border-white/5">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-teal-400" />
                  <span className="text-slate-350">Paid Spending: <strong className="text-teal-400">${detailPaid.toFixed(2)}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-rose-455" />
                  <span className="text-slate-350">Unpaid Ledger: <strong className="text-rose-400">${detailUnpaid.toFixed(2)}</strong></span>
                </div>
              </div>
              <div>
                <h4 className="font-bold text-slate-400 mb-2 flex items-center gap-2"><FileText className="w-4 h-4" /> Documents Archive</h4>
                {(detailCustomer.documents?.length ?? 0) > 0 ? (
                  <ul className="space-y-1">
                    {(detailCustomer.documents ?? []).map((d, i)=> (
                      <li key={i}>
                        <a href={d.url.startsWith('http') ? d.url : `${apiBase}${d.url}`} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">{d.name}</a>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-slate-500">No B2B documents signed or uploaded.</p>}
                <div className="mt-4">
                  <label className="text-[10px] text-slate-450 block mb-1">Upload signed agreement (PDF, JPG)</label>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={uploadingDoc} onChange={(e) => handleDocumentUpload(e, detailCustomer.id)} className="w-full text-slate-500 file:mr-2 file:py-1 file:px-2.5 file:rounded-xl file:border file:border-white/10 file:bg-slate-900 file:text-white" />
                </div>
              </div>
              <div className="pt-4 border-t border-white/10 flex justify-end">
                <button type="button" onClick={() => { openEdit(detailCustomer); setDetailCustomer(null); }} className="px-4 py-2 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold">
                  Edit B2B Customer Info
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ReceivePaymentLightbox
        isOpen={receivePaymentOpen}
        onClose={() => { setReceivePaymentOpen(false); setReceivePaymentCustomerId(undefined); }}
        onRecorded={() => { fetchSummary(); fetchBalances(); fetchCustomers(); }}
        preselectedCustomerId={receivePaymentCustomerId}
      />
    </div>
  );
}
