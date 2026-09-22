'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Search, CheckCircle, XCircle, X, FileText, Trash2, Download } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { downloadPdfFromResponse, openPdfFromResponse } from '@/lib/download-pdf';
import SearchableProductDropdown from '@/components/admin/SearchableProductDropdown';

interface CreditMemoItem {
  product_id: string;
  product_name?: string;
  quantity: number;
  unit_price: number;
  tax_percent?: number;
  tax_amount?: number;
  total?: number;
}

interface CreditMemo {
  id: string;
  credit_memo_number: string;
  type: 'VENDOR' | 'CUSTOMER';
  reference_invoice_id?: string;
  vendor_id?: string;
  vendor_name?: string;
  customer_id?: string;
  customer_name?: string;
  reason: string;
  affects_inventory: boolean;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: string;
  document_url?: string;
  notes?: string;
  created_at: string;
  approved_at?: string;
  items?: CreditMemoItem[];
}

const REASONS = ['DAMAGED', 'RATE_DIFFERENCE', 'RETURN', 'SCHEME', 'OTHER'] as const;
const STATUS_OPTIONS = ['', 'DRAFT', 'APPROVED', 'ADJUSTED', 'CLOSED', 'CANCELLED'];

export default function CreditMemosPage() {
  const searchParams = useSearchParams();
  const [list, setList] = useState<CreditMemo[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CreditMemo | null>(null);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; sku?: string; price?: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [savedCreditMemoId, setSavedCreditMemoId] = useState<string | null>(null);
  const emptyLine = (): { product_id: string; product_name: string; quantity: number; unit_price: number; tax_percent: number } => ({ product_id: '', product_name: '', quantity: 1, unit_price: 0, tax_percent: 0 });
  const [form, setForm] = useState({
    type: 'CUSTOMER' as 'VENDOR' | 'CUSTOMER',
    vendor_id: '',
    customer_id: '',
    reason: 'RETURN' as (typeof REASONS)[number],
    affects_inventory: true,
    reference_invoice_id: '',
    notes: '',
    tax_percent: 0,
    items: Array.from({ length: 15 }, emptyLine) as {
      product_id: string;
      product_name: string;
      quantity: number;
      unit_price: number;
      tax_percent: number;
    }[],
  });

  const fetchList = async () => {
    try {
      const params: Record<string, string | number> = { page: 1, limit: 100 };
      if (typeFilter) params.type = typeFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await adminApi.get('/credit-memos', { params });
      setList(res.data.credit_memos || []);
    } catch {
      toast.error('Failed to load credit memos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [typeFilter, statusFilter]);

  useEffect(() => {
    const newParam = searchParams?.get('new');
    const customerId = searchParams?.get('customer_id');
    if (newParam === '1' && customerId) {
      setForm((f) => ({ ...f, type: 'CUSTOMER', customer_id: customerId }));
      setShowModal(true);
    }
  }, [searchParams]);

  const fetchDetail = async (id: string) => {
    try {
      const res = await adminApi.get(`/credit-memos/${id}`);
      setDetail(res.data);
    } catch {
      toast.error('Failed to load credit memo');
    }
  };

  useEffect(() => {
    if (detailId) fetchDetail(detailId);
    else setDetail(null);
  }, [detailId]);

  useEffect(() => {
    if (showModal) {
      adminApi.get('/vendors', { params: { limit: 500 } }).then((r) => setVendors(r.data.vendors || [])).catch(() => {});
      adminApi.get('/customers', { params: { limit: 500 } }).then((r) => setCustomers(r.data.customers || [])).catch(() => {});
      adminApi.get('/products', { params: { limit: 500 } }).then((r) => setProducts(r.data.products || [])).catch(() => {});
    }
  }, [showModal]);

  const filteredList = search.trim()
    ? list.filter(
        (cm) =>
          cm.credit_memo_number?.toLowerCase().includes(search.toLowerCase()) ||
          cm.vendor_name?.toLowerCase().includes(search.toLowerCase()) ||
          cm.customer_name?.toLowerCase().includes(search.toLowerCase())
      )
    : list;

  const openNew = () => {
    setForm({
      type: 'CUSTOMER',
      vendor_id: '',
      customer_id: '',
      reason: 'RETURN',
      affects_inventory: true,
      reference_invoice_id: '',
      notes: '',
      tax_percent: 0,
      items: Array.from({ length: 15 }, emptyLine),
    });
    setShowModal(true);
  };

  const addLine = () => {
    setForm((f) => ({ ...f, items: [...f.items, emptyLine()] }));
  };

  const updateLine = (index: number, field: string, value: string | number) => {
    setForm((f) => {
      const items = [...f.items];
      if (!items[index]) return f;

      if (field === 'product_id') {
        const productId = String(value);
        const p = products.find((x) => x.id === productId);
        if (p) {
          const existingIdx = items.findIndex((l, i) => i !== index && l.product_id === productId);
          if (existingIdx !== -1) {
            items[existingIdx] = { ...items[existingIdx], quantity: items[existingIdx].quantity + (items[index].quantity || 1) };
            items[index] = emptyLine();
          } else {
            items[index] = { ...items[index], product_id: productId, product_name: p.name, unit_price: p.price ?? 0 };
          }
        }
      } else {
        (items[index] as any)[field] = value;
      }
      return { ...f, items };
    });
  };

  const removeLine = (index: number) => {
    setForm((f) => {
      const next = f.items.filter((_, i) => i !== index);
      return { ...f, items: next.length ? next : [emptyLine()] };
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.type === 'VENDOR' && !form.vendor_id) {
      toast.error('Select a vendor');
      return;
    }
    if (form.type === 'CUSTOMER' && !form.customer_id) {
      toast.error('Select a customer');
      return;
    }
    const validItems = form.items.filter((i) => i.product_id && i.quantity > 0);
    if (validItems.length === 0) {
      toast.error('Add at least one line item');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        type: form.type,
        vendor_id: form.type === 'VENDOR' ? form.vendor_id || undefined : undefined,
        customer_id: form.type === 'CUSTOMER' ? form.customer_id || undefined : undefined,
        reason: form.reason,
        affects_inventory: form.affects_inventory,
        reference_invoice_id: form.reference_invoice_id || undefined,
        notes: form.notes || undefined,
        items: validItems.map((i) => ({
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: Number(i.unit_price),
          tax_percent: Number(form.tax_percent) || 0,
        })),
      };
      const res = await adminApi.post('/credit-memos', payload);
      toast.success('Credit memo created');
      setShowModal(false);
      setSavedCreditMemoId(res.data?.id ?? null);
      setShowPdfModal(true);
      fetchList();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id: string) => {
    if (!confirm('Approve this credit memo? This will update ledger and optionally inventory.')) return;
    try {
      await adminApi.post(`/credit-memos/${id}/approve`);
      toast.success('Credit memo approved');
      fetchList();
      if (detailId === id) fetchDetail(id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to approve');
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this credit memo?')) return;
    try {
      await adminApi.post(`/credit-memos/${id}/cancel`);
      toast.success('Credit memo cancelled');
      fetchList();
      if (detailId === id) setDetailId(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to cancel');
    }
  };

  const formatDate = (d: string) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Credit Memos</h1>
          <p className="text-xs text-slate-400 mt-1">Issue customer return credits, vendor rebates, scheme adjustments, and rate corrections.</p>
        </div>
      </div>

      <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-4 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search memo number, vendor, customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 focus:bg-slate-950/80 transition-all font-semibold"
          />
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            New Credit Memo
          </button>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-200 font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="">All types</option>
            <option value="VENDOR">Vendor</option>
            <option value="CUSTOMER">Customer</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-200 font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => fetchList()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-900 border border-white/5 text-slate-300 hover:text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
          >
            <Search className="w-3.5 h-3.5" />
            Refresh
          </button>
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
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Number</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Type</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Vendor / Customer</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Reason</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Total</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Status</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Created</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-slate-500 text-xs font-semibold">
                      No credit memos found. Create a credit memo to get started.
                    </td>
                  </tr>
                ) : (
                  filteredList.map((cm) => (
                    <tr key={cm.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4 text-xs font-mono font-bold text-teal-400">{cm.credit_memo_number}</td>
                      <td className="py-3 px-4 text-xs text-slate-350">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${cm.type === 'VENDOR' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>{cm.type}</span>
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold text-slate-200">{cm.type === 'VENDOR' ? cm.vendor_name : cm.customer_name}</td>
                      <td className="py-3 px-4 text-xs text-slate-300">
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] border border-white/10 bg-slate-950/40">{cm.reason}</span>
                      </td>
                      <td className="py-3 px-4 text-xs text-right font-extrabold text-slate-100 font-mono">${Number(cm.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-xs">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${
                            cm.status === 'APPROVED'
                              ? 'bg-teal-500/10 text-teal-450 border-teal-500/20'
                              : cm.status === 'DRAFT'
                                ? 'bg-slate-800/80 text-slate-400 border border-white/10'
                                : cm.status === 'CANCELLED'
                                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                  : 'bg-blue-500/10 text-blue-40 border-blue-500/20'
                          }`}
                        >
                          {cm.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-450 font-mono">{formatDate(cm.created_at)}</td>
                      <td className="py-3 px-4 text-right text-xs">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setDetailId(detailId === cm.id ? null : cm.id)}
                            className="text-teal-450 hover:text-teal-350 hover:underline text-xs font-bold"
                          >
                            {detailId === cm.id ? 'Hide' : 'View'}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const res = await adminApi.get(`/credit-memos/${cm.id}/pdf`, { responseType: 'blob' });
                                if (downloadPdfFromResponse(res.data, `credit-memo-${cm.credit_memo_number || cm.id}.pdf`, res.headers['content-type'])) {
                                  toast.success('PDF downloaded');
                                }
                              } catch {
                                toast.error('Failed to download PDF');
                              }
                            }}
                            className="inline-flex items-center gap-1 text-slate-400 hover:text-white hover:underline text-xs font-medium"
                            title="Download PDF"
                          >
                            <Download className="w-3.5 h-3.5" />
                            PDF
                          </button>
                          {cm.status === 'DRAFT' && (
                            <button
                              type="button"
                              onClick={() => handleApprove(cm.id)}
                              className="text-emerald-450 hover:text-emerald-350 hover:underline text-xs font-bold"
                            >
                              Approve
                            </button>
                          )}
                          {(cm.status === 'DRAFT' || cm.status === 'APPROVED') && (
                            <button
                              type="button"
                              onClick={() => handleCancel(cm.id)}
                              className="text-rose-400 hover:text-rose-350 hover:underline text-xs font-medium"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailId && detail && (
        <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-white/5 pb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-teal-400" />
              {detail.credit_memo_number} <span className="text-xs text-slate-500 font-medium font-mono">({detail.status})</span>
            </h2>
            <button type="button" onClick={() => setDetailId(null)} className="p-1 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-slate-300">
            <div className="bg-slate-950/40 border border-white/5 p-3 rounded-xl">
              <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider mb-1">Type</span> 
              <span className="font-bold text-slate-205">{detail.type}</span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 p-3 rounded-xl">
              <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider mb-1">Party Name</span> 
              <span className="font-bold text-slate-205">{detail.type === 'VENDOR' ? detail.vendor_name : detail.customer_name}</span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 p-3 rounded-xl">
              <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider mb-1">Adjustment Reason</span> 
              <span className="font-bold text-slate-205">{detail.reason}</span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 p-3 rounded-xl">
              <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider mb-1">Affects Inventory</span> 
              <span className="font-bold text-slate-205">{detail.affects_inventory ? 'Yes' : 'No'}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-slate-300">
            <div className="bg-slate-950/40 border border-white/5 p-3 rounded-xl">
              <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider mb-1">Subtotal</span> 
              <span className="font-bold text-slate-205 font-mono">${Number(detail.subtotal).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 p-3 rounded-xl">
              <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider mb-1">VAT/Sales Tax</span> 
              <span className="font-bold text-slate-205 font-mono">${Number(detail.tax_amount).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 p-3 rounded-xl">
              <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider mb-1">Grand Total Adjustment</span> 
              <span className="font-bold text-teal-400 font-mono">${Number(detail.total_amount).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 p-3 rounded-xl">
              <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider mb-1">Created Date</span> 
              <span className="font-bold text-slate-205 font-mono">{formatDate(detail.created_at)}</span>
            </div>
            {detail.notes && (
              <div className="col-span-2 sm:col-span-4 bg-slate-950/40 border border-white/5 p-3 rounded-xl">
                <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider mb-1">Audit Notes / Reason description</span> 
                <span className="text-slate-300">{detail.notes}</span>
              </div>
            )}
          </div>
          {detail.items && detail.items.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Adjusted Line Items</h3>
              <div className="bg-slate-950/60 rounded-xl overflow-hidden border border-white/5">
                <table className="w-full text-xs">
                  <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                    <tr>
                      <th className="text-left py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Product Description</th>
                      <th className="text-right py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Quantity</th>
                      <th className="text-right py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Unit Price</th>
                      <th className="text-right py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Tax Rate</th>
                      <th className="text-right py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Adjusted Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item, idx) => (
                      <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.01]">
                        <td className="py-2.5 px-4 text-slate-205 font-medium">{item.product_name || item.product_id}</td>
                        <td className="text-right py-2.5 px-4 text-slate-350">{item.quantity}</td>
                        <td className="text-right py-2.5 px-4 text-slate-350 font-mono">${Number(item.unit_price).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td className="text-right py-2.5 px-4 text-slate-350 font-mono">{item.tax_percent ?? 0}%</td>
                        <td className="text-right py-2.5 px-4 font-bold text-slate-200 font-mono">${Number(item.total ?? 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.4)] rounded-2xl max-w-5xl w-full my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <h2 className="text-lg font-bold text-white">Create Adjustment Credit Memo</h2>
              <button type="button" onClick={() => setShowModal(false)} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Debit / Credit Type *</label>
                  <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as 'VENDOR' | 'CUSTOMER', vendor_id: '', customer_id: '' }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none">
                    <option value="VENDOR">Vendor (Procurement Rebate)</option>
                    <option value="CUSTOMER">Customer (Sales Return Claims)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{form.type === 'VENDOR' ? 'Select Vendor *' : 'Select Customer *'}</label>
                  {form.type === 'VENDOR' ? (
                    <select value={form.vendor_id} onChange={(e) => setForm((f) => ({ ...f, vendor_id: e.target.value }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500" required>
                      <option value="">Select vendor</option>
                      {vendors.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
                    </select>
                  ) : (
                    <select value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500" required>
                      <option value="">Select customer</option>
                      {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                    </select>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Reason Code *</label>
                  <select value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value as (typeof REASONS)[number] }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none">
                    {REASONS.map((r) => (<option key={r} value={r}>{r}</option>))}
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input type="checkbox" checked={form.affects_inventory} onChange={(e) => setForm((f) => ({ ...f, affects_inventory: e.target.checked }))} className="rounded border-white/10 bg-slate-950/60 text-teal-600 focus:ring-0 w-4 h-4" />
                    <span className="text-xs text-slate-300 font-semibold">Perform Warehouse Inventory Adjustment</span>
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Reference Sales/PO ID</label>
                  <input type="text" value={form.reference_invoice_id} onChange={(e) => setForm((f) => ({ ...f, reference_invoice_id: e.target.value }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none placeholder-slate-500" placeholder="e.g. INV-1002" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Audit Notes</label>
                  <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Line Items (Up to 15 entries) *</label>
                </div>
                <div className="border border-white/5 rounded-xl overflow-hidden bg-slate-950/20">
                  <table className="w-full text-xs min-w-[700px] border-collapse">
                    <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                      <tr>
                        <th className="text-left py-2.5 px-3 w-10 font-bold uppercase tracking-wider text-[9px]">#</th>
                        <th className="text-left py-2.5 px-3 min-w-[240px] font-bold uppercase tracking-wider text-[9px]">Product Item</th>
                        <th className="text-right py-2.5 px-3 w-24 font-bold uppercase tracking-wider text-[9px]">Return Qty</th>
                        <th className="text-right py-2.5 px-3 w-32 font-bold uppercase tracking-wider text-[9px]">Unit Rate</th>
                        <th className="text-right py-2.5 px-3 w-32 font-bold uppercase tracking-wider text-[9px]">Total Amount</th>
                        <th className="w-12 text-center font-bold uppercase tracking-wider text-[9px]" />
                      </tr>
                    </thead>
                    <tbody>
                      {form.items.map((line, idx) => {
                        const qty = Number(line.quantity) || 0;
                        const price = Number(line.unit_price) || 0;
                        const lineTotal = qty * price;
                        const hasProduct = !!(line.product_id || line.product_name);
                        return (
                          <tr key={idx} className="border-t border-white/5 hover:bg-white/[0.01]">
                            <td className="py-2.5 px-3 text-xs text-slate-500 font-mono">{idx + 1}</td>
                            <td className="py-2 px-3">
                              <SearchableProductDropdown
                                products={products}
                                value={line.product_id}
                                displayName={line.product_name || undefined}
                                onSelect={(p) => updateLine(idx, 'product_id', p.id)}
                                placeholder="Search products or scan barcode..."
                              />
                            </td>
                            <td className="py-2 px-3 text-right">
                              {hasProduct ? (
                                <input type="number" min={1} value={line.quantity} onChange={(e) => updateLine(idx, 'quantity', e.target.value)} className="w-20 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-xs text-right text-slate-200" />
                              ) : (
                                <span className="text-slate-600 font-mono">—</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right">
                              {hasProduct ? (
                                <input type="number" min={0} step={0.01} value={line.unit_price} onChange={(e) => updateLine(idx, 'unit_price', e.target.value)} className="w-24 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-xs text-right text-slate-200 font-mono font-semibold" />
                              ) : (
                                <span className="text-slate-600 font-mono">—</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-bold text-slate-300 font-mono">{hasProduct ? `$${lineTotal.toFixed(2)}` : ''}</td>
                            <td className="py-2 px-3 text-center">
                              {hasProduct && (
                                <button type="button" onClick={() => removeLine(idx)} className="p-1 text-rose-455 hover:bg-rose-500/10 rounded-lg transition-colors">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex flex-col sm:flex-row items-start justify-between gap-4">
                  <button type="button" onClick={addLine} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 transition-colors">
                    + Add row
                  </button>
                  {(() => {
                    const subtotal = form.items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
                    const taxRate = Number(form.tax_percent) || 0;
                    const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
                    const total = subtotal + taxAmount;
                    return (
                      <div className="w-80 bg-slate-950/40 border border-white/5 rounded-xl p-4 space-y-2 text-xs text-slate-350">
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-bold uppercase text-[9px] tracking-wider">Subtotal</span>
                          <span className="font-bold text-slate-205 font-mono">${subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500 font-bold uppercase text-[9px] tracking-wider">Tax Rate (%)</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            value={form.tax_percent || ''}
                            onChange={(e) => setForm((f) => ({ ...f, tax_percent: Number(e.target.value) || 0 }))}
                            className="w-20 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-xs text-right text-slate-200"
                            placeholder="0"
                          />
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-bold uppercase text-[9px] tracking-wider">VAT / Taxes amount</span>
                          <span className="font-bold text-slate-205 font-mono">${taxAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between border-t border-dashed border-white/10 pt-2 font-bold text-slate-200">
                          <span className="text-[10px] uppercase font-bold tracking-wider">Total Adjustment</span>
                          <span className="text-teal-400 font-mono text-sm">${total.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-4 border-t border-white/5">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">Close</button>
                <button type="submit" disabled={submitting} className="px-4 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-40">Create Memo</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPdfModal && savedCreditMemoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.4)] rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Credit Memo Saved</h3>
            <p className="text-slate-400 text-xs mb-5">Workflow complete, PDF generated and ledger accounts synchronized.</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await adminApi.get(`/credit-memos/${savedCreditMemoId}/pdf`, { responseType: 'blob' });
                    if (downloadPdfFromResponse(res.data, `credit-memo-${savedCreditMemoId}.pdf`, res.headers['content-type'])) {
                      toast.success('PDF downloaded');
                    }
                  } catch {
                    toast.error('Failed to download PDF');
                  }
                }}
                className="w-full px-4 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 border border-white/10 text-white rounded-xl text-xs font-bold transition-all shadow-sm font-bold"
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await adminApi.get(`/credit-memos/${savedCreditMemoId}/pdf`, { responseType: 'blob' });
                    if (openPdfFromResponse(res.data, res.headers['content-type'])) {
                      toast.success('Opening PDF for print');
                    }
                  } catch {
                    toast.error('Failed to open PDF for printing');
                  }
                }}
                className="w-full px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-350 hover:text-white rounded-xl text-xs font-semibold transition-all"
              >
                Print PDF
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPdfModal(false);
                  setSavedCreditMemoId(null);
                }}
                className="w-full px-4 py-2.5 bg-slate-900 border border-white/5 text-slate-500 hover:text-slate-400 rounded-xl text-xs font-semibold transition-all"
              >
                Finish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
