'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Download, Trash2, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import toast from 'react-hot-toast';
import { downloadPdfFromResponse, safePdfFilename } from '@/lib/download-pdf';
import { shareDocumentOnWhatsApp, composeEmailWithPdf } from '@/lib/share-document';
import { exportInvoicesToExcel } from '@/lib/export-invoices-excel';
import InvoiceFormLightbox from '@/components/admin/InvoiceFormLightbox';
import ReceivePaymentLightbox from '@/components/admin/ReceivePaymentLightbox';
import InvoiceHistoryDrawer from '@/components/admin/InvoiceHistoryDrawer';
import { adminUi } from '@/lib/admin-ui';

interface InvoiceItem {
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  total_amount: number;
  amount_paid?: number;
  payment_status: string;
  created_at: string;
  invoice_date?: string;
  shipping_type?: string;
  terms?: string;
  quote_status?: 'open' | 'rejected' | 'converted';
  converted_invoice_number?: string;
  items?: InvoiceItem[];
}

type DocType = 'invoice' | 'quotation';

export default function InvoicesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" /></div>}>
      <InvoicesPageInner />
    </Suspense>
  );
}

function InvoicesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [receivePaymentOpen, setReceivePaymentOpen] = useState(false);
  const [receivePaymentCustomerId, setReceivePaymentCustomerId] = useState<string | undefined>();
  const [receivePaymentInvoiceId, setReceivePaymentInvoiceId] = useState<string | undefined>();
  const [summary, setSummary] = useState<{ totalPaid: number; totalUnpaid: number } | null>(null);
  const [docTypeFilter, setDocTypeFilter] = useState<'all' | DocType>('invoice');
  const [createMode, setCreateMode] = useState<DocType>('invoice');
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareAfter, setShareAfter] = useState<Invoice | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);

  const fetchInvoices = async () => {
    try {
      const params: Record<string, string> = searchTerm ? { search: searchTerm } : {};
      if (docTypeFilter !== 'all') params.type = docTypeFilter;
      const response = await adminApi.get('/invoices', { params });
      const data = response.data;
      const list: Invoice[] = Array.isArray(data) ? data : (data.invoices || []);
      setInvoices(list);
      // Drop selections that are no longer in the visible list (filter/search changed).
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const visible = new Set(list.map((i) => i.id));
        const next = new Set([...prev].filter((id) => visible.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } catch (error) {
      if (isAdminAuthRedirectError(error)) return;
      toast.error('Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await adminApi.get('/invoices/summary');
      setSummary({ totalPaid: res.data.totalPaid ?? 0, totalUnpaid: res.data.totalUnpaid ?? 0 });
    } catch (e) {
      if (isAdminAuthRedirectError(e)) return;
      setSummary(null);
    }
  };

  useEffect(() => {
    fetchInvoices();
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const debounce = setTimeout(() => { fetchInvoices(); }, 500);
    return () => clearTimeout(debounce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, docTypeFilter]);

  // Deep links: /admin/invoices?create=invoice | ?create=quotation (quick commands, sidebar, palette).
  useEffect(() => {
    const create = searchParams?.get('create');
    if (create === 'invoice' || create === 'quotation') {
      setCreateMode(create);
      setDocTypeFilter(create);
      setEditId(null);
      setCreateOpen(true);
    }
  }, [searchParams]);

  const openCreate = (mode: DocType) => {
    setCreateMode(mode);
    setEditId(null);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setEditId(null);
    if (searchParams?.get('create')) router.replace('/admin/invoices');
  };

  const fetchPdf = async (invoiceId: string) => {
    try {
      const response = await adminApi.get(`/invoices/${invoiceId}/pdf`, { responseType: 'blob', timeout: 60000 });
      return { data: response.data as BlobPart, contentType: response.headers['content-type'] as string | undefined };
    } catch (error: any) {
      const data = error?.response?.data;
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        const text = await data.text();
        try {
          throw new Error(JSON.parse(text)?.error || 'Failed to generate PDF');
        } catch (inner) {
          if (inner instanceof SyntaxError) throw new Error(text.slice(0, 160) || 'Failed to generate PDF');
          throw inner;
        }
      }
      throw new Error(error?.message || 'Failed to generate PDF');
    }
  };

  const pdfName = (inv: Invoice) =>
    safePdfFilename(`${inv.invoice_type === 'quotation' ? 'quotation' : 'invoice'}-${inv.invoice_number}.pdf`);

  const handleDownloadPDF = async (inv: Invoice) => {
    try {
      const res = await fetchPdf(inv.id);
      if (await downloadPdfFromResponse(res.data, pdfName(inv), res.contentType)) {
        toast.success('PDF saved to your Downloads folder');
        setShareAfter(inv);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to download PDF');
    }
  };

  const handleWhatsApp = async (inv: Invoice) => {
    if (sharingId) return;
    setSharingId(inv.id);
    try {
      const outcome = await shareDocumentOnWhatsApp(
        {
          id: inv.id,
          type: inv.invoice_type === 'quotation' ? 'quotation' : 'invoice',
          number: inv.invoice_number,
          customerName: inv.customer_name,
          customerPhone: inv.customer_phone,
          total: Number(inv.total_amount),
        },
        () => fetchPdf(inv.id),
      );
      if (outcome === 'whatsapp-opened') toast.success('WhatsApp opened — attach the downloaded PDF');
      else if (outcome === 'shared') toast.success('Shared');
      else if (outcome === 'failed') toast.error('Could not open WhatsApp');
    } finally {
      setSharingId(null);
    }
  };

  const handleEmail = async (inv: Invoice) => {
    const doc = {
      id: inv.id,
      type: (inv.invoice_type === 'quotation' ? 'quotation' : 'invoice') as 'invoice' | 'quotation',
      number: inv.invoice_number,
      customerName: inv.customer_name,
      customerPhone: inv.customer_phone,
      total: Number(inv.total_amount),
    };
    if (inv.customer_email) {
      try {
        await adminApi.post(`/invoices/${inv.id}/send-email`);
        toast.success(`Sent via email to ${inv.customer_email}`);
        return;
      } catch {
        // SMTP is often not configured locally — open the mail app instead.
      }
    }
    const ok = await composeEmailWithPdf(doc, () => fetchPdf(inv.id), inv.customer_email);
    if (ok) toast.success('Mail app opened — attach the downloaded PDF');
    else toast.error('Could not open email');
  };

  // ---- Selection ----
  const allVisibleSelected = invoices.length > 0 && invoices.every((i) => selectedIds.has(i.id));
  const someVisibleSelected = invoices.some((i) => selectedIds.has(i.id));

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
        invoices.forEach((i) => next.delete(i.id));
        return next;
      }
      const next = new Set(prev);
      invoices.forEach((i) => next.add(i.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleExport = async (rows: Invoice[]) => {
    if (rows.length === 0 || exporting) return;
    setExporting(true);
    try {
      const base = docTypeFilter === 'quotation' ? 'quotations' : docTypeFilter === 'all' ? 'invoices-and-quotations' : 'invoices';
      await exportInvoicesToExcel(rows, base);
      toast.success(`Exported ${rows.length} ${rows.length === 1 ? 'document' : 'documents'} to Excel`);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const selectedRows = invoices.filter((i) => selectedIds.has(i.id));

  const handleDeleteSelected = async () => {
    if (selectedRows.length === 0 || deleting) return;
    const n = selectedRows.length;
    if (!confirm(`Delete ${n} selected ${n === 1 ? 'document' : 'documents'}?\n\nQuotations and unpaid invoices can be removed. Paid invoices and POS sales stay in the books — export those instead.`)) {
      return;
    }
    setDeleting(true);
    let ok = 0;
    const failures: string[] = [];
    for (const inv of selectedRows) {
      try {
        await adminApi.delete(`/invoices/${inv.id}`);
        ok += 1;
      } catch (error: any) {
        failures.push(error?.response?.data?.error || `Could not delete ${inv.invoice_number}`);
      }
    }
    setDeleting(false);
    if (ok) toast.success(`Deleted ${ok} ${ok === 1 ? 'document' : 'documents'}`);
    if (failures.length) toast.error(failures.slice(0, 3).join(' · '));
    clearSelection();
    fetchInvoices();
    fetchSummary();
  };

  const openReceivePayment = (inv: Invoice) => {
    setReceivePaymentCustomerId(inv.customer_id || undefined);
    setReceivePaymentInvoiceId(inv.id);
    setReceivePaymentOpen(true);
  };

  const isQuotation = (inv: Invoice) => (inv.invoice_type || 'invoice') === 'quotation';
  const quoteOutcome = (inv: Invoice): 'open' | 'rejected' | 'converted' => {
    if (inv.quote_status) return inv.quote_status;
    const raw = String(inv.shipping_type || '');
    if (raw === 'rejected') return 'rejected';
    if (raw.startsWith('converted:')) return 'converted';
    return 'open';
  };
  const statusDisplay = (inv: Invoice) => ((inv.payment_status || 'unpaid').toLowerCase() === 'paid' ? 'Paid' : 'Unpaid');
  const balance = (inv: Invoice) => (inv.total_amount ?? 0) - (inv.amount_paid ?? 0);
  const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
  const fmtDate = (inv: Invoice) => new Date(inv.invoice_date || inv.created_at).toLocaleDateString();

  const convertQuote = async (inv: Invoice) => {
    if (!confirm(`Convert ${inv.invoice_number} to an invoice?\n\nStock will be deducted and the customer will be billed the quoted amounts.`)) return;
    try {
      const res = await adminApi.post(`/invoices/${inv.id}/convert`);
      toast.success(`Converted to ${res.data.invoice_number}`);
      setDocTypeFilter('invoice');
      fetchInvoices();
      fetchSummary();
      if (res.data?.id) setHistoryId(res.data.id);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Could not convert quotation');
    }
  };

  const rejectQuote = async (inv: Invoice) => {
    if (!confirm(`Mark ${inv.invoice_number} as rejected?`)) return;
    try {
      await adminApi.post(`/invoices/${inv.id}/reject`);
      toast.success('Quotation marked rejected');
      fetchInvoices();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Could not reject quotation');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className={adminUi.pageTitle}>{docTypeFilter === 'quotation' ? 'Quotations' : 'Invoices'}</h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => openCreate('quotation')} className={adminUi.btnSecondary}>
            Create quotation
          </button>
          <button type="button" onClick={() => openCreate('invoice')} className={adminUi.btnPrimary}>
            Create invoice
          </button>
        </div>
      </div>

      <div className="flex border-b border-[#E3E5E8]">
        {([
          { key: 'invoice', label: 'Invoices' },
          { key: 'quotation', label: 'Quotations' },
          { key: 'all', label: 'All' },
        ] as { key: 'all' | DocType; label: string }[]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setDocTypeFilter(tab.key)}
            className={`py-3 px-4 text-sm font-medium border-b-2 ${
              docTypeFilter === tab.key ? 'border-black text-[#1A1A1A]' : 'border-transparent text-[#6B6C72] hover:text-[#1A1A1A]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {summary && docTypeFilter !== 'quotation' && (
        <div className="grid grid-cols-1 md:grid-cols-2 rounded-md overflow-hidden border border-[#E3E5E8]">
          <div className="px-5 py-4 bg-[#FFF4E5]">
            <p className="text-[26px] leading-tight font-normal text-[#1A1A1A] tabular-nums break-words">{money(summary.totalUnpaid)}</p>
            <p className="text-xs text-[#6B6C72] mt-1">Unpaid</p>
            <div className="mt-3 h-1.5 bg-[#F5A623] rounded-full" />
          </div>
          <div className="px-5 py-4 bg-[#E5F6E3]">
            <p className="text-[26px] leading-tight font-normal text-[#1A1A1A] tabular-nums break-words">{money(summary.totalPaid)}</p>
            <p className="text-xs text-[#6B6C72] mt-1">Paid</p>
            <div className="mt-3 h-1.5 bg-[#2CA01C] rounded-full" />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-[#1A1A1A]">{docTypeFilter === 'quotation' ? 'All quotations' : docTypeFilter === 'all' ? 'All documents' : 'All invoices'}</span>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8D9096]" />
          <input
            type="text"
            placeholder="Search by number, customer, phone"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`${adminUi.field} pl-9`}
          />
        </div>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => handleExport(invoices)}
            disabled={exporting || invoices.length === 0}
            className={`${adminUi.btnSecondary} disabled:opacity-50`}
            title="Export everything in this list to Excel"
          >
            <Download className="w-4 h-4" />
            Export all ({invoices.length})
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#E3E5E8] bg-[#F4F5F8] px-4 py-2.5">
          <span className="text-sm font-medium text-[#1A1A1A]">
            {selectedIds.size} selected
          </span>
          <button type="button" onClick={() => handleExport(selectedRows)} disabled={exporting} className={`${adminUi.btnPrimary} disabled:opacity-50`}>
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting…' : 'Export selected to Excel'}
          </button>
          <button type="button" onClick={handleDeleteSelected} disabled={deleting} className={`${adminUi.btnDanger} disabled:opacity-50`}>
            <Trash2 className="w-4 h-4" />
            {deleting ? 'Deleting…' : 'Delete selected'}
          </button>
          <button type="button" onClick={clearSelection} className={adminUi.btnGhost}>
            Clear selection
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
        </div>
      ) : invoices.length === 0 ? (
        <div className={`${adminUi.panel} p-12 text-center`}>
          <p className="text-sm text-[#1A1A1A]">No {docTypeFilter === 'quotation' ? 'quotations' : 'invoices'} yet.</p>
          <p className={`${adminUi.meta} mt-1`}>Use the buttons above to create one.</p>
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
                  {docTypeFilter === 'all' && <th className="text-left px-4 py-3 font-medium">Type</th>}
                  <th className="text-left px-4 py-3 font-medium">Number</th>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  {docTypeFilter !== 'quotation' && <th className="text-right px-4 py-3 font-medium">Paid</th>}
                  {docTypeFilter !== 'quotation' && <th className="text-right px-4 py-3 font-medium">Balance</th>}
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const quote = isQuotation(inv);
                  const bal = balance(inv);
                  const qOut = quote ? quoteOutcome(inv) : null;
                  return (
                    <tr
                      key={inv.id}
                      className={`border-t border-[#E3E5E8] cursor-pointer ${adminUi.tableRowHover} ${selectedIds.has(inv.id) ? 'bg-[#F4F5F8]' : ''}`}
                      onClick={() => setHistoryId(inv.id)}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${inv.invoice_number}`}
                          checked={selectedIds.has(inv.id)}
                          onChange={() => toggleOne(inv.id)}
                          className="h-4 w-4 rounded border-[#C7C7C7] accent-black cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 text-[#1A1A1A] whitespace-nowrap">{fmtDate(inv)}</td>
                      {docTypeFilter === 'all' && (
                        <td className="px-4 py-3"><span className={adminUi.badge}>{quote ? 'Quotation' : 'Invoice'}</span></td>
                      )}
                      <td className="px-4 py-3 font-medium text-[#0077C5] whitespace-nowrap hover:underline">{inv.invoice_number}</td>
                      <td className="px-4 py-3">
                        <p className="text-[#1A1A1A]">{inv.customer_name || '—'}</p>
                        {inv.customer_phone && <p className={adminUi.helper}>{inv.customer_phone}</p>}
                      </td>
                      <td className="px-4 py-3 text-right text-[#1A1A1A] tabular-nums whitespace-nowrap">{money(inv.total_amount)}</td>
                      {docTypeFilter !== 'quotation' && (
                        <td className="px-4 py-3 text-right text-[#6B6C72] tabular-nums whitespace-nowrap">{quote ? '—' : money(inv.amount_paid ?? 0)}</td>
                      )}
                      {docTypeFilter !== 'quotation' && (
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                          {quote ? (
                            <span className="text-[#8D9096]">—</span>
                          ) : bal <= 0 ? (
                            <span className="text-[#6B6C72]">{bal < 0 ? `Over ${money(Math.abs(bal))}` : '—'}</span>
                          ) : (
                            <span className="text-[#8A4500]">{money(bal)}</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        {quote ? (
                          qOut === 'converted' ? (
                            <span className={adminUi.badgePaid}>Converted{inv.converted_invoice_number ? ` · ${inv.converted_invoice_number}` : ''}</span>
                          ) : qOut === 'rejected' ? (
                            <span className={adminUi.badgeUnpaid}>Rejected</span>
                          ) : (
                            <span className={adminUi.badgeDraft}>Open</span>
                          )
                        ) : (
                          <span className={statusDisplay(inv) === 'Paid' ? adminUi.badgePaid : adminUi.badgeUnpaid}>{statusDisplay(inv)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => { setEditId(inv.id); setCreateOpen(true); }} className="text-[#0077C5] hover:underline">
                          View/Edit
                        </button>
                        {quote && qOut === 'open' && (
                          <>
                            <span className="text-[#C7C7C7] mx-1.5">·</span>
                            <button type="button" onClick={() => convertQuote(inv)} className="text-[#0077C5] hover:underline">
                              Convert
                            </button>
                            <span className="text-[#C7C7C7] mx-1.5">·</span>
                            <button type="button" onClick={() => rejectQuote(inv)} className="text-[#C81916] hover:underline">
                              Reject
                            </button>
                          </>
                        )}
                        {!quote && (
                          <>
                            <span className="text-[#C7C7C7] mx-1.5">·</span>
                            <button type="button" onClick={() => openReceivePayment(inv)} className="text-[#0077C5] hover:underline">
                              Receive payment
                            </button>
                          </>
                        )}
                        <span className="text-[#C7C7C7] mx-1.5">·</span>
                        <button type="button" onClick={() => handleDownloadPDF(inv)} className="text-[#6B6C72] hover:underline" title="Download / print PDF">
                          PDF
                        </button>
                        <span className="text-[#C7C7C7] mx-1.5">·</span>
                        <button
                          type="button"
                          onClick={() => handleWhatsApp(inv)}
                          disabled={sharingId === inv.id}
                          className="text-[#6B6C72] hover:underline disabled:opacity-50"
                          title={inv.customer_phone ? `WhatsApp ${inv.customer_phone}` : 'Share on WhatsApp'}
                        >
                          WhatsApp
                        </button>
                        <span className="text-[#C7C7C7] mx-1.5">·</span>
                        <button
                          type="button"
                          onClick={() => handleEmail(inv)}
                          className="text-[#6B6C72] hover:underline"
                          title={inv.customer_email ? `Send to ${inv.customer_email}` : 'No email on file — opens your mail app with the PDF downloaded'}
                        >
                          Email
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

      <InvoiceFormLightbox
        isOpen={createOpen}
        onClose={closeCreate}
        onSaved={() => { fetchInvoices(); fetchSummary(); }}
        editId={editId}
        initialDocumentType={createMode}
      />

      <ReceivePaymentLightbox
        isOpen={receivePaymentOpen}
        onClose={() => { setReceivePaymentOpen(false); setReceivePaymentCustomerId(undefined); setReceivePaymentInvoiceId(undefined); }}
        onRecorded={() => { fetchInvoices(); fetchSummary(); setHistoryTick((n) => n + 1); }}
        preselectedCustomerId={receivePaymentCustomerId}
        preselectedInvoiceId={receivePaymentInvoiceId}
      />

      <InvoiceHistoryDrawer
        invoiceId={historyId}
        refreshKey={historyTick}
        onClose={() => setHistoryId(null)}
        onEdit={(id) => { setHistoryId(null); setEditId(id); setCreateOpen(true); }}
        onReceivePayment={(inv) => {
          setReceivePaymentCustomerId(inv.customer_id);
          setReceivePaymentInvoiceId(inv.id);
          setReceivePaymentOpen(true);
        }}
        onChanged={() => { fetchInvoices(); fetchSummary(); setHistoryTick((n) => n + 1); }}
      />

      {shareAfter && (
        <div className={adminUi.modalBackdrop} onClick={() => setShareAfter(null)}>
          <div className={`${adminUi.modal} max-w-md w-full p-6`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-lg font-medium text-[#1A1A1A]">PDF downloaded</h3>
              <button type="button" onClick={() => setShareAfter(null)} className={adminUi.btnIcon} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-[#1A1A1A] mb-2">
              {shareAfter.invoice_number} is in your Downloads folder.
            </p>
            <p className={`${adminUi.meta} mb-4`}>
              WhatsApp and email cannot attach a file automatically on desktop. Open one of these — then attach the PDF from Downloads (usually one drag).
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={sharingId === shareAfter.id}
                onClick={() => handleWhatsApp(shareAfter)}
                className={adminUi.btnPrimary}
              >
                Share on WhatsApp{shareAfter.customer_phone ? ` (${shareAfter.customer_phone})` : ''}
              </button>
              <button
                type="button"
                onClick={() => handleEmail(shareAfter)}
                className={adminUi.btnSecondary}
              >
                {shareAfter.customer_email ? `Email to ${shareAfter.customer_email}` : 'Open email app'}
              </button>
              <button type="button" onClick={() => setShareAfter(null)} className={adminUi.btnGhost}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
