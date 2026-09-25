'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FolderTree, Layers, Percent, CreditCard, Landmark, Plus, Edit, Trash2, X, FileDown, Package, ImagePlus, Loader2 } from 'lucide-react';
import adminApi, { uploadApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';

type TabId = 'categories' | 'subcategories' | 'tax' | 'payment' | 'bank';

interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  display_order?: number;
}

interface SubCategory {
  id: string;
  name: string;
  slug: string;
  category_id: string;
  category_name?: string;
  display_order?: number;
}

interface TaxType {
  id: string;
  name: string;
  rate: number;
  rate_type?: string;
}

interface PaymentMethod {
  id: string;
  name: string;
  display_order?: number;
}

interface BankAccount {
  id: string;
  name: string;
  account_number?: string;
}

interface Product {
  id: string;
  name: string;
  sku?: string;
  price?: number;
  category_id?: string;
  sub_category_id?: string;
  is_active?: boolean;
}

const TABS: { id: TabId; label: string; icon: typeof FolderTree }[] = [
  { id: 'categories', label: 'Categories', icon: FolderTree },
  { id: 'subcategories', label: 'Subcategories', icon: Layers },
  { id: 'tax', label: 'Tax Types', icon: Percent },
  { id: 'payment', label: 'Payment Methods', icon: CreditCard },
  { id: 'bank', label: 'Bank Accounts', icon: Landmark },
];

function isTabId(value: string | null): value is TabId {
  return !!value && TABS.some((t) => t.id === value);
}

function downloadCSV(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function CatalogPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const t = searchParams.get('tab');
    return isTabId(t) ? t : 'categories';
  });

  useEffect(() => {
    const t = searchParams.get('tab');
    if (isTabId(t)) setActiveTab(t);
  }, [searchParams]);

  const selectTab = (id: TabId) => {
    setActiveTab(id);
    router.replace(`/admin/catalog?tab=${id}`);
  };
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<SubCategory[]>([]);
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ type: TabId; edit?: any } | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
  const [selectedSubcategoryIds, setSelectedSubcategoryIds] = useState<Set<string>>(new Set());
  const [selectedTaxIds, setSelectedTaxIds] = useState<Set<string>>(new Set());
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<Set<string>>(new Set());
  const [selectedBankIds, setSelectedBankIds] = useState<Set<string>>(new Set());

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(null);
  const [productsInCategory, setProductsInCategory] = useState<Product[]>([]);
  const [productsInSubcategory, setProductsInSubcategory] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [addProductId, setAddProductId] = useState<string>('');
  const [addProductIdSub, setAddProductIdSub] = useState<string>('');

  const categoryImageInputRef = useRef<HTMLInputElement>(null);
  const categoryProductsRef = useRef<HTMLDivElement>(null);
  const subcategoryProductsRef = useRef<HTMLDivElement>(null);
  const [categoryImageBusy, setCategoryImageBusy] = useState(false);
  const [categoryImageDragging, setCategoryImageDragging] = useState(false);

  useEffect(() => {
    if (!modal || modal.type !== 'categories') {
      setCategoryImageDragging(false);
    }
  }, [modal]);

  const uploadCategoryImageFile = async (file?: File | null) => {
    if (!file || !file.type.startsWith('image/')) {
      toast.error('Please choose an image (JPEG, PNG, WebP, or GIF)');
      return;
    }
    setCategoryImageBusy(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await uploadApi.post('/categories/upload-image', fd);
      const url = res.data?.url || '';
      if (!url) throw new Error('No URL returned');
      setForm((f) => ({ ...f, image_url: url }));
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Upload failed');
    } finally {
      setCategoryImageBusy(false);
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

  const fetchSubcategories = async () => {
    try {
      const res = await adminApi.get('/sub-categories');
      setSubcategories(Array.isArray(res.data) ? res.data : []);
    } catch {
      setSubcategories([]);
    }
  };

  const fetchTaxTypes = async () => {
    try {
      const res = await adminApi.get('/tax-types');
      setTaxTypes(Array.isArray(res.data) ? res.data : []);
    } catch {
      setTaxTypes([]);
    }
  };

  const fetchPaymentMethods = async () => {
    try {
      const res = await adminApi.get('/payment-methods');
      setPaymentMethods(Array.isArray(res.data) ? res.data : []);
    } catch {
      setPaymentMethods([]);
    }
  };

  const fetchBankAccounts = async () => {
    try {
      const res = await adminApi.get('/bank-accounts/admin');
      setBankAccounts(Array.isArray(res.data) ? res.data : []);
    } catch {
      setBankAccounts([]);
    }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchCategories(), fetchSubcategories(), fetchTaxTypes(), fetchPaymentMethods(), fetchBankAccounts()]);
    setLoading(false);
  }, []);

  const fetchProductsByCategory = useCallback(async (categoryId: string) => {
    setProductsLoading(true);
    try {
      const res = await adminApi.get('/products', { params: { category_id: categoryId, limit: 2000, visibility: 'all' } });
      setProductsInCategory(res.data?.products || []);
    } catch {
      setProductsInCategory([]);
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const fetchProductsBySubcategory = useCallback(async (subcategoryId: string) => {
    setProductsLoading(true);
    try {
      const res = await adminApi.get('/products', { params: { sub_category_id: subcategoryId, limit: 500, visibility: 'all' } });
      setProductsInSubcategory(res.data?.products || []);
    } catch {
      setProductsInSubcategory([]);
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const fetchAllProducts = useCallback(async () => {
    try {
      const res = await adminApi.get('/products', { params: { limit: 2000, visibility: 'all' } });
      setAllProducts(res.data?.products || []);
    } catch {
      setAllProducts([]);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    fetchAllProducts();
  }, [fetchAll, fetchAllProducts]);

  useEffect(() => {
    if (selectedCategoryId) {
      fetchProductsByCategory(selectedCategoryId);
      fetchAllProducts();
    } else {
      setProductsInCategory([]);
    }
  }, [selectedCategoryId, fetchProductsByCategory, fetchAllProducts]);

  useEffect(() => {
    if (selectedSubcategoryId) {
      fetchProductsBySubcategory(selectedSubcategoryId);
      fetchAllProducts();
    } else {
      setProductsInSubcategory([]);
    }
  }, [selectedSubcategoryId, fetchProductsBySubcategory, fetchAllProducts]);

  useEffect(() => {
    if (!selectedCategoryId) return;
    const frame = window.requestAnimationFrame(() => {
      categoryProductsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedCategoryId]);

  useEffect(() => {
    if (!selectedSubcategoryId) return;
    const frame = window.requestAnimationFrame(() => {
      subcategoryProductsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedSubcategoryId]);

  const openAdd = (type: TabId) => {
    if (type === 'categories') setForm({ name: '', description: '', image_url: '' });
    if (type === 'subcategories') setForm({ name: '', category_id: categories[0]?.id || '', display_order: 0 });
    if (type === 'tax') setForm({ name: '', rate: '', rate_type: 'percent' });
    if (type === 'payment') setForm({ name: '' });
    if (type === 'bank') setForm({ name: '', account_number: '', account_number_confirm: '' });
    setModal({ type });
  };

  useEffect(() => {
    if (searchParams.get('create') !== '1') return;
    const t = searchParams.get('tab');
    const tab = isTabId(t) ? t : 'categories';
    openAdd(tab);
    router.replace(`/admin/catalog?tab=${tab}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openEdit = (type: TabId, row: any) => {
    if (type === 'tax') setForm({ ...row, rate: row.rate === 0 || row.rate ? String(row.rate) : '' });
    else if (type === 'bank') setForm({ ...row, account_number_confirm: row.account_number || '' });
    else setForm({ ...row });
    setModal({ type, edit: row });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    const { type, edit } = modal;
    try {
      if (type === 'categories') {
        const catPayload = {
          name: form.name,
          description: form.description,
          image_url: form.image_url || '',
          display_order: edit?.display_order ?? 0,
        };
        if (edit) await adminApi.put(`/categories/${edit.id}`, catPayload);
        else await adminApi.post('/categories', catPayload);
      }
      if (type === 'subcategories') {
        if (edit) await adminApi.put(`/sub-categories/${edit.id}`, { name: form.name, category_id: form.category_id, display_order: form.display_order });
        else await adminApi.post('/sub-categories', { name: form.name, category_id: form.category_id, display_order: form.display_order ?? 0 });
      }
      if (type === 'tax') {
        const rate = Number(form.rate);
        if (form.rate === '' || Number.isNaN(rate) || rate < 0) {
          toast.error('Enter a tax bracket percentage');
          return;
        }
        if (edit) await adminApi.put(`/tax-types/${edit.id}`, { name: form.name, rate, rate_type: form.rate_type || 'percent' });
        else await adminApi.post('/tax-types', { name: form.name, rate, rate_type: form.rate_type || 'percent' });
      }
      if (type === 'payment') {
        if (edit) await adminApi.put(`/payment-methods/${edit.id}`, { name: form.name, display_order: edit.display_order ?? 0 });
        else await adminApi.post('/payment-methods', { name: form.name, display_order: 0 });
      }
      if (type === 'bank') {
        const account = String(form.account_number || '').trim();
        const confirmAccount = String(form.account_number_confirm || '').trim();
        if (account && account !== confirmAccount) {
          toast.error('Bank account numbers do not match');
          return;
        }
        if (edit) await adminApi.put(`/bank-accounts/${edit.id}`, { name: form.name, account_number: account });
        else await adminApi.post('/bank-accounts', { name: form.name, account_number: account || undefined });
      }
      toast.success(edit ? 'Updated' : 'Created');
      setModal(null);
      fetchAll();
      if (selectedCategoryId) fetchProductsByCategory(selectedCategoryId);
      if (selectedSubcategoryId) fetchProductsBySubcategory(selectedSubcategoryId);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    }
  };

  const handleDelete = async (type: TabId, id: string) => {
    if (!confirm('Delete this item?')) return;
    try {
      if (type === 'categories') await adminApi.delete(`/categories/${id}`);
      if (type === 'subcategories') await adminApi.delete(`/sub-categories/${id}`);
      if (type === 'tax') await adminApi.delete(`/tax-types/${id}`);
      if (type === 'payment') await adminApi.delete(`/payment-methods/${id}`);
      if (type === 'bank') await adminApi.delete(`/bank-accounts/${id}`);
      toast.success('Deleted');
      fetchAll();
      if (type === 'categories' && selectedCategoryId === id) setSelectedCategoryId(null);
      if (type === 'subcategories' && selectedSubcategoryId === id) setSelectedSubcategoryId(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const toggleCategorySelect = (id: string) => {
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSubcategorySelect = (id: string) => {
    setSelectedSubcategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTaxSelect = (id: string) => {
    setSelectedTaxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllCategories = () => {
    if (selectedCategoryIds.size === categories.length) setSelectedCategoryIds(new Set());
    else setSelectedCategoryIds(new Set(categories.map((c) => c.id)));
  };

  const selectAllSubcategories = () => {
    if (selectedSubcategoryIds.size === subcategories.length) setSelectedSubcategoryIds(new Set());
    else setSelectedSubcategoryIds(new Set(subcategories.map((s) => s.id)));
  };

  const selectAllTax = () => {
    if (selectedTaxIds.size === taxTypes.length) setSelectedTaxIds(new Set());
    else setSelectedTaxIds(new Set(taxTypes.map((t) => t.id)));
  };

  const togglePaymentSelect = (id: string) => {
    setSelectedPaymentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllPayment = () => {
    if (selectedPaymentIds.size === paymentMethods.length) setSelectedPaymentIds(new Set());
    else setSelectedPaymentIds(new Set(paymentMethods.map((p) => p.id)));
  };

  const toggleBankSelect = (id: string) => {
    setSelectedBankIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllBank = () => {
    if (selectedBankIds.size === bankAccounts.length) setSelectedBankIds(new Set());
    else setSelectedBankIds(new Set(bankAccounts.map((b) => b.id)));
  };

  const handleBulkDeleteCategories = async () => {
    if (selectedCategoryIds.size === 0) {
      toast.error('Select at least one category');
      return;
    }
    if (!confirm(`Delete ${selectedCategoryIds.size} selected category(ies)? Products in these categories will be unassigned.`)) return;
    try {
      await adminApi.post('/categories/bulk-delete', { ids: Array.from(selectedCategoryIds) });
      toast.success('Categories deleted');
      setSelectedCategoryIds(new Set());
      if (selectedCategoryId && selectedCategoryIds.has(selectedCategoryId)) setSelectedCategoryId(null);
      fetchAll();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleBulkDeleteSubcategories = async () => {
    if (selectedSubcategoryIds.size === 0) {
      toast.error('Select at least one subcategory');
      return;
    }
    if (!confirm(`Delete ${selectedSubcategoryIds.size} selected subcategory(ies)?`)) return;
    try {
      await adminApi.post('/sub-categories/bulk-delete', { ids: Array.from(selectedSubcategoryIds) });
      toast.success('Subcategories deleted');
      setSelectedSubcategoryIds(new Set());
      if (selectedSubcategoryId && selectedSubcategoryIds.has(selectedSubcategoryId)) setSelectedSubcategoryId(null);
      fetchAll();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleBulkDeleteTax = async () => {
    if (selectedTaxIds.size === 0) {
      toast.error('Select at least one tax type');
      return;
    }
    if (!confirm(`Delete ${selectedTaxIds.size} selected tax type(s)?`)) return;
    try {
      for (const id of selectedTaxIds) await adminApi.delete(`/tax-types/${id}`);
      toast.success('Tax types deleted');
      setSelectedTaxIds(new Set());
      fetchAll();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const productCountForCategory = (categoryId: string, products = allProducts) =>
    products.filter((p) => String(p.category_id || '') === String(categoryId)).length;

  const handleExportCategoriesCSV = async () => {
    let products = allProducts;
    if (products.length === 0) {
      try {
        const res = await adminApi.get('/products', { params: { limit: 2000, visibility: 'all' } });
        products = res.data?.products || [];
        setAllProducts(products);
      } catch {
        products = [];
      }
    }
    const toExport = selectedCategoryIds.size > 0 ? categories.filter((c) => selectedCategoryIds.has(c.id)) : categories;
    const rows = [
      ['Name', 'Slug', 'Description', 'Product count'],
      ...toExport.map((c) => [c.name, c.slug, c.description || '', String(productCountForCategory(c.id, products))]),
    ];
    downloadCSV(`categories-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success('CSV downloaded');
  };

  const handleExportCategoryProductsCSV = () => {
    const cat = categories.find((c) => c.id === selectedCategoryId);
    if (!cat || productsInCategory.length === 0) {
      toast.error('No products to export for this category');
      return;
    }
    const rows = [
      ['Name', 'SKU', 'Price', 'Status'],
      ...productsInCategory.map((p) => [
        p.name,
        p.sku || '',
        p.price != null ? String(p.price) : '',
        p.is_active === false ? 'Inactive' : 'Active',
      ]),
    ];
    downloadCSV(`${cat.slug || 'category'}-products-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success('CSV downloaded');
  };

  const handleExportSubcategoriesCSV = () => {
    const toExport = selectedSubcategoryIds.size > 0 ? subcategories.filter((s) => selectedSubcategoryIds.has(s.id)) : subcategories;
    const rows = [['Name', 'Slug', 'Category', 'Display order'], ...toExport.map((s) => [s.name, s.slug, s.category_name || s.category_id || '', String(s.display_order ?? 0)])];
    downloadCSV(`subcategories-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success('CSV downloaded');
  };

  const handleExportTaxCSV = () => {
    const toExport = selectedTaxIds.size > 0 ? taxTypes.filter((t) => selectedTaxIds.has(t.id)) : taxTypes;
    const rows = [['Name', 'Rate type', 'Rate'], ...toExport.map((t) => [t.name, t.rate_type === 'amount' ? 'USD' : '%', String(t.rate)])];
    downloadCSV(`tax-types-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success('CSV downloaded');
  };

  const handleBulkDeletePayment = async () => {
    if (selectedPaymentIds.size === 0) {
      toast.error('Select at least one payment method');
      return;
    }
    if (!confirm(`Delete ${selectedPaymentIds.size} selected payment method(s)?`)) return;
    try {
      for (const id of selectedPaymentIds) await adminApi.delete(`/payment-methods/${id}`);
      toast.success('Payment methods deleted');
      setSelectedPaymentIds(new Set());
      fetchAll();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleExportPaymentCSV = () => {
    const toExport = selectedPaymentIds.size > 0 ? paymentMethods.filter((p) => selectedPaymentIds.has(p.id)) : paymentMethods;
    const rows = [['Name', 'Display order'], ...toExport.map((p) => [p.name, String(p.display_order ?? 0)])];
    downloadCSV(`payment-methods-${new Date().toISOString().slice(0, 15)}.csv`, rows);
    toast.success('CSV downloaded');
  };

  const handleBulkDeleteBank = async () => {
    if (selectedBankIds.size === 0) {
      toast.error('Select at least one bank account');
      return;
    }
    if (!confirm(`Delete ${selectedBankIds.size} selected bank account(s)?`)) return;
    try {
      for (const id of selectedBankIds) await adminApi.delete(`/bank-accounts/${id}`);
      toast.success('Bank accounts deleted');
      setSelectedBankIds(new Set());
      fetchAll();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleExportBankCSV = () => {
    const toExport = selectedBankIds.size > 0 ? bankAccounts.filter((b) => selectedBankIds.has(b.id)) : bankAccounts;
    const rows = [['Name', 'Account number'], ...toExport.map((b) => [b.name, b.account_number || ''])];
    downloadCSV(`bank-accounts-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success('CSV downloaded');
  };

  const removeProductFromCategory = async (productId: string) => {
    try {
      await adminApi.put(`/products/${productId}`, { category_id: null, sub_category_id: null });
      toast.success('Product removed from category');
      if (selectedCategoryId) fetchProductsByCategory(selectedCategoryId);
      fetchAllProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  };

  const addProductToCategory = async () => {
    if (!selectedCategoryId || !addProductId) return;
    try {
      await adminApi.put(`/products/${addProductId}`, { category_id: selectedCategoryId, sub_category_id: null });
      toast.success('Product added to category');
      setAddProductId('');
      fetchProductsByCategory(selectedCategoryId);
      fetchAllProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  };

  const removeProductFromSubcategory = async (productId: string) => {
    try {
      await adminApi.put(`/products/${productId}`, { sub_category_id: null });
      toast.success('Product removed from subcategory');
      if (selectedSubcategoryId) fetchProductsBySubcategory(selectedSubcategoryId);
      fetchAllProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  };

  const addProductToSubcategory = async () => {
    if (!selectedSubcategoryId || !addProductIdSub) return;
    try {
      const sub = subcategories.find((s) => s.id === selectedSubcategoryId);
      await adminApi.put(`/products/${addProductIdSub}`, { sub_category_id: selectedSubcategoryId, category_id: sub?.category_id || undefined });
      toast.success('Product added to subcategory');
      setAddProductIdSub('');
      fetchProductsBySubcategory(selectedSubcategoryId);
      fetchAllProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  };

  const productsNotInCategory = allProducts.filter((p) => p.category_id !== selectedCategoryId);
  const productsNotInSubcategory = allProducts.filter((p) => p.sub_category_id !== selectedSubcategoryId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-normal text-[#1A1A1A] tracking-tight">Catalog</h1>
          <p className="text-xs text-slate-400 mt-1">Configure retail tax rate brackets, homepage category carousels, sub-categories, dynamic payment gates, and store bank accounts.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5 mt-6 border-b border-white/5 pb-4">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isAct = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all ${
                isAct
                  ? 'bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white shadow-sm'
                  : 'bg-slate-905/60 border border-white/10 text-slate-400 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl overflow-hidden">
            {activeTab === 'categories' && (
              <div className="p-6 space-y-4">
                <div className="flex flex-wrap justify-between items-center gap-4 border-b border-white/5 pb-3">
                  <div>
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Product Categories</h2>
                    <p className="text-[10px] text-slate-400 mt-1.5 max-w-2xl font-medium">
                      The homepage catalog wheel renders the initial 7 categories. Add a high-resolution wheel thumbnail inside the metadata popup.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openAdd('categories')} className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                      <Plus className="w-4 h-4" /> Add Category
                    </button>
                    <button onClick={handleBulkDeleteCategories} disabled={selectedCategoryIds.size === 0} className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-rose-450 hover:bg-rose-500/10 border border-rose-500/20 text-xs font-bold transition-all disabled:opacity-40 disabled:bg-transparent disabled:border-white/5">
                      Delete Selected ({selectedCategoryIds.size})
                    </button>
                    <button onClick={handleExportCategoriesCSV} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-slate-350 bg-slate-800 border border-white/5 hover:text-white text-xs font-bold transition-all">
                      <FileDown className="w-3.5 h-3.5" /> Export CSV
                    </button>
                  </div>
                </div>
                <div className="grid lg:grid-cols-2 gap-4 items-start">
                <div className="max-h-[min(70vh,640px)] overflow-auto border border-white/5 rounded-xl">
                  <table className="w-full border-collapse">
                    <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5 sticky top-0 z-10">
                      <tr>
                        <th className="w-10 py-3.5 px-4 text-center">
                          <input type="checkbox" checked={categories.length > 0 && selectedCategoryIds.size === categories.length} onChange={selectAllCategories} className="rounded border-white/10 bg-slate-950 text-teal-600 focus:ring-0 focus:ring-offset-0" />
                        </th>
                        <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider w-16">Wheel Image</th>
                        <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Category Name</th>
                        <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Slug Token</th>
                        <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map((c) => (
                        <tr
                          key={c.id}
                          className={`border-b border-white/5 hover:bg-white/[0.04] cursor-pointer transition-colors ${selectedCategoryId === c.id ? 'bg-teal-500/20 ring-2 ring-inset ring-teal-400/70' : ''}`}
                          onClick={() => setSelectedCategoryId(c.id)}
                        >
                          <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selectedCategoryIds.has(c.id)} onChange={() => toggleCategorySelect(c.id)} className="rounded border-white/10 bg-slate-950 text-teal-600 focus:ring-0 focus:ring-offset-0" />
                          </td>
                          <td className="py-2 px-4" onClick={(e) => e.stopPropagation()}>
                            {c.image_url ? (
                              <img src={c.image_url} alt="" className="h-10 w-10 rounded-xl object-cover border border-white/10 shadow-sm bg-slate-950/40" />
                            ) : (
                              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-white/10 bg-slate-950/40 text-[9px] font-mono text-slate-500">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-205">{c.name}</td>
                          <td className="py-3 px-4 text-xs font-mono text-slate-400">{c.slug}</td>
                          <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEdit('categories', c)} className="p-2 text-teal-450 hover:bg-teal-500/10 rounded-xl transition-all" title="Edit">
                                <Edit className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDelete('categories', c.id)} className="p-2 text-rose-450 hover:bg-rose-500/10 rounded-xl transition-all" title="Delete">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {categories.length === 0 && <p className="text-center py-16 text-slate-500 text-xs font-semibold">No categories registered yet.</p>}
                </div>
                <div ref={categoryProductsRef} className="lg:sticky lg:top-0 border border-white/10 rounded-xl bg-slate-950/40 p-4 space-y-4 min-h-[280px]">
                  {selectedCategoryId ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                          <Package className="w-4 h-4 text-teal-400" />
                          Products in {categories.find((c) => c.id === selectedCategoryId)?.name}
                        </h3>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={handleExportCategoryProductsCSV}
                            disabled={productsLoading || productsInCategory.length === 0}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-slate-350 bg-slate-800 border border-white/5 hover:text-white text-[11px] font-bold transition-all disabled:opacity-40"
                          >
                            <FileDown className="w-3.5 h-3.5" /> Export products
                          </button>
                          <button type="button" onClick={() => setSelectedCategoryId(null)} className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg" aria-label="Close products">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-300 font-medium">
                        {productsLoading ? 'Loading products…' : `${productsInCategory.length} product${productsInCategory.length === 1 ? '' : 's'} in this category.`}
                      </p>
                      <div className="flex flex-wrap gap-2.5 items-center">
                        <select value={addProductId} onChange={(e) => setAddProductId(e.target.value)} className="bg-slate-955/65 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-250 focus:outline-none min-w-[200px] font-semibold">
                          <option value="">Select product to assign...</option>
                          {productsNotInCategory.map((p) => (
                            <option key={p.id} value={p.id}>{p.name} {p.sku ? `(${p.sku})` : ''}</option>
                          ))}
                        </select>
                        <button onClick={addProductToCategory} disabled={!addProductId} className="inline-flex items-center justify-center px-4 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 border border-white/10 text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-40">
                          Link Product
                        </button>
                      </div>
                      {productsLoading ? (
                        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-2 border-teal-500 border-t-transparent" /></div>
                      ) : (
                        <div className="overflow-x-auto border border-white/5 rounded-xl bg-slate-950/20 max-h-[min(52vh,480px)] overflow-y-auto">
                          <table className="w-full border-collapse text-xs">
                            <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5 sticky top-0">
                              <tr>
                                <th className="text-left py-2.5 px-4 text-[9px] font-bold uppercase tracking-wider">Product Name</th>
                                <th className="text-left py-2.5 px-4 text-[9px] font-bold uppercase tracking-wider font-mono">SKU</th>
                                <th className="text-right py-2.5 px-4 text-[9px] font-bold uppercase tracking-wider font-mono">Price</th>
                                <th className="text-right py-2.5 px-4 text-[9px] font-bold uppercase tracking-wider w-28">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {productsInCategory.map((p) => (
                                <tr key={p.id} className="border-t border-white/5 hover:bg-white/[0.01]">
                                  <td className="py-2.5 px-4 font-semibold text-slate-205">
                                    <span className="inline-flex flex-wrap items-center gap-2">
                                      {p.name}
                                      {p.is_active === false && (
                                        <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">Inactive</span>
                                      )}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 font-mono text-slate-400">{p.sku || '—'}</td>
                                  <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-200">${p.price != null ? Number(p.price).toLocaleString(undefined, {minimumFractionDigits: 2}) : '—'}</td>
                                  <td className="py-2.5 px-4 text-right">
                                    <button onClick={() => removeProductFromCategory(p.id)} className="text-rose-450 hover:text-rose-350 hover:underline font-bold text-[11px] transition-all">Remove</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {!productsLoading && productsInCategory.length === 0 && <p className="text-slate-500 text-xs py-4 text-center bg-slate-955/20 rounded-xl font-medium">No products in this category yet.</p>}
                    </>
                  ) : (
                    <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center px-6">
                      <Package className="w-8 h-8 text-teal-400 mb-3" />
                      <p className="text-sm font-semibold text-white">Click a category to see its products</p>
                      <p className="text-xs text-slate-400 mt-1.5">The product list opens here immediately — no need to scroll the category table.</p>
                    </div>
                  )}
                </div>
                </div>
              </div>
            )}

            {activeTab === 'subcategories' && (
              <div className="p-6 space-y-4">
                <div className="flex flex-wrap justify-between items-center gap-4 border-b border-white/5 pb-3">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Subcategories</h2>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openAdd('subcategories')} className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                      <Plus className="w-4 h-4" /> Add Subcategory
                    </button>
                    <button onClick={handleBulkDeleteSubcategories} disabled={selectedSubcategoryIds.size === 0} className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-rose-455 hover:bg-rose-500/10 border border-rose-500/20 text-xs font-bold transition-all disabled:opacity-40 disabled:bg-transparent disabled:border-white/5">
                      Delete Selected ({selectedSubcategoryIds.size})
                    </button>
                    <button onClick={handleExportSubcategoriesCSV} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-slate-350 bg-slate-800 border border-white/5 hover:text-white text-xs font-bold transition-all">
                      <FileDown className="w-3.5 h-3.5" /> Export CSV
                    </button>
                  </div>
                </div>
                <div className="grid lg:grid-cols-2 gap-4 items-start">
                <div className="max-h-[min(70vh,640px)] overflow-auto border border-white/5 rounded-xl">
                  <table className="w-full border-collapse">
                    <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5 sticky top-0 z-10">
                      <tr>
                        <th className="w-10 py-3.5 px-4 text-center">
                          <input type="checkbox" checked={subcategories.length > 0 && selectedSubcategoryIds.size === subcategories.length} onChange={selectAllSubcategories} className="rounded border-white/10 bg-slate-950 text-teal-600 focus:ring-0 focus:ring-offset-0" />
                        </th>
                        <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Subcategory Name</th>
                        <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Parent Category ID</th>
                        <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subcategories.map((s) => (
                        <tr
                          key={s.id}
                          className={`border-b border-white/5 hover:bg-white/[0.04] cursor-pointer transition-colors ${selectedSubcategoryId === s.id ? 'bg-teal-500/20 ring-2 ring-inset ring-teal-400/70' : ''}`}
                          onClick={() => setSelectedSubcategoryId(s.id)}
                        >
                          <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selectedSubcategoryIds.has(s.id)} onChange={() => toggleSubcategorySelect(s.id)} className="rounded border-white/10 bg-slate-950 text-teal-600 focus:ring-0 focus:ring-offset-0" />
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-205">{s.name}</td>
                          <td className="py-3 px-4 text-xs font-mono text-slate-400">{s.category_name || s.category_id}</td>
                          <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEdit('subcategories', s)} className="p-2 text-teal-450 hover:bg-teal-500/10 rounded-xl transition-all" title="Edit">
                                <Edit className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDelete('subcategories', s.id)} className="p-2 text-rose-455 hover:bg-rose-500/10 rounded-xl transition-all" title="Delete">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {subcategories.length === 0 && <p className="text-center py-16 text-slate-500 text-xs font-semibold">No sub-categories registered yet.</p>}
                </div>
                <div ref={subcategoryProductsRef} className="lg:sticky lg:top-0 border border-white/10 rounded-xl bg-slate-950/40 p-4 space-y-4 min-h-[280px]">
                  {selectedSubcategoryId ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                          <Package className="w-4 h-4 text-teal-400" />
                          Products in {subcategories.find((s) => s.id === selectedSubcategoryId)?.name}
                        </h3>
                        <button type="button" onClick={() => setSelectedSubcategoryId(null)} className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg" aria-label="Close products">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-300 font-medium">
                        {productsLoading ? 'Loading products…' : `${productsInSubcategory.length} product${productsInSubcategory.length === 1 ? '' : 's'} in this subcategory.`}
                      </p>
                      <div className="flex flex-wrap gap-2.5 items-center">
                        <select value={addProductIdSub} onChange={(e) => setAddProductIdSub(e.target.value)} className="bg-slate-955/65 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-250 focus:outline-none min-w-[200px] font-semibold">
                          <option value="">Select product to assign...</option>
                          {productsNotInSubcategory.map((p) => (
                            <option key={p.id} value={p.id}>{p.name} {p.sku ? `(${p.sku})` : ''}</option>
                          ))}
                        </select>
                        <button onClick={addProductToSubcategory} disabled={!addProductIdSub} className="inline-flex items-center justify-center px-4 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 border border-white/10 text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-40">
                          Link Product
                        </button>
                      </div>
                      {productsLoading ? (
                        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-2 border-teal-500 border-t-transparent" /></div>
                      ) : (
                        <div className="overflow-x-auto border border-white/5 rounded-xl bg-slate-950/20 max-h-[min(52vh,480px)] overflow-y-auto">
                          <table className="w-full border-collapse text-xs">
                            <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5 sticky top-0">
                              <tr>
                                <th className="text-left py-2.5 px-4 text-[9px] font-bold uppercase tracking-wider">Product Name</th>
                                <th className="text-left py-2.5 px-4 text-[9px] font-bold uppercase tracking-wider font-mono">SKU</th>
                                <th className="text-right py-2.5 px-4 text-[9px] font-bold uppercase tracking-wider font-mono">Price</th>
                                <th className="text-right py-2.5 px-4 text-[9px] font-bold uppercase tracking-wider w-28">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {productsInSubcategory.map((p) => (
                                <tr key={p.id} className="border-t border-white/5 hover:bg-white/[0.01]">
                                  <td className="py-2.5 px-4 font-semibold text-slate-205">
                                    <span className="inline-flex flex-wrap items-center gap-2">
                                      {p.name}
                                      {p.is_active === false && (
                                        <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">Inactive</span>
                                      )}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 font-mono text-slate-400">{p.sku || '—'}</td>
                                  <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-200">${p.price != null ? Number(p.price).toLocaleString(undefined, {minimumFractionDigits: 2}) : '—'}</td>
                                  <td className="py-2.5 px-4 text-right">
                                    <button onClick={() => removeProductFromSubcategory(p.id)} className="text-rose-455 hover:text-rose-350 hover:underline font-bold text-[11px] transition-all">Remove</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {!productsLoading && productsInSubcategory.length === 0 && <p className="text-slate-500 text-xs py-4 text-center bg-slate-955/20 rounded-xl font-medium">No products in this subcategory yet.</p>}
                    </>
                  ) : (
                    <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center px-6">
                      <Package className="w-8 h-8 text-teal-400 mb-3" />
                      <p className="text-sm font-semibold text-white">Click a subcategory to see its products</p>
                      <p className="text-xs text-slate-400 mt-1.5">The product list opens here immediately — no need to scroll the subcategory table.</p>
                    </div>
                  )}
                </div>
                </div>
              </div>
            )}

            {activeTab === 'tax' && (
              <div className="p-6 space-y-4">
                <div className="flex flex-wrap justify-between items-center gap-4 border-b border-white/5 pb-3">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Tax Brackets</h2>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openAdd('tax')} className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                      <Plus className="w-4 h-4" /> Add Tax Bracket/Type
                    </button>
                    <button onClick={handleBulkDeleteTax} disabled={selectedTaxIds.size === 0} className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-rose-455 hover:bg-rose-500/10 border border-rose-500/20 text-xs font-bold transition-all disabled:opacity-40 disabled:bg-transparent disabled:border-white/5">
                      Delete Selected ({selectedTaxIds.size})
                    </button>
                    <button onClick={handleExportTaxCSV} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-slate-350 bg-slate-800 border border-white/5 hover:text-white text-xs font-bold transition-all">
                      <FileDown className="w-3.5 h-3.5" /> Export CSV
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                      <tr>
                        <th className="w-10 py-3.5 px-4 text-center">
                          <input type="checkbox" checked={taxTypes.length > 0 && selectedTaxIds.size === taxTypes.length} onChange={selectAllTax} className="rounded border-white/10 bg-slate-950 text-teal-600 focus:ring-0 focus:ring-offset-0" />
                        </th>
                        <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Tax Type / Formula Title</th>
                        <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Flat / Percentage Value</th>
                        <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxTypes.map((t) => (
                        <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 px-4 text-center">
                            <input type="checkbox" checked={selectedTaxIds.has(t.id)} onChange={() => toggleTaxSelect(t.id)} className="rounded border-white/10 bg-slate-950 text-teal-600 focus:ring-0 focus:ring-offset-0" />
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-205">{t.name}</td>
                          <td className="py-3 px-4 text-right text-xs font-mono font-bold text-slate-300">{t.rate_type === 'amount' ? `$${Number(t.rate).toFixed(2)}` : `${t.rate}%`}</td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEdit('tax', t)} className="p-2 text-teal-450 hover:bg-teal-500/10 rounded-xl transition-all" title="Edit">
                                <Edit className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDelete('tax', t.id)} className="p-2 text-rose-455 hover:bg-rose-500/10 rounded-xl transition-all" title="Delete">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {taxTypes.length === 0 && <p className="text-center py-16 text-slate-500 text-xs font-semibold">No tax types registered yet.</p>}
              </div>
            )}

            {activeTab === 'payment' && (
              <div className="p-6 space-y-4">
                <div className="flex flex-wrap justify-between items-center gap-4 border-b border-white/5 pb-3">
                  <div>
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Payment Tenders</h2>
                    <p className="text-[10px] text-slate-400 mt-1 max-w-2xl font-medium">Configure active payment methods used on manual invoice receipt closures.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openAdd('payment')} className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                      <Plus className="w-4 h-4" /> Add Payment Title
                    </button>
                    <button onClick={handleBulkDeletePayment} disabled={selectedPaymentIds.size === 0} className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-rose-455 hover:bg-rose-500/10 border border-rose-500/20 text-xs font-bold transition-all disabled:opacity-40 disabled:bg-transparent disabled:border-white/5">
                      Delete Selected ({selectedPaymentIds.size})
                    </button>
                    <button onClick={handleExportPaymentCSV} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-slate-350 bg-slate-800 border border-white/5 hover:text-white text-xs font-bold transition-all">
                      <FileDown className="w-3.5 h-3.5" /> Export CSV
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                      <tr>
                        <th className="w-10 py-3.5 px-4 text-center">
                          <input type="checkbox" checked={paymentMethods.length > 0 && selectedPaymentIds.size === paymentMethods.length} onChange={selectAllPayment} className="rounded border-white/10 bg-slate-950 text-teal-600 focus:ring-0 focus:ring-offset-0" />
                        </th>
                        <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Method Name</th>
                        <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentMethods.map((p) => (
                        <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 px-4 text-center">
                            <input type="checkbox" checked={selectedPaymentIds.has(p.id)} onChange={() => togglePaymentSelect(p.id)} className="rounded border-white/10 bg-slate-950 text-teal-600 focus:ring-0 focus:ring-offset-0" />
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-205">{p.name}</td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEdit('payment', p)} className="p-2 text-teal-450 hover:bg-teal-500/10 rounded-xl transition-all" title="Edit">
                                <Edit className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDelete('payment', p.id)} className="p-2 text-rose-455 hover:bg-rose-500/10 rounded-xl transition-all" title="Delete">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {paymentMethods.length === 0 && <p className="text-center py-16 text-slate-500 text-xs font-semibold">No payment systems registered yet.</p>}
              </div>
            )}

            {activeTab === 'bank' && (
              <div className="p-6 space-y-4">
                <div className="flex flex-wrap justify-between items-center gap-4 border-b border-white/5 pb-3">
                  <div>
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Deposit Bank Accounts</h2>
                    <p className="text-[10px] text-slate-400 mt-1 max-w-2xl font-medium">Setup bank accounts where card clearances, check deposits and bulk wires are reconciled.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openAdd('bank')} className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                      <Plus className="w-4 h-4" /> Add Bank Account
                    </button>
                    <button onClick={handleBulkDeleteBank} disabled={selectedBankIds.size === 0} className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-rose-455 hover:bg-rose-500/10 border border-rose-500/20 text-xs font-bold transition-all disabled:opacity-40 disabled:bg-transparent disabled:border-white/5">
                      Delete Selected ({selectedBankIds.size})
                    </button>
                    <button onClick={handleExportBankCSV} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-slate-350 bg-slate-800 border border-white/5 hover:text-white text-xs font-bold transition-all">
                      <FileDown className="w-3.5 h-3.5" /> Export CSV
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                      <tr>
                        <th className="w-10 py-3.5 px-4 text-center">
                          <input type="checkbox" checked={bankAccounts.length > 0 && selectedBankIds.size === bankAccounts.length} onChange={selectAllBank} className="rounded border-white/10 bg-slate-950 text-teal-600 focus:ring-0 focus:ring-offset-0" />
                        </th>
                        <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Account Title / Bank</th>
                        <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider font-mono">Routing / Account number</th>
                        <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankAccounts.map((b) => (
                        <tr key={b.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 px-4 text-center">
                            <input type="checkbox" checked={selectedBankIds.has(b.id)} onChange={() => toggleBankSelect(b.id)} className="rounded border-white/10 bg-slate-950 text-teal-600 focus:ring-0 focus:ring-offset-0" />
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-205">{b.name}</td>
                          <td className="py-3 px-4 text-xs font-mono text-slate-400">{b.account_number || '—'}</td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEdit('bank', b)} className="p-2 text-teal-450 hover:bg-teal-500/10 rounded-xl transition-all" title="Edit">
                                <Edit className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDelete('bank', b.id)} className="p-2 text-rose-455 hover:bg-rose-500/10 rounded-xl transition-all" title="Delete">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {bankAccounts.length === 0 && <p className="text-center py-16 text-slate-500 text-xs font-semibold">No bank accounts registered yet.</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-slate-955/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <h2 className="text-md font-bold text-white uppercase tracking-wider">
                {modal.edit ? 'Edit' : 'Add'} {TABS.find((t) => t.id === modal!.type)?.label}
              </h2>
              <button type="button" onClick={() => setModal(null)} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
              {modal.type === 'categories' && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Category Name *</label>
                    <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" required />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Description</label>
                    <input type="text" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" placeholder="Description summary token" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Homepage Wheel Thumbnail</label>
                    <p className="text-[10px] text-slate-500 mb-2 font-medium">Upload png/webp artwork. Appears in the storefront carousel catalog circles.</p>
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (!categoryImageBusy) categoryImageInputRef.current?.click();
                        }
                      }}
                      className={`rounded-2xl border-2 border-dashed p-6 text-center transition-all bg-slate-955/40 outline-none focus-visible:ring-1 focus-visible:ring-teal-500 ${
                        categoryImageDragging ? 'border-teal-500 bg-teal-500/5' : 'border-white/10 hover:border-teal-500/40 hover:bg-slate-950/10'
                      } ${categoryImageBusy ? 'pointer-events-none opacity-50' : ''}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setCategoryImageDragging(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setCategoryImageDragging(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setCategoryImageDragging(false);
                        const f = e.dataTransfer.files?.[0];
                        void uploadCategoryImageFile(f);
                      }}
                      onClick={() => {
                        if (!categoryImageBusy) categoryImageInputRef.current?.click();
                      }}
                    >
                      <input
                        ref={categoryImageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          void uploadCategoryImageFile(f);
                          e.target.value = '';
                        }}
                      />
                      {categoryImageBusy ? (
                        <Loader2 className="w-8 h-8 mx-auto animate-spin text-teal-400" aria-hidden />
                      ) : (
                        <>
                          <ImagePlus className="w-8 h-8 mx-auto text-slate-500 mb-2" aria-hidden />
                          <p className="text-xs text-slate-350 font-bold">Drop artwork file here or click to browse</p>
                          <p className="text-[10px] text-slate-500 mt-1 font-medium">Replaces alphabet circle placeholder on landing</p>
                        </>
                      )}
                    </div>
                    {form.image_url ? (
                      <div className="mt-3.5 flex items-start gap-3.5">
                        <img src={form.image_url} alt="Category preview" className="h-24 w-24 object-cover rounded-xl border border-white/10 shadow-sm bg-slate-950/40" />
                        <button
                          type="button"
                          className="text-xs text-rose-450 hover:text-rose-405 font-bold transition-colors"
                          onClick={() => setForm((f) => ({ ...f, image_url: '' }))}
                        >
                          Remove Artwork
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
              {modal.type === 'subcategories' && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Subcategory Name *</label>
                    <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" required />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Parent Category *</label>
                    <select value={form.category_id || ''} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none font-semibold" required>
                      <option value="">Select category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    {categories.length === 0 && <p className="text-xs text-amber-400 mt-1 font-semibold">Please register a parent category first.</p>}
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Display order</label>
                    <input type="number" min={0} value={form.display_order ?? 0} onChange={(e) => setForm({ ...form, display_order: parseInt(e.target.value, 10) || 0 })} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none font-mono font-bold" />
                  </div>
                </>
              )}
              {modal.type === 'tax' && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Tax Type Name *</label>
                    <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" placeholder="e.g. VAT, GST" required />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Tax Ratio Type</label>
                    <select value={form.rate_type || 'percent'} onChange={(e) => setForm({ ...form, rate_type: e.target.value })} className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none font-semibold">
                      <option value="percent">Percentage (%)</option>
                      <option value="amount">Fixed Flat Surcharge (USD)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{form.rate_type === 'amount' ? 'Flat Dollar Surcharge *' : 'Tax Bracket Percentage *'}</label>
                    <input type="number" min={0} step={0.01} value={form.rate ?? ''} onChange={(e) => setForm({ ...form, rate: e.target.value })} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none font-mono font-bold" placeholder="e.g. 8.25" required />
                  </div>
                </>
              )}
              {modal.type === 'payment' && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Tender Method Name *</label>
                    <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" placeholder="e.g. Cheque, Card, Swift Bank Transfer" required />
                  </div>
                </>
              )}
              {modal.type === 'bank' && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Bank Account Name *</label>
                    <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" placeholder="e.g. Vault Savings, Checking" required />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Account Number</label>
                    <input type="text" autoComplete="off" value={form.account_number || ''} onChange={(e) => setForm({ ...form, account_number: e.target.value })} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none font-mono" placeholder="Account designation number" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Re-enter bank account number</label>
                    <input type="text" autoComplete="off" value={form.account_number_confirm || ''} onChange={(e) => setForm({ ...form, account_number_confirm: e.target.value })} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none font-mono" placeholder="Type the account number again" />
                  </div>
                </>
              )}
              <div className="flex gap-2.5 pt-4 border-t border-white/5">
                <button type="submit" className="flex-1 bg-gradient-to-tr from-teal-600 to-teal-500 border border-white/10 hover:from-teal-500 hover:to-teal-400 text-white py-2.5 rounded-xl font-bold text-xs transition-colors shadow-sm">Save Parameters</button>
                <button type="button" onClick={() => setModal(null)} className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
