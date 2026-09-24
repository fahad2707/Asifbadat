'use client';

import { useEffect, useState } from 'react';
import { Package, CheckCircle, Truck, MapPin, X, Search, ChevronDown, ChevronUp } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface OrderItem {
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
}

interface StatusEntry {
  status: string;
  timestamp: string;
}

interface OnlineOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  items: OrderItem[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  payment_method: string;
  payment_status: string;
  status: string;
  status_history: StatusEntry[];
  invoice_id?: string;
  created_at: string;
}

interface Summary {
  confirmed: number;
  packed: number;
  dispatched: number;
  delivered: number;
  cancelled: number;
  total: number;
}

const STATUS_FLOW = ['confirmed', 'packed', 'dispatched', 'delivered'] as const;
const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  confirmed: { label: 'Confirmed', icon: CheckCircle, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
  packed: { label: 'Packed', icon: Package, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  dispatched: { label: 'Dispatched', icon: Truck, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
  delivered: { label: 'Delivered', icon: MapPin, color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/25' },
  cancelled: { label: 'Cancelled', icon: X, color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20' },
};

export default function OnlineOrdersPage() {
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchOrders = async () => {
    try {
      const [ordersRes, summaryRes] = await Promise.all([
        adminApi.get('/online-orders', { params: filter !== 'all' ? { status: filter } : {} }),
        adminApi.get('/online-orders/summary'),
      ]);
      setOrders(ordersRes.data || []);
      setSummary(summaryRes.data);
    } catch {
      toast.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); }, [filter]);

  const updateStatus = async (orderId: string, newStatus: string) => {
    if (!confirm(`Mark this order as "${newStatus}"?`)) return;
    setUpdating(orderId);
    try {
      await adminApi.put(`/online-orders/${orderId}/status`, { status: newStatus });
      toast.success(`Order marked as ${newStatus}`);
      fetchOrders();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update');
    } finally {
      setUpdating(null);
    }
  };

  const filtered = search.trim()
    ? orders.filter((o) =>
        o.order_number.toLowerCase().includes(search.toLowerCase()) ||
        o.customer_name.toLowerCase().includes(search.toLowerCase()) ||
        o.customer_phone.includes(search)
      )
    : orders;

  const getNextStatus = (current: string) => {
    const idx = STATUS_FLOW.indexOf(current as any);
    if (idx === -1 || idx >= STATUS_FLOW.length - 1) return null;
    return STATUS_FLOW[idx + 1];
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Online sales</h1>
          <p className="text-xs text-slate-400 mt-1">Track and manage digital commerce sales orders and fulfillment pipelines.</p>
        </div>
        {summary && <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">{summary.total} total orders</span>}
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {(['confirmed', 'packed', 'dispatched', 'delivered', 'cancelled'] as const).map((s) => {
            const cfg = STATUS_CONFIG[s];
            const count = summary[s];
            const isActive = filter === s;
            return (
              <button
                key={s}
                onClick={() => setFilter(filter === s ? 'all' : s)}
                className={`rounded-2xl p-4 text-left transition-all backdrop-blur-lg border ${
                  isActive
                    ? 'bg-slate-900 border-teal-500 shadow-[0_4px_20px_rgba(20,184,166,0.15)]'
                    : 'bg-slate-900/40 border-white/[0.06] border-t-white/[0.18] hover:border-white/20 hover:bg-slate-900/60'
                }`}
              >
                <p className={`text-[10px] font-bold uppercase tracking-wider select-none ${cfg.color}`}>{cfg.label}</p>
                <p className="text-3xl font-extrabold text-slate-100 font-mono mt-2">{count}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-md bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] rounded-2xl p-2.5">
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by order number, customer, or phone…"
          className="w-full pl-10 pr-4 py-2 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 focus:bg-slate-950/80 transition-all font-semibold"
        />
      </div>

      {/* Orders list */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] rounded-2xl py-16 text-center text-slate-500 text-xs font-semibold">No orders found.</div>
      ) : (
        <div className="space-y-4">
          {filtered.map((order) => {
            const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.confirmed;
            const Icon = cfg.icon;
            const isExpanded = expandedId === order.id;
            const nextStatus = getNextStatus(order.status);
            const canCancel = order.status !== 'delivered' && order.status !== 'cancelled';

            return (
              <div key={order.id} className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl overflow-hidden">
                {/* Order header row */}
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : order.id)}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${cfg.bg}`}>
                    <Icon className={`w-5 h-5 ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-200 text-sm tracking-tight">{order.order_number}</span>
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                      {order.payment_method === 'cod' && (
                        <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">COD</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {order.customer_name} • {order.customer_phone} • {new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="text-right shrink-0 mr-2">
                    <p className="font-extrabold text-slate-100 font-mono text-sm">${order.total_amount.toFixed(2)}</p>
                    <p className="text-[10px] text-slate-500 font-semibold mt-0.5">{order.items.length} item{order.items.length !== 1 ? 's' : ''}</p>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />}
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-white/5 px-6 pb-6 pt-4">
                    {/* Horizontal status timeline */}
                    <div className="py-4 mb-4">
                      <div className="flex items-center justify-between max-w-lg mx-auto">
                        {STATUS_FLOW.map((s, i) => {
                          const sCfg = STATUS_CONFIG[s];
                          const SIcon = sCfg.icon;
                          const historyEntry = order.status_history.find((h) => h.status === s);
                          const currentFlowIdx = STATUS_FLOW.indexOf(order.status as any);
                          const done = i <= currentFlowIdx && order.status !== 'cancelled';
                          const isCurrent = order.status === s;
                          return (
                            <div key={s} className="flex flex-col items-center flex-1 relative">
                              {i > 0 && (
                                <div className={`absolute top-4 right-1/2 w-full h-0.5 -z-0 ${done ? 'bg-teal-500' : 'bg-slate-800'}`} />
                              )}
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center z-10 transition-colors ${done ? 'bg-[#0f766e] text-white border border-teal-400/20' : 'bg-slate-800 text-slate-500 border border-white/5'} ${isCurrent ? 'ring-2 ring-offset-2 ring-teal-500 ring-offset-slate-900' : ''}`}>
                                <SIcon className="w-3.5 h-3.5" />
                              </div>
                              <span className={`text-[10px] font-bold mt-2 uppercase tracking-wide ${done ? 'text-teal-450' : 'text-slate-500'}`}>{sCfg.label}</span>
                              {historyEntry && (
                                <span className="text-[9px] text-slate-500 font-mono mt-0.5">
                                  {new Date(historyEntry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {order.status === 'cancelled' && (
                        <div className="text-center mt-4 text-xs text-rose-455 font-bold uppercase tracking-wider">Order Cancelled</div>
                      )}
                    </div>

                    {/* Items table */}
                    <div className="bg-slate-950/60 rounded-xl p-4 mb-5 border border-white/5">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500 font-bold uppercase tracking-wider border-b border-white/5 pb-2 text-[10px]">
                            <th className="text-left pb-2">Product</th>
                            <th className="text-right pb-2">Qty</th>
                            <th className="text-right pb-2">Price</th>
                            <th className="text-right pb-2">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.items.map((item, i) => (
                            <tr key={i} className="border-t border-white/5">
                              <td className="py-2 text-slate-205">{item.product_name}</td>
                              <td className="py-2 text-right text-slate-350">{item.quantity}</td>
                              <td className="py-2 text-right text-slate-350 font-mono">${item.price.toFixed(2)}</td>
                              <td className="py-2 text-right font-bold text-slate-200 font-mono">${item.subtotal.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="border-t border-white/5 mt-3 pt-3 space-y-1.5 text-xs">
                        <div className="flex justify-between text-slate-400"><span>Subtotal</span><span className="font-mono">${order.subtotal.toFixed(2)}</span></div>
                        <div className="flex justify-between text-slate-400"><span>Tax</span><span className="font-mono">${order.tax_amount.toFixed(2)}</span></div>
                        <div className="flex justify-between font-bold text-slate-205 pt-1 border-t border-dashed border-white/10"><span>Total Amount</span><span className="font-mono text-teal-400">${order.total_amount.toFixed(2)}</span></div>
                      </div>
                    </div>

                    {/* Customer & address info */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-5 text-xs text-slate-350">
                      <div className="bg-slate-950/20 border border-white/5 p-4 rounded-xl">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Customer Profile</p>
                        <p className="font-bold text-slate-200 text-sm">{order.customer_name}</p>
                        <p className="text-slate-400 mt-1">{order.customer_email}</p>
                        <p className="text-slate-400 mt-0.5">{order.customer_phone}</p>
                      </div>
                      <div className="bg-slate-950/20 border border-white/5 p-4 rounded-xl">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Shipping Terminal Address</p>
                        <p className="leading-relaxed text-slate-300">
                          {order.address_line1}
                          {order.address_line2 ? `, ${order.address_line2}` : ''}<br />
                          {order.city}, {order.state} {order.zip}
                        </p>
                      </div>
                    </div>

                    {/* Action buttons */}
                    {(nextStatus || canCancel || order.invoice_id) && (
                      <div className="flex items-center gap-3 pt-4 border-t border-white/5">
                        {nextStatus && (
                          <button
                            onClick={() => updateStatus(order.id, nextStatus)}
                            disabled={updating === order.id}
                            className="px-4 py-2 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-40"
                          >
                            {updating === order.id ? 'Updating…' : `Mark as ${STATUS_CONFIG[nextStatus]?.label}`}
                          </button>
                        )}
                        {canCancel && (
                          <button
                            onClick={() => updateStatus(order.id, 'cancelled')}
                            disabled={updating === order.id}
                            className="px-4 py-2 bg-slate-900 border border-white/5 text-rose-400 hover:text-rose-350 hover:bg-rose-500/5 rounded-xl text-xs font-semibold shadow-sm transition-all disabled:opacity-40"
                          >
                            Cancel Order
                          </button>
                        )}
                        {order.invoice_id && (
                          <span className="text-xs text-teal-450 ml-auto flex items-center gap-1 font-semibold">
                            <CheckCircle className="w-3.5 h-3.5" /> Invoice generated
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
