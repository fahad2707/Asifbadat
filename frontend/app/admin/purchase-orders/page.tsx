'use client';

import { useEffect, useState } from 'react';
import { Plus, Eye, FileText, Truck, Search, X, Trash2, Download } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { downloadPdfFromResponse, openPdfFromResponse } from '@/lib/download-pdf';
import Link from 'next/link';
import SearchableProductDropdown from '@/components/admin/SearchableProductDropdown';

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

  const fetchPOs = async () => {
    try {
      const res = await adminApi.get('/purchase-orders', { params: search ? { search } : {} });
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
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Purchase order</h1>
          <p className="text-xs text-slate-400 mt-1">Issue procurement order sheets to wholesale vendors, track inventory shipments and balances.</p>
        </div>
      </div>

      <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-4 flex flex-wrap items-center gap-4">
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
            onClick={() => {
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
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            New PO
          </button>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-slate-955/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500">
            <option value="All">All Statuses</option>
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
                    <td colSpan={13} className="py-16 text-center text-slate-500 text-xs font-semibold">
                      No purchase orders yet. Click Draft PO to register imports.
                    </td>
                  </tr>
                ) : (
                  pos.map((po) => {
                    const paySt = pmtStatus(po);
                    const shipSt = shippingStatus(po);
                    return (
                      <tr key={po.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
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
                                  if (downloadPdfFromResponse(res.data, `po-${po.po_number || po.id}.pdf`, res.headers['content-type'])) {
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.4)] rounded-2xl max-w-5xl w-full my-8 max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Create Purchase Order</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePO} className="p-6 space-y-6">
              <section className="space-y-4">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-1.5 border-b border-white/5">PO Metadata</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">PO ID *</label>
                      <input type="text" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-205 focus:outline-none placeholder-slate-500" placeholder="e.g. P087684" />
                    </div>
                    <div>
                      <button type="button" onClick={generatePoId} className="px-3.5 py-2.5 bg-slate-800 border border-white/5 text-slate-350 hover:text-white rounded-xl text-xs font-semibold shadow-sm transition-all">
                        Generate
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">PO Date *</label>
                    <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-202 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Supplier Name *</label>
                    <select
                      value={vendorId}
                      onChange={(e) => {
                        if (e.target.value === '__add_new__') { setShowAddVendor(true); return; }
                        setVendorId(e.target.value);
                      }}
                      className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none"
                      required
                    >
                      <option value="">Select supplier</option>
                      <option value="__add_new__">+ Add New Supplier</option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wider mb-2">Supplier ID</label>
                    <input type="text" value={selectedVendor?.supplier_id ?? ''} readOnly className="w-full bg-slate-955/20 border border-white/5 rounded-xl px-4 py-2 text-xs text-slate-450" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-455 uppercase tracking-wider mb-2">State</label>
                    <input type="text" value={selectedVendor?.state ?? ''} readOnly className="w-full bg-slate-955/20 border border-white/5 rounded-xl px-4 py-2 text-xs text-slate-450" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-455 uppercase tracking-wider mb-2">City</label>
                    <input type="text" value={selectedVendor?.city ?? ''} readOnly className="w-full bg-slate-955/20 border border-white/5 rounded-xl px-4 py-2 text-xs text-slate-455" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Bill Reference</label>
                    <input type="text" value={billNum} onChange={(e) => setBillNum(e.target.value)} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-205 focus:outline-none" placeholder="Invoice bill number" />
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center justify-between pb-1.5 border-b border-white/5">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Purchase Items</h3>
                  <button type="button" onClick={addRow} className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-white/5 text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition-all">
                    <Plus className="w-3.5 h-3.5" />
                    Add Row
                  </button>
                </div>
                <div className="overflow-x-auto border border-white/5 rounded-xl bg-slate-955/20">
                  <table className="w-full text-xs min-w-[700px] border-collapse">
                    <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                      <tr>
                        <th className="text-center py-2.5 px-3 w-12 font-bold uppercase tracking-wider text-[9px]">#</th>
                        <th className="text-left py-2.5 px-4 font-bold uppercase tracking-wider text-[9px]">Product Item</th>
                        <th className="text-left py-2.5 px-4 font-bold uppercase tracking-wider text-[9px]">Category</th>
                        <th className="text-right py-2.5 px-4 font-bold uppercase tracking-wider text-[9px]">Quantity</th>
                        <th className="text-right py-2.5 px-4 font-bold uppercase tracking-wider text-[9px]">Unit Cost</th>
                        <th className="text-right py-2.5 px-4 font-bold uppercase tracking-wider text-[9px]">Subtotal</th>
                        <th className="w-10 text-center font-bold uppercase tracking-wider text-[9px]" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, idx) => (
                        <tr key={idx} className="border-t border-white/5 hover:bg-white/[0.01]">
                          <td className="py-2.5 px-3 text-center text-xs text-slate-500 font-mono">{idx + 1}</td>
                          <td className="py-2 px-4">
                            <SearchableProductDropdown
                              products={products}
                              value={r.product_id}
                              displayName={r.product_name || undefined}
                              onSelect={(p) => updateRow(idx, 'product_id', p.id)}
                              placeholder="Search products or scan barcode..."
                              showPrice={false}
                            />
                          </td>
                          <td className="py-2.5 px-4 text-slate-400">{r.category_name || '—'}</td>
                          <td className="py-2 px-4 text-right">
                            <input
                              type="number"
                              min={1}
                              value={r.qty}
                              onChange={(e) => updateRow(idx, 'qty', e.target.value)}
                              className="w-16 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-xs text-right text-slate-200"
                            />
                          </td>
                          <td className="py-2 px-4 text-right">
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={r.unit_cost || ''}
                              onChange={(e) => updateRow(idx, 'unit_cost', e.target.value)}
                              className="w-24 bg-slate-955/60 border border-white/10 rounded px-2 py-1 text-xs text-right text-slate-200 font-mono font-semibold"
                            />
                          </td>
                          <td className="py-2.5 px-4 text-right font-bold text-slate-350 font-mono">${(Number(r.qty) * Number(r.unit_cost)).toFixed(2)}</td>
                          <td className="py-2 px-4 text-center">
                            <button type="button" onClick={() => removeRow(idx)} className="p-1 text-slate-405 hover:text-rose-455 hover:bg-rose-500/10 rounded-lg transition-colors" title="Remove row">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Subtotal & Shipping */}
                {(() => {
                  const itemSubtotal = rows.reduce((s, r) => s + Number(r.qty) * Number(r.unit_cost), 0);
                  const grandTotal = itemSubtotal + Number(shippingCost);
                  return (
                    <div className="flex justify-end mt-4">
                      <div className="w-80 bg-slate-955/40 border border-white/5 rounded-xl p-4 space-y-2 text-xs text-slate-350">
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-bold uppercase text-[9px] tracking-wider">Subtotal</span>
                          <span className="font-bold text-slate-205 font-mono">${itemSubtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500 font-bold uppercase text-[9px] tracking-wider">Shipping/Freight Cost</span>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={shippingCost || ''}
                            onChange={(e) => setShippingCost(Number(e.target.value) || 0)}
                            className="w-28 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-xs text-right text-slate-200"
                            placeholder="0.00"
                          />
                        </div>
                        <div className="flex justify-between border-t border-dashed border-white/10 pt-2 font-bold text-slate-200">
                          <span className="text-[10px] uppercase font-bold tracking-wider">Grand Total Billing</span>
                          <span className="text-teal-400 font-mono text-sm">${grandTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </section>

              <div className="flex justify-end gap-2.5 pt-4 border-t border-white/5">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">
                  Close
                </button>
                <button type="submit" className="px-4 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                  Save Purchase Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddVendor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-955/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.4)] rounded-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider text-slate-400 text-[10px]">+ Register Supplier Vendor</h3>
            <form
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
              <input
                type="text"
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
                placeholder="Supplier business name"
                className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none mb-4"
                autoFocus
                required
              />
              <div className="flex justify-end gap-2.5">
                <button type="button" onClick={() => { setShowAddVendor(false); setNewVendorName(''); }} className="px-4 py-2 bg-slate-800 border border-white/5 text-slate-450 hover:text-white rounded-xl text-xs font-semibold">Cancel</button>
                <button type="submit" disabled={savingVendor} className="px-4 py-2 bg-gradient-to-tr from-teal-600 to-teal-500 text-white rounded-xl hover:from-teal-500 text-xs font-bold shadow-sm disabled:opacity-40">{savingVendor ? 'Saving...' : 'Add Supplier'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPdfModal && savedPoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-955/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.4)] rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Purchase Order Saved</h3>
            <p className="text-slate-450 text-xs mb-5">Procurement saved. Retrieve or print PO document sheet.</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await adminApi.get(`/purchase-orders/${savedPoId}/pdf`, { responseType: 'blob' });
                    if (downloadPdfFromResponse(res.data, `po-${savedPoId}.pdf`, res.headers['content-type'])) {
                      toast.success('PDF downloaded');
                    }
                  } catch {
                    toast.error('Failed to download PDF');
                  }
                }}
                className="w-full px-4 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 border border-white/10 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await adminApi.get(`/purchase-orders/${savedPoId}/pdf`, { responseType: 'blob' });
                    if (openPdfFromResponse(res.data, res.headers['content-type'])) {
                      toast.success('Opening PDF for print');
                    }
                  } catch {
                    toast.error('Failed to open PDF for printing');
                  }
                }}
                className="w-full px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-350 hover:text-white rounded-xl text-xs font-semibold transition-all"
              >
                Print PO PDF
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPdfModal(false);
                  setSavedPoId(null);
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
