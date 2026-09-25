'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Upload, Image as ImageIcon, Loader2 } from 'lucide-react';
import adminApi, { uploadApi } from '@/lib/admin-api';
import { formatApiError } from '@/lib/format-api-error';
import toast from 'react-hot-toast';

const ADD_CATEGORY = '__add_category__';
const ADD_SUB = '__add_sub__';
const ADD_TAX = '__add_tax__';
const ADD_VENDOR = '__add_vendor__';

interface Product {
  id?: string | number;
  name: string;
  description?: string;
  price: number;
  cost_price?: number;
  category_id?: string | number;
  sub_category_id?: string | number;
  vendor_id?: string | number;
  tax_rate?: number;
  image_url?: string;
  product_id?: string;
  sku?: string;
  stock_quantity: number;
  low_stock_threshold: number;
}

interface Category {
  id: string | number;
  name: string;
  slug?: string;
}

interface SubCategory {
  id: string | number;
  name: string;
  category_id: string;
  category_name?: string;
}

interface TaxType {
  id: string | number;
  name: string;
  rate: number;
}

interface Vendor {
  id: string | number;
  name: string;
}

interface ProductModalProps {
  product: Product | null;
  onClose: () => void;
  onSuccess: () => void;
}

function AddCategoryModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string, name: string) => void }) {
  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const handleImageUpload = async (file?: File | null) => {
    if (!file || !file.type.startsWith('image/')) {
      toast.error('Please use an image file');
      return;
    }
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append('image', file);
      const response = await uploadApi.post('/categories/upload-image', form);
      setImageUrl(response.data?.url || '');
      toast.success('Category image uploaded');
    } catch (err: unknown) {
      toast.error(formatApiError(err, 'Failed to upload category image'));
    } finally {
      setUploadingImage(false);
    }
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const { data } = await adminApi.post('/categories', {
        name: name.trim(),
        image_url: imageUrl || undefined,
      });
      onSaved(data.id, data.name);
      onClose();
      toast.success('Category added');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add category');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white border border-[#E2E8F0] text-[#0F172A] rounded-lg max-w-sm w-full p-6">
        <h3 className="text-sm font-semibold text-[#0F172A] mb-4">+ Add new category</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Category name"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4"
            autoFocus
          />
          <div className="mb-4">
            <label className="block text-sm text-gray-700 mb-1">Homepage wheel image (optional)</label>
            <p className="text-xs text-gray-500 mb-2">Drag and drop here or click to browse.</p>
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!uploadingImage) fileRef.current?.click();
                }
              }}
              className={`rounded-xl border-2 border-dashed p-4 text-center text-sm transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#0F9F8F] ${
                dragging ? 'border-[#0F9F8F] bg-teal-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400'
              } ${uploadingImage ? 'pointer-events-none opacity-60' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void handleImageUpload(e.dataTransfer.files?.[0]);
              }}
              onClick={() => !uploadingImage && fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => {
                  void handleImageUpload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {uploadingImage ? (
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-gray-500" />
              ) : (
                <>
                  <ImageIcon className="w-8 h-8 mx-auto text-gray-400 mb-1" />
                  <span className="text-gray-600">Drop image or click to upload</span>
                </>
              )}
            </div>
            {imageUrl && (
              <div className="mt-2 flex items-start gap-2">
                <img src={imageUrl} alt="Category preview" className="w-full max-h-28 object-cover rounded-lg border border-gray-200" />
                <button type="button" className="text-xs text-red-600 shrink-0" onClick={() => setImageUrl('')}>
                  Clear
                </button>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-white border border-[#CBD5E1] text-[#334155] hover:bg-[#F1F5F9] rounded-md text-sm font-medium">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-[#0F9F8F] hover:bg-[#0B8275] border border-white/10 text-white rounded-xl text-xs font-bold disabled:opacity-[0.40]">Add Category</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddSubCategoryModal({ categoryId, categoryName, onClose, onSaved }: { categoryId: string; categoryName: string; onClose: () => void; onSaved: (id: string, name: string) => void }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const { data } = await adminApi.post('/sub-categories', { name: name.trim(), category_id: categoryId });
      onSaved(data.id, data.name);
      onClose();
      toast.success('Sub-category added');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add sub-category');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white border border-[#E2E8F0] text-[#0F172A] rounded-lg max-w-sm w-full p-6">
        <h3 className="text-sm font-black text-white mb-1">+ Add new sub-category</h3>
        <p className="text-xs text-slate-400 mb-4">Under: {categoryName}</p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sub-category name"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-white border border-[#CBD5E1] text-[#334155] hover:bg-[#F1F5F9] rounded-md text-sm font-medium">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-[#0F9F8F] hover:bg-[#0B8275] border border-white/10 text-white rounded-xl text-xs font-bold disabled:opacity-[0.40]">Add Sub-category</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddTaxTypeModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string, name: string, rate: number, rate_type: string) => void }) {
  const [name, setName] = useState('');
  const [rateType, setRateType] = useState<'percent' | 'amount'>('percent');
  const [rate, setRate] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const r = parseFloat(rate);
    if (isNaN(r) || r < 0) return;
    setLoading(true);
    try {
      const { data } = await adminApi.post('/tax-types', { name: name.trim(), rate: r, rate_type: rateType });
      onSaved(data.id, data.name, data.rate, data.rate_type || 'percent');
      onClose();
      toast.success('Tax type added');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add tax type');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white border border-[#E2E8F0] text-[#0F172A] rounded-lg max-w-sm w-full p-6">
        <h3 className="text-sm font-semibold text-[#0F172A] mb-4">+ Add tax type</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. GST, VAT"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-3"
            autoFocus
          />
          <select value={rateType} onChange={(e) => setRateType(e.target.value as 'percent' | 'amount')} className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-3">
            <option value="percent">Rate in %</option>
            <option value="amount">Fixed amount (USD)</option>
          </select>
          <input
            type="number"
            step="0.01"
            min="0"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder={rateType === 'percent' ? 'Rate %' : 'Amount (USD)'}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-white border border-[#CBD5E1] text-[#334155] hover:bg-[#F1F5F9] rounded-md text-sm font-medium">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-[#0F9F8F] hover:bg-[#0B8275] border border-white/10 text-white rounded-xl text-xs font-bold disabled:opacity-[0.40]">Add Tax Type</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddVendorModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string, name: string) => void }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const { data } = await adminApi.post('/vendors', { name: name.trim() });
      onSaved(data.id, data.name);
      onClose();
      toast.success('Supplier added');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add supplier');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white border border-[#E2E8F0] text-[#0F172A] rounded-lg max-w-sm w-full p-6">
        <h3 className="text-sm font-semibold text-[#0F172A] mb-4">+ Add new supplier</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Supplier name"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-white border border-[#CBD5E1] text-[#334155] hover:bg-[#F1F5F9] rounded-md text-sm font-medium">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-[#0F9F8F] hover:bg-[#0B8275] border border-white/10 text-white rounded-xl text-xs font-bold disabled:opacity-[0.40]">Add Supplier</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProductModal({ product, onClose, onSuccess }: ProductModalProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [formData, setFormData] = useState<Partial<Product>>({
    name: '',
    description: '',
    price: undefined as number | undefined,
    cost_price: undefined,
    category_id: undefined,
    sub_category_id: undefined,
    vendor_id: undefined,
    tax_rate: 0,
    image_url: '',
    product_id: '',
    sku: '',
    stock_quantity: 0,
    low_stock_threshold: 10,
  });
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAddSub, setShowAddSub] = useState(false);
  const [showAddTax, setShowAddTax] = useState(false);
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [marginPct, setMarginPct] = useState<string>('');
  const [marginUsd, setMarginUsd] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Defensive: never call .map/.find on a non-array (e.g. error object from a bad response).
  const categoryList = Array.isArray(categories) ? categories : [];
  const taxTypeList = Array.isArray(taxTypes) ? taxTypes : [];
  const vendorList = Array.isArray(vendors) ? vendors : [];

  const fetchCategories = async () => {
    try {
      const response = await adminApi.get('/categories');
      setCategories(Array.isArray(response.data) ? response.data : []);
    } catch {
      setCategories([]);
      toast.error('Failed to load categories');
    }
  };
  const fetchSubCategories = async (categoryId?: string) => {
    try {
      const url = categoryId ? `/sub-categories?category_id=${categoryId}` : '/sub-categories';
      const response = await adminApi.get(url);
      setSubCategories(Array.isArray(response.data) ? response.data : []);
    } catch {
      setSubCategories([]);
    }
  };
  const fetchTaxTypes = async () => {
    try {
      const response = await adminApi.get('/tax-types');
      setTaxTypes(Array.isArray(response.data) ? response.data : []);
    } catch {
      setTaxTypes([]);
      toast.error('Failed to load tax types');
    }
  };
  const fetchVendors = async () => {
    try {
      const response = await adminApi.get('/vendors');
      const d = response.data;
      const list = Array.isArray(d?.vendors) ? d.vendors : Array.isArray(d) ? d : [];
      setVendors(list);
    } catch {
      setVendors([]);
      toast.error('Failed to load vendors');
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchTaxTypes();
    fetchVendors();
  }, []);

  useEffect(() => {
    if (formData.category_id) {
      fetchSubCategories(String(formData.category_id));
    } else {
      setSubCategories([]);
      setFormData((f) => ({ ...f, sub_category_id: undefined }));
    }
  }, [formData.category_id]);

  useEffect(() => {
    if (product) {
      setFormData({
        ...product,
        price: product.price,
        tax_rate: product.tax_rate ?? 0,
      });
      if (product.image_url) setImagePreview(product.image_url);
    }
  }, [product]);

  const handleCategoryChange = (value: string) => {
    if (value === ADD_CATEGORY) {
      setShowAddCategory(true);
      return;
    }
    setFormData({ ...formData, category_id: value || undefined, sub_category_id: undefined });
  };

  const handleSubChange = (value: string) => {
    if (value === ADD_SUB) {
      setShowAddSub(true);
      return;
    }
    setFormData({ ...formData, sub_category_id: value || undefined });
  };

  const handleTaxChange = (value: string) => {
    if (value === ADD_TAX) {
      setShowAddTax(true);
      return;
    }
    const tax = taxTypeList.find((t) => String(t.id) === value);
    setFormData({ ...formData, tax_rate: tax ? tax.rate : 0 });
  };

  const handleVendorChange = (value: string) => {
    if (value === ADD_VENDOR) {
      setShowAddVendor(true);
      return;
    }
    setFormData({ ...formData, vendor_id: value || undefined });
  };

  const handleImageUpload = async (file: File) => {
    if (!file?.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size must be less than 5MB');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('image', file);
      const response = await uploadApi.post('/upload/image', form);
      const imageUrl = response.data.url;
      setFormData((f) => ({ ...f, image_url: imageUrl }));
      setImagePreview(imageUrl);
      toast.success('Image uploaded');
    } catch (err: unknown) {
      toast.error(formatApiError(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { ...formData, price: Number(formData.price) || 0 };
      delete (payload as { product_id?: string }).product_id;
      if (product?.id) {
        const { data } = await adminApi.put(`/products/${product.id}`, payload);
        const assigned = data?.product_id ? String(data.product_id) : '';
        if (assigned) {
          setFormData((f) => ({ ...f, product_id: assigned }));
        }
        toast.success(assigned ? `Product updated (ID ${assigned})` : 'Product updated');
      } else {
        const { data } = await adminApi.post('/products', payload);
        const assigned = data?.product_id ? String(data.product_id) : '';
        if (assigned) {
          setFormData((f) => ({ ...f, product_id: assigned }));
        }
        toast.success(assigned ? `Product created (ID ${assigned})` : 'Product created');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save product');
    } finally {
      setLoading(false);
    }
  };

  const selectedCategoryName = formData.category_id
    ? categoryList.find((c) => String(c.id) === String(formData.category_id))?.name
    : '';

  const costVal = Number(formData.cost_price) || 0;
  const sellVal = Number(formData.price) || 0;
  const autoMarginPct = costVal > 0 && sellVal > 0 ? (((sellVal - costVal) / sellVal) * 100) : null;
  const autoMarginUsd = costVal > 0 && sellVal > 0 ? (sellVal - costVal) : null;

  const handleMarginPctChange = (val: string) => {
    setMarginPct(val);
    setMarginUsd('');
    const pct = parseFloat(val);
    if (!isNaN(pct) && pct < 100 && costVal > 0) {
      const suggested = Math.round((costVal / (1 - pct / 100)) * 100) / 100;
      setFormData((f) => ({ ...f, price: suggested }));
    }
  };

  const handleMarginUsdChange = (val: string) => {
    setMarginUsd(val);
    setMarginPct('');
    const usd = parseFloat(val);
    if (!isNaN(usd) && costVal > 0) {
      const suggested = Math.round((costVal + usd) * 100) / 100;
      setFormData((f) => ({ ...f, price: suggested }));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-[#E2E8F0] text-[#0F172A] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-lg font-semibold text-[#0F172A]">{product?.id ? 'Edit Product Specification' : 'Create Catalog Product'}</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-md border border-[#CBD5E1] text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">SKU / Barcode (scan or type UPC)</label>
            <input
              type="text"
              value={formData.sku ?? ''}
              onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              placeholder="Scan barcode or enter vendor SKU / UPC"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Product ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.product_id ?? ''}
                readOnly
                placeholder={
                  formData.product_id
                    ? ''
                    : product?.id
                      ? 'Click Update to assign a permanent ID'
                      : 'Auto-generated on save'
                }
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 font-mono"
              />
              {!formData.product_id && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const { data } = await adminApi.get('/products/generate-id');
                      setFormData((prev) => ({ ...prev, product_id: data.product_id || data.item_id || '' }));
                      toast('Preview only — save the product to lock this ID', { icon: 'ℹ️' });
                    } catch {
                      toast.error('Failed to generate Product ID');
                    }
                  }}
                  className="px-4 py-2 rounded-lg font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300 whitespace-nowrap"
                >
                  Preview ID
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">5-digit unique ID — permanent once saved. Shown on the website and used in POS.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Product Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Selling price (USD) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.price === undefined ? '' : formData.price}
                onChange={(e) => { setFormData({ ...formData, price: e.target.value === '' ? undefined : parseFloat(e.target.value) }); setMarginPct(''); setMarginUsd(''); }}
                placeholder="Enter amount"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Cost price (admin only, not on website)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.cost_price ?? ''}
                onChange={(e) => { setFormData({ ...formData, cost_price: e.target.value === '' ? undefined : parseFloat(e.target.value) }); setMarginPct(''); setMarginUsd(''); }}
                placeholder="Optional"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          {costVal > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-700">Margin calculator</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Margin (%)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={marginPct}
                    onChange={(e) => handleMarginPctChange(e.target.value)}
                    placeholder={autoMarginPct != null ? autoMarginPct.toFixed(1) : 'e.g. 20'}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-[#0F9F8F] focus:border-[#0F9F8F]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Margin ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={marginUsd}
                    onChange={(e) => handleMarginUsdChange(e.target.value)}
                    placeholder={autoMarginUsd != null ? autoMarginUsd.toFixed(2) : 'e.g. 5.00'}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-[#0F9F8F] focus:border-[#0F9F8F]"
                  />
                </div>
              </div>
              {autoMarginPct != null && (
                <p className="text-xs text-gray-600">
                  Current margin: <span className="font-semibold text-gray-900">${autoMarginUsd!.toFixed(2)}</span> ({autoMarginPct.toFixed(1)}%)
                  {sellVal > 0 && costVal > 0 && <span className="ml-2 text-gray-500">· Cost ${costVal.toFixed(2)} → Sell ${sellVal.toFixed(2)}</span>}
                </p>
              )}
              <p className="text-xs text-gray-500">Type a margin % or $ amount — the selling price updates automatically. Edit selling price directly to see the margin.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Category (product appears here on website)</label>
            <select
              value={formData.category_id === undefined ? '' : formData.category_id}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select category</option>
              <option value={ADD_CATEGORY}>+ Add new category</option>
              {categoryList.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Sub-category hidden from UI; still supported by API */}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tax type</label>
              <select
                value={taxTypeList.find((t) => t.rate === formData.tax_rate)?.id ?? ''}
                onChange={(e) => handleTaxChange(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">No tax</option>
                <option value={ADD_TAX}>+ Add tax type</option>
                {taxTypeList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.rate}%)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Supplier</label>
              <select
                value={formData.vendor_id === undefined ? '' : formData.vendor_id}
                onChange={(e) => handleVendorChange(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select supplier</option>
                <option value={ADD_VENDOR}>+ Add new supplier</option>
                {vendorList.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Stock Quantity *</label>
              <input
                type="number"
                min="0"
                value={formData.stock_quantity}
                onChange={(e) => setFormData({ ...formData, stock_quantity: parseInt(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Low Stock Threshold</label>
              <input
                type="number"
                min="0"
                value={formData.low_stock_threshold}
                onChange={(e) => setFormData({ ...formData, low_stock_threshold: parseInt(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Product Image</label>
            <div
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImageUpload(f); }}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-primary-500 cursor-pointer"
            >
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }} />
              {uploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
                  <p className="text-sm text-gray-600">Uploading...</p>
                </div>
              ) : imagePreview ? (
                <div className="space-y-2">
                  <img src={imagePreview} alt="Preview" className="max-w-full max-h-48 mx-auto rounded-lg object-cover" />
                  <p className="text-sm text-gray-600">Click or drag to change</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <ImageIcon className="w-12 h-12 text-gray-400" />
                  <p className="text-sm text-gray-600">Click to upload or drag and drop</p>
                  <p className="text-xs text-gray-500">PNG, JPG, GIF up to 5MB</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 bg-white border border-[#CBD5E1] text-[#334155] hover:bg-[#F1F5F9] rounded-md text-sm font-medium">Cancel</button>
            <button type="submit" disabled={loading || uploading} className="px-6 py-2 bg-[#0F9F8F] hover:bg-[#0B8275] border border-white/10 text-white rounded-xl text-xs font-bold disabled:opacity-[0.40]">
              {loading ? 'Saving specs…' : product?.id ? 'Update specification' : 'Create product'}
            </button>
          </div>
        </form>
      </div>

      {showAddCategory && (
        <AddCategoryModal
          onClose={() => setShowAddCategory(false)}
          onSaved={(id) => {
            fetchCategories();
            setFormData((f) => ({ ...f, category_id: id }));
            setShowAddCategory(false);
          }}
        />
      )}
      {showAddSub && formData.category_id && (
        <AddSubCategoryModal
          categoryId={String(formData.category_id)}
          categoryName={selectedCategoryName || 'Category'}
          onClose={() => setShowAddSub(false)}
          onSaved={(id) => {
            fetchSubCategories(String(formData.category_id));
            setFormData((f) => ({ ...f, sub_category_id: id }));
            setShowAddSub(false);
          }}
        />
      )}
      {showAddTax && (
        <AddTaxTypeModal
          onClose={() => setShowAddTax(false)}
          onSaved={(id, _name, rate) => {
            fetchTaxTypes();
            setFormData((f) => ({ ...f, tax_rate: rate }));
            setShowAddTax(false);
          }}
        />
      )}
      {showAddVendor && (
        <AddVendorModal
          onClose={() => setShowAddVendor(false)}
          onSaved={(id) => {
            fetchVendors();
            setFormData((f) => ({ ...f, vendor_id: id }));
            setShowAddVendor(false);
          }}
        />
      )}
    </div>
  );
}
