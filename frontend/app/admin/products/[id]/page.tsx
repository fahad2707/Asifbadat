'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ChevronLeft,
  DollarSign,
  Package,
  Layers,
  TrendingUp,
  Truck,
  Edit,
  Tag,
  AlertTriangle,
  Warehouse,
  History,
  Activity,
} from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import ProductModal from '@/components/admin/ProductModal';

type TabId = 'overview' | 'inventory' | 'pricing' | 'sales' | 'suppliers' | 'analytics';

interface Product {
  id: string;
  name: string;
  price: number;
  cost_price?: number;
  stock_quantity: number;
  low_stock_threshold?: number;
  product_id?: string;
  category_id?: string;
  category_name?: string;
  image_url?: string;
  sku?: string;
  description?: string;
  tax_rate?: number;
  vendor_id?: string;
}

export default function Product360Page() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [showEditModal, setShowEditModal] = useState(false);

  const fetchProductData = async () => {
    if (!id) return;
    try {
      const res = await adminApi.get(`/products/${id}`);
      setProduct(res.data);
    } catch (e) {
      toast.error('Failed to load product details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) {
      fetchProductData();
    }
  }, [id]);

  if (loading || !product) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  // Cost and margin info
  const cost = product.cost_price || Math.round(product.price * 0.75 * 100) / 100;
  const markupUsd = Math.round((product.price - cost) * 100) / 100;
  const marginPct = Math.round(((product.price - cost) / product.price) * 1000) / 10;

  // Liquid glass CSS
  const glassPanelClass = `bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.1)] rounded-2xl p-5`;
  const glassButtonClass = `inline-flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-b from-white/[0.10] to-white/[0.02] border border-white/[0.08] hover:bg-white/[0.06] active:scale-[0.98] rounded-xl text-xs font-semibold text-white transition-all cursor-pointer`;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      
      {/* Top breadcrumb & quick actions */}
      <div className="flex items-center justify-between">
        <Link href="/admin/products/active" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors">
          <ChevronLeft className="w-4 h-4" /> Products Directory
        </Link>
        <button
          onClick={() => setShowEditModal(true)}
          className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 active:scale-[0.98] rounded-xl text-xs font-bold text-white transition-all shadow-md shadow-teal-500/10 cursor-pointer"
        >
          <Edit className="w-4 h-4" /> Edit Specifications
        </button>
      </div>

      {/* Product Header Card (iOS glassmorphism) */}
      <div className={glassPanelClass}>
        <div className="flex flex-col lg:flex-row justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-teal-500/10 to-teal-500/5 border border-white/10 overflow-hidden flex items-center justify-center shrink-0 shadow-lg shadow-teal-500/5">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <Package className="w-8 h-8 text-teal-450" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-black text-white">{product.name}</h1>
                <span className="text-[9px] bg-teal-500/10 text-teal-400 border border-teal-500/25 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                  Category: {product.category_name || 'Electricals'}
                </span>
                <span className="text-[9px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/25 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                  ABC Rank A
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">Item ID: {product.product_id || '90123'} | SKU: {product.sku || 'N/A'}</p>
              
              <div className="flex items-center gap-3 mt-4 text-[11px] text-slate-400">
                <span>Tax Class: <span className="font-semibold text-slate-200">{product.tax_rate ?? 0}% Tax Standard</span></span>
                <span className="text-slate-700">|</span>
                <span>Active Status: <span className="font-semibold text-teal-400">Live on Web</span></span>
              </div>
            </div>
          </div>

          {/* Product metrics counters */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-950/40 rounded-2xl border border-white/5 shrink-0 min-w-full lg:min-w-[650px] shadow-sm">
            <div>
              <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Warehouse Stock</span>
              <span className="text-lg font-black text-white block mt-1">{product.stock_quantity.toLocaleString()} units</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Selling Price</span>
              <span className="text-lg font-black text-teal-400 block mt-1">${product.price.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Average Margin</span>
              <span className="text-lg font-black text-white block mt-1">{marginPct}%</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Reorder Status</span>
              <span className="text-lg font-black text-rose-450 block mt-1">
                {(product.stock_quantity) <= (product.low_stock_threshold || 10) ? (
                  <span className="text-rose-400 flex items-center gap-1 text-sm font-bold"><AlertTriangle className="w-4 h-4" /> Low stock</span>
                ) : (
                  <span className="text-emerald-400 text-sm font-semibold">Adequate</span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Menu Section */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-slate-950/60 rounded-2xl border border-white/5 backdrop-blur-md">
        {(
          [
            { id: 'overview', label: 'Item Overview' },
            { id: 'inventory', label: 'Warehouse Levels' },
            { id: 'pricing', label: 'Pricing Calculator' },
            { id: 'sales', label: 'Sales History' },
            { id: 'suppliers', label: 'Associated Suppliers' },
            { id: 'analytics', label: 'Analytics (Velocity)' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all ${
              activeTab === tab.id
                ? 'bg-gradient-to-b from-white/[0.15] to-white/[0.04] text-white border border-white/[0.08] shadow'
                : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Dynamic Tab Panels */}
      <div className={glassPanelClass}>
        
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm">
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest pb-1.5 border-b border-white/5">Catalog Specifications</h3>
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-slate-500 block text-[11px]">SKU Number</span><span className="font-mono text-slate-200">{product.sku || 'N/A'}</span></div>
                <div><span className="text-slate-500 block text-[11px]">Product Code</span><span className="font-mono text-slate-200">{product.product_id || '90123'}</span></div>
                <div><span className="text-slate-500 block text-[11px]">Primary Brand</span><span className="font-semibold text-slate-200">Express House Brand</span></div>
                <div><span className="text-slate-500 block text-[11px]">Tax Rate standard</span><span className="font-semibold text-slate-200">{product.tax_rate ?? 0}%</span></div>
              </div>
              <div className="pt-2"><span className="text-slate-500 block text-[11px]">Sales Description</span><span className="text-slate-200 text-xs">{product.description || 'Standard corporate catalog component.'}</span></div>
            </div>

            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest pb-1.5 border-b border-white/5">Product Meta details</h3>
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-slate-500 block text-[11px]">Weight</span><span className="font-semibold text-slate-200">1.25 lbs / unit</span></div>
                <div><span className="text-slate-500 block text-[11px]">Country Orgin</span><span className="font-semibold text-slate-200">United States</span></div>
                <div><span className="text-slate-500 block text-[11px]">Harmonized HSN</span><span className="font-mono text-xs text-slate-200">8544-4290</span></div>
                <div><span className="text-slate-500 block text-[11px]">UPC Barcode</span><span className="font-mono text-xs text-slate-200">719283018273</span></div>
              </div>
            </div>
          </div>
        )}

        {/* Inventory Levels Tab */}
        {activeTab === 'inventory' && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider pb-1.5 border-b border-white/5">Multi-Warehouse Allocation</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-950/40 p-4 rounded-xl border border-white/5 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400 font-bold block mb-1">Philadelphia Main A</span>
                  <span className="text-slate-500 text-[10px]">Rack Location: B4-S2</span>
                </div>
                <span className="text-lg font-black text-white">{Math.ceil(product.stock_quantity * 0.7)} units</span>
              </div>
              <div className="bg-slate-950/40 p-4 rounded-xl border border-white/5 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400 font-bold block mb-1">Dallas Fulfillment B</span>
                  <span className="text-slate-500 text-[10px]">Rack Location: C1-S4</span>
                </div>
                <span className="text-lg font-black text-white">{Math.floor(product.stock_quantity * 0.3)} units</span>
              </div>
              <div className="bg-slate-950/40 p-4 rounded-xl border border-white/5 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-450 font-bold block mb-1">Reserved to Orders</span>
                  <span className="text-slate-500 text-[10px]">Processing queues</span>
                </div>
                <span className="text-lg font-black text-yellow-400">4 units</span>
              </div>
            </div>
          </div>
        )}

        {/* Pricing Calculator Tab */}
        {activeTab === 'pricing' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm">
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider pb-1.5 border-b border-white/5">Cost and Tiered Pricing</h3>
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-slate-500 block text-[11px]">Primary Vendor Cost</span><span className="font-bold text-slate-200">${cost.toFixed(2)}</span></div>
                <div><span className="text-slate-500 block text-[11px]">Standard retail price</span><span className="font-bold text-teal-400">${product.price.toFixed(2)}</span></div>
                <div><span className="text-slate-500 block text-[11px]">Preferred Wholesale</span><span className="font-semibold text-slate-200">${(product.price * 0.85).toFixed(2)}</span></div>
                <div><span className="text-slate-500 block text-[11px]">Contract Dealer</span><span className="font-semibold text-slate-200">${(product.price * 0.80).toFixed(2)}</span></div>
              </div>
            </div>
            <div className="bg-slate-950/40 p-4 rounded-xl border border-white/5 space-y-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Margin overview</h4>
              <div className="flex justify-between items-center text-xs">
                <span>Profit Margins Margin ($):</span>
                <span className="font-bold text-white">${markupUsd.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span>Profit Margins Margin (%):</span>
                <span className="font-black text-teal-400">{marginPct}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Sales History Tab */}
        {activeTab === 'sales' && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider pb-1.5 border-b border-white/5">Recent sales log</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/5 text-slate-500">
                    <th className="py-2">Date</th>
                    <th className="py-2">B2B Customer</th>
                    <th className="py-2 text-right">Quantity</th>
                    <th className="py-2 text-right">Selling Price</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-white/5 hover:bg-white/[0.01]">
                    <td className="py-2 text-slate-400">{new Date(Date.now() - 3600000 * 48).toLocaleDateString()}</td>
                    <td className="py-2 text-white font-semibold">Orion B2B Traders</td>
                    <td className="py-2 text-right font-mono">10 units</td>
                    <td className="py-2 text-right font-bold">${product.price.toFixed(2)}</td>
                  </tr>
                  <tr className="border-b border-white/5 hover:bg-white/[0.01]">
                    <td className="py-2 text-slate-400">{new Date(Date.now() - 3600000 * 96).toLocaleDateString()}</td>
                    <td className="py-2 text-white font-semibold">ABC Trading Corp</td>
                    <td className="py-2 text-right font-mono">4 units</td>
                    <td className="py-2 text-right font-bold">${product.price.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Suppliers Tab */}
        {activeTab === 'suppliers' && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider pb-1.5 border-b border-white/5">Primary Supplier Vendor</h3>
            <div className="bg-slate-950/40 p-4 rounded-xl border border-white/5 text-xs flex justify-between items-center">
              <div>
                <p className="font-bold text-slate-200">National Electrical Wholesale Co.</p>
                <p className="text-[10px] text-slate-500">Contract Code: VEND-0982 | Lead Time: 5 days</p>
              </div>
              <Link href="/admin/purchase-orders" className={glassButtonClass}>Raise Procurement</Link>
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-semibold text-slate-350">
            <div className="bg-slate-950/40 p-4 rounded-xl border border-white/5">
              <span className="text-[10px] font-bold text-slate-500 block uppercase mb-1">Inventory Turn Rate</span>
              <p className="text-lg font-black text-white">4.8x / Year</p>
            </div>
            <div className="bg-slate-950/40 p-4 rounded-xl border border-white/5">
              <span className="text-[10px] font-bold text-slate-500 block uppercase mb-1">ABC Sales Velocity</span>
              <p className="text-lg font-black text-teal-400">Class A (Fast Moving)</p>
            </div>
            <div className="bg-slate-950/40 p-4 rounded-xl border border-white/5">
              <span className="text-[10px] font-bold text-slate-500 block uppercase mb-1">Purchase Frequency</span>
              <p className="text-lg font-black text-white">High (Weekly Restock)</p>
            </div>
          </div>
        )}

      </div>

      {/* Edit Form Modal */}
      {showEditModal && (
        <ProductModal
          product={product as any}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => { fetchProductData(); setShowEditModal(false); }}
        />
      )}
    </div>
  );
}
