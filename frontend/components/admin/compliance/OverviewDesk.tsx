'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import { actorLabel, formatAuditTime, reportName } from '@/lib/compliance-display';
import { CountCard, ReadStatus, StatusBadge } from './Chrome';

type CountView = { availability: 'recorded'; count: number } | { availability: 'unavailable'; reason: string };
type QueueItem = { id: string; title: string; status: string; detail: string; href: string; count: number | null };
type AuditRow = { _id: string; action: string; created_at: string; actor?: { label?: string | null } };
type ReportRow = { _id: string; report_key: string; status: string; period_start?: string; period_end?: string; created_at: string; filing_ready: boolean };

export default function OverviewDesk() {
  const [metrics, setMetrics] = useState<{ pendingReviews: CountView; incompleteTransactions: CountView; unreconciledPeriods: CountView; savedReports: CountView; workQueue: QueueItem[] } | null>(null);
  const [activity, setActivity] = useState<AuditRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [error, setError] = useState('');
  const [authFailed, setAuthFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError('');
    setAuthFailed(false);
    Promise.all([adminApi.get('/compliance/operations'), adminApi.get('/compliance/audit'), adminApi.get('/compliance/reports')])
      .then(([ops, audit, reportResponse]) => {
        setMetrics(ops.data);
        setActivity((audit.data.rows || []).slice(0, 8));
        setReports((reportResponse.data.rows || []).slice(0, 8));
      })
      .catch((err) => {
        if (isAdminAuthRedirectError(err)) setAuthFailed(true);
        else setError(err?.response?.data?.error || 'The compliance desk could not be loaded.');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className={`p-6 space-y-6 ${adminUi.workspace}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={adminUi.meta}>Express Distributors Inc. / Reports</p>
          <h1 className={adminUi.pageTitle}>Compliance</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={adminUi.btnPrimary} href="/admin/compliance/sales-tax?tab=transactions">Open sales tax</Link>
          <Link className={adminUi.btnSecondary} href="/admin/compliance/tobacco?tab=ledger">Open tobacco ledger</Link>
          <Link className={adminUi.btnSecondary} href="/admin/compliance/sales-tax?tab=exemptions">Review exemptions</Link>
          <Link className={adminUi.btnGhost} href="/admin/compliance/settings">Settings</Link>
        </div>
      </div>
      <ReadStatus phase={authFailed ? 'auth' : loading ? 'loading' : error ? 'error' : 'ready'} error={error} onRetry={load} />
      {metrics && (
        <div className="grid gap-4 md:grid-cols-4">
          <CountCard label="Pending reviews" value={metrics.pendingReviews} />
          <CountCard label="Incomplete transactions" value={metrics.incompleteTransactions} />
          <CountCard label="Unreconciled periods" value={metrics.unreconciledPeriods} />
          <CountCard label="Saved reports" value={metrics.savedReports} />
        </div>
      )}
      <section className={`overflow-hidden ${adminUi.panel}`}>
        <div className="px-4 py-3 border-b border-[#E3E5E8]"><h2 className={adminUi.sectionTitle}>Work queue</h2></div>
        <table className="w-full">
          <tbody>
            {(metrics?.workQueue || []).map((item) => (
              <tr key={item.id} className={adminUi.tableRowHover}>
                <td className={adminUi.tableCell}>
                  <p className="font-medium">{item.title}</p>
                  <p className={adminUi.meta}>{item.detail}</p>
                </td>
                <td className={adminUi.tableCell}>{item.count == null ? 'Not available' : item.count}</td>
                <td className={adminUi.tableCell}><span className={adminUi.badge}>{item.status}</span></td>
                <td className={`${adminUi.tableCell} text-right`}><Link className="underline" href={item.href}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`p-4 ${adminUi.panel}`}>
          <h2 className={adminUi.sectionTitle}>Recent activity</h2>
          {loading ? <p className={`mt-3 ${adminUi.meta}`}>Loading…</p> : error || authFailed ? null : activity.length === 0 ? <p className={`mt-3 ${adminUi.meta}`}>No compliance activity has been recorded.</p> : (
            <ul className="mt-3 divide-y divide-[#E3E5E8]">
              {activity.map((row) => (
                <li key={row._id} className="py-2 text-sm">
                  <p>{row.action}</p>
                  <p className={adminUi.meta}>{formatAuditTime(row.created_at)} · {actorLabel(row.actor)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={`overflow-hidden ${adminUi.panel}`}>
          <div className="px-4 py-3 border-b border-[#E3E5E8] flex justify-between">
            <h2 className={adminUi.sectionTitle}>Recent reports</h2>
            <Link className="text-sm underline" href="/admin/compliance/reports">View all</Link>
          </div>
          <table className="w-full">
            <thead className={adminUi.tableHead}><tr><th className="px-3 py-2 text-left">Period</th><th className="px-3 py-2 text-left">Report</th><th className="px-3 py-2 text-left">Status</th><th /></tr></thead>
            <tbody>
              {loading ? (
                <tr><td className={adminUi.tableCell} colSpan={4}>Loading…</td></tr>
              ) : error || authFailed ? null : reports.length === 0 ? (
                <tr><td className={adminUi.tableCell} colSpan={4}>No reports to display.</td></tr>
              ) : reports.map((report) => (
                <tr key={report._id}>
                  <td className={adminUi.tableCell}>{report.period_start || '—'} – {report.period_end || '—'}</td>
                  <td className={adminUi.tableCell}>{reportName(report.report_key)}</td>
                  <td className={adminUi.tableCell}><StatusBadge status={report.status} /></td>
                  <td className={`${adminUi.tableCell} text-right`}><Link className="underline" href={`/admin/compliance/reports?report=${report._id}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
