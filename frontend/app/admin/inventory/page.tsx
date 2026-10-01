'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Package, Search, Trash2, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { StockAttentionBanner } from '@/components/admin/StockAttentionBanner';
import SearchableProductDropdown, { type ProductOption } from '@/components/admin/SearchableProductDropdown';
import NumberInput from '@/components/admin/NumberInput';
import { sellingBelowMin, minSellingPrice } from '@/lib/min-selling-price';

interface InventoryItem {
  id: string;
  sku?: string;
  name: string;
  category_name?: string;
  sub_category_name?: string;
  stock_quantity: number;
  low_stock_threshold: number;
  category_id?: string;
  sub_category_id?: string;
  cost_price?: number;
  price?: number;
}

interface Category {
  id: string;
  name: string;
}

interface SubCategory {
  id: string;
  name: string;
  category_id: string;
}

interface AdjustLine {
  product_id: string;
  product_name: string;
  sku?: string;
  current_stock: number;
  quantity_change: number;
  cost_price: number | '';
  selling_price: number | '';
}

const ADJUST_LINES = 12;

function emptyAdjustLine(): AdjustLine {
  return {
    product_id: '',
    product_name: '',
    sku: '',
    current_stock: 0,
    quantity_change: 0,
    cost_price: '',
    selling_price: '',
  };
}

function pricesFromProduct(product: { cost_price?: number; price?: number }): Pick<AdjustLine, 'cost_price' | 'selling_price'> {
  const cost = Number(product.cost_price);
  const sell = Number(product.price);
  return {
    cost_price: Number.isFinite(cost) && cost !== 0 ? cost : '',
    selling_price: Number.isFinite(sell) && sell !== 0 ? sell : '',
  };
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="flex justify-center h-64 items-center"><div className="animate-spin rounded-full h-10 w-10 border-2 border-teal-500 border-t-transparent" /></div>}>
      <InventoryPageInner />
    </Suspense>
  );
}

function InventoryPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [stockFilter, setStockFilter] = useState<'all' | 'low_stock' | 'out_of_stock'>('all');
  const [showItemModal, setShowItemModal] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showSubcategoryModal, setShowSubcategoryModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustLines, setAdjustLines] = useState<AdjustLine[]>(() => Array.from({ length: ADJUST_LINES }, emptyAdjustLine));
  const [adjustScan, setAdjustScan] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);
  const adjustScanRef = useRef<HTMLInputElement>(null);
  const [movementSummary, setMovementSummary] = useState<Record<string, { in: number; out: number }>>({});
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState({
    item_id: '',
    item_type: '',
    item_category: '',
    item_subcategory: '',
    item_name: '',
    reorder_level: '10',
  });

  const fetchProducts = async () => {
    try {
      const res = await adminApi.get('/products', { params: { limit: 5000, visibility: 'all' } });
      const list = (res.data.products || []).map((p: any) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category_name: p.category_name,
        sub_category_name: p.sub_category_name,
        stock_quantity: p.stock_quantity ?? 0,
        low_stock_threshold: p.low_stock_threshold ?? 10,
        category_id: p.category_id,
        sub_category_id: p.sub_category_id,
        cost_price: p.cost_price != null ? Number(p.cost_price) : undefined,
        price: p.price != null ? Number(p.price) : undefined,
      }));
      setItems(list);
    } catch {
      toast.error('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  };

  const fetchMovementSummary = async () => {
    try {
      const res = await adminApi.get('/inventory/summary');
      setMovementSummary(res.data.summary || {});
    } catch {
      setMovementSummary({});
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await adminApi.get('/categories');
      setCategories(Array.isArray(res.data) ? res.data : []);
    } catch {
      setCategories([]);
    }
  };

  const fetchSubCategories = async () => {
    try {
      const res = await adminApi.get('/sub-categories');
      setSubCategories(Array.isArray(res.data) ? res.data : []);
    } catch {
      setSubCategories([]);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchProducts(), fetchMovementSummary()]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (showItemModal || showCategoryModal || showSubcategoryModal) {
      fetchCategories();
      fetchSubCategories();
    }
  }, [showItemModal, showCategoryModal, showSubcategoryModal]);

  const openAdjust = () => {
    setAdjustLines(Array.from({ length: ADJUST_LINES }, emptyAdjustLine));
    setAdjustScan('');
    setAdjustNotes('');
    setShowAdjustModal(true);
    window.setTimeout(() => adjustScanRef.current?.focus(), 50);
  };

  const closeAdjust = () => {
    if (adjustSaving) return;
    setShowAdjustModal(false);
    if (searchParams.get('adjust') === '1') router.replace('/admin/inventory');
  };

  useEffect(() => {
    if (searchParams.get('adjust') === '1') openAdjust();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const generateItemId = async () => {
    try {
      const res = await adminApi.get('/products/generate-id');
      setForm((f) => ({ ...f, item_id: res.data.item_id }));
    } catch {
      setForm((f) => ({ ...f, item_id: 'P' + Math.floor(10000 + Math.random() * 90000) }));
    }
  };

  const outOfStockCount = items.filter((p) => (p.stock_quantity ?? 0) <= 0).length;
  const lowStockCount = items.filter((p) => {
    const qty = p.stock_quantity ?? 0;
    return qty > 0 && qty <= (p.low_stock_threshold || 10);
  }).length;

  const filtered = items
    .filter(
      (p) =>
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.sku && p.sku.toLowerCase().includes(search.toLowerCase()))
    )
    .filter((p) => {
      if (stockFilter === 'out_of_stock') return (p.stock_quantity ?? 0) <= 0;
      if (stockFilter === 'low_stock') {
        const qty = p.stock_quantity ?? 0;
        return qty > 0 && qty <= (p.low_stock_threshold || 10);
      }
      return true;
    });

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.item_name?.trim()) {
      toast.error('Item name is required');
      return;
    }
    try {
      if (editing) {
        await adminApi.put(`/products/${editing.id}`, {
          name: form.item_name,
          category_id: form.item_category || undefined,
          sub_category_id: form.item_subcategory || undefined,
          low_stock_threshold: parseInt(form.reorder_level, 10) || 10,
        });
        toast.success('Item updated');
      } else {
        await adminApi.post('/products', {
          name: form.item_name,
          sku: form.item_id || undefined,
          category_id: form.item_category || undefined,
          sub_category_id: form.item_subcategory || undefined,
          low_stock_threshold: parseInt(form.reorder_level, 10) || 10,
          price: 0.01,
          stock_quantity: 0,
        });
        toast.success('Item added');
      }
      setShowItemModal(false);
      setEditing(null);
      setForm({ item_id: '', item_type: '', item_category: '', item_subcategory: '', item_name: '', reorder_level: '10' });
      fetchProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    }
  };

  const openEdit = (item: InventoryItem) => {
    setEditing(item);
    setForm({
      item_id: item.sku || item.id,
      item_type: item.category_id || '',
      item_category: item.category_id || '',
      item_subcategory: item.sub_category_id || '',
      item_name: item.name,
      reorder_level: String(item.low_stock_threshold ?? 10),
    });
    setShowItemModal(true);
  };

  const productOptions: ProductOption[] = items.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    stock_quantity: p.stock_quantity,
    category_name: p.category_name,
    cost_price: p.cost_price,
    price: p.price,
  }));

  const addAdjustProduct = (product: {
    id: string;
    name: string;
    sku?: string;
    stock_quantity?: number;
    cost_price?: number;
    price?: number;
  }) => {
    setAdjustLines((prev) => {
      const existingIdx = prev.findIndex((l) => l.product_id === product.id);
      if (existingIdx !== -1) {
        const next = [...prev];
        next[existingIdx] = {
          ...next[existingIdx],
          quantity_change: next[existingIdx].quantity_change + 1,
          current_stock: product.stock_quantity ?? next[existingIdx].current_stock,
        };
        return next;
      }
      const emptyIdx = prev.findIndex((l) => !l.product_id);
      const line: AdjustLine = {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        current_stock: product.stock_quantity ?? 0,
        quantity_change: 1,
        ...pricesFromProduct(product),
      };
      if (emptyIdx === -1) return [...prev, line];
      const next = [...prev];
      next[emptyIdx] = line;
      return next;
    });
    setAdjustScan('');
    window.setTimeout(() => adjustScanRef.current?.focus(), 0);
  };

  const selectAdjustLine = (index: number, product: ProductOption) => {
    setAdjustLines((prev) => {
      const existingIdx = prev.findIndex((l, i) => i !== index && l.product_id === product.id);
      const next = [...prev];
      if (existingIdx !== -1) {
        next[existingIdx] = {
          ...next[existingIdx],
          quantity_change: next[existingIdx].quantity_change + (next[index].quantity_change || 1),
        };
        next[index] = emptyAdjustLine();
        return next;
      }
      next[index] = {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        current_stock: product.stock_quantity ?? 0,
        quantity_change: next[index].quantity_change || 1,
        ...pricesFromProduct(product),
      };
      return next;
    });
  };

  const scanAdjustBarcode = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const listed = items.find(
      (p) => p.sku === trimmed || p.id === trimmed || p.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (listed) {
      addAdjustProduct(listed);
      return;
    }
    adminApi
      .get(`/products/barcode/${encodeURIComponent(trimmed)}`)
      .then((r) => {
        const p = r.data;
        if (p?.id) {
          addAdjustProduct({
            id: p.id,
            name: p.name,
            sku: p.sku,
            stock_quantity: p.stock_quantity,
            cost_price: p.cost_price,
            price: p.price,
          });
        }
      })
      .catch(() => toast.error('Product not found for this barcode/ID'));
  };

  const saveAdjustments = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = adjustLines.filter(
      (l) => l.product_id && (l.quantity_change !== 0 || l.cost_price !== '' || l.selling_price !== '')
    );
    if (valid.length === 0) {
      toast.error('Add at least one product to adjust stock or prices');
      return;
    }
    for (const line of valid) {
      const cost = line.cost_price === '' ? null : Number(line.cost_price);
      const sell = line.selling_price === '' ? null : Number(line.selling_price);
      if (sell != null && cost != null && sellingBelowMin(sell, cost)) {
        toast.error(
          `"${line.product_name}" selling price must be at least $${minSellingPrice(cost).toFixed(2)} (5% above cost).`
        );
        return;
      }
    }
    setAdjustSaving(true);
    let ok = 0;
    const failures: string[] = [];
    for (const line of valid) {
      try {
        const payload: {
          product_id: string;
          quantity_change: number;
          notes?: string;
          cost_price?: number;
          price?: number;
        } = {
          product_id: line.product_id,
          quantity_change: Math.trunc(Number(line.quantity_change) || 0),
          notes: adjustNotes || undefined,
        };
        if (line.cost_price !== '') payload.cost_price = Number(line.cost_price);
        if (line.selling_price !== '') payload.price = Number(line.selling_price);
        await adminApi.post('/inventory/adjust', payload);
        ok += 1;
      } catch (err: any) {
        failures.push(err.response?.data?.error || `Could not adjust ${line.product_name}`);
      }
    }
    setAdjustSaving(false);
    if (ok) {
      toast.success(`Adjusted ${ok} ${ok === 1 ? 'product' : 'products'}`);
      fetchProducts();
      fetchMovementSummary();
    }
    if (failures.length) {
      toast.error(failures.slice(0, 3).join(' · '));
      return;
    }
    setShowAdjustModal(false);
    if (searchParams.get('adjust') === '1') router.replace('/admin/inventory');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this item? It can be reactivated later.')) return;
    try {
      await adminApi.delete(`/products/${id}`);
      toast.success('Item deactivated');
      fetchProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#0F172A] tracking-tight">Inventory management</h1>
          <p className="text-xs text-slate-400 mt-1">Track units purchased versus units sold, control buffer stock margins, and log adjustments.</p>
        </div>
      </div>

      <StockAttentionBanner
        outOfStockCount={outOfStockCount}
        lowStockCount={lowStockCount}
        onSeeOutOfStock={() => setStockFilter('out_of_stock')}
        onSeeLowStock={() => setStockFilter('low_stock')}
      />
      {stockFilter !== 'all' && (
        <p className="text-sm text-[#6B6C72] -mt-3">
          Showing {stockFilter === 'low_stock' ? 'low stock' : 'out of stock'} items.{' '}
          <button type="button" onClick={() => setStockFilter('all')} className="text-[#0077C5] hover:underline font-medium">
            Show all
          </button>
        </p>
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search inventory by item name or SKU code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={openAdjust}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-teal-400 border border-teal-500/25 bg-teal-500/5 hover:bg-teal-500/10 font-bold text-xs transition-all"
          >
            <Package className="w-4 h-4" />
            Stock Adjustments
          </button>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-slate-955/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500">
            <option value="All">All Items</option>
          </select>
        </div>
      </div>

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
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Item ID / SKU</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Category</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Subcategory</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Item Name</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">QTY Purchased</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">QTY Sold</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Remaining Stock</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Buffer Level</th>
                  <th className="text-center py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Reorder status</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-16 text-center text-slate-500 text-xs font-semibold">
                      No inventory logs detected.
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const reorderRequired = p.stock_quantity <= (p.low_stock_threshold || 10);
                    return (
                      <tr key={p.id} className={`border-b border-white/5 transition-colors hover:bg-white/[0.01] ${reorderRequired ? 'bg-rose-500/[0.03]' : ''}`}>
                        <td className="py-3 px-4 text-xs font-mono font-bold text-teal-450">{p.sku || p.id.slice(-6)}</td>
                        <td className="py-3 px-4 text-xs text-slate-400">{p.category_name || '—'}</td>
                        <td className="py-3 px-4 text-xs text-slate-400">{p.sub_category_name || '—'}</td>
                        <td className="py-3 px-4 text-xs font-semibold text-slate-205">{p.name}</td>
                        <td className="py-3 px-4 text-xs text-right font-mono text-slate-350 font-bold">
                          {movementSummary[p.id]?.in != null ? movementSummary[p.id].in : '0'}
                        </td>
                        <td className="py-3 px-4 text-xs text-right font-mono text-slate-350 font-bold">
                          {movementSummary[p.id]?.out != null ? movementSummary[p.id].out : '0'}
                        </td>
                        <td className={`py-3 px-4 text-xs text-right font-extrabold font-mono ${reorderRequired ? 'text-rose-455' : 'text-slate-100'}`}>{p.stock_quantity}</td>
                        <td className="py-3 px-4 text-xs text-right font-mono text-slate-400">{p.low_stock_threshold ?? 10}</td>
                        <td className="py-3 px-4 text-center text-xs">
                          {reorderRequired ? (
                            <span className="inline-flex px-2 py-0.5 rounded text-[9px] font-bold border bg-rose-500/10 text-rose-400 border-rose-500/20 uppercase tracking-wider">Required</span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 rounded text-[9px] font-bold border border-white/10 bg-slate-950/40 text-slate-450 uppercase tracking-wider">Stock Good</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-xs">
                          <div className="flex items-center justify-end gap-3">
                            <button type="button" onClick={() => openEdit(p)} className="text-teal-450 hover:text-teal-350 hover:underline font-semibold">
                              Edit
                            </button>
                            <button type="button" onClick={() => handleDelete(p.id)} className="text-slate-450 hover:text-rose-400 hover:underline font-semibold">
                              Deactivate
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

      {showAdjustModal && (
        <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={closeAdjust}>
          <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Stock adjustment</h2>
              <button type="button" onClick={closeAdjust} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={saveAdjustments} className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <label className="block text-sm font-medium text-gray-700">Product or service</label>
                  <div className="flex-1 flex gap-2 items-center">
                    <input
                      ref={adjustScanRef}
                      type="text"
                      value={adjustScan}
                      onChange={(e) => setAdjustScan(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        scanAdjustBarcode(adjustScan);
                      }}
                      placeholder="Scan barcode / item ID and press Enter"
                      className="flex-1 max-w-xs pl-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                    />
                    <Link href="/admin/products/new" className="text-sm text-[#0F9F8F] font-medium hover:underline">+ Add product</Link>
                  </div>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[920px]">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left py-3 px-4 w-10">#</th>
                        <th className="text-left py-3 px-4 min-w-[240px]">Product</th>
                        <th className="text-left py-3 px-4 min-w-[120px]">SKU</th>
                        <th className="text-right py-3 px-4 w-28">Current stock</th>
                        <th className="text-right py-3 px-4 w-32">Adjustment qty</th>
                        <th className="text-right py-3 px-4 w-28">New stock</th>
                        <th className="text-right py-3 px-4 w-32">Cost price</th>
                        <th className="text-right py-3 px-4 w-32">Selling price</th>
                        <th className="w-12 px-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {adjustLines.map((line, idx) => {
                        const hasProduct = !!line.product_id;
                        const newStock = line.current_stock + (Number(line.quantity_change) || 0);
                        return (
                          <tr key={idx} className={`border-t border-gray-100 hover:bg-gray-50/50 ${hasProduct && newStock < 0 ? 'bg-red-50' : ''}`}>
                            <td className="py-2 px-4">{idx + 1}</td>
                            <td className="py-2 px-4">
                              <SearchableProductDropdown
                                products={productOptions}
                                value={line.product_id}
                                displayName={line.product_name || undefined}
                                showPrice={false}
                                onSelect={(p) => selectAdjustLine(idx, p)}
                                onBarcodeScan={scanAdjustBarcode}
                                placeholder="Search product or scan barcode…"
                              />
                            </td>
                            <td className="py-2 px-4 text-gray-600">{hasProduct ? (line.sku || '—') : ''}</td>
                            <td className="py-2 px-4 text-right text-gray-600">{hasProduct ? line.current_stock : ''}</td>
                            <td className="py-2 px-4 text-right">
                              {hasProduct ? (
                                <NumberInput
                                  step={1}
                                  value={line.quantity_change}
                                  onValueChange={(n) => {
                                    setAdjustLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], quantity_change: n === '' ? 0 : n };
                                      return next;
                                    });
                                  }}
                                  className={`w-24 text-right border rounded px-2 py-1 ${newStock < 0 ? 'border-red-400 text-red-700 bg-red-50' : 'border-gray-300'}`}
                                />
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className={`py-2 px-4 text-right font-medium ${newStock < 0 ? 'text-red-700' : ''}`}>
                              {hasProduct ? newStock : ''}
                            </td>
                            <td className="py-2 px-4 text-right">
                              {hasProduct ? (
                                <NumberInput
                                  value={line.cost_price}
                                  onValueChange={(n) => {
                                    setAdjustLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], cost_price: n };
                                      return next;
                                    });
                                  }}
                                  className="w-24 text-right border border-gray-300 rounded px-2 py-1"
                                />
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="py-2 px-4 text-right">
                              {hasProduct ? (
                                <NumberInput
                                  value={line.selling_price}
                                  onValueChange={(n) => {
                                    setAdjustLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], selling_price: n };
                                      return next;
                                    });
                                  }}
                                  className={`w-24 text-right border rounded px-2 py-1 ${
                                    line.cost_price !== '' &&
                                    line.selling_price !== '' &&
                                    sellingBelowMin(Number(line.selling_price), Number(line.cost_price))
                                      ? 'border-red-400 text-red-700 bg-red-50'
                                      : 'border-gray-300'
                                  }`}
                                />
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="py-2 px-4">
                              {hasProduct && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAdjustLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = emptyAdjustLine();
                                      return next;
                                    });
                                  }}
                                  className="text-red-600 hover:bg-red-50 p-1 rounded"
                                >
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
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">Scan or search a product. Positive qty adds stock, negative qty deducts. Cost and selling prices stay as listed unless you change them. Scanning the same product again increases qty.</p>
                  <button
                    type="button"
                    onClick={() => setAdjustLines((prev) => [...prev, emptyAdjustLine()])}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    + Add line
                  </button>
                </div>
                <div className="max-w-md">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                  <input
                    type="text"
                    value={adjustNotes}
                    onChange={(e) => setAdjustNotes(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Reason for this adjustment"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
                <button type="button" onClick={closeAdjust} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={adjustSaving} className="px-4 py-2 bg-black text-white rounded-lg hover:bg-[#2C2C2C] disabled:opacity-50">
                  {adjustSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-955/80 backdrop-blur-sm p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <h2 className="text-lg font-bold text-white">{editing ? 'Edit Inventory Item' : 'New Inventory Item'}</h2>
              <button type="button" onClick={() => setShowItemModal(false)} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveItem} className="p-5 space-y-4 text-xs">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Item ID *</label>
                  <input type="text" value={form.item_id} onChange={(e) => setForm((f) => ({ ...f, item_id: e.target.value }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-205 focus:outline-none" />
                </div>
                <div>
                  <button type="button" onClick={generateItemId} className="px-3.5 py-2.5 bg-slate-800 border border-white/5 text-slate-350 hover:text-white rounded-xl text-xs font-semibold transition-all">
                    Generate
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Item Type *</label>
                <select value={form.item_type} onChange={(e) => setForm((f) => ({ ...f, item_type: e.target.value, item_category: e.target.value }))} className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none">
                  <option value="">Select type</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Item Category *</label>
                <select value={form.item_category} onChange={(e) => setForm((f) => ({ ...f, item_category: e.target.value }))} className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none">
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Item Subcategory *</label>
                <select value={form.item_subcategory} onChange={(e) => setForm((f) => ({ ...f, item_subcategory: e.target.value }))} className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none">
                  <option value="">Select subcategory</option>
                  {subCategories.filter((s) => !form.item_category || s.category_id === form.item_category).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Item Name *</label>
                <input type="text" value={form.item_name} onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" required />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Reorder Buffer Target (Qty) *</label>
                <NumberInput min={0} value={form.reorder_level} onValueChange={(n) => setForm((f) => ({ ...f, reorder_level: n === '' ? '' : String(n) }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" />
              </div>
              <div className="flex justify-end gap-2.5 pt-4 border-t border-white/5">
                <button type="button" onClick={() => setShowItemModal(false)} className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">
                  Close
                </button>
                <button type="submit" className="px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] border-transparent text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTypeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-955/80 backdrop-blur-sm p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] max-w-sm w-full p-6">
            <h3 className="text-sm font-bold text-white mb-3 uppercase tracking-wider text-slate-400 text-[10px]">Add Item Type</h3>
            <p className="text-slate-450 text-xs mb-5">Create a parent category type list to associate inventory assets.</p>
            <button type="button" onClick={() => { setShowTypeModal(false); setShowCategoryModal(true); }} className="w-full px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] text-white rounded-xl text-xs font-bold shadow-sm transition-all">
              Go to Category Registry
            </button>
            <button type="button" onClick={() => setShowTypeModal(false)} className="w-full mt-2 px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold transition-all">
              Cancel
            </button>
          </div>
        </div>
      )}

      {showCategoryModal && (
        <AddCategoryModal
          onClose={() => setShowCategoryModal(false)}
          onSaved={() => {
            fetchCategories();
            setShowCategoryModal(false);
            toast.success('Category added');
          }}
        />
      )}

      {showSubcategoryModal && (
        <AddSubcategoryModal
          categories={categories}
          onClose={() => setShowSubcategoryModal(false)}
          onSaved={() => {
            fetchSubCategories();
            setShowSubcategoryModal(false);
            toast.success('Subcategory added');
          }}
        />
      )}
    </div>
  );
}

function AddCategoryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await adminApi.post('/categories', { name: name.trim() });
      onSaved();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add category');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-955/80 backdrop-blur-sm p-4">
      <div className="bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] max-w-sm w-full p-6">
        <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider text-slate-400 text-[10px]">+ Create Item Category</h3>
        <form onSubmit={handleSubmit}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Category title..." className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-205 focus:outline-none mb-4" autoFocus />
          <div className="flex justify-end gap-2.5">
            <button type="button" onClick={onClose} className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] text-white rounded-xl text-xs font-bold shadow-sm disabled:opacity-40">Save Category</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddSubcategoryModal({ categories, onClose, onSaved }: { categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !categoryId) {
      toast.error('Name and category required');
      return;
    }
    setLoading(true);
    try {
      await adminApi.post('/sub-categories', { name: name.trim(), category_id: categoryId });
      onSaved();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add subcategory');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-955/80 backdrop-blur-sm p-4">
      <div className="bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] max-w-sm w-full p-6">
        <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider text-slate-400 text-[10px]">+ Create Item Subcategory</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wider mb-2">Category *</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none font-semibold" required>
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wider mb-2">Subcategory name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" required />
          </div>
          <div className="flex justify-end gap-2.5">
            <button type="button" onClick={onClose} className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] text-white rounded-xl text-xs font-bold shadow-sm disabled:opacity-40">Save Subcategory</button>
          </div>
        </form>
      </div>
    </div>
  );
}
