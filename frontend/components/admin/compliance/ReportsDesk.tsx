'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import { actorLabel, filterByText, formatAuditTime, formatPacks, listPhase, nextReportAction, reportName, submissionAllowed } from '@/lib/compliance-display';
import { ConfirmDialog, Drawer, EmptyRow, PreviewBanner, ReadStatus, StatusBadge } from './Chrome';

type Actor = { label?: string | null };
type ReportRow = { _id: string; report_key: string; status: string; period_start?: string; period_end?: string; created_at?: string; actor?: Actor; filing_ready?: boolean };

export default function ReportsDesk() {
  const params = useSearchParams();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(params.get('report') || '');
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; status: string; label: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [authFailed, setAuthFailed] = useState(false);
  const [requested, setRequested] = useState(false);
  const inFlight = useRef(false);

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setRequested(true);
    setError('');
    setAuthFailed(false);
    try {
      const response = await adminApi.get('/compliance/reports');
      setRows(response.data.rows || []);
    } catch (err: any) {
      if (isAdminAuthRedirectError(err)) setAuthFailed(true);
      else setError(err?.response?.data?.error || 'Reports could not be loaded.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!openId) return;
    adminApi.get(`/compliance/reports/${openId}`).then((response) => setDetail(response.data)).catch((err) => {
      if (!isAdminAuthRedirectError(err)) toast.error(err?.response?.data?.error || 'The report could not be opened.');
    });
  }, [openId]);

  const visible = filterByText(rows, query, (row) => `${reportName(row.report_key)} ${row.period_start || ''} ${row.status}`);
  const phase = listPhase({ requested, loading, error, authFailed, count: visible.length });

  async function transition() {
    if (!confirm || !submissionAllowed(busy)) return;
    setBusy(true);
    try {
      await adminApi.post(`/compliance/reports/${confirm.id}/transition`, { status: confirm.status });
      toast.success('Report status saved. Filing ready: no.');
      setConfirm(null);
      await load();
      const response = await adminApi.get(`/compliance/reports/${confirm.id}`);
      setDetail(response.data);
    } catch (err: any) {
      if (!isAdminAuthRedirectError(err)) toast.error(err?.response?.data?.error || 'The status could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  const action = detail ? nextReportAction(detail.report?.status) : null;

  return (
    <div className={`p-6 space-y-4 ${adminUi.workspace}`}>
      <div>
        <h1 className={adminUi.pageTitle}>Reports</h1>
        <PreviewBanner />
      </div>
      <input className={adminUi.field} style={{ maxWidth: 320 }} placeholder="Search report or period" value={query} onChange={(event) => setQuery(event.target.value)} />
      <ReadStatus phase={phase === 'empty' || phase === 'ready' || phase === 'idle' ? 'ready' : phase} error={error} onRetry={load} />
      <div className={`overflow-x-auto ${adminUi.panel}`}>
        <table className="w-full">
          <thead className={adminUi.tableHead}><tr>{['Report', 'Period', 'Created', 'Status', 'Filing', ''].map((heading) => <th key={heading} className="px-3 py-2 text-left">{heading}</th>)}</tr></thead>
          <tbody>
            {phase === 'ready' || phase === 'refreshing' || (phase === 'error' && visible.length > 0) ? visible.map((row) => (
              <tr key={row._id} className={adminUi.tableRowHover}>
                <td className={adminUi.tableCell}>{reportName(row.report_key)}</td>
                <td className={adminUi.tableCell}>{row.period_start || '—'} – {row.period_end || '—'}</td>
                <td className={adminUi.tableCell}>{formatAuditTime(row.created_at)}</td>
                <td className={adminUi.tableCell}><StatusBadge status={row.status} /></td>
                <td className={adminUi.tableCell}>No</td>
                <td className={`${adminUi.tableCell} text-right`}><button className="underline" type="button" onClick={() => setOpenId(row._id)}>View</button></td>
              </tr>
            )) : phase === 'empty' ? <EmptyRow colSpan={6} text={query ? 'No reports match this search.' : 'No reports to display.'} /> : phase === 'loading' ? <EmptyRow colSpan={6} text="Loading…" /> : null}
          </tbody>
        </table>
      </div>
      {detail && (
        <Drawer title={reportName(detail.report.report_key)} onClose={() => { setDetail(null); setOpenId(''); }}>
          <PreviewBanner />
          <p className={adminUi.body}>{detail.report.period_start} – {detail.report.period_end}</p>
          <StatusBadge status={detail.report.status} />
          <p className={adminUi.meta}>Created by {actorLabel(detail.report.actor)} · {formatAuditTime(detail.report.created_at)}</p>
          {action && <button className={adminUi.btnPrimary} type="button" onClick={() => setConfirm({ id: detail.report._id, status: action.status, label: action.label })}>{action.label}</button>}
          <h3 className={adminUi.sectionTitle}>History</h3>
          {(detail.history || []).length === 0 ? <p className={adminUi.meta}>No history rows were returned.</p> : (
            <ul className="text-sm space-y-1">{detail.history.map((row: any) => <li key={row._id}>{formatAuditTime(row.created_at)} · {actorLabel(row.actor)} · {row.action}</li>)}</ul>
          )}
          {detail.report.snapshot?.buckets && (
            <ul className="text-sm space-y-1">
              {Object.entries(detail.report.snapshot.buckets).map(([key, value]) => <li key={key}>{key}: {formatPacks(value)}</li>)}
              <li>Expected closing: {formatPacks(detail.report.snapshot.calculatedClosingPacks)}</li>
              <li>Stated closing: {formatPacks(detail.report.snapshot.statedClosingPacks)}</li>
            </ul>
          )}
          <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(detail.report.snapshot, null, 2)}</pre>
        </Drawer>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.label}
          body="This records a review status. It does not file the report."
          confirmLabel={confirm.label}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={transition}
        />
      )}
    </div>
  );
}
