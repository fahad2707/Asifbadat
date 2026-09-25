'use client';

import { useEffect, useState } from 'react';
import {
  Search,
  ClipboardList,
  FileSignature,
  Mail,
  Phone,
  Building2,
  MessageSquare,
  Trash2,
  X,
} from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import { formatApiError } from '@/lib/format-api-error';
import toast from 'react-hot-toast';
import InvoiceFormLightbox, { type InvoiceInitialItem } from '@/components/admin/InvoiceFormLightbox';
import { adminUi } from '@/lib/admin-ui';

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
  pending: { label: 'Pending', cls: adminUi.badgeUnpaid },
  quoted: { label: 'Quoted', cls: adminUi.badgePaid },
  closed: { label: 'Closed', cls: adminUi.badgeDraft },
  cancelled: { label: 'Cancelled', cls: 'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#FDECEC] text-[#8A100E]' },
};

const money = (n?: number | null) => (n != null && Number.isFinite(Number(n)) ? `$${Number(n).toFixed(2)}` : '—');

const estimatedTotal = (rfq: RFQ) =>
  rfq.items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);

export default function AdminRFQPage() {
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RFQ['status']>('pending');
  const [selected, setSelected] = useState<RFQ | null>(null);
  const [summary, setSummary] = useState<{ pending: number; quoted: number }>({ pending: 0, quoted: 0 });

  // Quotation lightbox (shared form from Invoices)
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [quotationCustomerId, setQuotationCustomerId] = useState<string | null>(null);
  const [quotationItems, setQuotationItems] = useState<InvoiceInitialItem[]>([]);
  const [quotationEditId, setQuotationEditId] = useState<string | null>(null);
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
    const t = setTimeout(() => {
      setLoading(true);
      fetchRfqs();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  /**
   * Draft a quotation from an RFQ: make sure the requester exists as a customer,
   * then open the standard quotation form with every requested item, quantity and
   * price already filled in. The admin can adjust prices before saving.
   */
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
        price: it.price,
        cost_price: it.cost_price,
      }));
      setQuotationCustomerId(customerId || null);
      setQuotationItems(items);
      setQuotationEditId(null);
      setPendingRfqId(rfq.id);
      setSelected(null);
      setQuotationOpen(true);
    } catch (error) {
      toast.error(formatApiError(error, 'Failed to prepare quotation'));
    } finally {
      setPreparing(false);
    }
  };

  /** Open the quotation already linked to this RFQ (view / edit / re-share). */
  const handleOpenQuotation = (rfq: RFQ) => {
    if (!rfq.quotation_id) return;
    setQuotationEditId(rfq.quotation_id);
    setQuotationItems([]);
    setQuotationCustomerId(null);
    setPendingRfqId(null);
    setSelected(null);
    setQuotationOpen(true);
  };

  const handleQuotationSaved = async (savedId?: string) => {
    if (pendingRfqId && savedId) {
      try {
        await adminApi.post(`/rfq/${pendingRfqId}/link-quotation`, { quotation_id: savedId });
        toast.success('Quotation linked to quote request');
      } catch {
        // linking is best-effort; the quotation itself is already saved
      }
    }
    fetchRfqs();
  };

  const handleQuotationClose = () => {
    setQuotationOpen(false);
    setQuotationCustomerId(null);
    setQuotationItems([]);
    setQuotationEditId(null);
    setPendingRfqId(null);
  };

  const handleStatusChange = async (rfq: RFQ, status: RFQ['status']) => {
    try {
      await adminApi.patch(`/rfq/${rfq.id}`, { status });
      toast.success('Status updated');
      setSelected((cur) => (cur?.id === rfq.id ? { ...cur, status } : cur));
      fetchRfqs();
    } catch (error) {
      toast.error(formatApiError(error, 'Failed to update status'));
    }
  };

  const handleDelete = async (rfq: RFQ) => {
    if (!confirm(`Delete quote request ${rfq.rfq_number}? This cannot be undone.`)) return;
    try {
      await adminApi.delete(`/rfq/${rfq.id}`);
      toast.success('Quote request deleted');
      setSelected((cur) => (cur?.id === rfq.id ? null : cur));
      fetchRfqs();
    } catch (error) {
      toast.error(formatApiError(error, 'Failed to delete quote request'));
    }
  };

  const tabs: { key: 'all' | RFQ['status']; label: string; count?: number }[] = [
    { key: 'pending', label: 'Pending', count: summary.pending },
    { key: 'quoted', label: 'Quoted', count: summary.quoted },
    { key: 'closed', label: 'Closed' },
    { key: 'cancelled', label: 'Cancelled' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={adminUi.pageTitle}>Quote requests</h1>
          <p className={`${adminUi.meta} mt-1`}>
            Requests submitted by website customers. Draft a quotation from any request — items and prices are filled in for you.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 rounded-md overflow-hidden border border-[#E3E5E8]">
        <button type="button" onClick={() => setStatusFilter('pending')} className="text-left px-5 py-4 bg-[#FFF4E5] hover:brightness-[0.98]">
          <p className="text-[26px] leading-tight font-normal text-[#1A1A1A] tabular-nums">{summary.pending}</p>
          <p className="text-xs text-[#6B6C72] mt-1">Pending — waiting for a quotation</p>
          <div className="mt-3 h-1.5 bg-[#F5A623] rounded-full" />
        </button>
        <button type="button" onClick={() => setStatusFilter('quoted')} className="text-left px-5 py-4 bg-[#E5F6E3] hover:brightness-[0.98]">
          <p className="text-[26px] leading-tight font-normal text-[#1A1A1A] tabular-nums">{summary.quoted}</p>
          <p className="text-xs text-[#6B6C72] mt-1">Quoted — quotation sent</p>
          <div className="mt-3 h-1.5 bg-[#2CA01C] rounded-full" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3E5E8]">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px ${
                statusFilter === tab.key ? 'border-black text-[#1A1A1A]' : 'border-transparent text-[#6B6C72] hover:text-[#1A1A1A]'
              }`}
            >
              {tab.label}
              {typeof tab.count === 'number' && tab.count > 0 && (
                <span className={`${adminUi.badge} ml-2`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-80 pb-2 sm:pb-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8D9096]" />
          <input
            type="text"
            placeholder="Search number, customer, company, phone, email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${adminUi.field} pl-9`}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
        </div>
      ) : rfqs.length === 0 ? (
        <div className={`${adminUi.panel} p-12 text-center`}>
          <ClipboardList className="w-10 h-10 text-[#C7C7C7] mx-auto mb-3" />
          <p className="text-sm text-[#1A1A1A]">No {statusFilter === 'all' ? '' : statusFilter} quote requests.</p>
          <p className={`${adminUi.meta} mt-1`}>New requests from the website will appear here.</p>
        </div>
      ) : (
        <div className={`${adminUi.panel} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={adminUi.tableHead}>
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Received</th>
                  <th className="text-left px-4 py-3 font-medium">Request #</th>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium">Items requested</th>
                  <th className="text-right px-4 py-3 font-medium">Est. value</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {rfqs.map((rfq) => {
                  const status = STATUS_STYLES[rfq.status] || STATUS_STYLES.pending;
                  const preview = rfq.items.slice(0, 2).map((it) => `${it.quantity} × ${it.product_name}`).join(', ');
                  const more = rfq.items.length - 2;
                  return (
                    <tr
                      key={rfq.id}
                      className={`border-t border-[#E3E5E8] ${adminUi.tableRowHover} cursor-pointer`}
                      onClick={() => setSelected(rfq)}
                    >
                      <td className="px-4 py-3 text-[#1A1A1A] whitespace-nowrap">
                        {new Date(rfq.created_at).toLocaleDateString()}
                        <span className={`${adminUi.helper} block`}>
                          {new Date(rfq.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-[#1A1A1A] whitespace-nowrap">{rfq.rfq_number}</td>
                      <td className="px-4 py-3">
                        <p className="text-[#1A1A1A]">{rfq.customer_name}</p>
                        <p className={adminUi.helper}>
                          {[rfq.customer_company, rfq.customer_phone].filter(Boolean).join(' · ')}
                        </p>
                      </td>
                      <td className="px-4 py-3 max-w-[320px]">
                        <p className="text-[#1A1A1A] truncate" title={rfq.items.map((it) => `${it.quantity} × ${it.product_name}`).join('\n')}>
                          {preview || '—'}
                        </p>
                        <p className={adminUi.helper}>
                          {rfq.items.length} {rfq.items.length === 1 ? 'item' : 'items'} · {rfq.item_count} units
                          {more > 0 ? ` · +${more} more` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right text-[#1A1A1A] tabular-nums whitespace-nowrap">{money(estimatedTotal(rfq))}</td>
                      <td className="px-4 py-3">
                        <span className={status.cls}>{status.label}</span>
                        {rfq.quotation_number && (
                          <span className={`${adminUi.helper} block mt-0.5`}>{rfq.quotation_number}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {rfq.quotation_id ? (
                          <button type="button" onClick={() => handleOpenQuotation(rfq)} className="text-[#0077C5] hover:underline">
                            Open quotation
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleGenerateQuotation(rfq)}
                            disabled={preparing}
                            className="text-[#0077C5] hover:underline disabled:opacity-50"
                          >
                            Draft quotation
                          </button>
                        )}
                        <span className="text-[#C7C7C7] mx-1.5">·</span>
                        <button type="button" onClick={() => setSelected(rfq)} className="text-[#6B6C72] hover:underline">
                          View
                        </button>
                        <span className="text-[#C7C7C7] mx-1.5">·</span>
                        <button type="button" onClick={() => handleDelete(rfq)} className="text-[#6B6C72] hover:text-[#C81916] hover:underline">
                          Delete
                        </button>
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
        <div className={adminUi.modalBackdrop} onClick={() => setSelected(null)}>
          <div
            className={`${adminUi.modal} max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-[#E3E5E8]">
              <div>
                <h2 className="text-lg font-medium text-[#1A1A1A] flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-[#6B6C72]" />
                  Quote request {selected.rfq_number}
                  <span className={STATUS_STYLES[selected.status]?.cls || STATUS_STYLES.pending.cls}>
                    {STATUS_STYLES[selected.status]?.label || 'Pending'}
                  </span>
                </h2>
                <p className={`${adminUi.meta} mt-1`}>
                  Received {new Date(selected.created_at).toLocaleString()} · via {selected.source}
                  {selected.quotation_number ? ` · Quotation ${selected.quotation_number}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className={adminUi.btnIcon} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className={`${adminUi.panel} p-4`}>
                  <p className={`${adminUi.label} mb-2`}>Customer</p>
                  <p className="text-sm font-medium text-[#1A1A1A]">{selected.customer_name}</p>
                  {selected.customer_company && (
                    <p className="flex items-center gap-1.5 text-sm text-[#6B6C72] mt-1">
                      <Building2 className="w-4 h-4 text-[#8D9096]" />
                      {selected.customer_company}
                    </p>
                  )}
                </div>
                <div className={`${adminUi.panel} p-4`}>
                  <p className={`${adminUi.label} mb-2`}>Contact</p>
                  <p className="flex items-center gap-1.5 text-sm text-[#1A1A1A]">
                    <Phone className="w-4 h-4 text-[#8D9096]" />
                    <a href={`tel:${selected.customer_phone}`} className="hover:underline">{selected.customer_phone}</a>
                  </p>
                  {selected.customer_email && (
                    <p className="flex items-center gap-1.5 text-sm text-[#1A1A1A] mt-1">
                      <Mail className="w-4 h-4 text-[#8D9096]" />
                      <a href={`mailto:${selected.customer_email}`} className="hover:underline">{selected.customer_email}</a>
                    </p>
                  )}
                </div>
              </div>

              {selected.customer_comments && (
                <div className="rounded-md border border-[#FCD34D] bg-[#FFF4E5] p-4">
                  <p className={`${adminUi.label} flex items-center gap-1.5 mb-2 text-[#8A4500]`}>
                    <MessageSquare className="w-4 h-4" />
                    Customer notes
                  </p>
                  <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap leading-relaxed">{selected.customer_comments}</p>
                </div>
              )}

              <div>
                <p className={`${adminUi.label} mb-3`}>Requested items ({selected.items.length})</p>
                <div className={`${adminUi.panel} overflow-hidden`}>
                  <table className="w-full text-sm">
                    <thead className={adminUi.tableHead}>
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium">#</th>
                        <th className="text-left px-4 py-2.5 font-medium">Product</th>
                        <th className="text-left px-4 py-2.5 font-medium">Category</th>
                        <th className="text-right px-4 py-2.5 font-medium">Qty</th>
                        <th className="text-right px-4 py-2.5 font-medium">Price</th>
                        <th className="text-right px-4 py-2.5 font-medium">Line total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((it, idx) => (
                        <tr key={`${it.product_id || it.product_name}-${idx}`} className="border-t border-[#E3E5E8]">
                          <td className="px-4 py-2.5 text-[#8D9096]">{idx + 1}</td>
                          <td className="px-4 py-2.5 text-[#1A1A1A]">{it.product_name}</td>
                          <td className="px-4 py-2.5 text-[#6B6C72]">{it.category_name || '—'}</td>
                          <td className="px-4 py-2.5 text-right text-[#1A1A1A] tabular-nums">{it.quantity}</td>
                          <td className="px-4 py-2.5 text-right text-[#1A1A1A] tabular-nums">{money(it.price)}</td>
                          <td className="px-4 py-2.5 text-right text-[#1A1A1A] tabular-nums">
                            {it.price != null ? money(Number(it.price) * Number(it.quantity)) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[#E3E5E8] bg-[#FAFAFA]">
                        <td colSpan={5} className="px-4 py-2.5 text-right text-sm text-[#6B6C72]">Estimated value at list prices</td>
                        <td className="px-4 py-2.5 text-right text-sm font-medium text-[#1A1A1A] tabular-nums">{money(estimatedTotal(selected))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className={`${adminUi.panel} p-4 flex flex-wrap items-center gap-2`}>
                <p className={`${adminUi.label} mr-2`}>Status</p>
                {(['pending', 'quoted', 'closed', 'cancelled'] as const).map((s) => {
                  const active = selected.status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleStatusChange(selected, s)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                        active ? 'bg-black text-white border-black' : 'bg-white text-[#393A3D] border-[#C7C7C7] hover:bg-[#F4F5F8]'
                      }`}
                    >
                      {STATUS_STYLES[s].label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-4 border-t border-[#E3E5E8] bg-[#FAFAFA] flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => handleDelete(selected)} className={`${adminUi.btnGhost} text-[#C81916] hover:text-[#8A100E]`}>
                <Trash2 className="w-4 h-4" />
                Delete request
              </button>
              <div className="flex items-center gap-2">
                {selected.quotation_id && (
                  <button type="button" onClick={() => handleOpenQuotation(selected)} className={adminUi.btnSecondary}>
                    Open {selected.quotation_number || 'quotation'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleGenerateQuotation(selected)}
                  disabled={preparing}
                  className={`${adminUi.btnPrimary} disabled:opacity-50`}
                >
                  <FileSignature className="w-4 h-4" />
                  {preparing ? 'Preparing…' : selected.quotation_id ? 'Draft new quotation' : 'Draft quotation'}
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
        editId={quotationEditId}
        initialCustomerId={quotationCustomerId}
        initialDocumentType="quotation"
        initialItems={quotationItems}
      />
    </div>
  );
}
