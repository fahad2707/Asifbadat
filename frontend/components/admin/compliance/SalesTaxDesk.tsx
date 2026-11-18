'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import { actorLabel, formatAuditTime, formatCents, listPhase, submissionAllowed, validatePeriod, type MoneyView } from '@/lib/compliance-display';
import { ConfirmDialog, Drawer, EmptyRow, MetricCard, ModuleTabs, Money, PreviewBanner, ReadStatus, ReasonList, StatusBadge } from './Chrome';

type Tab = 'overview' | 'transactions' | 'exemptions' | 'reconciliation' | 'reports';
type Row = {
  id: string;
  source: string;
  number: string;
  date: string | null;
  customer: string | null;
  storedTotal: MoneyView;
  recordedTax: MoneyView;
  taxableBase: MoneyView;
  jurisdictionStatus: string;
  complianceStatus: string;
  reasons: string[];
};
type SummaryPayload = {
  counts: { invoices: number; posSales: number; onlineOrders: number };
  summary: {
    recordedTax: MoneyView;
    taxable: MoneyView;
    incompleteCount: number;
    discrepancies: Array<{ id: string; reason: string }>;
    filingReady: false;
  };
};
type Exemption = {
  _id: string;
  customer_id: string;
  certificate_number?: string;
  exemption_type?: string;
  status: string;
  effective_on?: string;
  expires_on?: string;
  created_at?: string;
};
type HistoryRow = { _id: string; action: string; created_at?: string; actor?: { label?: string | null } };

const TABS: Tab[] = ['overview', 'transactions', 'exemptions', 'reconciliation', 'reports'];
const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  transactions: 'Transactions',
  exemptions: 'Exemptions',
  reconciliation: 'Reconciliation',
  reports: 'Reports',
};

function failure(err: any, fallback: string) {
  if (isAdminAuthRedirectError(err)) return '';
  return err?.response?.data?.error || fallback;
}

export default function SalesTaxDesk() {
  const params = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'overview';
  const [start, setStart] = useState(params.get('start') || '');
  const [end, setEnd] = useState(params.get('end') || '');
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<any>(null);
  const [exemptions, setExemptions] = useState<Exemption[]>([]);
  const [exemptionHistory, setExemptionHistory] = useState<HistoryRow[]>([]);
  const [exemptionLoading, setExemptionLoading] = useState(false);
  const [exemptionAttempted, setExemptionAttempted] = useState(false);
  const [reports, setReports] = useState<any[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsAttempted, setReportsAttempted] = useState(false);
  const [periodAttempted, setPeriodAttempted] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draftOpen, setDraftOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; status: string } | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; tax_exempt?: boolean }>>([]);
  const [draft, setDraft] = useState({ customerId: '', certificateNumber: '', exemptionType: '', effectiveOn: '' });

  function href(next: Tab) {
    const search = new URLSearchParams({ tab: next });
    if (start) search.set('start', start);
    if (end) search.set('end', end);
    return `/admin/compliance/sales-tax?${search.toString()}`;
  }

  async function loadPeriod(nextPage = 1) {
    const invalid = validatePeriod(start, end);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!submissionAllowed(loading || busy)) return;
    setPeriodAttempted(true);
    setLoading(true);
    setAuthFailed(false);
    setError('');
    try {
      const [summaryResponse, register] = await Promise.all([
        adminApi.get('/compliance/sales-tax/summary', { params: { start, end } }),
        adminApi.get('/compliance/sales-tax/transactions', { params: { start, end, source, status, q: query, page: nextPage, limit: 50 } }),
      ]);
      setSummary(summaryResponse.data);
      setRows(register.data.rows || []);
      setTotal(register.data.total || 0);
      setPage(register.data.page || 1);
    } catch (err) {
      if (isAdminAuthRedirectError(err)) setAuthFailed(true);
      setError(failure(err, 'The period could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }

  async function openRow(row: Row) {
    try {
      const response = await adminApi.get(`/compliance/sales-tax/transactions/${row.source}/${row.id}`);
      setDetail(response.data);
    } catch (err) {
      const text = failure(err, 'The transaction could not be opened.');
      if (text) toast.error(text);
    }
  }

  useEffect(() => {
    if (tab !== 'exemptions' && tab !== 'reports') return;
    let ignore = false;
    if (tab === 'exemptions') {
      setExemptionLoading(true);
      setExemptionAttempted(true);
      adminApi.get('/compliance/exemptions').then((response) => {
        if (ignore) return;
        setExemptions(response.data.rows || []);
        setExemptionHistory(response.data.history || []);
      }).catch((err) => {
        if (!ignore) {
          if (isAdminAuthRedirectError(err)) setAuthFailed(true);
          setError(failure(err, 'Exemptions could not be loaded.'));
        }
      }).finally(() => {
        if (!ignore) setExemptionLoading(false);
      });
    }
    if (tab === 'reports') {
      setReportsLoading(true);
      setReportsAttempted(true);
      adminApi.get('/compliance/reports').then((response) => {
        if (ignore) return;
        setReports((response.data.rows || []).filter((row: any) => row.report_key === 'sales_tax_summary'));
      }).catch((err) => {
        if (!ignore) {
          if (isAdminAuthRedirectError(err)) setAuthFailed(true);
          setError(failure(err, 'Reports could not be loaded.'));
        }
      }).finally(() => {
        if (!ignore) setReportsLoading(false);
      });
    }
    return () => {
      ignore = true;
    };
  }, [tab]);

  async function saveSnapshot() {
    if (!submissionAllowed(busy)) return;
    const invalid = validatePeriod(start, end);
    if (invalid) return setError(invalid);
    setBusy(true);
    try {
      await adminApi.post('/compliance/reports/sales-tax', { start, end });
      toast.success('Preview snapshot saved. Filing ready: no.');
      const response = await adminApi.get('/compliance/reports');
      setReports((response.data.rows || []).filter((row: any) => row.report_key === 'sales_tax_summary'));
    } catch (err) {
      const text = failure(err, 'The preview could not be saved.');
      if (text) toast.error(text);
    } finally {
      setBusy(false);
    }
  }

  async function searchCustomers() {
    const response = await adminApi.get('/customers', { params: { search: customerQuery, limit: 8 } });
    setCustomers(response.data.customers || []);
  }

  async function createDraft() {
    if (!submissionAllowed(busy)) return;
    if (!draft.customerId) return toast.error('Choose a customer.');
    if (!draft.certificateNumber.trim()) return toast.error('A certificate number is required.');
    setBusy(true);
    try {
      await adminApi.post('/compliance/exemptions', draft);
      toast.success('Draft saved. The customer tax-exempt flag was not changed.');
      setDraftOpen(false);
      const response = await adminApi.get('/compliance/exemptions');
      setExemptions(response.data.rows || []);
      setExemptionHistory(response.data.history || []);
    } catch (err) {
      const text = failure(err, 'The draft could not be saved.');
      if (text) toast.error(text);
    } finally {
      setBusy(false);
    }
  }

  async function reviewExemption() {
    if (!confirm || !submissionAllowed(busy)) return;
    setBusy(true);
    try {
      await adminApi.post(`/compliance/exemptions/${confirm.id}/review`, { status: confirm.status });
      toast.success('Status saved. Checkout was not changed.');
      setConfirm(null);
      const response = await adminApi.get('/compliance/exemptions');
      setExemptions(response.data.rows || []);
      setExemptionHistory(response.data.history || []);
    } catch (err) {
      const text = failure(err, 'The exemption could not be reviewed.');
      if (text) toast.error(text);
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv() {
    const invalid = validatePeriod(start, end);
    if (invalid) return setError(invalid);
    const response = await adminApi.get('/compliance/sales-tax/export.csv', { params: { start, end }, responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sales-tax-preview.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  const periodPhase = listPhase({ requested: periodAttempted, loading, error, authFailed, count: rows.length });
  const exemptionPhase = listPhase({ requested: exemptionAttempted, loading: exemptionLoading, error: tab === 'exemptions' ? error : '', authFailed, count: exemptions.length });
  const salesReportPhase = listPhase({ requested: reportsAttempted, loading: reportsLoading, error: tab === 'reports' ? error : '', authFailed, count: reports.length });

  return (
    <div className={`p-6 space-y-4 ${adminUi.workspace}`}>
      <div>
        <h1 className={adminUi.pageTitle}>Sales tax</h1>
        <p className={`mt-1 ${adminUi.meta}`}>Work from the transaction register. Filing stays disabled.</p>
      </div>
      <ModuleTabs tabs={TABS.map((id) => ({ id, label: TAB_LABELS[id], href: href(id) }))} current={tab} />
      <div className={`p-4 flex flex-wrap items-end gap-3 ${adminUi.panel}`}>
        <label className="text-sm">From<input className={`mt-1 ${adminUi.field}`} type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label className="text-sm">To<input className={`mt-1 ${adminUi.field}`} type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        <button className={adminUi.btnPrimary} type="button" disabled={loading} onClick={() => loadPeriod(1)}>{loading ? 'Loading…' : 'Load period'}</button>
      </div>
      <ReadStatus phase={authFailed ? 'auth' : error ? 'error' : 'ready'} error={error} onRetry={() => {
        if (tab === 'exemptions') {
          setExemptionLoading(true);
          adminApi.get('/compliance/exemptions').then((response) => {
            setExemptions(response.data.rows || []);
            setExemptionHistory(response.data.history || []);
            setError('');
          }).catch((err) => setError(failure(err, 'Exemptions could not be loaded.'))).finally(() => setExemptionLoading(false));
        } else if (tab === 'reports') {
          setReportsLoading(true);
          adminApi.get('/compliance/reports').then((response) => {
            setReports((response.data.rows || []).filter((row: any) => row.report_key === 'sales_tax_summary'));
            setError('');
          }).catch((err) => setError(failure(err, 'Reports could not be loaded.'))).finally(() => setReportsLoading(false));
        } else {
          loadPeriod(1);
        }
      }} />

      {tab === 'overview' && !summary && <p className={adminUi.meta}>Load a period. No combined taxable base is shown until the records are read.</p>}
      {tab === 'overview' && summary && (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Wholesale invoices" value={String(summary.counts.invoices)} />
          <MetricCard label="POS transactions" value={String(summary.counts.posSales)} />
          <MetricCard label="Online orders" value={String(summary.counts.onlineOrders)} />
          <MetricCard label="Recorded tax" value={formatCents(summary.summary.recordedTax)} detail="Stored tax. Not a calculated return." />
          <MetricCard label="Taxable sales" value={formatCents(summary.summary.taxable)} detail="Wholesale snapshots only. Unavailable when the snapshot is missing." />
          <MetricCard label="Incomplete" value={String(summary.summary.incompleteCount)} detail={`${summary.summary.discrepancies.length} discrepancies`} />
        </div>
      )}

      {tab === 'transactions' && (
        <>
          <div className="flex flex-wrap gap-2">
            <select className={adminUi.field} style={{ width: 160 }} value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="all">All sources</option>
              <option value="wholesale">Wholesale</option>
              <option value="pos">POS</option>
              <option value="online">Online</option>
            </select>
            <select className={adminUi.field} style={{ width: 180 }} value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="recorded">Recorded</option>
              <option value="incomplete">Incomplete</option>
              <option value="discrepancy">Discrepancy</option>
            </select>
            <input className={adminUi.field} style={{ width: 240 }} placeholder="Document or customer" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button className={adminUi.btnSecondary} type="button" disabled={loading} onClick={() => loadPeriod(1)}>Search</button>
          </div>
          <div className={`overflow-x-auto ${adminUi.panel}`}>
            <table className="w-full">
              <thead className={adminUi.tableHead}>
                <tr>
                  {['Date', 'Document', 'Source', 'Customer', 'Stored total', 'Recorded tax', 'Jurisdiction', 'Status', ''].map((heading) => (
                    <th key={heading} className="px-3 py-2 text-left">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periodPhase === 'ready' || periodPhase === 'refreshing' ? rows.map((row) => (
                  <tr key={`${row.source}-${row.id}`} className={adminUi.tableRowHover}>
                    <td className={adminUi.tableCell}>{row.date || '—'}</td>
                    <td className={adminUi.tableCell}>{row.number}</td>
                    <td className={adminUi.tableCell}>{row.source}</td>
                    <td className={adminUi.tableCell}>{row.customer || '—'}</td>
                    <td className={adminUi.tableCell}><Money value={row.storedTotal} /></td>
                    <td className={adminUi.tableCell}><Money value={row.recordedTax} /></td>
                    <td className={adminUi.tableCell}>Not resolved</td>
                    <td className={adminUi.tableCell}><StatusBadge status={row.complianceStatus} /></td>
                    <td className={`${adminUi.tableCell} text-right`}><button className="underline" type="button" onClick={() => openRow(row)}>Open</button></td>
                  </tr>
                )) : <EmptyRow colSpan={9} text={periodPhase === 'empty' ? 'No transactions match these filters.' : periodPhase === 'loading' ? 'Loading…' : 'Load a period to see transactions.'} />}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <p className={adminUi.meta}>{periodPhase === 'ready' || periodPhase === 'refreshing' || periodPhase === 'empty' ? `${total} transactions` : periodPhase === 'loading' ? 'Loading…' : ''}</p>
            <div className="flex gap-2">
              <button className={adminUi.btnSecondary} type="button" disabled={page <= 1 || loading} onClick={() => loadPeriod(page - 1)}>Previous</button>
              <button className={adminUi.btnSecondary} type="button" disabled={page * 50 >= total || loading} onClick={() => loadPeriod(page + 1)}>Next</button>
            </div>
          </div>
        </>
      )}

      {tab === 'exemptions' && (
        <>
          <button className={adminUi.btnPrimary} type="button" onClick={() => setDraftOpen(true)}>Create draft</button>
          <div className={`overflow-x-auto ${adminUi.panel}`}>
            <table className="w-full">
              <thead className={adminUi.tableHead}>
                <tr>{['Customer', 'Certificate', 'Type', 'Effective', 'Expires', 'Status', ''].map((heading) => <th key={heading} className="px-3 py-2 text-left">{heading}</th>)}</tr>
              </thead>
              <tbody>
                {exemptionPhase === 'ready' || exemptionPhase === 'refreshing' ? exemptions.map((row) => (
                  <tr key={row._id}>
                    <td className={adminUi.tableCell}>{row.customer_id}</td>
                    <td className={adminUi.tableCell}>{row.certificate_number || '—'}</td>
                    <td className={adminUi.tableCell}>{row.exemption_type || '—'}</td>
                    <td className={adminUi.tableCell}>{row.effective_on ? String(row.effective_on).slice(0, 10) : '—'}</td>
                    <td className={adminUi.tableCell}>{row.expires_on ? String(row.expires_on).slice(0, 10) : '—'}</td>
                    <td className={adminUi.tableCell}><StatusBadge status={row.status} /></td>
                    <td className={`${adminUi.tableCell} text-right`}>
                      {row.status === 'draft' && <button className="underline mr-3" type="button" onClick={() => setConfirm({ id: row._id, status: 'pending_review' })}>Send for review</button>}
                      {row.status === 'pending_review' && (
                        <>
                          <button className="underline mr-3" type="button" onClick={() => setConfirm({ id: row._id, status: 'approved' })}>Approve</button>
                          <button className="underline" type="button" onClick={() => setConfirm({ id: row._id, status: 'rejected' })}>Reject</button>
                        </>
                      )}
                      {row.status === 'approved' && <button className="underline" type="button" onClick={() => setConfirm({ id: row._id, status: 'revoked' })}>Revoke</button>}
                    </td>
                  </tr>
                )) : <EmptyRow colSpan={7} text={exemptionPhase === 'empty' ? 'No exemption certificates have been saved.' : exemptionPhase === 'error' || exemptionPhase === 'auth' ? 'The certificates could not be loaded.' : 'Loading…'} />}
              </tbody>
            </table>
          </div>
          <section className={`p-4 ${adminUi.panel}`}>
            <h2 className={adminUi.sectionTitle}>Certificate history</h2>
            {exemptionPhase === 'loading' || exemptionPhase === 'idle' ? <p className={adminUi.meta}>Loading…</p> : exemptionHistory.length === 0 ? <p className={adminUi.meta}>No certificate history has been recorded.</p> : (
              <ul className="mt-2 text-sm space-y-1">
                {exemptionHistory.map((row) => <li key={row._id}>{formatAuditTime(row.created_at)} · {actorLabel(row.actor)} · {row.action}</li>)}
              </ul>
            )}
          </section>
        </>
      )}

      {tab === 'reconciliation' && (
        <section className={`p-4 space-y-3 ${adminUi.panel}`}>
          <h2 className={adminUi.sectionTitle}>Period workflow</h2>
          <ol className={`list-decimal ml-5 ${adminUi.body}`}>
            <li>Load the period.</li>
            <li>Review incomplete transactions and discrepancies.</li>
            <li>Save a preview snapshot. This does not mark the period reconciled or filed.</li>
          </ol>
          <PreviewBanner />
          {!summary ? <p className={adminUi.meta}>Load a period to compare the available records.</p> : (
            <>
              <p className={adminUi.body}>Recorded tax {formatCents(summary.summary.recordedTax)}. Taxable base {formatCents(summary.summary.taxable)}. Incomplete {summary.summary.incompleteCount}.</p>
              {summary.summary.discrepancies.length === 0 ? <p className={adminUi.meta}>No discrepancies were returned for the loaded records.</p> : (
                <ul className="text-sm space-y-1">
                  {summary.summary.discrepancies.slice(0, 30).map((item) => <li key={`${item.id}-${item.reason}`}>{item.id}: {item.reason.replace(/_/g, ' ')}</li>)}
                </ul>
              )}
              <button className={adminUi.btnPrimary} type="button" disabled={busy} onClick={saveSnapshot}>{busy ? 'Saving…' : 'Save preview snapshot'}</button>
            </>
          )}
        </section>
      )}

      {tab === 'reports' && (
        <section className="space-y-3">
          <div className="flex gap-2">
            <button className={adminUi.btnSecondary} type="button" onClick={downloadCsv}>Download preview CSV</button>
          </div>
          <PreviewBanner />
          <div className={`overflow-x-auto ${adminUi.panel}`}>
            <table className="w-full">
              <thead className={adminUi.tableHead}><tr>{['Report', 'Period', 'Status', 'Filing', ''].map((heading) => <th key={heading} className="px-3 py-2 text-left">{heading}</th>)}</tr></thead>
              <tbody>
                {salesReportPhase === 'ready' || salesReportPhase === 'refreshing' ? reports.map((report) => (
                  <tr key={report._id}>
                    <td className={adminUi.tableCell}>Sales tax summary</td>
                    <td className={adminUi.tableCell}>{report.period_start} – {report.period_end}</td>
                    <td className={adminUi.tableCell}><StatusBadge status={report.status} /></td>
                    <td className={adminUi.tableCell}>No</td>
                    <td className={`${adminUi.tableCell} text-right`}><Link className="underline" href={`/admin/compliance/reports?report=${report._id}`}>View</Link></td>
                  </tr>
                )) : <EmptyRow colSpan={5} text={salesReportPhase === 'empty' ? 'No sales-tax snapshots have been saved.' : salesReportPhase === 'loading' ? 'Loading…' : 'The reports could not be loaded.'} />}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {detail && (
        <Drawer title={detail.number || 'Transaction'} onClose={() => setDetail(null)}>
          <StatusBadge status={detail.complianceStatus} />
          <p className={adminUi.body}>{detail.source} · {detail.date || 'No date'} · {detail.customer || 'No customer'}</p>
          <p className={adminUi.body}>Stored total <Money value={detail.storedTotal} /></p>
          <p className={adminUi.body}>Recorded tax <Money value={detail.recordedTax} /></p>
          <p className={adminUi.body}>Taxable base <Money value={detail.taxableBase} /></p>
          <p className={adminUi.body}>Jurisdiction: not resolved.</p>
          <p className={adminUi.meta}>Stored location: {detail.storedLocation || 'Not on the document.'}</p>
          <p className={adminUi.meta}>Stored address: {detail.storedAddress || 'Not on the document.'}</p>
          <ReasonList reasons={detail.reasons || []} />
          <p className={adminUi.meta}>This view does not change the original document.</p>
        </Drawer>
      )}

      {draftOpen && (
        <Drawer title="New exemption draft" onClose={() => setDraftOpen(false)}>
          <div className="flex gap-2">
            <input className={adminUi.field} placeholder="Search customer" value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} />
            <button className={adminUi.btnSecondary} type="button" onClick={searchCustomers}>Search</button>
          </div>
          <ul className="text-sm">
            {customers.map((customer) => (
              <li key={customer.id}>
                <button type="button" className="underline" onClick={() => setDraft({ ...draft, customerId: customer.id })}>{customer.name}</button>
                <span className={adminUi.meta}> · checkout flag {customer.tax_exempt ? 'on' : 'off'}</span>
              </li>
            ))}
          </ul>
          <input className={adminUi.field} placeholder="Certificate number" value={draft.certificateNumber} onChange={(event) => setDraft({ ...draft, certificateNumber: event.target.value })} />
          <input className={adminUi.field} placeholder="Exemption type" value={draft.exemptionType} onChange={(event) => setDraft({ ...draft, exemptionType: event.target.value })} />
          <input className={adminUi.field} type="date" value={draft.effectiveOn} onChange={(event) => setDraft({ ...draft, effectiveOn: event.target.value })} />
          <p className={adminUi.meta}>Customer selected: {draft.customerId || 'none'}. Saving a draft does not change checkout.</p>
          <button className={adminUi.btnPrimary} type="button" disabled={busy} onClick={createDraft}>{busy ? 'Saving…' : 'Save draft'}</button>
        </Drawer>
      )}

      {confirm && (
        <ConfirmDialog
          title="Update exemption status"
          body="This changes the certificate status only. It does not change the customer tax-exempt flag or any invoice."
          confirmLabel="Save status"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={reviewExemption}
        />
      )}
    </div>
  );
}
