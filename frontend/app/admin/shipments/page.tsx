'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface Shipment {
  id: string;
  shipment_number: string;
  shipment_type: string;
  linked_invoice_id?: string;
  status: string;
  transporter_name?: string;
  vehicle_number?: string;
  dispatch_date?: string;
  expected_delivery_date?: string;
  delivered_date?: string;
  freight_charge?: number;
  created_at: string;
  items?: { product_id: string; product_name?: string; quantity: number; status?: string }[];
}

export default function ShipmentsPage() {
  const [list, setList] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const fetchList = async () => {
    try {
      const params: Record<string, string | number> = { page: 1, limit: 100 };
      if (typeFilter) params.shipment_type = typeFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await adminApi.get('/shipments', { params });
      setList(res.data.shipments || []);
    } catch {
      toast.error('Failed to load shipments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [typeFilter, statusFilter]);

  const formatDate = (d?: string) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Shipments & Logistics</h1>
          <p className="text-xs text-slate-400 mt-1">Track outbound dispatch shipments, transporter details, vehicle entries, and delivery status logs.</p>
        </div>
      </div>

      <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2.5 flex-wrap flex-1">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-955/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500 font-semibold"
          >
            <option value="">All dispatch types</option>
            <option value="GROUND">GROUND</option>
            <option value="GROUND_RG">GROUND_RG (Return)</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-955/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-202 focus:outline-none focus:ring-1 focus:ring-teal-500 font-semibold"
          >
            <option value="">All logistics statuses</option>
            <option value="PENDING">PENDING</option>
            <option value="PACKED">PACKED</option>
            <option value="DISPATCHED">DISPATCHED</option>
            <option value="IN_TRANSIT">IN_TRANSIT</option>
            <option value="DELIVERED">DELIVERED</option>
            <option value="RETURNED">RETURNED</option>
            <option value="FAILED">FAILED</option>
          </select>
        </div>
        <div>
          <button
            type="button"
            onClick={() => fetchList()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <Search className="w-3.5 h-3.5" />
            Refresh Log
          </button>
        </div>
      </div>

      <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                <tr>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Waybill ID</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Type</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Status</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Transporter</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Vehicle ID</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Dispatch Date</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">ETA</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Delivered Date</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Freight Charge</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-slate-500 text-xs font-semibold">
                      No transit shipments registered yet.
                    </td>
                  </tr>
                ) : (
                  list.map((s) => (
                    <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4 text-xs font-mono font-bold text-teal-450">{s.shipment_number}</td>
                      <td className="py-3 px-4 text-xs">
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold border border-white/10 bg-slate-950/40 text-slate-350">{s.shipment_type}</span>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${
                            s.status === 'DELIVERED' || s.status === 'RETURNED'
                              ? 'bg-teal-500/10 text-teal-455 border-teal-500/20'
                              : s.status === 'PENDING'
                              ? 'bg-slate-800 text-slate-450 border-white/10'
                              : s.status === 'FAILED'
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                              : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold text-slate-205">{s.transporter_name || '—'}</td>
                      <td className="py-3 px-4 text-xs text-slate-400 font-mono">{s.vehicle_number || '—'}</td>
                      <td className="py-3 px-4 text-xs text-slate-400 font-mono">{formatDate(s.dispatch_date)}</td>
                      <td className="py-3 px-4 text-xs text-slate-400 font-mono">{formatDate(s.expected_delivery_date)}</td>
                      <td className="py-3 px-4 text-xs text-slate-400 font-mono">{formatDate(s.delivered_date)}</td>
                      <td className="py-3 px-4 text-xs text-right font-mono font-bold text-slate-105">{s.freight_charge != null ? `$${Number(s.freight_charge).toLocaleString(undefined, {minimumFractionDigits: 2})}` : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
