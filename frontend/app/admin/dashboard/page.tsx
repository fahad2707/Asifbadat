'use client';

import { useEffect, useState } from 'react';
import {
  ShoppingCart,
  MessageSquare,
  Truck,
  Wallet,
  AlertTriangle,
  RefreshCw,
  Plus,
  Clock,
  ChevronRight,
  UserCheck,
  Zap,
  Users,
  ClipboardList,
} from 'lucide-react';
import Link from 'next/link';
import adminApi from '@/lib/admin-api';
import {
  CALCULATION_UNDER_REVIEW,
  UNAVAILABLE,
  buildActivityPanels,
  buildMetricCards,
  resolveDashboardViewState,
  type DashboardPayload,
} from '@/lib/dashboard-metrics';

const glassPanelClass = `bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.22] shadow-[0_12px_40px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.15)] rounded-2xl p-5 transition-all duration-300`;
const glassActionBtn = `w-full flex items-center justify-between p-3.5 bg-gradient-to-b from-white/[0.08] to-white/[0.01] hover:bg-white/[0.06] border border-white/[0.04] border-t-white/[0.18] rounded-xl text-xs font-semibold text-slate-100 transition-all active:scale-[0.98] cursor-pointer`;

const PANEL_ICONS: Record<string, typeof ShoppingCart> = {
  'recent-orders': ShoppingCart,
  approvals: UserCheck,
  'stock-checks': AlertTriangle,
  dispatch: Truck,
  'follow-ups': Clock,
  feeds: Clock,
};

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    const isRefresh = data !== null;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await adminApi.get('/admin/dashboard', { params: { period: '30' } });
      setData(res.data);
      setError(null);
    } catch {
      setError('Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    // Initial load only; refresh is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = resolveDashboardViewState({
    hasData: data !== null,
    loading,
    refreshing,
    error,
  });

  const metricCards = data ? buildMetricCards(data) : [];
  const activityPanels = buildActivityPanels();

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            Workspace <span className="text-teal-400">Dashboard</span>
          </h1>
          <p className="text-slate-400 text-xs mt-1">Operational view of Express Distributors</p>
        </div>
        <button
          type="button"
          onClick={fetchDashboardData}
          disabled={loading || refreshing}
          className="p-2.5 rounded-xl bg-slate-900 border border-white/5 text-slate-400 hover:text-white transition-colors disabled:opacity-40"
          title="Refresh Workspace"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {view.kind === 'loading' && (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-teal-500 border-t-transparent" />
        </div>
      )}

      {view.kind === 'error' && (
        <div className={`${glassPanelClass} max-w-lg`}>
          <p className="text-sm font-bold text-white">Failed to load dashboard</p>
          <p className="text-xs text-slate-400 mt-2">{view.message}</p>
          <button
            type="button"
            onClick={fetchDashboardData}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 text-white text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {(view.kind === 'ready' || view.kind === 'stale') && (
        <>
          {view.refreshing && view.kind === 'ready' && (
            <div className="rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-2 text-xs font-semibold text-teal-300">
              Refreshing dashboard…
            </div>
          )}

          {view.kind === 'stale' && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              <p className="font-bold">Showing stale data</p>
              <p className="mt-1 text-amber-200/80">{view.message}. Figures below are from the last successful load.</p>
              {view.refreshing && <p className="mt-1 font-semibold">Retrying…</p>}
              <button
                type="button"
                onClick={fetchDashboardData}
                className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-100 font-semibold"
              >
                Retry
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {metricCards.map((card) => {
              const isReview = card.value === CALCULATION_UNDER_REVIEW;
              const isUnavailable = card.value === UNAVAILABLE;
              return (
                <div key={card.id} className={glassPanelClass}>
                  <p className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">{card.label}</p>
                  <p
                    className={`mt-1.5 font-black ${
                      isReview || isUnavailable ? 'text-xs text-slate-400 font-semibold' : 'text-lg text-white'
                    }`}
                  >
                    {card.value}
                  </p>
                  {card.caption && (
                    <span className="inline-block text-[9px] text-slate-400 mt-2 font-semibold">{card.caption}</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            <div className="lg:col-span-3 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {activityPanels.slice(0, 2).map((panel) => (
                  <ActivityPanelCard key={panel.id} panel={panel} />
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {activityPanels.slice(2, 5).map((panel) => (
                  <ActivityPanelCard key={panel.id} panel={panel} />
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className={glassPanelClass}>
                <div className="pb-3 border-b border-white/5 mb-4">
                  <h3 className="text-xs font-bold text-white tracking-widest uppercase flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-400" /> ERP Quick Commands
                  </h3>
                </div>
                <div className="space-y-2">
                  <Link href="/admin/orders" className={glassActionBtn}>
                    <span className="flex items-center gap-2.5"><ShoppingCart className="w-4 h-4 text-teal-400" /> Create New Order</span>
                    <Plus className="w-3.5 h-3.5 text-slate-400" />
                  </Link>
                  <Link href="/admin/rfq" className={glassActionBtn}>
                    <span className="flex items-center gap-2.5"><MessageSquare className="w-4 h-4 text-teal-400" /> Create Quote Request</span>
                    <Plus className="w-3.5 h-3.5 text-slate-400" />
                  </Link>
                  <Link href="/admin/customers" className={glassActionBtn}>
                    <span className="flex items-center gap-2.5"><Users className="w-4 h-4 text-teal-400" /> Register Customer</span>
                    <Plus className="w-3.5 h-3.5 text-slate-400" />
                  </Link>
                  <Link href="/admin/purchase-orders" className={glassActionBtn}>
                    <span className="flex items-center gap-2.5"><ClipboardList className="w-4 h-4 text-teal-400" /> Create Purchase Order</span>
                    <Plus className="w-3.5 h-3.5 text-slate-400" />
                  </Link>
                  <Link href="/admin/receipts" className={glassActionBtn}>
                    <span className="flex items-center gap-2.5"><Wallet className="w-4 h-4 text-teal-400" /> Receive Client Payment</span>
                    <Plus className="w-3.5 h-3.5 text-slate-400" />
                  </Link>
                  <Link
                    href="/admin/pos"
                    className="w-full flex items-center justify-between p-3.5 bg-gradient-to-r from-teal-500/20 to-emerald-500/10 hover:from-teal-500/30 hover:to-emerald-500/20 border border-teal-500/30 border-t-white/20 rounded-xl text-xs font-bold text-white transition-all active:scale-[0.98] shadow-md shadow-teal-500/5 cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5"><ShoppingCart className="w-4 h-4 text-teal-400" /> Launch POS Terminal</span>
                    <ChevronRight className="w-3.5 h-3.5 text-teal-400" />
                  </Link>
                </div>
              </div>

              {activityPanels.slice(5).map((panel) => (
                <ActivityPanelCard key={panel.id} panel={panel} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ActivityPanelCard({
  panel,
}: {
  panel: ReturnType<typeof buildActivityPanels>[number];
}) {
  const Icon = PANEL_ICONS[panel.id] || Clock;
  return (
    <div className={glassPanelClass}>
      <h3 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-400" /> {panel.title}
      </h3>
      <p className="text-xs text-slate-400">{panel.message}</p>
    </div>
  );
}
