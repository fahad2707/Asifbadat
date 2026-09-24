'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Send, Package, Check } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface POItem {
  product_id: string;
  product_name: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  subtotal: number;
}

interface PO {
  id: string;
  po_number: string;
  vendor_id: string;
  vendor: { name: string; contact_name?: string; phone?: string };
  status: string;
  items: POItem[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  expected_date?: string;
  received_at?: string;
  notes?: string;
  created_at: string;
}

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [po, setPo] = useState<PO | null>(null);
  const [loading, setLoading] = useState(true);
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [receiving, setReceiving] = useState(false);

  const fetchPO = async () => {
    try {
      const res = await adminApi.get(`/purchase-orders/${id}`);
      setPo(res.data);
      const initial: Record<string, number> = {};
      (res.data.items || []).forEach((i: POItem) => {
        const remaining = i.quantity_ordered - (i.quantity_received || 0);
        initial[i.product_id] = remaining > 0 ? remaining : 0;
      });
      setReceiveQty(initial);
    } catch {
      toast.error('Failed to load purchase order');
      router.push('/admin/purchase-orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchPO();
  }, [id]);

  const handleSend = async () => {
    try {
      await adminApi.post(`/purchase-orders/${id}/send`);
      toast.success('PO marked as sent');
      fetchPO();
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleReceive = async () => {
    if (!po) return;
    const items = po.items
      .filter((i) => (receiveQty[i.product_id] || 0) > 0)
      .map((i) => ({ product_id: i.product_id, quantity_received: receiveQty[i.product_id] || 0 }));
    if (items.length === 0) {
      toast.error('Enter quantities to receive');
      return;
    }
    setReceiving(true);
    try {
      await adminApi.post(`/purchase-orders/${id}/receive`, { items });
      toast.success('Stock updated');
      fetchPO();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to receive');
    } finally {
      setReceiving(false);
    }
  };

  if (loading || !po) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  const canReceive = po.status === 'sent' || po.status === 'partial' || po.status === 'draft';
  const canSend = po.status === 'draft';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/purchase-orders" className="inline-flex items-center gap-2 text-teal-450 hover:text-teal-350 hover:underline text-xs font-bold transition-all">
          <ArrowLeft className="w-4 h-4" />
          Back to Purchase order
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">{po.po_number}</h1>
          <div className="text-xs text-slate-400 mt-1.5 flex items-center gap-2">
            <span className="font-semibold text-slate-200">{po.vendor?.name}</span>
            <span>•</span>
            <span
              className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${
                po.status === 'received'
                  ? 'bg-teal-500/10 text-teal-400 border-teal-500/20'
                  : po.status === 'draft'
                  ? 'bg-slate-800 text-slate-400 border-white/10'
                  : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              }`}
            >
              {po.status}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {canSend && (
            <button onClick={handleSend} className="bg-gradient-to-tr from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 border border-white/10 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2">
              <Send className="w-4 h-4" />
              Mark as Sent
            </button>
          )}
          {canReceive && (
            <button onClick={handleReceive} disabled={receiving} className="bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 disabled:opacity-40">
              <Check className="w-4 h-4" />
              {receiving ? 'Receiving Stock...' : 'Receive Stock'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl overflow-hidden mb-6">
        <table className="w-full border-collapse">
          <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
            <tr>
              <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Product</th>
              <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Ordered</th>
              <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Received</th>
              {canReceive && <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Qty to Receive</th>}
              <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Unit Cost</th>
              <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {po.items?.map((item) => {
              const remaining = item.quantity_ordered - (item.quantity_received || 0);
              return (
                <tr key={item.product_id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="py-3.5 px-4 text-xs font-semibold text-slate-200">
                    <div className="flex items-center gap-2.5">
                      <Package className="w-4 h-4 text-slate-500" />
                      {item.product_name}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right text-xs font-bold text-slate-300 font-mono">{item.quantity_ordered}</td>
                  <td className="py-3 px-4 text-right text-xs font-semibold text-slate-400 font-mono">{item.quantity_received || 0}</td>
                  {canReceive && (
                    <td className="py-3 px-4 text-right text-xs">
                      {remaining > 0 ? (
                        <input
                          type="number"
                          min={0}
                          max={remaining}
                          value={receiveQty[item.product_id] ?? remaining}
                          onChange={(e) => setReceiveQty({ ...receiveQty, [item.product_id]: parseInt(e.target.value, 10) || 0 })}
                          className="w-20 bg-slate-950/60 border border-white/10 rounded px-2.5 py-1 text-xs text-right text-slate-205 focus:outline-none"
                        />
                      ) : (
                        <span className="text-teal-400 font-bold">Completely Filled</span>
                      )}
                    </td>
                  )}
                  <td className="py-3 px-4 text-right text-xs font-mono font-semibold text-slate-350">${Number(item.unit_cost).toFixed(2)}</td>
                  <td className="py-3 px-4 text-right text-xs font-mono font-extrabold text-slate-100">${Number(item.subtotal).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] p-5 max-w-xs ml-auto shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl space-y-2 text-xs text-slate-350">
        <div className="flex justify-between">
          <span className="text-slate-500 font-bold uppercase text-[9px] tracking-wider">Subtotal</span>
          <span className="font-mono text-slate-200 font-bold">${Number(po.subtotal).toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 font-bold uppercase text-[9px] tracking-wider">Tax</span>
          <span className="font-mono text-slate-200 font-bold">${Number(po.tax_amount).toFixed(2)}</span>
        </div>
        <div className="flex justify-between border-t border-dashed border-white/10 pt-2 text-xs font-bold text-slate-200">
          <span className="text-[10px] uppercase font-bold tracking-wider">Grand Total</span>
          <span className="text-teal-400 font-mono font-extrabold">${Number(po.total_amount).toFixed(2)}</span>
        </div>
      </div>

      {po.notes && (
        <div className="mt-6 p-4 bg-slate-950/40 border border-white/5 rounded-2xl text-xs">
          <p className="text-[10px] text-slate-505 font-bold uppercase tracking-wider mb-1">Billing Notes / Comments</p>
          <p className="text-slate-300 leading-relaxed">{po.notes}</p>
        </div>
      )}
    </div>
  );
}
