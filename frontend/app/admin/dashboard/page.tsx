'use client';

import { useEffect, useState } from 'react';
import {
  ShoppingCart,
  MessageSquare,
  Truck,
  Landmark,
  AlertTriangle,
  RefreshCw,
  Plus,
  Clock,
  ChevronRight,
  UserCheck,
  Zap,
  Users,
  ClipboardList,
  FileText,
  RotateCcw,
} from 'lucide-react';
import Link from 'next/link';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import {
  CALCULATION_UNDER_REVIEW,
  UNAVAILABLE,
  buildActivityPanels,
  buildMetricCards,
  resolveDashboardViewState,
  type DashboardPayload,
} from '@/lib/dashboard-metrics';

const panelClass = `${adminUi.panel} p-5`;
const quickCmdClass = `${adminUi.btnSecondary} w-full justify-between`;

const PANEL_ICONS: Record<string, typeof ShoppingCart> = {
  'recent-orders': ShoppingCart,
  approvals: UserCheck,
  'stock-checks': AlertTriangle,
  dispatch: Truck,
  'follow-ups': Clock,
  feeds: Clock,
};

/** Order fixed by the business: invoice, quotation, customer, vendor, bank transaction, PO, credit memo. */
const QUICK_COMMANDS = [
  { label: 'Create new invoice', href: '/admin/invoices?create=invoice', icon: ShoppingCart, primary: true },
  { label: 'Create new quotation', href: '/admin/invoices?create=quotation', icon: FileText },
  { label: 'Create customer', href: '/admin/customers?create=1', icon: Users },
  { label: 'Create vendor', href: '/admin/vendors?create=1', icon: Truck },
  { label: 'Create bank transaction', href: '/admin/receipts?create=1', icon: Landmark },
  { label: 'Create purchase order', href: '/admin/purchase-orders?create=1', icon: ClipboardList },
  { label: 'Create credit memo', href: '/admin/credit-memos?new=1', icon: RotateCcw },
] as const;

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRfqs, setPendingRfqs] = useState<number | null>(null);

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

    try {
      const rfqRes = await adminApi.get('/rfq', { params: { status: 'pending', limit: 1 } });
      const pending = rfqRes.data?.summary?.pending;
      setPendingRfqs(typeof pending === 'number' ? pending : null);
    } catch {
      setPendingRfqs(null);
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
          <h1 className={adminUi.pageTitle}>Welcome</h1>
          <p className={`${adminUi.meta} mt-1`}>Sales &amp; Get Paid overview</p>
        </div>
        <button
          type="button"
          onClick={fetchDashboardData}
          disabled={loading || refreshing}
          className={`${adminUi.btnSecondary} disabled:opacity-40`}
          title="Refresh Workspace"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {view.kind === 'loading' && (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-black border-t-transparent" />
        </div>
      )}

      {view.kind === 'error' && (
        <div className={`${panelClass} max-w-lg space-y-3`}>
          <p className="text-sm font-medium text-[#1A1A1A]">Failed to load dashboard</p>
          <p className={adminUi.meta}>{view.message}</p>
          <button type="button" onClick={fetchDashboardData} className={adminUi.btnPrimary}>
            Retry
          </button>
        </div>
      )}

      {(view.kind === 'ready' || view.kind === 'stale') && (
        <>
          {view.refreshing && view.kind === 'ready' && (
            <div className={`${adminUi.panel} px-4 py-2 text-sm font-medium text-[#6B6C72]`}>
              Refreshing dashboard…
            </div>
          )}

          {view.kind === 'stale' && (
            <div className={`${adminUi.panel} px-4 py-3 text-sm`} style={{ background: '#FEF3C7', borderColor: '#FCD34D' }}>
              <p className="font-semibold text-[#92400E]">Showing stale data</p>
              <p className="mt-1 text-[#92400E]">{view.message}. Figures below are from the last successful load.</p>
              {view.refreshing && <p className="mt-1 font-medium">Retrying…</p>}
              <button type="button" onClick={fetchDashboardData} className={`${adminUi.btnSecondary} mt-2`}>
                Retry
              </button>
            </div>
          )}

          {/* Metric cards: 4 per row on desktop so currency values never clip. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {metricCards.map((card) => {
              const isReview = card.value === CALCULATION_UNDER_REVIEW;
              const isUnavailable = card.value === UNAVAILABLE;
              const muted = isReview || isUnavailable;
              return (
                <div key={card.id} className={`${panelClass} min-w-0 min-h-[120px] flex flex-col`}>
                  <p className={`${adminUi.label} truncate`} title={card.label}>{card.label}</p>
                  <p
                    className={
                      muted
                        ? 'mt-2 text-sm text-[#8D9096] leading-snug break-words'
                        : 'mt-2 text-[26px] leading-tight font-normal text-[#1A1A1A] tabular-nums break-words'
                    }
                  >
                    {card.value}
                  </p>
                  {card.caption && (
                    <span className={`${adminUi.helper} block mt-auto pt-2 leading-snug`}>{card.caption}</span>
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
              <div className={panelClass}>
                <div className="pb-3 border-b border-[#E3E5E8] mb-4">
                  <h3 className={`${adminUi.sectionTitle} flex items-center gap-2`}>
                    <Zap className={`w-4 h-4 ${adminUi.icon}`} /> Quick commands
                  </h3>
                </div>
                <div className="space-y-2">
                  {QUICK_COMMANDS.map((cmd) => {
                    const Icon = cmd.icon;
                    const primary = 'primary' in cmd && cmd.primary;
                    return (
                      <Link
                        key={cmd.href}
                        href={cmd.href}
                        className={primary ? `${adminUi.btnPrimary} w-full justify-between` : quickCmdClass}
                      >
                        <span className="flex items-center gap-2.5">
                          <Icon className={`w-4 h-4 ${primary ? '' : adminUi.icon}`} /> {cmd.label}
                        </span>
                        {primary ? <ChevronRight className="w-3.5 h-3.5" /> : <Plus className={`w-3.5 h-3.5 ${adminUi.icon}`} />}
                      </Link>
                    );
                  })}
                </div>
              </div>

              <Link href="/admin/rfq" className={`${panelClass} block hover:bg-[#F4F5F8]`}>
                <h3 className={`${adminUi.sectionTitle} mb-3 flex items-center gap-2`}>
                  <MessageSquare className={`w-4 h-4 ${adminUi.icon}`} /> Quote requests
                </h3>
                <p className="text-[26px] leading-tight font-normal text-[#1A1A1A] tabular-nums">
                  {pendingRfqs === null ? '—' : pendingRfqs}
                </p>
                <p className={`${adminUi.meta} mt-1`}>
                  {pendingRfqs === null ? 'Could not load quote requests' : 'Pending from website customers'}
                </p>
                <span className="inline-flex items-center gap-1 mt-3 text-sm text-[#0077C5]">
                  Open quote requests <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </Link>

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
    <div className={panelClass}>
      <h3 className={`${adminUi.sectionTitle} mb-3 flex items-center gap-2`}>
        <Icon className={`w-4 h-4 ${adminUi.icon}`} /> {panel.title}
      </h3>
      <p className={adminUi.meta}>{panel.message}</p>
    </div>
  );
}
