'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Edit,
  Trash2,
  Search,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileDown,
  Layers,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import adminApi, { uploadApi } from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import { formatApiError } from '@/lib/format-api-error';
import toast from 'react-hot-toast';
import ProductModal from '@/components/admin/ProductModal';
import { StockAttentionBanner } from '@/components/admin/StockAttentionBanner';
import { adminUi } from '@/lib/admin-ui';

interface Product {
  id: string | number;
  name: string;
  price: number;
  stock_quantity: number;
  low_stock_threshold?: number;
  product_id?: string;
  category_id?: string;
  category_name?: string;
  image_url?: string;
  is_active: boolean;
  sku?: string;
  description?: string;
  cost_price?: number;
  tax_rate?: number;
}

interface CategoryOption {
  id: string;
  name: string;
}

interface SubCategoryOption {
  id: string;
  name: string;
  category_id: string;
}

interface PreviewRow {
  rowIndex: number;
  data: {
    category: string;
    subcategory: string;
    name: string;
    price: number;
    cost_price: number;
    sku: string | null;
    barcode: string | null;
    stock_quantity: number;
    tax_rate: number;
    is_active: boolean;
  } | null;
  errors: string[];
  status: 'valid' | 'invalid' | 'duplicate_skipped';
}

interface ImportPreviewResult {
  rows: PreviewRow[];
  summary: { total: number; valid: number; invalid: number; duplicate_skipped: number };
}

interface ImportExecuteResult {
  imported: number;
  failed: number;
  duplicate_skipped: number;
  total: number;
  errors: { row: number; message: string }[];
  duplicate_skipped_rows?: { row: number; message: string }[];
  categories_created: number;
  subcategories_created: number;
}

export type ProductsAdminMode = 'active' | 'inactive';

export function ProductsAdminView({ mode }: { mode: ProductsAdminMode }) {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [importStep, setImportStep] = useState<'idle' | 'preview' | 'importing' | 'done'>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [importResult, setImportResult] = useState<ImportExecuteResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [stockFilter, setStockFilter] = useState<'all' | 'low_stock' | 'out_of_stock'>('all');
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategoryOption[]>([]);
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkSubId, setBulkSubId] = useState('');
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminApi.get('/products', {
        params: { limit: 5000, visibility: mode === 'inactive' ? 'inactive' : 'active' },
      });
      setProducts(response.data.products || []);
      setTotalCount(response.data.pagination?.total ?? (response.data.products?.length ?? 0));
    } catch (error) {
      if (isAdminAuthRedirectError(error)) {
        return;
      }
      toast.error('Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [mode]);

  const fetchTaxonomy = async () => {
    try {
      const [catRes, subRes] = await Promise.all([
        adminApi.get('/categories'),
        adminApi.get('/sub-categories'),
      ]);
      const cats = Array.isArray(catRes.data) ? catRes.data : [];
      setCategories(cats.map((c: { id?: string; name?: string }) => ({ id: String(c.id), name: c.name || '' })));
      const subs = Array.isArray(subRes.data) ? subRes.data : [];
      setSubCategories(
        subs.map((s: { id?: string; name?: string; category_id?: string }) => ({
          id: String(s.id),
          name: s.name || '',
          category_id: String(s.category_id || ''),
        }))
      );
    } catch (e) {
      if (isAdminAuthRedirectError(e)) {
        return;
      }
      toast.error('Failed to load categories');
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchTaxonomy();
  }, [fetchProducts]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, stockFilter, categoryFilter, mode]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }
    setSelectedFile(file);
    setImportResult(null);
    setImportStep('preview');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await uploadApi.post<ImportPreviewResult>('/products/import/preview', formData);
      setPreview(data);
      toast.success('Preview ready. Review and confirm to import.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to parse CSV');
      setPreview(null);
      setImportStep('idle');
    }
  };

  const handleConfirmImport = async () => {
    if (!selectedFile) return;
    setImportStep('importing');
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const { data } = await uploadApi.post<ImportExecuteResult>('/products/import', formData);
      setImportResult(data);
      setImportStep('done');
      if (data.imported > 0) {
        toast.success(`${data.imported} products imported`);
        fetchProducts();
      }
      if (data.failed > 0) {
        toast.error(`${data.failed} row(s) failed`);
      }
      if (data.duplicate_skipped > 0) {
        toast(`${data.duplicate_skipped} duplicate(s) skipped`, { icon: '⚠️' });
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Import failed');
      setImportStep('preview');
    }
  };

  const handleCloseImport = () => {
    setImportStep('idle');
    setSelectedFile(null);
    setPreview(null);
    setImportResult(null);
  };

  const toggleSelect = (id: string | number) => {
    const s = String(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredProducts.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredProducts.map((p) => String(p.id))));
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected product(s)?`)) return;
    try {
      await adminApi.post('/products/bulk-delete', { ids: Array.from(selectedIds) });
      toast.success(`${selectedIds.size} product(s) deleted`);
      setSelectedIds(new Set());
      fetchProducts();
    } catch (err: unknown) {
      toast.error(formatApiError(err, 'Failed to delete'));
    }
  };

  const handleBulkActivate = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Show ${selectedIds.size} selected product(s) on the website again?`)) return;
    try {
      const { data } = await adminApi.post<{ modified?: number }>('/products/bulk-activate', {
        ids: Array.from(selectedIds),
      });
      toast.success(`${data?.modified ?? selectedIds.size} product(s) activated`);
      setSelectedIds(new Set());
      fetchProducts();
    } catch (err: unknown) {
      toast.error(formatApiError(err, 'Failed to activate'));
    }
  };

  const handleWebsiteToggle = async (id: string, next: boolean) => {
    setTogglingId(id);
    try {
      await adminApi.put(`/products/${id}`, { is_active: next });
      toast.success(next ? 'Product is visible on the website' : 'Product hidden from the website');
      await fetchProducts();
    } catch (err: unknown) {
      toast.error(formatApiError(err, 'Could not update visibility'));
    } finally {
      setTogglingId(null);
    }
  };

  const handleBulkAssignCategory = async () => {
    if (selectedIds.size === 0 || !bulkCategoryId) {
      toast.error('Select products and choose a category');
      return;
    }
    setBulkAssigning(true);
    try {
      const payload: { ids: string[]; category_id: string; sub_category_id?: string } = {
        ids: Array.from(selectedIds),
        category_id: bulkCategoryId,
      };
      if (bulkSubId) payload.sub_category_id = bulkSubId;
      const { data } = await adminApi.post<{ modified: number }>('/products/bulk-assign-category', payload);
      toast.success(`Assigned category to ${data.modified} product(s)`);
      setSelectedIds(new Set());
      setBulkCategoryId('');
      setBulkSubId('');
      await fetchProducts();
    } catch (err: unknown) {
      toast.error(formatApiError(err, 'Failed to assign category'));
    } finally {
      setBulkAssigning(false);
    }
  };

  const handleExportSelected = () => {
    if (selectedIds.size === 0) return;
    const rows = filteredProducts.filter((p) => selectedIds.has(String(p.id)));
    // QuickBooks-compatible columns: name, sku, price, tax_rate, cost_price, description, stock_quantity, category (no PLU, Barcode, picture)
    const headers = ['name', 'sku', 'price', 'tax_rate', 'cost_price', 'description', 'stock_quantity', 'category'];
    const csvRows = [
      headers.join(','),
      ...rows.map((p) =>
        [
          `"${(p.name || '').replace(/"/g, '""')}"`,
          `"${(p.sku || '').replace(/"/g, '""')}"`,
          parseFloat(String(p.price)).toFixed(2),
          String(p.tax_rate ?? 0),
          parseFloat(String(p.cost_price ?? 0)).toFixed(2),
          `"${(p.description || '').replace(/"/g, '""')}"`,
          p.stock_quantity,
          `"${(p.category_name || '').replace(/"/g, '""')}"`,
        ].join(',')
      ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `products_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} product(s). QuickBooks-compatible.`);
  };

  const lowStockThreshold = (p: Product) => p.low_stock_threshold ?? 10;
  const lowStockCount = products.filter((p) => (p.stock_quantity ?? 0) > 0 && (p.stock_quantity ?? 0) <= lowStockThreshold(p)).length;
  const outOfStockCount = products.filter((p) => (p.stock_quantity ?? 0) <= 0).length;

  const searchLower = searchTerm.trim().toLowerCase();
  const filteredBySearch = !searchLower
    ? products
    : products.filter((p) => {
        const name = (p.name || '').toLowerCase();
        const sku = (p.sku || '').toLowerCase();
        const productId = (p.product_id || '').toLowerCase();
        const desc = (p.description || '').toLowerCase();
        const cat = (p.category_name || '').toLowerCase();
        return (
          name.includes(searchLower) ||
          sku.includes(searchLower) ||
          productId.includes(searchLower) ||
          desc.includes(searchLower) ||
          cat.includes(searchLower)
        );
      });
  const categoryFiltered = categoryFilter
    ? filteredBySearch.filter((p) => {
        if (String(p.category_id || '') === categoryFilter) return true;
        const cat = categories.find((c) => c.id === categoryFilter);
        return !!(cat && (p.category_name || '') === cat.name);
      })
    : filteredBySearch;
  const stockFiltered =
    mode === 'inactive'
      ? categoryFiltered
      : stockFilter === 'low_stock'
        ? categoryFiltered.filter((p) => (p.stock_quantity ?? 0) > 0 && (p.stock_quantity ?? 0) <= lowStockThreshold(p))
        : stockFilter === 'out_of_stock'
          ? categoryFiltered.filter((p) => (p.stock_quantity ?? 0) <= 0)
          : categoryFiltered;

  const filteredProducts = stockFiltered;
  const totalFiltered = filteredProducts.length;
  const pageCount = Math.max(1, Math.ceil(totalFiltered / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pagedProducts = filteredProducts.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-normal text-[#1A1A1A] tracking-tight">
            Products &amp; services
          </h1>
          {mode === 'inactive' ? (
            <p className="text-[#6B6C72] mt-2 max-w-2xl text-sm">
              Hidden from the public storefront. Use <strong>Set active</strong> or edit the product and turn on &ldquo;Active on website&rdquo;.
            </p>
          ) : null}
          {totalCount !== null && (
            <p className="text-teal-400 mt-1.5 font-bold text-xs uppercase tracking-wider">
              {mode === 'inactive' ? 'Inactive' : 'Active'}: {totalCount.toLocaleString()} product{totalCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        {mode === 'active' && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
            />
            <a
              href="/product-import-sample.csv"
              download="product-import-sample.csv"
              className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-white border border-[#CBD5E1] hover:bg-[#F1F5F9] rounded-md text-sm font-medium text-[#334155] transition-all cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-slate-400" />
              Sample CSV
            </a>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-white border border-[#CBD5E1] hover:bg-[#F1F5F9] rounded-md text-sm font-medium text-[#334155] transition-all cursor-pointer"
            >
              <Upload className="w-4 h-4 text-slate-400" />
              Import CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingProduct(null);
                setShowModal(true);
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-black text-white text-sm font-medium hover:bg-[#2C2C2C] cursor-pointer"
            >
              New product/service
            </button>
          </div>
        )}
      </div>

      {mode === 'active' && (
        <StockAttentionBanner
          outOfStockCount={outOfStockCount}
          lowStockCount={lowStockCount}
          onSeeOutOfStock={() => setStockFilter('out_of_stock')}
          onSeeLowStock={() => setStockFilter('low_stock')}
        />
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 mb-6 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative w-full flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8D9096] pointer-events-none" />
            <input
              type="text"
              placeholder="Search name, Product ID, SKU, category, description…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`${adminUi.field} pl-9`}
            />
          </div>
          <div className="sm:w-64 shrink-0">
            <label className="sr-only" htmlFor="product-category-filter">Category</label>
            <select
              id="product-category-filter"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className={adminUi.field}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[#E3E5E8] text-xs font-semibold text-[#6B6C72]">
          <p>
            {totalFiltered === 0 ? (
              <>No products match.</>
            ) : (
              <>
                Showing{' '}
                <span className="font-semibold text-[#1A1A1A] tabular-nums">
                  {((safePage - 1) * pageSize + 1).toLocaleString()}–{Math.min(safePage * pageSize, totalFiltered).toLocaleString()}
                </span>{' '}
                of <span className="font-semibold text-[#1A1A1A] tabular-nums">{totalFiltered.toLocaleString()}</span>
                {searchTerm.trim() || categoryFilter || (mode === 'active' && stockFilter !== 'all') ? (
                  <span className="text-[#8D9096]"> (filtered)</span>
                ) : null}
              </>
            )}
          </p>
          <label className="flex items-center gap-2 text-slate-455">
            <span className="shrink-0">Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="border border-white/10 rounded-lg px-2.5 py-1 bg-slate-950/60 font-medium text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
      </div>
      {mode === 'active' && stockFilter !== 'all' && (
        <p className="text-xs text-slate-400 mb-2 font-semibold flex items-center gap-2">
          Showing only {stockFilter === 'low_stock' ? 'low stock' : 'out of stock'} products.
          <button type="button" onClick={() => setStockFilter('all')} className="text-teal-400 font-bold hover:underline">Show all catalog items</button>
        </p>
      )}

      {mode === 'active' && (
      <>
      {/* Import preview / progress / summary */}
      {importStep === 'preview' && preview && (
        <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-white mb-4">Import Preview</h2>
          <p className="text-xs text-slate-400 mb-4 font-semibold">
            File target: <span className="font-mono text-slate-200">{selectedFile?.name}</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-3">
              <p className="text-2xl font-black text-white">{preview.summary.total}</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">Total rows</p>
            </div>
            <div className="bg-teal-950/20 border border-teal-500/20 rounded-xl p-3">
              <p className="text-2xl font-black text-teal-400">{preview.summary.valid}</p>
              <p className="text-[10px] text-teal-300/80 font-bold uppercase tracking-wider mt-0.5 font-bold">Ready to import</p>
            </div>
            <div className="bg-rose-955/20 border border-rose-500/20 rounded-xl p-3">
              <p className="text-2xl font-black text-rose-400">{preview.summary.invalid}</p>
              <p className="text-[10px] text-rose-350/80 font-bold uppercase tracking-wider mt-0.5 font-bold">Invalid rows</p>
            </div>
            <div className="bg-amber-955/20 border border-amber-500/20 rounded-xl p-3">
              <p className="text-2xl font-black text-amber-400">{preview.summary.duplicate_skipped}</p>
              <p className="text-[10px] text-amber-300/80 font-bold uppercase tracking-wider mt-0.5 font-bold">Duplicates</p>
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto border border-white/5 rounded-xl bg-slate-950/20 mb-4">
            <table className="w-full text-xs">
              <thead className="bg-slate-950/60 sticky top-0 border-b border-white/5 text-slate-400">
                <tr>
                  <th className="text-left py-2.5 px-3 text-[9px] font-bold uppercase tracking-wider">Row</th>
                  <th className="text-left py-2.5 px-3 text-[9px] font-bold uppercase tracking-wider">Status</th>
                  <th className="text-left py-2.5 px-3 text-[9px] font-bold uppercase tracking-wider">Category / Sub</th>
                  <th className="text-left py-2.5 px-3 text-[9px] font-bold uppercase tracking-wider">Product</th>
                  <th className="text-right py-2.5 px-3 text-[9px] font-bold uppercase tracking-wider">Price</th>
                  <th className="text-left py-2.5 px-3 text-[9px] font-bold uppercase tracking-wider">Errors</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t border-white/5 hover:bg-white/[0.01]">
                    <td className="py-2 px-3 font-mono text-slate-500">{r.rowIndex}</td>
                    <td className="py-2 px-3">
                      {r.status === 'valid' && <span className="inline-flex items-center gap-1 text-teal-400"><CheckCircle2 className="w-3.5 h-3.5" /> Valid</span>}
                      {r.status === 'invalid' && <span className="inline-flex items-center gap-1 text-rose-400"><XCircle className="w-3.5 h-3.5" /> Invalid</span>}
                      {r.status === 'duplicate_skipped' && <span className="inline-flex items-center gap-1 text-amber-400"><AlertCircle className="w-3.5 h-3.5" /> Duplicate</span>}
                    </td>
                    <td className="py-2 px-3 text-slate-350 font-semibold">
                      {r.data ? `${r.data.category}${r.data.subcategory ? ' / ' + r.data.subcategory : ''}` : '-'}
                    </td>
                    <td className="py-2 px-3 font-bold text-white">{r.data?.name ?? '-'}</td>
                    <td className="py-2 px-3 text-right text-slate-205 font-mono font-bold">{r.data ? `$${r.data.price.toFixed(2)}` : '-'}</td>
                    <td className="py-2 px-3 text-rose-400 font-semibold">{r.errors.join('; ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 50 && (
            <p className="text-xs text-slate-500 mb-4 font-semibold">Showing first 50 rows. All {preview.summary.total} rows will be processed on import.</p>
          )}
          <div className="flex gap-2.5">
            <button
              onClick={handleConfirmImport}
              disabled={preview.summary.valid === 0}
              className="px-5 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] border-transparent text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-40"
            >
              Import {preview.summary.valid} Product{preview.summary.valid !== 1 ? 's' : ''}
            </button>
            <button onClick={handleCloseImport} className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">
              Cancel
            </button>
          </div>
        </div>
      )}

      {importStep === 'importing' && (
        <div className="bg-white border border-[#E2E8F0] rounded-lg p-8 mb-6 text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-teal-500 border-t-transparent mx-auto mb-4" />
          <p className="text-white font-bold text-sm">Executing CSV Database Upsert...</p>
          <p className="text-xs text-slate-500 mt-1 font-semibold">Do not close this window or navigate away.</p>
        </div>
      )}

      {importStep === 'done' && importResult && (
        <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-white mb-4">Import Run Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-3">
              <p className="text-2xl font-black text-white">{importResult.total}</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">Rows read</p>
            </div>
            <div className="bg-teal-950/20 border border-teal-500/20 rounded-xl p-3">
              <p className="text-2xl font-black text-teal-400">{importResult.imported}</p>
              <p className="text-[10px] text-teal-350/85 font-bold uppercase tracking-wider mt-0.5">Imported</p>
            </div>
            <div className="bg-rose-955/20 border border-rose-500/20 rounded-xl p-3">
              <p className="text-2xl font-black text-rose-400">{importResult.failed}</p>
              <p className="text-[10px] text-rose-350/85 font-bold uppercase tracking-wider mt-0.5">Failed</p>
            </div>
            <div className="bg-amber-955/20 border border-amber-500/20 rounded-xl p-3">
              <p className="text-2xl font-black text-amber-400">{importResult.duplicate_skipped}</p>
              <p className="text-[10px] text-amber-350/85 font-bold uppercase tracking-wider mt-0.5">Duplicates</p>
            </div>
            <div className="bg-blue-955/20 border border-blue-500/20 rounded-xl p-3">
              <p className="text-2xl font-black text-blue-400">{importResult.categories_created + importResult.subcategories_created}</p>
              <p className="text-[10px] text-blue-350/85 font-bold uppercase tracking-wider mt-0.5">Taxonomy tags</p>
            </div>
          </div>
          {(importResult.errors?.length > 0 || importResult.duplicate_skipped_rows?.length) && (
            <div className="max-h-40 overflow-y-auto text-xs font-semibold mb-4 space-y-2 p-3 bg-slate-950/40 rounded-xl border border-white/5">
              <p className="text-slate-400 uppercase tracking-wider text-[9px] font-bold">Trace errors logs:</p>
              <ul className="list-disc list-inside text-rose-400 space-y-1">
                {importResult.errors?.slice(0, 20).map((e, i) => (
                  <li key={i}>Row {e.row}: {e.message}</li>
                ))}
                {importResult.duplicate_skipped_rows?.slice(0, 10).map((e, i) => (
                  <li key={`d-${i}`} className="text-amber-400">Row {e.row}: {e.message}</li>
                ))}
              </ul>
            </div>
          )}
          <button onClick={handleCloseImport} className="px-5 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold transition-all">
            Close Panel
          </button>
        </div>
      )}
      </>
      )}

      {selectedIds.size > 0 && (
      <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] p-4 rounded-2xl mb-6 flex flex-wrap items-center gap-4 text-xs font-semibold">
          <div className="flex flex-col gap-3 w-full lg:flex-row lg:flex-wrap lg:items-end">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-450 font-bold">{selectedIds.size} selected</span>
              <span className="text-[10px] text-slate-550 hidden sm:inline">Tip: use the header checkbox to select all rows in current page view.</span>
            </div>
            {mode === 'active' && (
            <div className="flex flex-wrap items-center gap-2 p-2 border border-white/5 bg-slate-950/40 rounded-xl w-full lg:w-auto">
              <Layers className="w-4 h-4 text-teal-400 shrink-0 hidden sm:block" />
              <span className="text-slate-350 shrink-0">Bulk Category:</span>
              <select
                value={bulkCategoryId}
                onChange={(e) => {
                  setBulkCategoryId(e.target.value);
                  setBulkSubId('');
                }}
                className="border border-white/10 rounded-lg px-2.5 py-1 bg-slate-950/60 font-medium text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
              >
                <option value="">Category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={bulkSubId}
                disabled={!bulkCategoryId}
                onChange={(e) => setBulkSubId(e.target.value)}
                className="border border-white/10 rounded-lg px-2.5 py-1 bg-slate-950/60 font-medium text-white focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
              >
                <option value="">No subcategory</option>
                {subCategories
                  .filter((s) => s.category_id === bulkCategoryId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!bulkCategoryId || bulkAssigning}
                onClick={handleBulkAssignCategory}
                className="bg-teal-600 hover:bg-teal-500 text-white px-3 py-1.5 rounded-lg border border-white/10 font-bold whitespace-nowrap active:scale-95 disabled:opacity-40 transition-all cursor-pointer"
              >
                {bulkAssigning ? 'Applying…' : `Apply to ${selectedIds.size}`}
              </button>
            </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleExportSelected}
                className="inline-flex items-center gap-2 px-3 py-2 bg-slate-950/40 border border-white/10 hover:bg-white/5 text-slate-300 rounded-lg text-xs font-semibold"
              >
                <FileDown className="w-3.5 h-3.5 text-teal-400" />
                Export
              </button>
              {mode === 'inactive' ? (
              <button
                type="button"
                onClick={handleBulkActivate}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#0F9F8F] hover:bg-[#0B8275] border-transparent text-white rounded-xl text-xs font-bold cursor-pointer active:scale-95"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Set active
              </button>
              ) : (
              <button
                type="button"
                onClick={handleBulkDelete}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-455 rounded-xl text-xs font-bold cursor-pointer active:scale-95 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Deactivate
              </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-slate-500 hover:text-slate-205 font-bold"
              >
                Clear selection
              </button>
            </div>
          </div>
      </div>
      )}

      {loading ? (
        <div className="flex justify-center h-64 items-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-teal-500 border-t-transparent" />
        </div>
      ) : (
        <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
          <table className="w-full text-xs font-semibold">
            <thead className="bg-slate-950/60 sticky top-0 z-10 border-b border-white/5 text-slate-400">
              <tr>
                <th className="w-12 py-3.5 px-4 text-center">#</th>
                <th className="w-12 py-3.5 px-4">
                  <input
                    type="checkbox"
                    checked={filteredProducts.length > 0 && selectedIds.size === filteredProducts.length}
                    onChange={toggleSelectAll}
                    className="rounded bg-slate-900 border-white/10 text-teal-400 focus:ring-teal-500"
                  />
                </th>
                <th className="text-left py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">Product name</th>
                <th className="text-left py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">Category</th>
                <th className="text-right py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">Price</th>
                <th className="text-right py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">Stock</th>
                <th className="text-left py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">Product ID</th>
                <th className="text-left py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">SKU</th>
                <th className="text-right py-3.5 px-4 font-bold tracking-wider uppercase text-[10px] min-w-[200px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {pagedProducts.map((product, index) => (
                <tr key={String(product.id)} className="hover:bg-white/[0.02] cursor-pointer transition-colors" onClick={() => router.push(`/admin/products/${product.id}`)}>
                  <td className="py-3 px-4 text-center text-slate-500">{(safePage - 1) * pageSize + index + 1}</td>
                  <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(String(product.id))}
                      onChange={() => toggleSelect(product.id)}
                      className="rounded bg-slate-900 border-white/10 text-teal-400 focus:ring-teal-500"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      {product.image_url && (
                        <img src={product.image_url} alt={product.name} className="w-10 h-10 object-cover rounded-xl border border-white/10 shadow-sm" />
                      )}
                      <span className="font-bold text-white hover:text-teal-400 transition-colors">{product.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-350 font-semibold">{product.category_name || '-'}</td>
                  <td className="py-3 px-4 text-right font-bold text-slate-200">
                    ${parseFloat(product.price.toString()).toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className={product.stock_quantity <= 10 ? 'text-rose-400 font-black' : 'text-slate-200'}>
                      {product.stock_quantity}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-400 font-mono text-[10px] font-semibold">{product.product_id || '-'}</td>
                  <td className="py-3 px-4 text-slate-400 font-mono text-[10px]">{product.sku || '-'}</td>
                  <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-3 flex-wrap">
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <input
                          type="checkbox"
                          className="rounded bg-slate-900 border-white/10 text-teal-500 focus:ring-teal-500 h-3.5 w-3.5 shrink-0 disabled:opacity-50"
                          checked={product.is_active !== false}
                          disabled={togglingId === String(product.id)}
                          onChange={(e) => {
                            const next = e.target.checked;
                            void handleWebsiteToggle(String(product.id), next);
                          }}
                        />
                        <span className="whitespace-nowrap">On website</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProduct(product);
                          setShowModal(true);
                        }}
                        className="p-2 text-slate-450 hover:text-white hover:bg-white/5 rounded-xl border border-white/5 transition-all outline-none"
                        title="Edit specifications"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalFiltered > 0 && pageCount > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-t border-white/5 bg-slate-950/40 text-xs font-semibold text-slate-400">
              <p>
                Page <span className="font-bold text-white tabular-nums">{safePage}</span> of{' '}
                <span className="font-bold text-white tabular-nums">{pageCount}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-white/10 bg-slate-950/60 text-xs font-bold text-white hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <button
                  type="button"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-white/10 bg-slate-950/60 text-xs font-bold text-white hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <ProductModal
          product={editingProduct ? { ...editingProduct, low_stock_threshold: editingProduct.low_stock_threshold ?? 10 } : null}
          onClose={() => { setShowModal(false); setEditingProduct(null); }}
          onSuccess={fetchProducts}
        />
      )}
    </div>
  );
}
