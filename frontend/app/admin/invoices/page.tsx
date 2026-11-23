'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Download, Trash2, X, Send, Printer, Banknote, ChevronLeft, ChevronRight, Barcode } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import toast from 'react-hot-toast';
import { shareDocumentOnWhatsApp, composeEmailWithPdf } from '@/lib/share-document';
import { downloadPdfFromResponse } from '@/lib/download-pdf';
import { exportInvoicesToExcel } from '@/lib/export-invoices-excel';
import InvoiceFormLightbox from '@/components/admin/InvoiceFormLightbox';
import ReceivePaymentLightbox from '@/components/admin/ReceivePaymentLightbox';
import InvoiceHistoryDrawer from '@/components/admin/InvoiceHistoryDrawer';
import SalesStatement from '@/components/admin/SalesStatement';
import { adminMenuItemClass, adminMenuPanel, adminUi } from '@/lib/admin-ui';
import { moneyIn, moneyOut, moneyPlain } from '@/lib/moneyTone';

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
  customer_company?: string;
  customer_phone?: string;
  settlement?: 'paid' | 'partial' | 'unpaid' | null;
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
  fulfillment_method?: 'unfulfilled' | 'store_pickup' | 'shipment' | null;
  inventory_applied?: boolean | null;
  linked_shipment_id?: string | null;
}

type DocType = 'invoice' | 'quotation';

const PAGE_SIZE = 25;

const filterControl = 'border border-[#E2E8F0] rounded-lg bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0F9F8F] focus:border-[#0F9F8F]';

type BarcodeHit = { rawValue?: string };

function InvoiceBarcodeScan({ onClose, onScan }: { onClose: () => void; onScan: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState('');
  const [cameraNote, setCameraNote] = useState('Starting the camera…');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;

    const stop = () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };

    const run = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraNote('This browser has no camera. Type the code, or scan it with a handheld scanner into the box below.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const Detector = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: CanvasImageSource) => Promise<BarcodeHit[]> } }).BarcodeDetector;
        if (!Detector) {
          setCameraNote('Point a handheld scanner at the box below. This browser cannot read a barcode from the camera.');
          return;
        }
        let detector: { detect: (source: CanvasImageSource) => Promise<BarcodeHit[]> };
        try {
          detector = new Detector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'] });
        } catch {
          setCameraNote('Point a handheld scanner at the box below. This browser cannot read a barcode from the camera.');
          return;
        }
        setCameraNote('Hold the invoice barcode in front of the camera.');
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const hits = await detector.detect(videoRef.current);
            const value = hits.find((hit) => hit.rawValue)?.rawValue?.trim();
            if (value) {
              stop();
              onScan(value);
              return;
            }
          } catch {
            /* keep trying while the camera is open */
          }
          timer = window.setTimeout(tick, 280);
        };
        timer = window.setTimeout(tick, 300);
      } catch {
        setCameraNote('The camera is unavailable. Type the code, or scan it with a handheld scanner into the box below.');
      }
    };

    void run();
    return stop;
  }, [onScan]);

  return createPortal(
    <div className={adminUi.modalBackdrop} onClick={onClose}>
      <div className={`${adminUi.modal} w-full max-w-md p-5`} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-medium text-[#1A1A1A]">Scan invoice barcode</h3>
          <button type="button" onClick={onClose} className={adminUi.btnIcon} aria-label="Close scanner">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className={`${adminUi.meta} mt-1`}>{cameraNote}</p>
        <video ref={videoRef} muted playsInline className="mt-4 h-52 w-full rounded-lg bg-[#1A1A1A] object-cover" />
        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = manual.trim();
            if (value) onScan(value);
          }}
        >
          <input
            autoFocus
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="RI#001"
            aria-label="Invoice barcode"
            className={`${adminUi.field} flex-1`}
          />
          <button type="submit" className={adminUi.btnPrimary}>Find</button>
        </form>
      </div>
    </div>,
    document.body
  );
}

function localDateInput(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
const NUMBER_PREFIXES = ['INV#', 'RI#', 'QI#', 'WI#', 'QTN#', 'RQ#', 'WQ#'] as const;

async function printPdfBlob(data: BlobPart, contentType?: string) {
  const blob = new Blob([data], { type: contentType && contentType.includes('pdf') ? contentType : 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.setAttribute('title', 'Print invoice');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.src = url;
  document.body.appendChild(frame);
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The invoice did not open for printing')), 20000);
    frame.onload = () => {
      window.clearTimeout(timer);
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      resolve();
    };
  });
  window.setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 60000);
}

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
  const [refreshing, setRefreshing] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(() => searchParams?.get('q') || '');
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
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [sendMenuId, setSendMenuId] = useState<string | null>(null);
  const [sendMenuAnchor, setSendMenuAnchor] = useState<DOMRect | null>(null);
  const [fulfillMenuId, setFulfillMenuId] = useState<string | null>(null);
  const [fulfillMenuAnchor, setFulfillMenuAnchor] = useState<DOMRect | null>(null);
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalDocs, setTotalDocs] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [customerFilter, setCustomerFilter] = useState('');
  const [prefixFilter, setPrefixFilter] = useState('');
  const [settlementFilter, setSettlementFilter] = useState('');
  const [customers, setCustomers] = useState<{ id: string; name: string; company?: string }[]>([]);
  const [printing, setPrinting] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [statementFrom, setStatementFrom] = useState(() => `${localDateInput().slice(0, 8)}01`);
  const [statementTo, setStatementTo] = useState(() => localDateInput());
  const [statementRange, setStatementRange] = useState<{ from: string; to: string } | null>(null);
  const listRequest = useRef(0);
  const hasLoaded = useRef(false);

  const fetchInvoices = async () => {
    const requestId = ++listRequest.current;
    try {
      const params: Record<string, string> = {
        paginated: '1',
        page: String(page),
        limit: String(PAGE_SIZE),
      };
      if (searchTerm) params.search = searchTerm;
      if (docTypeFilter !== 'all') params.type = docTypeFilter;
      if (customerFilter) params.customer_id = customerFilter;
      if (prefixFilter) params.prefix = prefixFilter;
      if (settlementFilter) params.settlement = settlementFilter;
      const response = await adminApi.get('/invoices', { params });
      if (requestId !== listRequest.current) return;
      const data = response.data;
      const list: Invoice[] = Array.isArray(data) ? data : (data.invoices || []);
      const pagination = Array.isArray(data) ? null : data.pagination;
      setInvoices(list);
      setTotalDocs(pagination?.total ?? list.length);
      setTotalPages(pagination?.totalPages ?? 1);
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const visible = new Set(list.map((i) => i.id));
        const next = new Set([...prev].filter((id) => visible.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } catch (error) {
      if (requestId !== listRequest.current) return;
      if (isAdminAuthRedirectError(error)) return;
      toast.error('Failed to load invoices');
    } finally {
      if (requestId === listRequest.current) {
        hasLoaded.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const applyBarcode = useCallback((code: string) => {
    const value = code.trim();
    if (!value) return;
    setScannerOpen(false);
    setDocTypeFilter('all');
    setPrefixFilter('');
    setSettlementFilter('');
    setCustomerFilter('');
    setPage(1);
    setSearchTerm(value);
  }, []);

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
    fetchSummary();
    adminApi.get('/customers', { params: { limit: 1000, page: 1 } }).then((res) => {
      const rows = Array.isArray(res.data) ? res.data : res.data?.customers || [];
      setCustomers(rows.map((row: { id: string; name: string; company?: string }) => ({ id: row.id, name: row.name, company: row.company })));
    }).catch(() => setCustomers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const delay = searchTerm.trim() ? 250 : 0;
    const debounce = setTimeout(() => {
      if (hasLoaded.current) setRefreshing(true);
      void fetchInvoices();
    }, delay);
    return () => clearTimeout(debounce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, docTypeFilter, page, customerFilter, prefixFilter, settlementFilter]);

  // Deep links: /admin/invoices?create=invoice | ?create=quotation | ?receive=1
  useEffect(() => {
    const create = searchParams?.get('create');
    if (create === 'invoice' || create === 'quotation') {
      setCreateMode(create);
      setDocTypeFilter(create);
      setEditId(null);
      setCreateOpen(true);
    }
    if (searchParams?.get('receive') === '1') {
      router.replace('/admin/payments');
    }
    const q = searchParams?.get('q');
    if (q) setSearchTerm(q);
    const openId = searchParams?.get('open');
    if (openId) {
      setEditId(openId);
      setCreateOpen(true);
    }
  }, [searchParams, router]);

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

  const handlePrint = async (inv: Invoice) => {
    try {
      const res = await fetchPdf(inv.id);
      await printPdfBlob(res.data, res.contentType);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to print');
    }
  };

  const handleDownload = async (inv: Invoice) => {
    try {
      const res = await fetchPdf(inv.id);
      await downloadPdfFromResponse(res.data, `${inv.invoice_number}.pdf`, res.contentType);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to download');
    }
  };

  const handleDownloadSelected = async () => {
    if (printing || selectedRows.length === 0) return;
    setPrinting(true);
    try {
      for (const inv of selectedRows) {
        const res = await fetchPdf(inv.id);
        await downloadPdfFromResponse(res.data, `${inv.invoice_number}.pdf`, res.contentType);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to download');
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintSelected = async () => {
    if (printing || selectedRows.length === 0) return;
    setPrinting(true);
    try {
      for (const inv of selectedRows) {
        const res = await fetchPdf(inv.id);
        await printPdfBlob(res.data, res.contentType);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to print');
    } finally {
      setPrinting(false);
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

  // Keep the table mounted while the next tab loads, and hide rows that belong to the previous tab.
  const shown = invoices.filter((inv) => {
    if (docTypeFilter === 'all') return true;
    const quote = (inv.invoice_type || 'invoice') === 'quotation';
    return docTypeFilter === 'quotation' ? quote : !quote;
  });

  // ---- Selection ----
  const allVisibleSelected = shown.length > 0 && shown.every((i) => selectedIds.has(i.id));
  const someVisibleSelected = shown.some((i) => selectedIds.has(i.id));

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
        shown.forEach((i) => next.delete(i.id));
        return next;
      }
      const next = new Set(prev);
      shown.forEach((i) => next.add(i.id));
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
  const canDeleteSelected = selectedRows.length > 0 && selectedRows.every((inv) => {
    if ((inv.invoice_type || 'invoice') === 'quotation') return true;
    const paidAmount = inv.amount_paid ?? 0;
    const stillOwed = (inv.total_amount ?? 0) - paidAmount;
    return paidAmount <= 0 && stillOwed > 0;
  });

  const handleDeleteSelected = async () => {
    if (!canDeleteSelected || deleting) return;
    const n = selectedRows.length;
    if (!confirm(`Delete ${n} selected ${n === 1 ? 'document' : 'documents'}? Paid invoices stay in the books.`)) {
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
  const statusDisplay = (inv: Invoice) => {
    if (inv.settlement === 'partial' || ((inv.amount_paid ?? 0) > 0 && balance(inv) > 0)) return 'Partial';
    return balance(inv) <= 0 ? 'Paid' : 'Unpaid';
  };
  const balance = (inv: Invoice) => (inv.total_amount ?? 0) - (inv.amount_paid ?? 0);
  const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
  const fmtDate = (inv: Invoice) => new Date(inv.invoice_date || inv.created_at).toLocaleDateString();

  const fulfillInvoice = async (inv: Invoice, method: 'store_pickup' | 'shipment') => {
    setFulfillingId(inv.id);
    setFulfillMenuId(null);
    setFulfillMenuAnchor(null);
    try {
      const { data } = await adminApi.post(`/invoices/${inv.id}/fulfill`, { method });
      if (method === 'store_pickup') {
        toast.success(`${inv.invoice_number}: in-store pickup — stock taken`);
      } else {
        toast.success(`${inv.invoice_number} added to shipments as ${data.shipment_number}`);
        router.push(`/admin/shipments?id=${encodeURIComponent(data.shipment_id || data.linked_shipment_id)}`);
      }
      fetchInvoices();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Could not fulfill invoice');
    } finally {
      setFulfillingId(null);
    }
  };

  const convertQuote = async (inv: Invoice) => {
    if (!confirm(`Convert ${inv.invoice_number} to an invoice?\n\nThe customer will be billed the quoted amounts. Stock is taken when you choose in-store pickup or mark the shipment delivered.`)) return;
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className={adminUi.pageTitle}>{docTypeFilter === 'quotation' ? 'Quotations' : docTypeFilter === 'all' ? 'All documents' : 'Invoices'}</h1>
        <div className="flex items-center gap-2">
          {docTypeFilter === 'invoice' && (
            <button type="button" onClick={() => setStatementOpen(true)} className={adminUi.btnSecondary}>
              Sales statement
            </button>
          )}
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
          { key: 'all', label: 'All' },
          { key: 'invoice', label: 'Invoices' },
          { key: 'quotation', label: 'Quotations' },
        ] as { key: 'all' | DocType; label: string }[]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => { setDocTypeFilter(tab.key); setPage(1); setSelectedIds(new Set()); }}
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
            <p className={`text-[26px] leading-tight font-normal tabular-nums break-words ${moneyIn}`}>{money(summary.totalUnpaid)}</p>
            <p className="text-xs text-[#6B6C72] mt-1">Unpaid</p>
            <div className="mt-3 h-1.5 bg-[#F5A623] rounded-full" />
          </div>
          <div className="px-5 py-4 bg-[#E5F6E3]">
            <p className={`text-[26px] leading-tight font-normal tabular-nums break-words ${moneyIn}`}>{money(summary.totalPaid)}</p>
            <p className="text-xs text-[#6B6C72] mt-1">Paid</p>
            <div className="mt-3 h-1.5 bg-[#2CA01C] rounded-full" />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#E2E8F0] bg-white p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by number, customer, or phone"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            className={`${filterControl} w-full pl-9 pr-10`}
          />
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#6B6C72] hover:bg-[#F4F5F8] hover:text-[#1A1A1A]"
            title="Scan barcode"
            aria-label="Scan barcode"
          >
            <Barcode className="h-4 w-4" />
          </button>
        </div>
        <select
          aria-label="Filter by customer"
          value={customerFilter}
          onChange={(e) => { setCustomerFilter(e.target.value); setPage(1); }}
          className={filterControl}
        >
          <option value="">All customers</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}{customer.company ? ` · ${customer.company}` : ''}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by number format"
          value={prefixFilter}
          onChange={(e) => { setPrefixFilter(e.target.value); setPage(1); }}
          className={filterControl}
        >
          <option value="">All formats</option>
          {NUMBER_PREFIXES.map((prefix) => (
            <option key={prefix} value={prefix}>{prefix.replace('#', '')}</option>
          ))}
        </select>
        <select
          aria-label="Filter by payment status"
          value={settlementFilter}
          onChange={(e) => { setSettlementFilter(e.target.value); setPage(1); }}
          className={filterControl}
        >
          <option value="">All statuses</option>
          <option value="paid">Paid</option>
          <option value="partial">Partially paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
        <button
          type="button"
          onClick={() => handleExport(invoices)}
          disabled={exporting || invoices.length === 0}
          className={`${adminUi.btnSecondary} disabled:opacity-50`}
          title="Export everything in this list to Excel"
        >
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[#E3E5E8] bg-[#F4F5F8] px-4 py-2">
          <span className="text-sm font-medium text-[#1A1A1A]">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Receive payment"
              aria-label="Receive payment"
              onClick={() => {
                const payable = selectedRows.filter((row) => !isQuotation(row));
                if (payable.length === 1) {
                  openReceivePayment(payable[0]);
                  return;
                }
                const customerIds = new Set(payable.map((row) => row.customer_id).filter(Boolean));
                setReceivePaymentInvoiceId(undefined);
                setReceivePaymentCustomerId(customerIds.size === 1 ? String([...customerIds][0]) : undefined);
                setReceivePaymentOpen(true);
              }}
              className={adminUi.btnIcon}
            >
              <Banknote className="w-4 h-4" />
            </button>
            <button
              type="button"
              title={canDeleteSelected ? 'Delete selected' : 'Paid invoices stay in the books'}
              aria-label="Delete selected"
              onClick={handleDeleteSelected}
              disabled={!canDeleteSelected || deleting}
              className={`${adminUi.btnIcon} disabled:opacity-40`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button type="button" title="Clear selection" aria-label="Clear selection" onClick={clearSelection} className={adminUi.btnIcon}>
              <X className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Print"
              aria-label="Print selected"
              onClick={handlePrintSelected}
              disabled={printing}
              className={`${adminUi.btnIcon} disabled:opacity-40`}
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Download"
              aria-label="Download selected"
              onClick={handleDownloadSelected}
              disabled={printing}
              className={`${adminUi.btnIcon} disabled:opacity-40`}
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {loading && invoices.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
        </div>
      ) : shown.length === 0 && !refreshing ? (
        <div className={`${adminUi.panel} p-12 text-center transition-opacity duration-200 ${refreshing ? 'opacity-60' : 'opacity-100'}`}>
          <p className="text-sm text-[#1A1A1A]">No {docTypeFilter === 'quotation' ? 'quotations' : 'invoices'} yet.</p>
          <p className={`${adminUi.meta} mt-1`}>Use the buttons above to create one.</p>
        </div>
      ) : (
        <div className={`${adminUi.panel} overflow-hidden transition-opacity duration-200 ${refreshing ? 'opacity-60' : 'opacity-100'}`}>
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
                  <th className="text-left px-4 py-3 font-medium">Company</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  {docTypeFilter !== 'quotation' && <th className="text-right px-4 py-3 font-medium">Paid</th>}
                  {docTypeFilter !== 'quotation' && <th className="text-right px-4 py-3 font-medium">Balance</th>}
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-sm text-[#6B6C72]">Loading…</td>
                  </tr>
                )}
                {shown.map((inv) => {
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
                      <td className="px-4 py-3 text-[#1A1A1A]">{inv.customer_name || '—'}</td>
                      <td className="px-4 py-3 text-[#1A1A1A]">{inv.customer_company || '—'}</td>
                      <td className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${quote ? moneyPlain : moneyIn}`}>{money(inv.total_amount)}</td>
                      {docTypeFilter !== 'quotation' && (
                        <td className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${quote || !(inv.amount_paid ?? 0) ? moneyPlain : moneyIn}`}>{quote ? '—' : money(inv.amount_paid ?? 0)}</td>
                      )}
                      {docTypeFilter !== 'quotation' && (
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                          {quote ? (
                            <span className="text-[#8D9096]">—</span>
                          ) : bal <= 0 ? (
                            <span className={bal < 0 ? moneyOut : moneyPlain}>{bal < 0 ? `Over ${money(Math.abs(bal))}` : '—'}</span>
                          ) : (
                            <span className={moneyIn}>{money(bal)}</span>
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
                          <span className={statusDisplay(inv) === 'Paid' ? adminUi.badgePaid : statusDisplay(inv) === 'Partial' ? adminUi.badgeDraft : adminUi.badgeUnpaid}>{statusDisplay(inv)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          <button type="button" onClick={() => { setEditId(inv.id); setCreateOpen(true); }} className="text-sm text-[#0077C5] hover:underline">
                            View/Edit
                          </button>
                          {quote && qOut === 'open' && (
                            <>
                              <button type="button" onClick={() => convertQuote(inv)} className="text-sm text-[#0077C5] hover:underline">
                                Convert
                              </button>
                              <button type="button" onClick={() => rejectQuote(inv)} className="text-sm text-[#C81916] hover:underline">
                                Reject
                              </button>
                            </>
                          )}
                          {!quote && (
                            inv.inventory_applied === false ? (
                              inv.fulfillment_method === 'shipment' && inv.linked_shipment_id ? (
                                <Link href={`/admin/shipments?id=${encodeURIComponent(inv.linked_shipment_id)}`} className="text-sm text-[#0077C5] hover:underline">
                                  Shipment
                                </Link>
                              ) : (
                                <button
                                  type="button"
                                  disabled={fulfillingId === inv.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (fulfillMenuId === inv.id) {
                                      setFulfillMenuId(null);
                                      setFulfillMenuAnchor(null);
                                    } else {
                                      setFulfillMenuId(inv.id);
                                      setFulfillMenuAnchor(e.currentTarget.getBoundingClientRect());
                                    }
                                  }}
                                  className="text-sm text-[#0077C5] hover:underline disabled:opacity-50"
                                >
                                  Fulfill
                                </button>
                              )
                            ) : (
                              <span className="text-sm text-[#6B6C72]">{inv.fulfillment_method === 'store_pickup' ? 'Picked up' : 'Fulfilled'}</span>
                            )
                          )}
                          {!quote && (
                            <button type="button" onClick={() => openReceivePayment(inv)} className={adminUi.btnIcon} title="Receive payment" aria-label="Receive payment">
                              <Banknote className="w-4 h-4" />
                            </button>
                          )}
                          <button type="button" onClick={() => handlePrint(inv)} className={adminUi.btnIcon} title="Print" aria-label="Print">
                            <Printer className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => handleDownload(inv)} className={adminUi.btnIcon} title="Download" aria-label="Download">
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Send"
                            title="Send"
                            disabled={sharingId === inv.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (sendMenuId === inv.id) {
                                setSendMenuId(null);
                                setSendMenuAnchor(null);
                              } else {
                                setSendMenuId(inv.id);
                                setSendMenuAnchor(e.currentTarget.getBoundingClientRect());
                              }
                            }}
                            className={`${adminUi.btnIcon} disabled:opacity-50`}
                          >
                            <Send className="w-4 h-4" />
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

      {!loading && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <p className={adminUi.meta}>
            {totalDocs === 0 ? '0 documents' : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalDocs)} of ${totalDocs}`}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className={adminUi.btnSecondary} disabled={page <= 1 || refreshing} onClick={() => setPage((current) => Math.max(1, current - 1))} aria-label="Previous page">
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <span className="min-w-[3.5rem] text-center text-sm tabular-nums text-[#1A1A1A]">{page} / {totalPages}</span>
            <button type="button" className={adminUi.btnSecondary} disabled={page >= totalPages || refreshing} onClick={() => setPage((current) => current + 1)} aria-label="Next page">
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {scannerOpen && <InvoiceBarcodeScan onClose={() => setScannerOpen(false)} onScan={applyBarcode} />}

      {typeof document !== 'undefined' && fulfillMenuId && fulfillMenuAnchor && (() => {
        const inv = invoices.find((i) => i.id === fulfillMenuId);
        if (!inv) return null;
        const closeFulfill = () => { setFulfillMenuId(null); setFulfillMenuAnchor(null); };
        return createPortal(
          <>
            <div className="fixed inset-0 z-[100]" aria-hidden onClick={(e) => { e.stopPropagation(); closeFulfill(); }} />
            <div
              data-admin-menu
              className={`fixed z-[101] py-1.5 min-w-[200px] ${adminMenuPanel}`}
              style={{ top: fulfillMenuAnchor.bottom + 4, right: typeof window !== 'undefined' ? window.innerWidth - fulfillMenuAnchor.right : 0 }}
            >
              <button
                type="button"
                className={adminMenuItemClass()}
                onClick={(e) => { e.stopPropagation(); void fulfillInvoice(inv, 'store_pickup'); }}
              >
                In-store pickup
              </button>
              <button
                type="button"
                className={adminMenuItemClass()}
                onClick={(e) => { e.stopPropagation(); void fulfillInvoice(inv, 'shipment'); }}
              >
                Send for shipment
              </button>
            </div>
          </>,
          document.body
        );
      })()}

      {typeof document !== 'undefined' && sendMenuId && sendMenuAnchor && (() => {
        const inv = invoices.find((i) => i.id === sendMenuId);
        if (!inv) return null;
        const closeSend = () => { setSendMenuId(null); setSendMenuAnchor(null); };
        return createPortal(
          <>
            <div className="fixed inset-0 z-[100]" aria-hidden onClick={(e) => { e.stopPropagation(); closeSend(); }} />
            <div
              data-admin-menu
              className={`fixed z-[101] py-1.5 min-w-[160px] ${adminMenuPanel}`}
              style={{ top: sendMenuAnchor.bottom + 4, right: typeof window !== 'undefined' ? window.innerWidth - sendMenuAnchor.right : 0 }}
            >
              <button
                type="button"
                className={adminMenuItemClass()}
                disabled={sharingId === inv.id}
                onClick={(e) => { e.stopPropagation(); closeSend(); void handleWhatsApp(inv); }}
              >
                WhatsApp
              </button>
              <button
                type="button"
                className={adminMenuItemClass()}
                onClick={(e) => { e.stopPropagation(); closeSend(); void handleEmail(inv); }}
              >
                Email
              </button>
            </div>
          </>,
          document.body
        );
      })()}

      <InvoiceFormLightbox
        isOpen={createOpen}
        onClose={closeCreate}
        onSaved={() => { fetchInvoices(); fetchSummary(); }}
        editId={editId}
        initialDocumentType={createMode}
      />

      <ReceivePaymentLightbox
        isOpen={receivePaymentOpen}
        onClose={() => {
          setReceivePaymentOpen(false);
          setReceivePaymentCustomerId(undefined);
          setReceivePaymentInvoiceId(undefined);
          if (searchParams?.get('receive')) router.replace('/admin/payments');
        }}
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

      {statementOpen && (
        <div className={adminUi.modalBackdrop} onClick={() => setStatementOpen(false)}>
          <form
            className={`${adminUi.modal} max-w-md w-full p-6`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (!statementFrom || !statementTo || statementFrom > statementTo) {
                toast.error('Choose a from date on or before the to date.');
                return;
              }
              setStatementRange({ from: statementFrom, to: statementTo });
              setStatementOpen(false);
            }}
          >
            <h3 className="text-lg font-medium text-[#1A1A1A]">Sales statement</h3>
            <p className={`${adminUi.meta} mt-1`}>Choose the dates to include. Opening balance is everything still owed before the from date.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block text-sm text-[#1A1A1A]">
                From
                <input type="date" required value={statementFrom} onChange={(e) => setStatementFrom(e.target.value)} className={`${adminUi.field} mt-1`} />
              </label>
              <label className="block text-sm text-[#1A1A1A]">
                To
                <input type="date" required value={statementTo} onChange={(e) => setStatementTo(e.target.value)} className={`${adminUi.field} mt-1`} />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setStatementOpen(false)} className={adminUi.btnSecondary}>Cancel</button>
              <button type="submit" className={adminUi.btnPrimary}>Open statement</button>
            </div>
          </form>
        </div>
      )}

      {statementRange && (
        <SalesStatement
          from={statementRange.from}
          to={statementRange.to}
          onClose={() => setStatementRange(null)}
        />
      )}
    </div>
  );
}
