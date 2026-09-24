'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  ClipboardList,
  FileSignature,
  Mail,
  Phone,
  Building2,
  MessageSquare,
  Trash2,
  ExternalLink,
  X,
  Package,
} from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import { formatApiError } from '@/lib/format-api-error';
import toast from 'react-hot-toast';
import InvoiceFormLightbox, { type InvoiceInitialItem } from '@/components/admin/InvoiceFormLightbox';

interface RFQItem {
  product_id: string | null;
  product_name: string;
  category_name?: string;
  image_url?: string;
  quantity: number;
  price?: number;
  cost_price?: number;
}

interface RFQ {
  id: string;
  rfq_number: string;
  status: 'pending' | 'quoted' | 'closed' | 'cancelled';
  customer_name: string;
  customer_email?: string;
  customer_phone: string;
  customer_company?: string;
  customer_comments?: string;
  items: RFQItem[];
  item_count: number;
  quotation_id: string | null;
  quotation_number?: string;
  source: 'website' | 'store' | 'manual';
  created_at: string;
  updated_at: string;
}

interface RFQListResponse {
  rfqs: RFQ[];
  summary?: { pending?: number; quoted?: number };
  pagination?: { page: number; limit: number; total: number; totalPages: number };
}

const STATUS_STYLES: Record<RFQ['status'], { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  quoted: { label: 'Quoted', cls: 'bg-teal-500/10 text-teal-400 border-teal-500/25' },
  closed: { label: 'Closed', cls: 'bg-slate-800 text-slate-400 border-white/10' },
  cancelled: { label: 'Cancelled', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
};

export default function AdminRFQPage() {
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RFQ['status']>('all');
  const [selected, setSelected] = useState<RFQ | null>(null);
  const [summary, setSummary] = useState<{ pending: number; quoted: number }>({ pending: 0, quoted: 0 });

  // Quotation lightbox
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [quotationCustomerId, setQuotationCustomerId] = useState<string | null>(null);
  const [quotationItems, setQuotationItems] = useState<InvoiceInitialItem[]>([]);
  const [pendingRfqId, setPendingRfqId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const fetchRfqs = async () => {
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await adminApi.get<RFQListResponse>('/rfq', { params });
      setRfqs(res.data.rfqs || []);
      setSummary({
        pending: res.data.summary?.pending ?? 0,
        quoted: res.data.summary?.quoted ?? 0,
      });
    } catch (error) {
      if (isAdminAuthRedirectError(error)) return;
      toast.error(formatApiError(error, 'Failed to load quote requests'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRfqs();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      fetchRfqs();
    }, 400);
    return () => clearTimeout(t);
  }, [search, statusFilter]);

  const filteredRfqs = useMemo(() => rfqs, [rfqs]);

  const handleGenerateQuotation = async (rfq: RFQ) => {
    if (preparing) return;
    setPreparing(true);
    try {
      const ensureRes = await adminApi.post(`/rfq/${rfq.id}/ensure-customer`, {});
      const customerId = ensureRes.data?.customer_id as string | undefined;
      const items: InvoiceInitialItem[] = rfq.items.map((it) => ({
        product_id: it.product_id || undefined,
        product_name: it.product_name,
        category_name: it.category_name,
        quantity: it.quantity,
      }));
      setQuotationCustomerId(customerId || null);
      setQuotationItems(items);
      setPendingRfqId(rfq.id);
      setQuotationOpen(true);
    } catch (error) {
      toast.error(formatApiError(error, 'Failed to prepare quotation'));
    } finally {
      setPreparing(false);
    }
  };

  const handleQuotationSaved = async (savedId?: string) => {
    if (pendingRfqId && savedId) {
      try {
        await adminApi.post(`/rfq/${pendingRfqId}/link-quotation`, { quotation_id: savedId });
        toast.success('Quotation linked to RFQ');
      } catch {
        // ignore
      }
    }
    fetchRfqs();
  };

  const handleQuotationClose = () => {
    setQuotationOpen(false);
    setQuotationCustomerId(null);
    setQuotationItems([]);
    setPendingRfqId(null);
  };

  const handleStatusChange = async (rfq: RFQ, status: RFQ['status']) => {
    try {
      await adminApi.patch(`/rfq/${rfq.id}`, { status });
      toast.success('Status updated');
      fetchRfqs();
    } catch (error) {
      toast.error(formatApiError(error, 'Failed to update status'));
    }
  };

  const handleDelete = async (rfq: RFQ) => {
    if (!confirm(`Delete RFQ ${rfq.rfq_number}? This cannot be undone.`)) return;
    try {
      await adminApi.delete(`/rfq/${rfq.id}`);
      toast.success('RFQ deleted');
      setSelected((cur) => (cur?.id === rfq.id ? null : cur));
      fetchRfqs();
    } catch (error) {
      toast.error(formatApiError(error, 'Failed to delete RFQ'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Quote requests</h1>
          <p className="text-xs text-slate-400 mt-1">
            Incoming digital quote requests submitted by website customers. Convert to quotation drafts.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Pending RFQs</p>
              <p className="text-3xl font-extrabold text-amber-400 mt-2 font-mono">{summary.pending}</p>
            </div>
            <ClipboardList className="w-7 h-7 text-amber-500/80" />
          </div>
        </div>
        <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Quoted RFQs</p>
              <p className="text-3xl font-extrabold text-teal-400 mt-2 font-mono">{summary.quoted}</p>
            </div>
            <FileSignature className="w-7 h-7 text-teal-450/80" />
          </div>
        </div>
        <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total Visible</p>
              <p className="text-3xl font-extrabold text-slate-205 mt-2 font-mono">{rfqs.length}</p>
            </div>
            <Package className="w-7 h-7 text-slate-500" />
          </div>
        </div>
      </div>

      <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-4 flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Search Catalog Filters</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search RFQ number, customer name, company, phone or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Status Code</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | RFQ['status'])}
            className="bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-205 font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="quoted">Quoted</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
        </div>
      ) : filteredRfqs.length === 0 ? (
        <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] rounded-2xl p-16 text-center text-slate-500 text-xs font-semibold">
          <ClipboardList className="w-12 h-12 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-350">No incoming quote requests found.</p>
        </div>
      ) : (
        <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                <tr>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Submitted</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">RFQ #</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Customer</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Contact</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Unique Items</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Status</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRfqs.map((rfq) => {
                  const status = STATUS_STYLES[rfq.status] || STATUS_STYLES.pending;
                  return (
                    <tr
                      key={rfq.id}
                      className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer transition-colors"
                      onClick={() => setSelected(rfq)}
                    >
                      <td className="py-3 px-4 text-xs text-slate-400 font-mono">
                        {new Date(rfq.created_at).toLocaleDateString()}{' '}
                        <span className="text-slate-500 ml-1">
                          {new Date(rfq.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs font-bold text-teal-450">{rfq.rfq_number}</td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-200 text-xs">{rfq.customer_name}</p>
                        {rfq.customer_company && (
                          <p className="text-[10px] text-slate-450 font-medium mt-0.5">{rfq.customer_company}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-350">
                        <p className="flex items-center gap-1.5 font-semibold text-slate-300">
                          <Phone className="w-3.5 h-3.5 text-slate-500" />
                          {rfq.customer_phone}
                        </p>
                        {rfq.customer_email && (
                          <p className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
                            <Mail className="w-3 h-3 text-slate-500" />
                            {rfq.customer_email}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-xs">
                        <span className="font-bold text-slate-200 font-mono">{rfq.items.length}</span>{' '}
                        <span className="text-[10px] text-slate-500 font-medium font-mono">
                          ({rfq.item_count} units)
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${status.cls}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-xs">
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleGenerateQuotation(rfq)}
                            disabled={preparing}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-40"
                            title="Generate quotation"
                          >
                            <FileSignature className="w-3.5 h-3.5" />
                            Draft Quote
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelected(rfq)}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                            title="View details"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(rfq)}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-slate-900 border border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.4)] rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-teal-400" />
                  {selected.rfq_number}
                </h2>
                <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-wider">
                  Submitted {new Date(selected.created_at).toLocaleString()} · Channel: {selected.source}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-955/40 border border-white/5 rounded-xl p-4 text-xs">
                  <p className="text-[9px] uppercase text-slate-500 font-bold tracking-wider mb-2">Requesting Customer</p>
                  <p className="text-sm font-bold text-slate-200">{selected.customer_name}</p>
                  {selected.customer_company && (
                    <p className="flex items-center gap-1.5 text-slate-400 mt-2 font-medium">
                      <Building2 className="w-4 h-4 text-slate-500" />
                      {selected.customer_company}
                    </p>
                  )}
                </div>
                <div className="bg-slate-955/40 border border-white/5 rounded-xl p-4 text-xs">
                  <p className="text-[9px] uppercase text-slate-500 font-bold tracking-wider mb-2">Contact Channels</p>
                  <p className="flex items-center gap-1.5 text-slate-300 mt-1 font-semibold">
                    <Phone className="w-4 h-4 text-slate-550" />
                    <a href={`tel:${selected.customer_phone}`} className="hover:text-teal-400 transition-colors">{selected.customer_phone}</a>
                  </p>
                  {selected.customer_email && (
                    <p className="flex items-center gap-1.5 text-slate-400 mt-2">
                      <Mail className="w-4 h-4 text-slate-550" />
                      <a href={`mailto:${selected.customer_email}`} className="hover:text-teal-400 transition-colors">{selected.customer_email}</a>
                    </p>
                  )}
                </div>
              </div>

              {selected.customer_comments && (
                <div className="bg-amber-500/10 border border-amber-500/15 rounded-xl p-4 text-xs text-amber-400">
                  <p className="text-[9px] uppercase font-bold tracking-wider flex items-center gap-1.5 mb-2">
                    <MessageSquare className="w-4 h-4" />
                    Customer specifications / requirements
                  </p>
                  <p className="text-slate-300 mt-1 whitespace-pre-wrap leading-relaxed">{selected.customer_comments}</p>
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-3">
                  Requested products ({selected.items.length})
                </p>
                <div className="border border-white/5 rounded-xl overflow-hidden bg-slate-955/20">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                      <tr>
                        <th className="text-left py-2.5 px-4 font-bold uppercase tracking-wider text-[9px]">#</th>
                        <th className="text-left py-2.5 px-4 font-bold uppercase tracking-wider text-[9px]">Product Item</th>
                        <th className="text-left py-2.5 px-4 font-bold uppercase tracking-wider text-[9px]">Category</th>
                        <th className="text-right py-2.5 px-4 font-bold uppercase tracking-wider text-[9px]">Cost Price</th>
                        <th className="text-right py-2.5 px-4 font-bold uppercase tracking-wider text-[9px]">Normal Price</th>
                        <th className="text-right py-2.5 px-4 font-bold uppercase tracking-wider text-[9px]">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((it, idx) => (
                        <tr key={`${it.product_id || it.product_name}-${idx}`} className="border-t border-white/5 hover:bg-white/[0.01]">
                          <td className="py-2.5 px-4 text-slate-500 font-mono">{idx + 1}</td>
                          <td className="py-2.5 px-4 text-slate-205 font-medium">{it.product_name}</td>
                          <td className="py-2.5 px-4 text-slate-400">{it.category_name || '—'}</td>
                          <td className="py-2.5 px-4 text-right text-slate-450 font-mono">
                            {it.cost_price != null ? `$${it.cost_price.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right text-slate-250 font-bold font-mono">
                            {it.price != null ? `$${it.price.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-extrabold text-slate-100 font-mono">{it.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-slate-955/40 border border-white/5 rounded-xl p-4 flex flex-wrap items-center gap-3 text-xs text-slate-350">
                <p className="text-[9px] uppercase text-slate-500 font-bold tracking-wider mr-2">Override status</p>
                {(['pending', 'quoted', 'closed', 'cancelled'] as const).map((s) => {
                  const style = STATUS_STYLES[s];
                  const active = selected.status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleStatusChange(selected, s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                        active ? style.cls + ' ring-1 ring-teal-500/50 shadow-sm shadow-teal-500/10' : 'bg-slate-800 text-slate-400 border-white/5 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="p-4 border-t border-white/5 bg-slate-950/40 flex flex-wrap items-center justify-between gap-3 text-xs">
              <p className="text-slate-450 font-medium">Link with customer profiles or draft quotation worksheets.</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDelete(selected)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-rose-455 hover:text-rose-400 border border-rose-500/15 rounded-xl text-xs font-semibold hover:bg-rose-500/5 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete RFQ
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerateQuotation(selected)}
                  disabled={preparing}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
                >
                  <FileSignature className="w-4 h-4" />
                  Draft Quotation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <InvoiceFormLightbox
        isOpen={quotationOpen}
        onClose={handleQuotationClose}
        onSaved={handleQuotationSaved}
        initialCustomerId={quotationCustomerId}
        initialDocumentType="quotation"
        initialItems={quotationItems}
      />
    </div>
  );
}
