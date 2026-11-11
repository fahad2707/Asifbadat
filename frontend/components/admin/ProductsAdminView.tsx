'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Edit,
  Trash2,
  Search,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileDown,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Printer,
} from 'lucide-react';
import adminApi, { uploadApi } from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import { formatApiError } from '@/lib/format-api-error';
import toast from 'react-hot-toast';
import ProductModal from '@/components/admin/ProductModal';
import { StockAttentionBanner } from '@/components/admin/StockAttentionBanner';
import { adminUi } from '@/lib/admin-ui';
import { formatTaxTypeLabel, productTaxLabel, type TaxTypeOption } from '@/lib/tax-type';
import { titleCaseWords } from '@/lib/titleCaseWords';

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
  tax_type_id?: string | null;
  tax_type_configured?: boolean;
  tax_type_label?: string;
  tax_type?: TaxTypeOption | null;
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

interface PriceGroupOption {
  id: string;
  name: string;
  product_count?: number;
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

export type ProductsAdminMode = 'all' | 'active' | 'inactive';

export function ProductsAdminView({ initialView = 'all' }: { initialView?: ProductsAdminMode }) {
  const router = useRouter();
  const [view, setView] = useState<ProductsAdminMode>(initialView);
  const mode = view;
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
  const [taxTypes, setTaxTypes] = useState<TaxTypeOption[]>([]);
  const [bulkTaxTypeId, setBulkTaxTypeId] = useState('');
  const [bulkTaxAssigning, setBulkTaxAssigning] = useState(false);
  const [priceGroups, setPriceGroups] = useState<PriceGroupOption[]>([]);
  const [bulkPriceGroupId, setBulkPriceGroupId] = useState('');
  const [bulkPriceGroupName, setBulkPriceGroupName] = useState('');
  const [bulkPriceGroupAssigning, setBulkPriceGroupAssigning] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const fetchProducts = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    try {
      const response = await adminApi.get('/products', {
        params: { limit: 5000, visibility: 'all' },
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
  }, []);

  const fetchTaxonomy = async () => {
    try {
      const [catRes, subRes, taxRes] = await Promise.all([
        adminApi.get('/categories'),
        adminApi.get('/sub-categories'),
        adminApi.get('/tax-types'),
      ]);
      const taxes = Array.isArray(taxRes.data) ? taxRes.data : [];
      setTaxTypes(
        taxes.map((t: TaxTypeOption) => ({
          id: String(t.id),
          name: t.name,
          rate: Number(t.rate) || 0,
          rate_type: t.rate_type,
        }))
      );
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
    try {
      const pgRes = await adminApi.get('/price-groups');
      const groups = Array.isArray(pgRes.data) ? pgRes.data : [];
      setPriceGroups(
        groups.map((g: PriceGroupOption) => ({
          id: String(g.id),
          name: g.name || '',
          product_count: g.product_count,
        }))
      );
    } catch (e) {
      if (isAdminAuthRedirectError(e)) return;
      setPriceGroups([]);
    }
  };

  const handleBulkAssignTaxType = async () => {
    if (selectedIds.size === 0 || !bulkTaxTypeId) {
      toast.error('Select products and choose a tax type');
      return;
    }
    const selectedTax = taxTypes.find((t) => t.id === bulkTaxTypeId);
    const label = bulkTaxTypeId === '__no_tax__' ? 'No Tax' : selectedTax ? formatTaxTypeLabel(selectedTax) : 'the selected tax type';
    if (!confirm(`Assign ${label} to ${selectedIds.size} selected product(s)? Selling prices will not change.`)) {
      return;
    }
    setBulkTaxAssigning(true);
    try {
      const { data } = await adminApi.post<{ modified: number }>('/products/bulk-assign-tax-type', {
        ids: Array.from(selectedIds),
        tax_type_id: bulkTaxTypeId === '__no_tax__' ? null : bulkTaxTypeId,
      });
      toast.success(`Assigned ${label} to ${data.modified} product(s)`);
      setBulkTaxTypeId('');
      await fetchProducts();
    } catch (err: unknown) {
      toast.error(formatApiError(err, 'Failed to assign tax type'));
    } finally {
      setBulkTaxAssigning(false);
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
    const ids = Array.from(selectedIds);
    try {
      await adminApi.post('/products/bulk-delete', { ids });
      toast.success(`${ids.length} product(s) deleted`);
      setSelectedIds(new Set());
      // Soft-delete on the server — remove from this list immediately so UI matches the toast.
      setProducts((prev) => prev.filter((p) => !ids.includes(String(p.id))));
      setTotalCount((prev) => Math.max(0, (prev ?? 0) - ids.length));
      await fetchProducts();
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
      fetchProducts({ quiet: true });
    } catch (err: unknown) {
      toast.error(formatApiError(err, 'Failed to activate'));
    }
  };

  const handleWebsiteToggle = async (id: string, next: boolean) => {
    setTogglingId(id);
    try {
      await adminApi.put(`/products/${id}`, { is_active: next });
      setProducts((prev) => prev.map((p) => (String(p.id) === id ? { ...p, is_active: next } : p)));
      toast.success(next ? 'Product is visible on the website' : 'Product hidden from the website');
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

  const handleBulkAssignPriceGroup = async () => {
    if (selectedIds.size === 0) {
      toast.error('Select products first');
      return;
    }
    const ids = Array.from(selectedIds);
    const creatingNew = bulkPriceGroupId === '__new__';
    if (creatingNew && !bulkPriceGroupName.trim()) {
      toast.error('Enter a name for the new price group');
      return;
    }
    if (!creatingNew && !bulkPriceGroupId) {
      toast.error('Select a price group or create a new one');
      return;
    }
    const label = creatingNew
      ? bulkPriceGroupName.trim()
      : priceGroups.find((g) => g.id === bulkPriceGroupId)?.name || 'price group';
    if (!confirm(`Add ${selectedIds.size} selected product(s) to price group "${label}"?`)) {
      return;
    }
    setBulkPriceGroupAssigning(true);
    try {
      if (creatingNew) {
        const { data } = await adminApi.post<PriceGroupOption>('/price-groups', {
          name: bulkPriceGroupName.trim(),
          product_ids: ids,
        });
        toast.success(`Created "${data.name}" with ${ids.length} product(s)`);
      } else {
        const { data } = await adminApi.post<{ added: number; name: string }>(
          `/price-groups/${bulkPriceGroupId}/products`,
          { product_ids: ids }
        );
        toast.success(`Added ${data.added} product(s) to "${data.name || label}"`);
      }
      setBulkPriceGroupId('');
      setBulkPriceGroupName('');
      setSelectedIds(new Set());
      await fetchTaxonomy();
    } catch (err: unknown) {
      toast.error(formatApiError(err, 'Failed to update price group'));
    } finally {
      setBulkPriceGroupAssigning(false);
    }
  };

  const handleBulkApply = async () => {
    if (selectedIds.size === 0) return;
    if (bulkPriceGroupId === '__new__' && !bulkPriceGroupName.trim()) {
      toast.error('Enter a name for the new price group');
      return;
    }
    if (!bulkCategoryId && !bulkTaxTypeId && !bulkPriceGroupId) {
      toast.error('Choose a category, tax type, or price group');
      return;
    }
    const ids = Array.from(selectedIds);
    const parts: string[] = [];
    if (bulkCategoryId) {
      const cat = categories.find((c) => c.id === bulkCategoryId)?.name || 'category';
      parts.push(titleCaseWords(cat));
    }
    if (bulkTaxTypeId) {
      const selectedTax = taxTypes.find((t) => t.id === bulkTaxTypeId);
      parts.push(
        bulkTaxTypeId === '__no_tax__' ? 'No Tax' : selectedTax ? formatTaxTypeLabel(selectedTax) : 'tax type'
      );
    }
    if (bulkPriceGroupId) {
      parts.push(
        bulkPriceGroupId === '__new__'
          ? bulkPriceGroupName.trim()
          : priceGroups.find((g) => g.id === bulkPriceGroupId)?.name || 'price group'
      );
    }
    if (!confirm(`Apply ${parts.join(', ')} to ${ids.length} product(s)?`)) return;

    setBulkAssigning(true);
    try {
      if (bulkCategoryId) {
        const payload: { ids: string[]; category_id: string; sub_category_id?: string } = {
          ids,
          category_id: bulkCategoryId,
        };
        if (bulkSubId) payload.sub_category_id = bulkSubId;
        await adminApi.post('/products/bulk-assign-category', payload);
      }
      if (bulkTaxTypeId) {
        await adminApi.post('/products/bulk-assign-tax-type', {
          ids,
          tax_type_id: bulkTaxTypeId === '__no_tax__' ? null : bulkTaxTypeId,
        });
      }
      if (bulkPriceGroupId === '__new__') {
        await adminApi.post('/price-groups', {
          name: titleCaseWords(bulkPriceGroupName.trim()),
          product_ids: ids,
        });
      } else if (bulkPriceGroupId) {
        await adminApi.post(`/price-groups/${bulkPriceGroupId}/products`, { product_ids: ids });
      }
      toast.success(`Updated ${ids.length} product(s)`);
      setBulkCategoryId('');
      setBulkSubId('');
      setBulkTaxTypeId('');
      setBulkPriceGroupId('');
      setBulkPriceGroupName('');
      setSelectedIds(new Set());
      await fetchProducts({ quiet: true });
      await fetchTaxonomy();
    } catch (err: unknown) {
      toast.error(formatApiError(err, 'Failed to update products'));
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

  const switchView = (next: ProductsAdminMode) => {
    setView(next);
    setPage(1);
    const url = next === 'all' ? '/admin/products' : `/admin/products?view=${next}`;
    window.history.replaceState(window.history.state, '', url);
  };

  const searchLower = searchTerm.trim().toLowerCase();
  const catalogForView =
    mode === 'active'
      ? products.filter((p) => p.is_active !== false)
      : mode === 'inactive'
        ? products.filter((p) => p.is_active === false)
        : products;
  const filteredBySearch = !searchLower
    ? catalogForView
    : catalogForView.filter((p) => {
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-normal text-[#1A1A1A] tracking-tight">
            Products &amp; services
          </h1>
          {totalCount !== null && (
            <p className="text-[#6B6C72] mt-1 text-sm">
              {totalCount.toLocaleString()} product{totalCount !== 1 ? 's' : ''}
              {mode !== 'inactive' ? (
                <> · {products.filter((p) => p.is_active !== false).length.toLocaleString()} on website</>
              ) : null}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full border border-[#C7C7C7] bg-white p-0.5" role="tablist" aria-label="Product visibility">
            {(
              [
                { id: 'all' as const, label: 'All' },
                { id: 'active' as const, label: 'Active' },
                { id: 'inactive' as const, label: 'Inactive' },
              ]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={mode === tab.id}
                onClick={() => switchView(tab.id)}
                className={`px-3.5 py-1.5 text-sm rounded-full ${
                  mode === tab.id ? 'bg-black text-white' : 'text-[#6B6C72] hover:bg-[#F4F5F8]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            type="button"
            onClick={() => {
              setEditingProduct(null);
              setShowModal(true);
            }}
            className={adminUi.btnPrimary}
          >
            <Plus className="w-4 h-4" />
            New product
          </button>
        </div>
      </div>

      {mode !== 'inactive' && (
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
                {searchTerm.trim() || categoryFilter || (mode !== 'inactive' && stockFilter !== 'all') ? (
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
      {mode !== 'inactive' && stockFilter !== 'all' && (
        <p className="text-xs text-slate-400 mb-2 font-semibold flex items-center gap-2">
          Showing only {stockFilter === 'low_stock' ? 'low stock' : 'out of stock'} products.
          <button type="button" onClick={() => setStockFilter('all')} className="text-teal-400 font-bold hover:underline">Show all catalog items</button>
        </p>
      )}

      {mode !== 'inactive' && (
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
        <div className="sticky top-2 z-20 mb-4 rounded-lg border border-[#E3E5E8] bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-[#E3E5E8]">
            <p className="text-sm text-[#1A1A1A]">
              <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full bg-black text-white text-xs font-medium mr-2">
                {selectedIds.size}
              </span>
              selected
            </p>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const ids = Array.from(selectedIds).slice(0, 50);
                  router.push(`/admin/products/labels?ids=${ids.map(encodeURIComponent).join(',')}`);
                }}
                className={adminUi.btnGhost}
              >
                <Printer className="w-3.5 h-3.5" />
                Print labels
              </button>
              <button type="button" onClick={handleExportSelected} className={adminUi.btnGhost}>
                <FileDown className="w-3.5 h-3.5" />
                Export
              </button>
              {mode === 'inactive' ? (
                <button type="button" onClick={handleBulkActivate} className={adminUi.btnSecondary}>
                  <RotateCcw className="w-3.5 h-3.5" />
                  Set on website
                </button>
              ) : (
                <button type="button" onClick={handleBulkDelete} className={adminUi.btnGhost}>
                  <Trash2 className="w-3.5 h-3.5" />
                  Deactivate
                </button>
              )}
              <button type="button" onClick={() => setSelectedIds(new Set())} className={adminUi.btnGhost}>
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3 px-4 py-3">
            <div className="min-w-[160px]">
              <label className={adminUi.label}>Category</label>
              <select
                value={bulkCategoryId}
                onChange={(e) => {
                  setBulkCategoryId(e.target.value);
                  setBulkSubId('');
                }}
                className={`${adminUi.field} mt-1`}
              >
                <option value="">Leave unchanged</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {titleCaseWords(c.name)}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[160px]">
              <label className={adminUi.label}>Tax type</label>
              <select
                value={bulkTaxTypeId}
                onChange={(e) => setBulkTaxTypeId(e.target.value)}
                className={`${adminUi.field} mt-1`}
              >
                <option value="">Leave unchanged</option>
                <option value="__no_tax__">No Tax</option>
                {taxTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {formatTaxTypeLabel(t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[180px]">
              <label className={adminUi.label}>Price group</label>
              <select
                value={bulkPriceGroupId}
                onChange={(e) => {
                  setBulkPriceGroupId(e.target.value);
                  if (e.target.value !== '__new__') setBulkPriceGroupName('');
                }}
                className={`${adminUi.field} mt-1`}
              >
                <option value="">Leave unchanged</option>
                <option value="__new__">+ New group</option>
                {priceGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {titleCaseWords(g.name)}
                  </option>
                ))}
              </select>
            </div>
            {bulkPriceGroupId === '__new__' && (
              <div className="min-w-[160px]">
                <label className={adminUi.label}>New group name</label>
                <input
                  type="text"
                  value={bulkPriceGroupName}
                  onChange={(e) => setBulkPriceGroupName(e.target.value)}
                  onBlur={() => setBulkPriceGroupName((n) => titleCaseWords(n))}
                  placeholder="Group name"
                  className={`${adminUi.field} mt-1`}
                />
              </div>
            )}
            <button
              type="button"
              disabled={
                bulkAssigning ||
                (!bulkCategoryId && !bulkTaxTypeId && !bulkPriceGroupId) ||
                (bulkPriceGroupId === '__new__' && !bulkPriceGroupName.trim())
              }
              onClick={handleBulkApply}
              className={adminUi.btnPrimary}
            >
              {bulkAssigning ? 'Applying…' : `Apply to ${selectedIds.size}`}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center h-64 items-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-teal-500 border-t-transparent" />
        </div>
      ) : (
        <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-x-auto">
          <table className="w-full text-xs font-semibold min-w-[1100px]">
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
                <th className="text-left py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">Tax</th>
                <th className="text-right py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">Stock</th>
                <th className="text-left py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">Product ID</th>
                <th className="text-left py-3.5 px-4 font-bold tracking-wider uppercase text-[10px]">SKU</th>
                <th className="text-center py-3.5 px-4 font-bold tracking-wider uppercase text-[10px] whitespace-nowrap">On website</th>
                <th className="text-right py-3.5 px-4 font-bold tracking-wider uppercase text-[10px] sticky right-0 bg-white min-w-[88px]">Actions</th>
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
                      <span className="font-bold text-[#1A1A1A] hover:text-[#0F9F8F] transition-colors">
                        {titleCaseWords(product.name)}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-[#6B6C72] font-semibold">
                    {product.category_name ? titleCaseWords(product.category_name) : '-'}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-slate-200">
                    ${parseFloat(product.price.toString()).toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-slate-350 font-semibold whitespace-nowrap">{productTaxLabel(product)}</td>
                  <td className="py-3 px-4 text-right">
                    <span className={product.stock_quantity <= 10 ? 'text-rose-400 font-black' : 'text-slate-200'}>
                      {product.stock_quantity}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-400 font-mono text-[10px] font-semibold">{product.product_id || '-'}</td>
                  <td className="py-3 px-4 text-slate-400 font-mono text-[10px]">{product.sku || '-'}</td>
                  <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                    <label className="inline-flex items-center justify-center cursor-pointer select-none">
                      <input
                        type="checkbox"
                        aria-label={`Show ${product.name} on website`}
                        className="rounded bg-slate-900 border-white/10 text-teal-500 focus:ring-teal-500 h-3.5 w-3.5 shrink-0 disabled:opacity-50"
                        checked={product.is_active !== false}
                        disabled={togglingId === String(product.id)}
                        onChange={(e) => {
                          const next = e.target.checked;
                          void handleWebsiteToggle(String(product.id), next);
                        }}
                      />
                    </label>
                  </td>
                  <td className="py-3 px-4 sticky right-0 bg-white" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end">
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
