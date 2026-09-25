'use client';

import { useEffect, useState } from 'react';
import { Package, Search, Edit, Trash2, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { StockAttentionBanner } from '@/components/admin/StockAttentionBanner';

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

export default function InventoryPage() {
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
  const [adjustProductId, setAdjustProductId] = useState('');
  const [adjustQty, setAdjustQty] = useState('');
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
      const res = await adminApi.get('/products', { params: { limit: 5000 } });
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
            onClick={() => {
              setAdjustProductId('');
              setAdjustQty('');
              setShowAdjustModal(true);
            }}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-955/80 backdrop-blur-sm p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <h2 className="text-lg font-bold text-white">Adjust Stock Quantity</h2>
              <button type="button" onClick={() => setShowAdjustModal(false)} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!adjustProductId) {
                  toast.error('Select a product');
                  return;
                }
                const change = Number(adjustQty);
                if (!change || Number.isNaN(change)) {
                  toast.error('Enter a quantity to adjust');
                  return;
                }
                try {
                  await adminApi.post('/inventory/adjust', {
                    product_id: adjustProductId,
                    quantity_change: change,
                  });
                  toast.success('Stock adjusted');
                  setShowAdjustModal(false);
                  setAdjustProductId('');
                  setAdjustQty('');
                  fetchProducts();
                } catch (err: any) {
                  toast.error(err.response?.data?.error || 'Failed to adjust stock');
                }
              }}
              className="p-5 space-y-4 text-xs"
            >
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Target Product *</label>
                <select
                  value={adjustProductId}
                  onChange={(e) => setAdjustProductId(e.target.value)}
                  className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none"
                  required
                >
                  <option value="">Select product (scan barcode or select ID)</option>
                  {items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.sku ? `(${p.sku})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Adjustment Qty Delta *</label>
                <input
                  type="number"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none placeholder-slate-600"
                  placeholder="e.g. 20 to add, -15 to deduct from stack"
                  required
                />
                <p className="text-[10px] text-slate-500 font-medium mt-1.5">
                  Positive overrides add material stock, negatives deduct from the stack.
                </p>
              </div>
              <div className="flex justify-end gap-2.5 pt-4 border-t border-white/5">
                <button type="button" onClick={() => setShowAdjustModal(false)} className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] border-transparent text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                  Save Adjustment
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
                <input type="number" min={0} value={form.reorder_level} onChange={(e) => setForm((f) => ({ ...f, reorder_level: e.target.value }))} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" />
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
