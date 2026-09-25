'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Image as ImageIcon, Loader2 } from 'lucide-react';
import adminApi, { uploadApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface Category {
  id: string | number;
  name: string;
}

interface SubCategory {
  id: string | number;
  name: string;
  category_id: string;
}

export default function NewProductPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: '',
    sku: '',
    description: '',
    image_url: '',
    selling_price: '',
    cost_price: '',
    category_id: '',
    sub_category_id: '',
    stock_quantity: '0',
    low_stock_threshold: '10',
  });
  const [marginPct, setMarginPct] = useState('');
  const [marginUsd, setMarginUsd] = useState('');

  useEffect(() => {
    adminApi
      .get('/categories')
      .then((r) => setCategories(Array.isArray(r.data) ? r.data : []))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (form.category_id) {
      adminApi
        .get(`/sub-categories?category_id=${form.category_id}`)
        .then((r) => setSubCategories(Array.isArray(r.data) ? r.data : []))
        .catch(() => setSubCategories([]));
      setForm((f) => ({ ...f, sub_category_id: '' }));
    } else {
      setSubCategories([]);
    }
  }, [form.category_id]);

  const handleImageUpload = async (file: File) => {
    if (!file?.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5MB');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const { data } = await uploadApi.post<{ url: string }>('/upload/image', fd);
      setForm((f) => ({ ...f, image_url: data.url }));
      setImagePreview(data.url);
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Product name is required');
      return;
    }
    const selling = parseFloat(form.selling_price);
    if (isNaN(selling) || selling < 0) {
      toast.error('Enter a valid selling price');
      return;
    }
    setLoading(true);
    try {
      await adminApi.post('/products', {
        name: form.name.trim(),
        description: form.description || undefined,
        sku: form.sku.trim() || undefined,
        image_url: form.image_url || undefined,
        price: selling,
        cost_price: form.cost_price !== '' ? parseFloat(form.cost_price) : undefined,
        category_id: form.category_id || undefined,
        sub_category_id: form.sub_category_id || undefined,
        stock_quantity: parseInt(form.stock_quantity, 10) || 0,
        low_stock_threshold: parseInt(form.low_stock_threshold, 10) || 10,
      });
      toast.success('Product added. It will appear on the website in the selected category.');
      router.push('/admin/products');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add product');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/admin/products" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to Products
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Add New Product</h1>
      <p className="text-gray-600 mb-6">
        Product will appear on the website in the chosen category. A 5-digit Product ID is auto-generated on save. SKU is your barcode/UPC.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow border border-gray-200 p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Product name *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">SKU / Barcode (UPC)</label>
          <input
            type="text"
            value={form.sku}
            onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
            placeholder="Scan or type barcode / vendor SKU"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono"
          />
          <p className="text-xs text-gray-500 mt-1">Product ID (5 digits) is created automatically when you save.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Product image (drag & drop or click)</label>
          <div
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) handleImageUpload(f);
            }}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-[#0F9F8F] cursor-pointer transition-colors"
          >
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }} />
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-10 h-10 text-[#0F9F8F] animate-spin" />
                <p className="text-sm text-gray-600">Uploading...</p>
              </div>
            ) : imagePreview ? (
              <div className="space-y-2">
                <img src={imagePreview} alt="Preview" className="max-w-full max-h-48 mx-auto rounded-lg object-cover" />
                <p className="text-sm text-gray-500">Click or drag to change</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <ImageIcon className="w-12 h-12 text-gray-400" />
                <p className="text-sm text-gray-600">Drag and drop an image here, or click to choose</p>
                <p className="text-xs text-gray-500">PNG, JPG, GIF up to 5MB</p>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Selling price (USD) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.selling_price}
              onChange={(e) => { setForm((f) => ({ ...f, selling_price: e.target.value })); setMarginPct(''); setMarginUsd(''); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cost price (admin only, not on website)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.cost_price}
              onChange={(e) => { setForm((f) => ({ ...f, cost_price: e.target.value })); setMarginPct(''); setMarginUsd(''); }}
              placeholder="Optional"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
        </div>

        {parseFloat(form.cost_price) > 0 && (() => {
          const costVal = parseFloat(form.cost_price) || 0;
          const sellVal = parseFloat(form.selling_price) || 0;
          const autoMarginPct = costVal > 0 && sellVal > 0 ? ((sellVal - costVal) / sellVal) * 100 : null;
          const autoMarginUsd = costVal > 0 && sellVal > 0 ? sellVal - costVal : null;
          return (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-700">Margin calculator</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Margin (%)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={marginPct}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMarginPct(val);
                      setMarginUsd('');
                      const pct = parseFloat(val);
                      if (!isNaN(pct) && pct < 100 && costVal > 0) {
                        setForm((f) => ({ ...f, selling_price: String(Math.round((costVal / (1 - pct / 100)) * 100) / 100) }));
                      }
                    }}
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
                    onChange={(e) => {
                      const val = e.target.value;
                      setMarginUsd(val);
                      setMarginPct('');
                      const usd = parseFloat(val);
                      if (!isNaN(usd) && costVal > 0) {
                        setForm((f) => ({ ...f, selling_price: String(Math.round((costVal + usd) * 100) / 100) }));
                      }
                    }}
                    placeholder={autoMarginUsd != null ? autoMarginUsd.toFixed(2) : 'e.g. 5.00'}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-[#0F9F8F] focus:border-[#0F9F8F]"
                  />
                </div>
              </div>
              {autoMarginPct != null && (
                <p className="text-xs text-gray-600">
                  Current margin: <span className="font-semibold text-gray-900">${autoMarginUsd!.toFixed(2)}</span> ({autoMarginPct.toFixed(1)}%)
                </p>
              )}
              <p className="text-xs text-gray-500">Type a margin % or $ — the selling price updates automatically. Edit selling price directly to see the calculated margin.</p>
            </div>
          );
        })()}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category (product appears here on website)</label>
          <select
            value={form.category_id}
            onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
          >
            <option value="">Select category</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Subcategory intentionally hidden in UI; still supported by API if set elsewhere */}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stock quantity</label>
            <input
              type="number"
              min="0"
              value={form.stock_quantity}
              onChange={(e) => setForm((f) => ({ ...f, stock_quantity: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Low stock threshold</label>
            <input
              type="number"
              min="0"
              value={form.low_stock_threshold}
              onChange={(e) => setForm((f) => ({ ...f, low_stock_threshold: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 rounded-lg text-white font-medium bg-[#0F9F8F] hover:bg-[#0B8275] disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Add Product'}
          </button>
          <Link href="/admin/products" className="px-6 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
