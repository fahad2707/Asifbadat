'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Eye, FileText, Truck, Search, X, Trash2, Download } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { downloadPdfFromResponse, openPdfFromResponse } from '@/lib/download-pdf';
import Link from 'next/link';
import SearchableProductDropdown from '@/components/admin/SearchableProductDropdown';
import { adminUi } from '@/lib/admin-ui';
import { exportPurchaseOrdersToExcel } from '@/lib/export-purchase-orders-excel';

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
  items: POItem[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  created_at: string;
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
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchPOs = async () => {
    try {
      const res = await adminApi.get('/purchase-orders', { params: { limit: 1000, ...(search ? { search } : {}) } });
      setPos(res.data.purchase_orders || []);
    } catch {
      toast.error('Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  };

  const fetchVendors = async () => {
    try {
      const res = await adminApi.get('/vendors');
      setVendors(res.data.vendors || []);
    } catch {
      toast.error('Failed to load vendors');
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await adminApi.get('/products');
      setProducts(res.data.products || []);
    } catch {
      toast.error('Failed to load products');
    }
  };

  useEffect(() => {
    fetchPOs();
  }, [search]);

  const openCreatePo = () => {
    const emptyRow = (): CreateRow => ({
      product_id: '',
      product_name: '',
      category_name: '',
      qty: 1,
      unit_cost: 0,
    });
    setShowCreate(true);
    setPoNumber('');
    setPoDate(new Date().toISOString().slice(0, 10));
    setVendorId('');
    setBillNum('');
    setShippingCost(0);
    setRows(Array.from({ length: 15 }, emptyRow));
  };

  // Quick command: /admin/purchase-orders?create=1 opens a blank PO form.
  useEffect(() => {
    if (searchParams?.get('create') !== '1') return;
    openCreatePo();
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
    const validRows = rows.filter((r) => r.product_id && r.qty > 0 && r.unit_cost >= 0);
    if (!vendorId || validRows.length === 0) {
      toast.error('Select supplier and add at least one item');
      return;
    }
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
    }
  };

  const allVisibleSelected = pos.length > 0 && pos.every((p) => selectedIds.has(p.id));
  const someVisibleSelected = pos.some((p) => selectedIds.has(p.id));
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
        pos.forEach((p) => next.delete(p.id));
        return next;
      }
      const next = new Set(prev);
      pos.forEach((p) => next.add(p.id));
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

  const pmtStatus = (po: PurchaseOrder) => {
    if (po.status === 'received') return 'Paid';
    if (po.status === 'partial') return 'Partial PMT';
    return 'Pending';
  };

  const shippingStatus = (po: PurchaseOrder) => {
    if (po.status === 'received') return 'Received';
    if (po.status === 'partial') return 'Partial';
    return 'Pending';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#0F172A] tracking-tight">Purchase order</h1>
          <p className="text-xs text-slate-400 mt-1">Issue procurement order sheets to wholesale vendors, track inventory shipments and balances.</p>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search POs by number, supplier, bill #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 focus:bg-slate-950/80 transition-all font-semibold"
          />
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={openCreatePo}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] border-transparent text-white rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            New PO
          </button>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-slate-955/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500">
            <option value="All">All Statuses</option>
          </select>
          <button
            type="button"
            onClick={() => handleExport(pos)}
            disabled={exporting || pos.length === 0}
            className={`${adminUi.btnSecondary} disabled:opacity-50`}
          >
            <Download className="w-4 h-4" />
            Export all ({pos.length})
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
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Date</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">PO ID</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Supplier ID</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Supplier Name</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Bill</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">State</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">City</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Total Amount</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Total Paid</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">PO Balance</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">PMT Status</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Shipping</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pos.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="py-16 text-center text-slate-500 text-xs font-semibold">
                      No purchase orders yet. Click Draft PO to register imports.
                    </td>
                  </tr>
                ) : (
                  pos.map((po) => {
                    const paySt = pmtStatus(po);
                    const shipSt = shippingStatus(po);
                    return (
                      <tr key={po.id} className={`border-b border-white/5 hover:bg-white/[0.02] transition-colors ${selectedIds.has(po.id) ? 'bg-[#F4F5F8]' : ''}`}>
                        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${po.po_number}`}
                            checked={selectedIds.has(po.id)}
                            onChange={() => toggleOne(po.id)}
                            className="h-4 w-4 rounded border-[#C7C7C7] accent-black cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-350">{po.created_at ? new Date(po.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono font-bold text-teal-450">{po.po_number}</td>
                        <td className="py-3 px-4 text-xs text-slate-300 font-mono">{po.supplier_id || '—'}</td>
                        <td className="py-3 px-4 text-xs font-semibold text-slate-200">{po.vendor_name}</td>
                        <td className="py-3 px-4 text-xs text-slate-400">—</td>
                        <td className="py-3 px-4 text-xs text-slate-400">{po.state || '—'}</td>
                        <td className="py-3 px-4 text-xs text-slate-400">{po.city || '—'}</td>
                        <td className="py-3 px-4 text-xs text-right font-extrabold text-slate-100 font-mono">${Number(po.total_amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td className="py-3 px-4 text-xs text-right font-mono text-slate-400">0.00</td>
                        <td className="py-3 px-4 text-xs text-right font-extrabold text-slate-100 font-mono">${Number(po.total_amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td className="py-3 px-4 text-xs">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${paySt === 'Paid' ? 'bg-teal-500/10 text-teal-400 border-teal-500/20' : paySt === 'Partial PMT' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-slate-800 text-slate-400 border-white/10'}`}>{paySt}</span>
                        </td>
                        <td className="py-3 px-4 text-xs">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${shipSt === 'Received' ? 'bg-teal-500/10 text-teal-450 border-teal-500/20' : shipSt === 'Partial' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-slate-800 text-slate-400 border-white/10'}`}>{shipSt}</span>
                        </td>
                        <td className="py-3 px-4 text-right text-xs">
                          <div className="flex items-center justify-end gap-2.5">
                            <Link href={`/admin/purchase-orders/${po.id}`} className="inline-flex items-center gap-1 text-teal-450 hover:text-teal-350 hover:underline font-semibold">
                              <Eye className="w-3.5 h-3.5" />
                              View
                            </Link>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const res = await adminApi.get(`/purchase-orders/${po.id}/pdf`, { responseType: 'blob' });
                                  if (await downloadPdfFromResponse(res.data, `po-${po.po_number || po.id}.pdf`, res.headers['content-type'])) {
                                    toast.success('PDF downloaded');
                                  }
                                } catch {
                                  toast.error('Failed to download PDF');
                                }
                              }}
                              className="inline-flex items-center gap-1 text-slate-400 hover:text-white hover:underline font-semibold"
                              title="Download PDF"
                            >
                              <Download className="w-3.5 h-3.5" />
                              PDF
                            </button>
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
                    <div className="flex gap-2">
                      <input type="text" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50" placeholder="e.g. P087684" />
                      <button type="button" onClick={generatePoId} className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
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
                                  onSelect={(p) => updateRow(idx, 'product_id', p.id)}
                                  placeholder="Search product or scan barcode…"
                                  showPrice={false}
                                />
                              </td>
                              <td className="py-2 px-4 text-gray-600">{r.category_name || ''}</td>
                              <td className="py-2 px-4 text-right">
                                {hasProduct ? (
                                  <input type="number" min={1} value={r.qty} onChange={(e) => updateRow(idx, 'qty', e.target.value)} className="w-16 text-right border border-gray-300 rounded px-2 py-1" />
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-right">
                                {hasProduct ? (
                                  <input type="number" min={0} step={0.01} value={r.unit_cost || ''} onChange={(e) => updateRow(idx, 'unit_cost', e.target.value)} className="w-20 text-right border border-gray-300 rounded px-2 py-1" />
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
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={shippingCost || ''}
                              onChange={(e) => setShippingCost(Number(e.target.value) || 0)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                              placeholder="0.00"
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
                <button type="submit" className="px-4 py-2 bg-black text-white rounded-lg hover:bg-[#2C2C2C]">Save</button>
              </div>
            </form>
          </div>
        </div>
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
            <p className="text-gray-600 text-sm mb-4">Download or print the purchase order PDF.</p>
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
