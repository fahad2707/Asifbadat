'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Package, Edit, AlertTriangle } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import ProductModal from '@/components/admin/ProductModal';
import { productTaxLabel } from '@/lib/tax-type';

type TabId = 'overview' | 'inventory' | 'pricing' | 'sales' | 'suppliers' | 'analytics';

interface Product {
  id: string;
  name: string;
  price: number;
  cost_price?: number | null;
  stock_quantity: number;
  committed_quantity?: number;
  available_quantity?: number;
  low_stock_threshold?: number;
  reorder_point?: number;
  product_id?: string;
  category_id?: string;
  category_name?: string;
  image_url?: string;
  sku?: string;
  description?: string;
  tax_rate?: number;
  tax_type_id?: string | null;
  tax_type_configured?: boolean;
  tax_type_label?: string;
  vendor_id?: string;
  is_active?: boolean;
}

interface ProductActivity {
  vendor: { id: string; name: string; phone?: string | null; email?: string | null; supplier_id?: string | null } | null;
  sales: Array<{
    date: string;
    customer_name: string;
    quantity: number;
    price: number;
    source: string;
    document: string;
  }>;
  customer_prices: Array<{
    customer_id: string;
    customer_name: string;
    price: number;
    last_invoice_date: string | null;
  }>;
  price_groups: Array<{ id: string; name: string }>;
}

export default function Product360Page() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [activity, setActivity] = useState<ProductActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [showEditModal, setShowEditModal] = useState(false);
  const [generatingSku, setGeneratingSku] = useState(false);

  const fetchProductData = async () => {
    if (!id) return;
    try {
      const [res, act] = await Promise.all([
        adminApi.get(`/products/${id}`),
        adminApi.get(`/products/${id}/activity`).catch(() => ({ data: null })),
      ]);
      setProduct(res.data);
      setActivity(act.data || { vendor: null, sales: [], customer_prices: [], price_groups: [] });
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

  const cost = product.cost_price != null && Number(product.cost_price) > 0 ? Number(product.cost_price) : null;
  const markupUsd = cost != null ? Math.round((product.price - cost) * 100) / 100 : null;
  const marginPct =
    cost != null && product.price > 0 ? Math.round(((product.price - cost) / product.price) * 1000) / 10 : null;
  const threshold = product.low_stock_threshold ?? product.reorder_point ?? 10;
  const onHand = product.stock_quantity ?? 0;
  const committed = product.committed_quantity ?? 0;
  const available = product.available_quantity ?? Math.max(0, onHand - committed);
  const reorderLabel = onHand <= 0 ? 'Out of stock' : onHand <= threshold ? 'Low stock' : 'In stock';
  const unitsSold = (activity?.sales || []).reduce((sum, row) => sum + (row.quantity || 0), 0);

  // Liquid glass CSS
  const glassPanelClass = `bg-white border border-[#E2E8F0] rounded-lg p-5`;
  const glassButtonClass = `inline-flex items-center gap-2 px-3.5 py-2.5 bg-white border border-[#CBD5E1] hover:bg-[#F1F5F9] rounded-md text-sm font-medium text-[#334155] transition-all cursor-pointer`;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      
      {/* Top breadcrumb & quick actions */}
      <div className="flex items-center justify-between">
        <Link href="/admin/products" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#6B6C72] hover:text-[#1A1A1A] transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back to products
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/products/labels?ids=${encodeURIComponent(product.id)}`}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-white border border-[#CBD5E1] hover:bg-[#F1F5F9] rounded-md text-xs font-medium text-[#334155]"
          >
            Print label
          </Link>
          <button
            onClick={() => setShowEditModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] border-transparent active:scale-[0.98] rounded-xl text-xs font-bold text-white transition-all shadow-md shadow-teal-500/10 cursor-pointer"
          >
            <Edit className="w-4 h-4" /> Edit Specifications
          </button>
        </div>
      </div>

      {/* Product Header Card (iOS glassmorphism) */}
      <div className={`${glassPanelClass} overflow-hidden`}>
        <div className="flex flex-col xl:flex-row justify-between gap-6 min-w-0">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-teal-500/10 to-teal-500/5 border border-white/10 overflow-hidden flex items-center justify-center shrink-0 shadow-lg shadow-teal-500/5">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <Package className="w-8 h-8 text-teal-450" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold text-[#1A1A1A]">{product.name}</h1>
                {product.category_name ? (
                  <span className="text-[11px] bg-[#F4F5F8] text-[#393A3D] px-2 py-0.5 rounded font-medium">
                    {product.category_name}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-[#6B6C72] mt-1">
                Item ID: <span className="font-mono text-[#1A1A1A]">{product.product_id || '—'}</span>
                {' · '}
                SKU: <span className="font-mono text-[#1A1A1A]">{product.sku?.trim() || '—'}</span>
              </p>
              {!product.sku?.trim() && (
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={generatingSku || !product.id}
                    onClick={async () => {
                      setGeneratingSku(true);
                      try {
                        const { data } = await adminApi.post(`/products/${product.id}/generate-internal-sku`);
                        toast.success(data?.sku ? `SKU assigned: ${data.sku}` : 'SKU assigned');
                        await fetchProductData();
                      } catch {
                        toast.error('Failed to generate internal SKU');
                      } finally {
                        setGeneratingSku(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black text-white text-xs font-medium hover:bg-[#2C2C2C] disabled:opacity-50"
                  >
                    {generatingSku ? 'Generating…' : 'Generate internal SKU'}
                  </button>
                </div>
              )}
              
              <div className="flex items-center gap-3 mt-4 text-[11px] text-[#6B6C72]">
                <span>Tax type: <span className="font-semibold text-[#1A1A1A]">{productTaxLabel(product)}</span></span>
                <span className="text-[#C7C7C7]">|</span>
                <span>
                  Website:{' '}
                  <span className="font-semibold text-[#1A1A1A]">
                    {product.is_active === false ? 'Hidden' : 'On website'}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Product metrics counters */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 p-4 bg-[#F4F5F8] rounded-lg border border-[#E3E5E8] w-full xl:w-auto xl:flex-1 min-w-0">
            <div>
              <span className="text-[10px] font-bold text-[#6B6C72] tracking-wider block uppercase">On hand</span>
              <span className="text-lg font-semibold text-[#1A1A1A] block mt-1">{onHand.toLocaleString()} units</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-[#6B6C72] tracking-wider block uppercase">Selling price</span>
              <span className="text-lg font-semibold text-[#1A1A1A] block mt-1">${product.price.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-[#6B6C72] tracking-wider block uppercase">Margin</span>
              <span className="text-lg font-semibold text-[#1A1A1A] block mt-1">
                {marginPct != null ? `${marginPct}%` : '—'}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-[#6B6C72] tracking-wider block uppercase">Stock status</span>
              <span className="text-sm font-semibold block mt-1">
                {reorderLabel === 'Low stock' || reorderLabel === 'Out of stock' ? (
                  <span className="text-[#C81916] inline-flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> {reorderLabel}
                  </span>
                ) : (
                  <span className="text-[#0B6B0B]">{reorderLabel}</span>
                )}
              </span>
              <span className="text-[11px] text-[#8D9096]">Alert at {threshold}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Menu Section */}
      <div className="flex flex-wrap gap-1 p-1 bg-[#F4F5F8] rounded-md border border-[#E3E5E8]">
        {(
          [
            { id: 'overview', label: 'Overview' },
            { id: 'inventory', label: 'Stock' },
            { id: 'pricing', label: 'Pricing' },
            { id: 'sales', label: 'Sales' },
            { id: 'suppliers', label: 'Supplier' },
            { id: 'analytics', label: 'Activity' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-[#1A1A1A] border border-[#E3E5E8] shadow-sm'
                : 'text-[#6B6C72] hover:text-[#1A1A1A]'
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
              <h3 className="text-xs font-semibold text-[#6B6C72] uppercase tracking-wider pb-1.5 border-b border-[#E3E5E8]">Product</h3>
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-[#6B6C72] block text-[11px]">SKU</span><span className="font-mono text-[#1A1A1A]">{product.sku?.trim() || '—'}</span></div>
                <div><span className="text-[#6B6C72] block text-[11px]">Product ID</span><span className="font-mono text-[#1A1A1A]">{product.product_id || '—'}</span></div>
                <div><span className="text-[#6B6C72] block text-[11px]">Tax type</span><span className="font-semibold text-[#1A1A1A]">{productTaxLabel(product)}</span></div>
              </div>
              <div className="pt-2"><span className="text-[#6B6C72] block text-[11px]">Description</span><span className="text-[#1A1A1A] text-sm">{product.description || '—'}</span></div>
            </div>
          </div>
        )}

        {activeTab === 'inventory' && (
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-[#6B6C72] uppercase tracking-wider pb-1.5 border-b border-[#E3E5E8]">Stock</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-md border border-[#E3E5E8]">
                <span className="text-xs text-[#6B6C72] block mb-1">On hand</span>
                <span className="text-lg font-semibold text-[#1A1A1A]">{onHand.toLocaleString()} units</span>
              </div>
              <div className="p-4 rounded-md border border-[#E3E5E8]">
                <span className="text-xs text-[#6B6C72] block mb-1">Committed to open orders</span>
                <span className="text-lg font-semibold text-[#1A1A1A]">{committed.toLocaleString()} units</span>
              </div>
              <div className="p-4 rounded-md border border-[#E3E5E8]">
                <span className="text-xs text-[#6B6C72] block mb-1">Available</span>
                <span className="text-lg font-semibold text-[#1A1A1A]">{available.toLocaleString()} units</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'pricing' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm">
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-[#6B6C72] uppercase tracking-wider pb-1.5 border-b border-[#E3E5E8]">Catalog price</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[#6B6C72] block text-[11px]">Cost</span>
                  <span className="font-semibold text-[#1A1A1A]">{cost != null ? `$${cost.toFixed(2)}` : '—'}</span>
                </div>
                <div>
                  <span className="text-[#6B6C72] block text-[11px]">Selling price</span>
                  <span className="font-semibold text-[#1A1A1A]">${product.price.toFixed(2)}</span>
                </div>
              </div>
              {activity?.price_groups?.length ? (
                <div>
                  <span className="text-[#6B6C72] block text-[11px] mb-1">Price groups</span>
                  <ul className="text-sm text-[#1A1A1A] space-y-1">
                    {activity.price_groups.map((g) => (
                      <li key={g.id}>{g.name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <div className="p-4 rounded-md border border-[#E3E5E8] space-y-3">
              <h4 className="text-xs font-semibold text-[#6B6C72] uppercase">Margin</h4>
              {cost != null ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span>Profit per unit</span>
                    <span className="font-semibold">${markupUsd!.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Margin</span>
                    <span className="font-semibold">{marginPct}%</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-[#6B6C72]">Add a cost on the product to see margin.</p>
              )}
              {activity?.customer_prices?.length ? (
                <div className="pt-3 border-t border-[#E3E5E8]">
                  <h4 className="text-xs font-semibold text-[#6B6C72] uppercase mb-2">Last invoice price by customer</h4>
                  <ul className="space-y-1 text-sm">
                    {activity.customer_prices.map((row) => (
                      <li key={row.customer_id} className="flex justify-between gap-3">
                        <span className="truncate">{row.customer_name}</span>
                        <span className="font-mono">${row.price.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-[#6B6C72] pt-2">No customer-specific prices yet. Those appear after the product is invoiced.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'sales' && (
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-[#6B6C72] uppercase tracking-wider pb-1.5 border-b border-[#E3E5E8]">Sales</h3>
            {!activity?.sales?.length ? (
              <p className="text-sm text-[#6B6C72]">No invoices, POS sales, or online orders for this product yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E3E5E8] text-[#6B6C72] text-xs">
                      <th className="py-2">Date</th>
                      <th className="py-2">Customer</th>
                      <th className="py-2">Document</th>
                      <th className="py-2 text-right">Qty</th>
                      <th className="py-2 text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.sales.map((row, i) => (
                      <tr key={`${row.document}-${i}`} className="border-b border-[#E3E5E8]">
                        <td className="py-2 text-[#6B6C72]">{new Date(row.date).toLocaleDateString()}</td>
                        <td className="py-2 text-[#1A1A1A]">{row.customer_name}</td>
                        <td className="py-2 text-[#6B6C72]">{row.source} · {row.document}</td>
                        <td className="py-2 text-right font-mono">{row.quantity}</td>
                        <td className="py-2 text-right font-mono">${row.price.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'suppliers' && (
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-[#6B6C72] uppercase tracking-wider pb-1.5 border-b border-[#E3E5E8]">Supplier</h3>
            {!activity?.vendor ? (
              <p className="text-sm text-[#6B6C72]">No supplier is linked to this product. Assign one when you edit the product.</p>
            ) : (
              <div className="p-4 rounded-md border border-[#E3E5E8] text-sm flex justify-between items-center gap-3">
                <div>
                  <p className="font-medium text-[#1A1A1A]">{activity.vendor.name}</p>
                  <p className="text-xs text-[#6B6C72] mt-1">
                    {[activity.vendor.supplier_id, activity.vendor.phone, activity.vendor.email].filter(Boolean).join(' · ') || 'Linked supplier'}
                  </p>
                </div>
                <Link href="/admin/purchase-orders" className={glassButtonClass}>Purchase orders</Link>
              </div>
            )}
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="p-4 rounded-md border border-[#E3E5E8]">
              <span className="text-[11px] font-medium text-[#6B6C72] block uppercase mb-1">Units sold</span>
              <p className="text-lg font-semibold text-[#1A1A1A]">{unitsSold.toLocaleString()}</p>
              <p className="text-xs text-[#8D9096] mt-1">From invoices, POS, and online orders</p>
            </div>
            <div className="p-4 rounded-md border border-[#E3E5E8]">
              <span className="text-[11px] font-medium text-[#6B6C72] block uppercase mb-1">Last sold</span>
              <p className="text-lg font-semibold text-[#1A1A1A]">
                {activity?.sales?.[0]?.date ? new Date(activity.sales[0].date).toLocaleDateString() : '—'}
              </p>
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
