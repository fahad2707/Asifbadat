'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Download, Plus, Printer, Search, Trash2, X } from 'lucide-react';
import adminApi, { uploadApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { downloadPdfFromResponse, openPdfFromResponse, printPdfFromResponse } from '@/lib/download-pdf';
import SearchableProductDropdown from '@/components/admin/SearchableProductDropdown';
import ProductModal from '@/components/admin/ProductModal';
import NumberInput from '@/components/admin/NumberInput';
import { adminUi } from '@/lib/admin-ui';
import { exportPurchaseOrdersToExcel } from '@/lib/export-purchase-orders-excel';
import PurchaseOrderDrawer from '@/components/admin/PurchaseOrderDrawer';
import PurchaseBooksStatement from '@/components/admin/PurchaseBooksStatement';
import { STATEMENT_PERIODS, type StatementPeriod } from '@/components/admin/statementPeriods';
import { toastBarcodeNotFound, toastProductAdded } from '@/lib/barcode-feedback';
import { moneyOut } from '@/lib/moneyTone';

interface POItem {
  product_id: string;
  product_name: string;
  quantity_ordered: number;
  quantity_received?: number;
  unit_cost: number;
  subtotal: number;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  supplier_id?: string;
  state?: string;
  city?: string;
  status: string;
  amount_paid?: number;
  payment_status?: 'unpaid' | 'partial' | 'paid';
  balance_due?: number;
  items: POItem[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  created_at: string;
  vendor_invoice_url?: string | null;
  vendor_invoice_name?: string | null;
}

interface Vendor {
  id: string;
  supplier_id?: string;
  name: string;
  state?: string;
  city?: string;
}

interface Product {
  id: string;
  name: string;
  cost_price?: number;
  category_name?: string;
}

interface CreateRow {
  product_id: string;
  product_name: string;
  category_name: string;
  qty: number;
  unit_cost: number;
}

export default function PurchaseOrdersPage() {
  return (
    <Suspense fallback={<div className="flex justify-center h-64 items-center"><div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" /></div>}>
      <PurchaseOrdersPageInner />
    </Suspense>
  );
}

function PurchaseOrdersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [showCreate, setShowCreate] = useState(false);
  const [poNumber, setPoNumber] = useState('');
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendorId, setVendorId] = useState('');
  const [billNum, setBillNum] = useState('');
  const [rows, setRows] = useState<CreateRow[]>([]);
  const [shippingCost, setShippingCost] = useState(0);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [savedPoId, setSavedPoId] = useState<string | null>(null);
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');
  const [savingVendor, setSavingVendor] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [period, setPeriod] = useState<StatementPeriod>('month');
  const [statementOpen, setStatementOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [uploadingVendorInvoice, setUploadingVendorInvoice] = useState(false);
  const [savingPo, setSavingPo] = useState(false);
  const receiveInFlightRef = useRef(false);
  const vendorInvoiceInputRef = useRef<HTMLInputElement>(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const addProductRowRef = useRef(0);

  const fetchPOs = async () => {
    try {
      const res = await adminApi.get('/purchase-orders', { params: { limit: 1000 } });
      setPos(res.data.purchase_orders || []);
    } catch {
      toast.error('Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  };

  const fetchVendors = async () => {
    try {
      const res = await adminApi.get('/vendors', { params: { limit: 5000 } });
      setVendors(res.data.vendors || []);
    } catch {
      toast.error('Failed to load vendors');
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await adminApi.get('/products', { params: { limit: 5000 } });
      setProducts(res.data.products || []);
      return (res.data.products || []) as Product[];
    } catch {
      toast.error('Failed to load products');
      return [] as Product[];
    }
  };

  const handleCreatedProduct = async (saved?: { id: string }) => {
    setShowAddProduct(false);
    const idx = addProductRowRef.current;
    try {
      const list = await fetchProducts();
      const created = saved?.id ? list.find((p) => String(p.id) === String(saved.id)) : undefined;
      if (!created) {
        toast.error('Product saved. Search for it on the line to add it.');
        return;
      }
      setRows((prev) => {
        const next = [...prev];
        const current = next[idx] || emptyRow();
        next[idx] = {
          ...current,
          product_id: created.id,
          product_name: created.name,
          category_name: created.category_name || '',
          unit_cost: current.unit_cost || Number(created.cost_price) || 0,
          qty: current.qty || 1,
        };
        return next;
      });
    } catch {
      toast.error('Product saved. Search for it on the line to add it.');
    }
  };

  useEffect(() => {
    fetchPOs();
  }, []);

  const emptyRow = (): CreateRow => ({
    product_id: '',
    product_name: '',
    category_name: '',
    qty: 1,
    unit_cost: 0,
  });

  const openCreatePo = (prefill?: {
    vendorId?: string;
    lines?: Array<{ product_id?: string; product_name?: string; qty?: number; unit_cost?: number }>;
  }) => {
    setShowCreate(true);
    setPoNumber('');
    setPoDate(new Date().toISOString().slice(0, 10));
    setVendorId(prefill?.vendorId || '');
    setBillNum('');
    setShippingCost(0);
    const lines = (prefill?.lines || [])
      .filter((l) => l.product_id)
      .map((l) => ({
        product_id: String(l.product_id),
        product_name: l.product_name || '',
        category_name: '',
        qty: Math.max(1, Number(l.qty) || 1),
        unit_cost: Number(l.unit_cost) || 0,
      }));
    if (lines.length) {
      const padded = [...lines];
      while (padded.length < 15) padded.push(emptyRow());
      setRows(padded);
    } else {
      setRows(Array.from({ length: 15 }, emptyRow));
    }
  };

  // Quick command: /admin/purchase-orders?create=1 opens a PO form (optional vendor_id + lines JSON).
  useEffect(() => {
    if (searchParams?.get('create') !== '1') return;
    let lines: Array<{ product_id?: string; product_name?: string; qty?: number; unit_cost?: number }> = [];
    const raw = searchParams.get('lines');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) lines = parsed;
      } catch {
        lines = [];
      }
    }
    openCreatePo({ vendorId: searchParams.get('vendor_id') || '', lines });
    router.replace('/admin/purchase-orders', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (showCreate) {
      fetchVendors();
      fetchProducts();
    }
  }, [showCreate]);

  const selectedVendor = vendors.find((v) => v.id === vendorId);

  const generatePoId = async () => {
    try {
      const res = await adminApi.get('/purchase-orders/generate-id');
      setPoNumber(res.data.po_number);
    } catch {
      setPoNumber('P' + Math.floor(10000 + Math.random() * 90000));
    }
  };

  const addRow = () => {
    setRows([
      ...rows,
      {
        product_id: '',
        product_name: '',
        category_name: '',
        qty: 1,
        unit_cost: 0,
      },
    ]);
  };

  const updateRow = (idx: number, field: keyof CreateRow, value: string | number) => {
    const next = [...rows];
    const r = { ...next[idx], [field]: value };
    if (field === 'product_id') {
      const p = products.find((x) => x.id === value);
      r.product_name = p?.name ?? r.product_name;
      r.category_name = p?.category_name ?? '';
      r.unit_cost = p?.cost_price ?? 0;

      const existingIdx = next.findIndex((row, i) => i !== idx && row.product_id === value && value !== '');
      if (existingIdx !== -1) {
        next[existingIdx] = { ...next[existingIdx], qty: next[existingIdx].qty + r.qty };
        next.splice(idx, 1);
        setRows(next);
        return;
      }
    }
    if (field === 'qty') r.qty = Number(value);
    if (field === 'unit_cost') r.unit_cost = Number(value);
    next[idx] = r;
    setRows(next);
  };

  const removeRow = (idx: number) => {
    setRows(rows.filter((_, i) => i !== idx));
  };

  const handleSavePO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingPo) return;
    const validRows = rows.filter((r) => r.product_id && r.qty > 0 && r.unit_cost >= 0);
    if (!vendorId || validRows.length === 0) {
      toast.error('Select supplier and add at least one item');
      return;
    }
    setSavingPo(true);
    try {
      const res = await adminApi.post('/purchase-orders', {
        po_number: poNumber || undefined,
        vendor_id: vendorId,
        items: validRows.map((r) => ({
          product_id: r.product_id,
          product_name: r.product_name,
          quantity_ordered: r.qty,
          unit_cost: r.unit_cost,
        })),
        shipping_cost: shippingCost,
        notes: billNum ? `Bill #${billNum}` : undefined,
      });
      toast.success('PO saved');
      setShowCreate(false);
      setPoNumber('');
      setPoDate(new Date().toISOString().slice(0, 10));
      setVendorId('');
      setBillNum('');
      setRows([]);
      setShippingCost(0);
      setSavedPoId(res.data?.id ?? null);
      setShowPdfModal(true);
      fetchPOs();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save PO');
    } finally {
      setSavingPo(false);
    }
  };

  const PAGE_SIZE = 25;
  const term = search.trim().toLowerCase();
  const filtered = pos.filter((po) => {
    if (filter !== 'All' && po.status !== filter) return false;
    if (!term) return true;
    return [po.po_number, po.vendor_name, po.supplier_id, po.state, po.city].some((value) => String(value || '').toLowerCase().includes(term));
  });
  const totalDocs = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalDocs / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const allVisibleSelected = pageRows.length > 0 && pageRows.every((p) => selectedIds.has(p.id));
  const someVisibleSelected = pageRows.some((p) => selectedIds.has(p.id));
  const selectedRows = pos.filter((p) => selectedIds.has(p.id));

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
        pageRows.forEach((p) => next.delete(p.id));
        return next;
      }
      const next = new Set(prev);
      pageRows.forEach((p) => next.add(p.id));
      return next;
    });
  };

  const handleExport = async (rows: PurchaseOrder[]) => {
    if (rows.length === 0 || exporting) return;
    setExporting(true);
    try {
      await exportPurchaseOrdersToExcel(rows);
      toast.success(`Exported ${rows.length} ${rows.length === 1 ? 'purchase order' : 'purchase orders'} to Excel`);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const printOrders = async (rows: PurchaseOrder[]) => {
    if (printing || rows.length === 0) return;
    setPrinting(true);
    try {
      for (const po of rows) {
        const res = await adminApi.get(`/purchase-orders/${po.id}/pdf`, { responseType: 'blob' });
        await printPdfFromResponse(res.data, res.headers['content-type']);
      }
    } catch {
      toast.error('Failed to print');
    } finally {
      setPrinting(false);
    }
  };

  const downloadOrders = async (rows: PurchaseOrder[]) => {
    if (printing || rows.length === 0) return;
    setPrinting(true);
    try {
      for (const po of rows) {
        const res = await adminApi.get(`/purchase-orders/${po.id}/pdf`, { responseType: 'blob' });
        await downloadPdfFromResponse(res.data, `po-${po.po_number || po.id}.pdf`, res.headers['content-type']);
      }
    } catch {
      toast.error('Failed to download');
    } finally {
      setPrinting(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedRows.length === 0 || deleting) return;
    const n = selectedRows.length;
    if (!confirm(`Delete ${n} selected ${n === 1 ? 'purchase order' : 'purchase orders'}?\n\nReceived POs stay in the books — export those instead.`)) return;
    setDeleting(true);
    let ok = 0;
    const failures: string[] = [];
    for (const po of selectedRows) {
      try {
        await adminApi.delete(`/purchase-orders/${po.id}`);
        ok += 1;
      } catch (error: any) {
        failures.push(error?.response?.data?.error || `Could not delete ${po.po_number}`);
      }
    }
    setDeleting(false);
    if (ok) toast.success(`Deleted ${ok} ${ok === 1 ? 'purchase order' : 'purchase orders'}`);
    if (failures.length) toast.error(failures.slice(0, 3).join(' · '));
    setSelectedIds(new Set());
    fetchPOs();
  };

  /** Receiving lifecycle only — not vendor payment. */
  const poStatusLabel = (status: string) => {
    if (status === 'received') return 'Fully Received';
    if (status === 'partial') return 'Partially Received';
    if (status === 'sent') return 'Sent';
    if (status === 'cancelled') return 'Cancelled';
    return 'Draft';
  };

  const poStatusBadgeClass = (status: string) => {
    if (status === 'received') return adminUi.badgePaid;
    if (status === 'partial') return adminUi.badgeUnpaid;
    if (status === 'sent') return adminUi.badge;
    if (status === 'cancelled') return adminUi.badgeUnpaid;
    return adminUi.badgeDraft;
  };

  const poPaymentLabel = (po: PurchaseOrder) => {
    if (po.payment_status === 'paid') return 'Paid in Full';
    if (po.payment_status === 'partial') {
      return `Partial ($${Number(po.amount_paid || 0).toFixed(0)}/$${Number(po.total_amount || 0).toFixed(0)})`;
    }
    return 'Payment Pending';
  };

  const poPaymentBadgeClass = (status?: string) => {
    if (status === 'paid') return adminUi.badgePaid;
    if (status === 'partial') return adminUi.badgeUnpaid;
    return adminUi.badgeUnpaid;
  };

  const receivePoStock = async (po: PurchaseOrder) => {
    if (receiveInFlightRef.current) return;
    receiveInFlightRef.current = true;
    try {
      const res = await adminApi.get(`/purchase-orders/${po.id}`);
      const items = (res.data.items || [])
        .map((i: POItem) => {
          const pid = typeof i.product_id === 'string' ? i.product_id : String((i.product_id as unknown as { _id?: string })?._id || i.product_id || '');
          const remaining = Number(i.quantity_ordered || 0) - Number(i.quantity_received || 0);
          return { product_id: pid, quantity_received: remaining };
        })
        .filter((i: { product_id: string; quantity_received: number }) => i.product_id && i.quantity_received > 0);
      if (items.length === 0) {
        toast.error('Nothing left to receive');
        return;
      }
      const totalRemaining = items.reduce(
        (sum: number, i: { quantity_received: number }) => sum + i.quantity_received,
        0
      );
      if (
        !confirm(
          `Receive All Remaining on PO ${po.po_number}?\n\n` +
            `This will receive all remaining quantities on PO #${po.po_number}.\n` +
            `Line items with remaining qty: ${items.length}\n` +
            `Total remaining quantity: ${totalRemaining}\n\n` +
            `This action will increase inventory.`
        )
      ) {
        return;
      }
      await adminApi.post(`/purchase-orders/${po.id}/receive`, { items });
      toast.success('All remaining quantities received · inventory updated');
      fetchPOs();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to receive stock');
    } finally {
      receiveInFlightRef.current = false;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className={adminUi.pageTitle}>Purchase orders</h1>
        <div className="flex items-center gap-2">
          <select aria-label="Statement period" value={period} onChange={(e) => setPeriod(e.target.value as StatementPeriod)} className={adminUi.filter}>
            {STATEMENT_PERIODS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <button type="button" onClick={() => setStatementOpen(true)} className={adminUi.btnSecondary}>Statement</button>
          <button type="button" onClick={() => openCreatePo()} className={adminUi.btnPrimary}>
            <Plus className="w-3.5 h-3.5" />
            New PO
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#E2E8F0] bg-white p-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8D9096]" />
          <input
            type="text"
            placeholder="Search by PO number, supplier, or bill"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className={adminUi.filterSearch}
          />
        </div>
        <select aria-label="Filter by status" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} className={adminUi.filter}>
          <option value="All">All statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="partial">Partially received</option>
          <option value="received">Fully received</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button
          type="button"
          onClick={() => handleExport(filtered)}
          disabled={exporting || filtered.length === 0}
          className={`${adminUi.btnSecondary} disabled:opacity-50`}
        >
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[#E3E5E8] bg-[#F4F5F8] px-4 py-2">
          <span className="text-sm font-medium text-[#1A1A1A]">{selectedIds.size} selected</span>
          <div className="flex items-center gap-1">
            <button type="button" title="Export selected" aria-label="Export selected" onClick={() => handleExport(selectedRows)} disabled={exporting} className={`${adminUi.btnIcon} disabled:opacity-40`}>
              <Download className="w-4 h-4" />
            </button>
            <button type="button" title="Delete selected" aria-label="Delete selected" onClick={handleDeleteSelected} disabled={deleting} className={`${adminUi.btnIcon} disabled:opacity-40`}>
              <Trash2 className="w-4 h-4" />
            </button>
            <button type="button" title="Clear selection" aria-label="Clear selection" onClick={() => setSelectedIds(new Set())} className={adminUi.btnIcon}>
              <X className="w-4 h-4" />
            </button>
            <button type="button" title="Print selected" aria-label="Print selected" onClick={() => { void printOrders(selectedRows); }} disabled={printing} className={`${adminUi.btnIcon} disabled:opacity-40`}>
              <Printer className="w-4 h-4" />
            </button>
            <button type="button" title="Download selected" aria-label="Download selected" onClick={() => { void downloadOrders(selectedRows); }} disabled={printing} className={`${adminUi.btnIcon} disabled:opacity-40`}>
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className={`${adminUi.panel} overflow-hidden`}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
          </div>
        ) : (
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
                  <th className="text-left px-4 py-3 font-medium">Number</th>
                  <th className="text-left px-4 py-3 font-medium">Supplier ID</th>
                  <th className="text-left px-4 py-3 font-medium">Supplier</th>
                  <th className="text-left px-4 py-3 font-medium">Bill</th>
                  <th className="text-left px-4 py-3 font-medium">State</th>
                  <th className="text-left px-4 py-3 font-medium">City</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 font-medium">Stock</th>
                  <th className="text-left px-4 py-3 font-medium">Payment</th>
                  <th className="text-right px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-10 text-center text-sm text-[#6B6C72]">
                      No purchase orders yet. Use New PO to create one.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((po) => {
                    const statusLabel = poStatusLabel(po.status);
                    return (
                      <tr
                        key={po.id}
                        className={`border-t border-[#E3E5E8] cursor-pointer ${adminUi.tableRowHover} ${selectedIds.has(po.id) ? 'bg-[#F4F5F8]' : ''}`}
                        onClick={() => setDetailId(po.id)}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${po.po_number}`}
                            checked={selectedIds.has(po.id)}
                            onChange={() => toggleOne(po.id)}
                            className="h-4 w-4 rounded border-[#C7C7C7] accent-black cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 text-[#1A1A1A] whitespace-nowrap">{po.created_at ? new Date(po.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '—'}</td>
                        <td className="px-4 py-3 font-medium text-[#0077C5] whitespace-nowrap">
                          <span>{po.po_number}</span>
                          {po.vendor_invoice_url ? (
                            <span className="ml-2 text-[11px] text-[#6B6C72]">vendor inv.</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-[#1A1A1A]">{po.supplier_id || '—'}</td>
                        <td className="px-4 py-3 text-[#1A1A1A]">{po.vendor_name}</td>
                        <td className="px-4 py-3 text-[#6B6C72]">—</td>
                        <td className="px-4 py-3 text-[#1A1A1A]">{po.state || '—'}</td>
                        <td className="px-4 py-3 text-[#1A1A1A]">{po.city || '—'}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${moneyOut}`}>${Number(po.total_amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td className="px-4 py-3">
                          <span className={poStatusBadgeClass(po.status)}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={poPaymentBadgeClass(po.payment_status)}>
                            {poPaymentLabel(po)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <button type="button" onClick={() => setDetailId(po.id)} className="text-sm text-[#0077C5] hover:underline">
                              View/Edit
                            </button>
                            {po.payment_status !== 'paid' && po.status !== 'cancelled' && (
                              <button type="button" onClick={() => setDetailId(po.id)} className="text-sm text-[#0077C5] hover:underline" title="Record a payment to the supplier">
                                Pay
                              </button>
                            )}
                            {(po.status === 'draft' || po.status === 'sent' || po.status === 'partial') && (
                              <button type="button" onClick={() => receivePoStock(po)} className="text-sm text-[#0077C5] hover:underline">
                                Receive
                              </button>
                            )}
                            <button type="button" title="Print" aria-label="Print" onClick={() => { void printOrders([po]); }} className={adminUi.btnIcon}>
                              <Printer className="w-4 h-4" />
                            </button>
                            <button type="button" title="Download" aria-label="Download" onClick={() => { void downloadOrders([po]); }} className={adminUi.btnIcon}>
                              <Download className="w-4 h-4" />
                            </button>
                            {(po.status === 'draft' || po.status === 'cancelled' || po.status === 'sent') && (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!confirm(`Delete ${po.po_number}?`)) return;
                                  try {
                                    await adminApi.delete(`/purchase-orders/${po.id}`);
                                    toast.success('Deleted');
                                    fetchPOs();
                                  } catch (error: any) {
                                    toast.error(error?.response?.data?.error || 'Failed to delete');
                                  }
                                }}
                                className="text-sm text-[#C81916] hover:underline"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <p className={adminUi.meta}>
            {totalDocs === 0 ? '0 purchase orders' : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, totalDocs)} of ${totalDocs}`}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className={adminUi.btnSecondary} disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} aria-label="Previous page">
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <span className="min-w-[3.5rem] text-center text-sm tabular-nums text-[#1A1A1A]">{safePage} / {totalPages}</span>
            <button type="button" className={adminUi.btnSecondary} disabled={safePage >= totalPages} onClick={() => setPage((current) => current + 1)} aria-label="Next page">
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {statementOpen && <PurchaseBooksStatement period={period} focus="orders" onClose={() => setStatementOpen(false)} />}

      <PurchaseOrderDrawer
        poId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(id) => {
          setDetailId(null);
          router.push(`/admin/purchase-orders/${id}?edit=1`);
        }}
        onChanged={fetchPOs}
      />

      {showCreate && (
        <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">New purchase order</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePO} className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier <span className="text-red-600">*</span></label>
                    <select
                      value={vendorId}
                      onChange={(e) => {
                        if (e.target.value === '__add_new__') { setShowAddVendor(true); return; }
                        setVendorId(e.target.value);
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      required
                    >
                      <option value="">Select supplier</option>
                      <option value="__add_new__">+ Add new supplier</option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">PO no.</label>
                    <div className="flex items-end gap-2">
                      <input type="text" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50" placeholder="e.g. P087684" />
                      <button type="button" onClick={generatePoId} className="shrink-0 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
                        Generate
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">PO date</label>
                    <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bill reference</label>
                    <input type="text" value={billNum} onChange={(e) => setBillNum(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Invoice bill number" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier ID</label>
                    <input type="text" value={selectedVendor?.supplier_id ?? ''} readOnly className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">State / City</label>
                    <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded-lg">{[selectedVendor?.state, selectedVendor?.city].filter(Boolean).join(', ') || '—'}</p>
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
                          <th className="text-left py-3 px-4 min-w-[120px]">Category</th>
                          <th className="text-right py-3 px-4 w-20">Qty</th>
                          <th className="text-right py-3 px-4 w-28">Unit cost</th>
                          <th className="text-right py-3 px-4 w-28">Amount</th>
                          <th className="w-12 px-4" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, idx) => {
                          const hasProduct = !!(r.product_id || r.product_name);
                          return (
                            <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50/50">
                              <td className="py-2 px-4">{idx + 1}</td>
                              <td className="py-2 px-4">
                                <SearchableProductDropdown
                                  products={products}
                                  value={r.product_id}
                                  displayName={r.product_name || undefined}
                                  onAddProduct={() => {
                                    addProductRowRef.current = idx;
                                    setShowAddProduct(true);
                                  }}
                                  onSelect={(p) => updateRow(idx, 'product_id', p.id)}
                                  onBarcodeScan={(code) => {
                                    adminApi
                                      .get(`/products/barcode/${encodeURIComponent(code)}`)
                                      .then((res) => {
                                        const p = res.data;
                                        const id = p?.id || p?._id?.toString?.();
                                        if (!id) throw new Error('missing id');
                                        const name = p.name || 'Product';
                                        const cost = p.cost_price ?? 0;
                                        const category = p.category_name || '';
                                        setProducts((prev) =>
                                          prev.some((x) => x.id === id)
                                            ? prev
                                            : [
                                                ...prev,
                                                {
                                                  id,
                                                  name,
                                                  cost_price: cost,
                                                  category_name: category,
                                                  sku: p.sku,
                                                },
                                              ]
                                        );
                                        let addedNew = false;
                                        setRows((prev) => {
                                          const next = [...prev];
                                          const current = next[idx];
                                          if (!current) return prev;
                                          const existingIdx = next.findIndex(
                                            (row, i) => i !== idx && row.product_id === id
                                          );
                                          if (existingIdx !== -1) {
                                            next[existingIdx] = {
                                              ...next[existingIdx],
                                              qty: next[existingIdx].qty + (current.qty || 1),
                                            };
                                            next.splice(idx, 1);
                                            return next;
                                          }
                                          addedNew = true;
                                          next[idx] = {
                                            ...current,
                                            product_id: id,
                                            product_name: name,
                                            category_name: category,
                                            unit_cost: cost,
                                          };
                                          return next;
                                        });
                                        if (addedNew) toastProductAdded(name);
                                      })
                                      .catch(() => toastBarcodeNotFound());
                                  }}
                                  placeholder="Search product or scan barcode…"
                                  showPrice={false}
                                />
                              </td>
                              <td className="py-2 px-4 text-gray-600">{r.category_name || ''}</td>
                              <td className="py-2 px-4 text-right">
                                {hasProduct ? (
                                  <NumberInput min={1} value={r.qty} onValueChange={(n) => updateRow(idx, 'qty', n === '' ? 0 : n)} className="w-16 text-right border border-gray-300 rounded px-2 py-1" />
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-right">
                                {hasProduct ? (
                                  <NumberInput min={0} step={0.01} value={r.unit_cost} onValueChange={(n) => updateRow(idx, 'unit_cost', n === '' ? 0 : n)} className="w-20 text-right border border-gray-300 rounded px-2 py-1" />
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-right font-medium">{hasProduct ? `$${(Number(r.qty) * Number(r.unit_cost)).toFixed(2)}` : ''}</td>
                              <td className="py-2 px-4">
                                {hasProduct && (
                                  <button type="button" onClick={() => removeRow(idx)} className="text-red-600 hover:bg-red-50 p-1 rounded" title="Remove row">
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
                    <button type="button" onClick={addRow} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50">
                      + Add line
                    </button>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <div className="flex flex-wrap items-start justify-end gap-8">
                    {(() => {
                      const itemSubtotal = rows.reduce((s, r) => s + Number(r.qty) * Number(r.unit_cost), 0);
                      const grandTotal = itemSubtotal + Number(shippingCost);
                      return (
                        <div className="space-y-2 min-w-[200px]">
                          <p className="text-sm text-gray-600">Subtotal: <span className="font-medium text-gray-900">${itemSubtotal.toFixed(2)}</span></p>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Shipping</label>
                            <NumberInput
                              min={0}
                              step={0.01}
                              value={shippingCost}
                              onValueChange={(n) => setShippingCost(n === '' ? 0 : n)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            />
                          </div>
                          <p className="font-semibold text-gray-900 text-base">Total: ${grandTotal.toFixed(2)}</p>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={savingPo} className="px-4 py-2 bg-black text-white rounded-lg hover:bg-[#2C2C2C] disabled:opacity-50">
                  {savingPo ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddProduct && (
        <ProductModal
          product={null}
          onClose={() => setShowAddProduct(false)}
          onSuccess={handleCreatedProduct}
        />
      )}

      {showAddVendor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={() => { setShowAddVendor(false); setNewVendorName(''); }}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Add supplier</h3>
              <button type="button" onClick={() => { setShowAddVendor(false); setNewVendorName(''); }} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form
              className="p-4 space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newVendorName.trim()) return;
                setSavingVendor(true);
                try {
                  const { data } = await adminApi.post('/vendors', { name: newVendorName.trim() });
                  toast.success('Supplier added');
                  setVendors((prev) => [...prev, { id: data.id, name: data.name, supplier_id: data.supplier_id, state: data.state, city: data.city }]);
                  setVendorId(data.id);
                  setShowAddVendor(false);
                  setNewVendorName('');
                } catch (err: any) {
                  toast.error(err.response?.data?.error || 'Failed to add supplier');
                } finally {
                  setSavingVendor(false);
                }
              }}
            >
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier name *</label>
                <input
                  type="text"
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                  placeholder="Supplier business name"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  autoFocus
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={savingVendor} className="flex-1 py-2 bg-black text-white rounded-lg font-medium hover:bg-[#2C2C2C] disabled:opacity-50">{savingVendor ? 'Saving...' : 'Add supplier'}</button>
                <button type="button" onClick={() => { setShowAddVendor(false); setNewVendorName(''); }} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPdfModal && savedPoId && (
        <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => { setShowPdfModal(false); setSavedPoId(null); }}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Document saved</h3>
            <p className="text-gray-600 text-sm mb-4">Download our PO PDF, or attach the vendor&apos;s invoice (JPG or PDF) for later reference.</p>
            <input
              ref={vendorInvoiceInputRef}
              type="file"
              accept=".jpg,.jpeg,.pdf,image/jpeg,application/pdf"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file || !savedPoId) return;
                const name = file.name.toLowerCase();
                const ok =
                  file.type === 'image/jpeg' ||
                  file.type === 'application/pdf' ||
                  name.endsWith('.jpg') ||
                  name.endsWith('.jpeg') ||
                  name.endsWith('.pdf');
                if (!ok) {
                  toast.error('Upload a JPG or PDF of the vendor invoice');
                  return;
                }
                setUploadingVendorInvoice(true);
                try {
                  const form = new FormData();
                  form.append('file', file);
                  await uploadApi.post(`/purchase-orders/${savedPoId}/vendor-invoice`, form);
                  toast.success('Vendor invoice saved');
                  fetchPOs();
                } catch (err: any) {
                  toast.error(err.response?.data?.error || 'Failed to upload vendor invoice');
                } finally {
                  setUploadingVendorInvoice(false);
                }
              }}
            />
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await adminApi.get(`/purchase-orders/${savedPoId}/pdf`, { responseType: 'blob' });
                    if (await downloadPdfFromResponse(res.data, `po-${savedPoId}.pdf`, res.headers['content-type'])) {
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
                disabled={uploadingVendorInvoice}
                onClick={() => vendorInvoiceInputRef.current?.click()}
                className="w-full px-4 py-2.5 rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {uploadingVendorInvoice ? 'Uploading…' : 'Upload vendor invoice'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await adminApi.get(`/purchase-orders/${savedPoId}/pdf`, { responseType: 'blob' });
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
                  setSavedPoId(null);
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
