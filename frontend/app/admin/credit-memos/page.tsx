'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Search, CheckCircle, XCircle, X, FileText, Trash2, Download } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { downloadPdfFromResponse, openPdfFromResponse } from '@/lib/download-pdf';
import SearchableProductDropdown from '@/components/admin/SearchableProductDropdown';
import { adminUi } from '@/lib/admin-ui';
import { exportCreditMemosToExcel } from '@/lib/export-credit-memos-excel';

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      const params: Record<string, string | number> = { page: 1, limit: 1000 };
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
    if (newParam !== '1') return;
    // Quick command (/admin/credit-memos?new=1) opens a blank memo; a customer_id preselects the customer.
    if (customerId) setForm((f) => ({ ...f, type: 'CUSTOMER', customer_id: customerId }));
    setShowModal(true);
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

  const allVisibleSelected = filteredList.length > 0 && filteredList.every((c) => selectedIds.has(c.id));
  const someVisibleSelected = filteredList.some((c) => selectedIds.has(c.id));
  const selectedRows = filteredList.filter((c) => selectedIds.has(c.id));

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filteredList.forEach((c) => next.delete(c.id));
        return next;
      }
      const next = new Set(prev);
      filteredList.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const handleExport = async (rows: CreditMemo[]) => {
    if (rows.length === 0 || exporting) return;
    setExporting(true);
    try {
      await exportCreditMemosToExcel(rows);
      toast.success(`Exported ${rows.length} ${rows.length === 1 ? 'credit memo' : 'credit memos'} to Excel`);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedRows.length === 0 || deleting) return;
    const n = selectedRows.length;
    if (!confirm(`Delete ${n} selected ${n === 1 ? 'credit memo' : 'credit memos'}?\n\nApproved memos stay in the books until cancelled — export those instead.`)) return;
    setDeleting(true);
    let ok = 0;
    const failures: string[] = [];
    for (const cm of selectedRows) {
      try {
        await adminApi.delete(`/credit-memos/${cm.id}`);
        ok += 1;
      } catch (error: any) {
        failures.push(error?.response?.data?.error || `Could not delete ${cm.credit_memo_number}`);
      }
    }
    setDeleting(false);
    if (ok) toast.success(`Deleted ${ok} ${ok === 1 ? 'credit memo' : 'credit memos'}`);
    if (failures.length) toast.error(failures.slice(0, 3).join(' · '));
    setSelectedIds(new Set());
    fetchList();
  };

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
          <h1 className="text-2xl font-semibold text-[#0F172A] tracking-tight">Credit memo</h1>
          <p className="text-xs text-slate-400 mt-1">Issue customer return credits, vendor rebates, scheme adjustments, and rate corrections.</p>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 flex flex-wrap items-center gap-4">
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
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] border-transparent text-white rounded-xl text-xs font-bold shadow-sm transition-all"
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
          <button
            type="button"
            onClick={() => handleExport(filteredList)}
            disabled={exporting || filteredList.length === 0}
            className={`${adminUi.btnSecondary} disabled:opacity-50`}
          >
            <Download className="w-4 h-4" />
            Export all ({filteredList.length})
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#E3E5E8] bg-[#F4F5F8] px-4 py-2.5">
          <span className="text-sm font-medium text-[#1A1A1A]">{selectedIds.size} selected</span>
          <button type="button" onClick={() => handleExport(selectedRows)} disabled={exporting} className={`${adminUi.btnPrimary} disabled:opacity-50`}>
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting…' : 'Export selected to Excel'}
          </button>
          <button type="button" onClick={handleDeleteSelected} disabled={deleting} className={`${adminUi.btnDanger} disabled:opacity-50`}>
            <Trash2 className="w-4 h-4" />
            {deleting ? 'Deleting…' : 'Delete selected'}
          </button>
          <button type="button" onClick={() => setSelectedIds(new Set())} className={adminUi.btnGhost}>
            Clear selection
          </button>
        </div>
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
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
                      <td colSpan={9} className="py-16 text-center text-slate-500 text-xs font-semibold">
                      No credit memos found. Create a credit memo to get started.
                    </td>
                  </tr>
                ) : (
                  filteredList.map((cm) => (
                    <tr key={cm.id} className={`border-b border-white/5 hover:bg-white/[0.02] transition-colors ${selectedIds.has(cm.id) ? 'bg-[#F4F5F8]' : ''}`}>
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          aria-label={`Select ${cm.credit_memo_number}`}
                          checked={selectedIds.has(cm.id)}
                          onChange={() => toggleOne(cm.id)}
                          className="h-4 w-4 rounded border-[#C7C7C7] accent-black cursor-pointer"
                        />
                      </td>
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
                                if (await downloadPdfFromResponse(res.data, `credit-memo-${cm.credit_memo_number || cm.id}.pdf`, res.headers['content-type'])) {
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
        <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 space-y-6">
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
        <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">New credit memo</h2>
              <button type="button" onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type <span className="text-red-600">*</span></label>
                    <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as 'VENDOR' | 'CUSTOMER', vendor_id: '', customer_id: '' }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      <option value="VENDOR">Vendor (Procurement Rebate)</option>
                      <option value="CUSTOMER">Customer (Sales Return Claims)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{form.type === 'VENDOR' ? 'Vendor' : 'Customer'} <span className="text-red-600">*</span></label>
                    {form.type === 'VENDOR' ? (
                      <select value={form.vendor_id} onChange={(e) => setForm((f) => ({ ...f, vendor_id: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" required>
                        <option value="">Select vendor</option>
                        {vendors.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
                      </select>
                    ) : (
                      <select value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" required>
                        <option value="">Select customer</option>
                        {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-600">*</span></label>
                    <select value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value as (typeof REASONS)[number] }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      {REASONS.map((r) => (<option key={r} value={r}>{r}</option>))}
                    </select>
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={form.affects_inventory} onChange={(e) => setForm((f) => ({ ...f, affects_inventory: e.target.checked }))} className="rounded border-gray-300 text-black focus:ring-0 w-4 h-4" />
                      <span className="text-sm text-gray-700">Adjust inventory</span>
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reference invoice / PO</label>
                    <input type="text" value={form.reference_invoice_id} onChange={(e) => setForm((f) => ({ ...f, reference_invoice_id: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. INV-1002" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                    <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Product or service</label>
                  <div className="border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left py-3 px-4 w-10">#</th>
                          <th className="text-left py-3 px-4 min-w-[200px]">Product</th>
                          <th className="text-right py-3 px-4 w-24">Qty</th>
                          <th className="text-right py-3 px-4 w-28">Unit price</th>
                          <th className="text-right py-3 px-4 w-28">Amount</th>
                          <th className="w-12 px-4" />
                        </tr>
                      </thead>
                      <tbody>
                        {form.items.map((line, idx) => {
                          const qty = Number(line.quantity) || 0;
                          const price = Number(line.unit_price) || 0;
                          const lineTotal = qty * price;
                          const hasProduct = !!(line.product_id || line.product_name);
                          return (
                            <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50/50">
                              <td className="py-2 px-4">{idx + 1}</td>
                              <td className="py-2 px-4">
                                <SearchableProductDropdown
                                  products={products}
                                  value={line.product_id}
                                  displayName={line.product_name || undefined}
                                  onSelect={(p) => updateLine(idx, 'product_id', p.id)}
                                  placeholder="Search product or scan barcode…"
                                />
                              </td>
                              <td className="py-2 px-4 text-right">
                                {hasProduct ? (
                                  <input type="number" min={1} value={line.quantity} onChange={(e) => updateLine(idx, 'quantity', e.target.value)} className="w-16 text-right border border-gray-300 rounded px-2 py-1" />
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-right">
                                {hasProduct ? (
                                  <input type="number" min={0} step={0.01} value={line.unit_price} onChange={(e) => updateLine(idx, 'unit_price', e.target.value)} className="w-20 text-right border border-gray-300 rounded px-2 py-1" />
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-right font-medium">{hasProduct ? `$${lineTotal.toFixed(2)}` : ''}</td>
                              <td className="py-2 px-4">
                                {hasProduct && (
                                  <button type="button" onClick={() => removeLine(idx)} className="text-red-600 hover:bg-red-50 p-1 rounded">
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
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs text-gray-500">Click any empty row to search or scan a barcode. Amount fills automatically.</p>
                    <button type="button" onClick={addLine} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50">
                      + Add line
                    </button>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <div className="flex flex-wrap items-start justify-end gap-8">
                    {(() => {
                      const subtotal = form.items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
                      const taxRate = Number(form.tax_percent) || 0;
                      const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
                      const total = subtotal + taxAmount;
                      return (
                        <div className="space-y-2 min-w-[200px]">
                          <p className="text-sm text-gray-600">Subtotal: <span className="font-medium text-gray-900">${subtotal.toFixed(2)}</span></p>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Tax rate (%)</label>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={form.tax_percent || ''}
                              onChange={(e) => setForm((f) => ({ ...f, tax_percent: Number(e.target.value) || 0 }))}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                              placeholder="0"
                            />
                          </div>
                          <p className="text-sm text-gray-600">Tax: <span className="font-medium text-gray-900">${taxAmount.toFixed(2)}</span></p>
                          <p className="font-semibold text-gray-900 text-base">Total: ${total.toFixed(2)}</p>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-black text-white rounded-lg hover:bg-[#2C2C2C] disabled:opacity-50">
                  {submitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPdfModal && savedCreditMemoId && (
        <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => { setShowPdfModal(false); setSavedCreditMemoId(null); }}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Document saved</h3>
            <p className="text-gray-600 text-sm mb-4">Download or print the credit memo PDF.</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await adminApi.get(`/credit-memos/${savedCreditMemoId}/pdf`, { responseType: 'blob' });
                    if (await downloadPdfFromResponse(res.data, `credit-memo-${savedCreditMemoId}.pdf`, res.headers['content-type'])) {
                      toast.success('PDF downloaded');
                    }
                  } catch {
                    toast.error('Failed to download PDF');
                  }
                }}
                className="w-full px-4 py-2.5 rounded-lg font-medium bg-black text-white hover:bg-[#2C2C2C]"
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await adminApi.get(`/credit-memos/${savedCreditMemoId}/pdf`, { responseType: 'blob' });
                    if (await openPdfFromResponse(res.data, res.headers['content-type'])) {
                      toast.success('Opening PDF for print');
                    }
                  } catch {
                    toast.error('Failed to open PDF for printing');
                  }
                }}
                className="w-full px-4 py-2.5 rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Print PDF
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPdfModal(false);
                  setSavedCreditMemoId(null);
                }}
                className="w-full px-4 py-2.5 rounded-lg font-medium text-gray-600 hover:bg-gray-100"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
