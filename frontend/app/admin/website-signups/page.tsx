'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  RefreshCw,
  UserPlus,
  X,
} from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import { formatApiError } from '@/lib/format-api-error';
import { adminUi } from '@/lib/admin-ui';
import toast from 'react-hot-toast';

type ApplicationStatus = 'pending' | 'approved' | 'rejected';
type LinkOutcome = 'created' | 'linked' | 'unlinked';
type MatchKind =
  | 'none'
  | 'approved_crm'
  | 'already_linked'
  | 'ambiguous'
  | 'non_approved_crm';

interface WebsiteSignupApplication {
  id: string;
  user_id: string | null;
  submitted_name: string | null;
  submitted_email: string | null;
  submitted_phone: string | null;
  status: ApplicationStatus;
  link_outcome: LinkOutcome;
  customer_id: string | null;
  matched_customer_ids: string[];
  match_kind: MatchKind;
  created_at: string;
  updated_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

interface ListResponse {
  applications: WebsiteSignupApplication[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

type StatusTab = 'pending' | 'approved' | 'rejected' | 'all';

const REVIEW_NOTE_MAX = 2000;
const PAGE_LIMIT = 50;

const STATUS_BADGE: Record<ApplicationStatus, string> = {
  pending: adminUi.badgeUnpaid,
  approved: adminUi.badgePaid,
  rejected: 'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#FDECEC] text-[#8A100E]',
};

function isObjectIdString(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

/** UX safeguard mirroring backend safe-path eligibility. Backend remains authoritative. */
function canApproveApplication(app: WebsiteSignupApplication): boolean {
  return (
    app.status === 'pending' &&
    app.link_outcome === 'created' &&
    app.match_kind === 'none' &&
    isObjectIdString(app.user_id) &&
    isObjectIdString(app.customer_id)
  );
}

function needsManualResolution(app: WebsiteSignupApplication): boolean {
  if (app.status !== 'pending') return false;
  return !canApproveApplication(app);
}

function matchKindLabel(kind: MatchKind): string {
  switch (kind) {
    case 'none':
      return 'New customer (no CRM match)';
    case 'approved_crm':
      return 'Matched approved CRM customer';
    case 'non_approved_crm':
      return 'Matched non-approved CRM customer';
    case 'already_linked':
      return 'Matched CRM already linked to another user';
    case 'ambiguous':
      return 'Ambiguous CRM matches';
    default:
      return String(kind);
  }
}

function displayOrDash(value: string | null | undefined): string {
  const t = typeof value === 'string' ? value.trim() : '';
  return t || '—';
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function axiosStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

/** Backend may return 500 after the decision was applied (audit/recovery gaps). */
function isPotentiallyAppliedDecisionError(status: number | undefined, message: string): boolean {
  if (status !== 500) return false;
  const m = message.toLowerCase();
  return (
    m.includes('audit logging failed') ||
    m.includes('requires recovery') ||
    m.includes('requires investigation') ||
    (m.includes('approved but') && m.includes('audit')) ||
    (m.includes('rejected but') && m.includes('audit')) ||
    m.includes('approval incomplete')
  );
}

export default function WebsiteSignupsPage() {
  const [applications, setApplications] = useState<WebsiteSignupApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<StatusTab>('pending');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_LIMIT, total: 0, totalPages: 0 });

  const [selected, setSelected] = useState<WebsiteSignupApplication | null>(null);
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WebsiteSignupApplication | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [approveNote, setApproveNote] = useState('');

  const fetchApplications = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    setLoadError(null);
    try {
      const params: Record<string, string | number> = { page, limit: PAGE_LIMIT };
      if (statusTab !== 'all') params.status = statusTab;
      const res = await adminApi.get<ListResponse>('/admin/website-signup-applications', { params });
      const rows = Array.isArray(res.data?.applications) ? res.data.applications : [];
      setApplications(rows);
      setPagination({
        page: res.data?.pagination?.page ?? page,
        limit: res.data?.pagination?.limit ?? PAGE_LIMIT,
        total: res.data?.pagination?.total ?? rows.length,
        totalPages: res.data?.pagination?.totalPages ?? 0,
      });
      setSelected((cur) => {
        if (!cur) return null;
        return rows.find((r) => r.id === cur.id) ?? null;
      });
    } catch (error) {
      if (isAdminAuthRedirectError(error)) return;
      const message = formatApiError(error, 'Failed to load website signup applications');
      setLoadError(message);
      setApplications([]);
      if (!opts?.quiet) toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [page, statusTab]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  useEffect(() => {
    setPage(1);
  }, [statusTab]);

  const handleApprove = async (app: WebsiteSignupApplication) => {
    if (!canApproveApplication(app) || decisionBusyId) return;
    const note = approveNote.trim();
    if (note.length > REVIEW_NOTE_MAX) {
      toast.error(`Review note must be at most ${REVIEW_NOTE_MAX} characters`);
      return;
    }
    if (
      !confirm(
        `Approve website signup for ${displayOrDash(app.submitted_name)}?\n\nThis grants commercial access once the linked customer is approved.`
      )
    ) {
      return;
    }

    setDecisionBusyId(app.id);
    try {
      const body = note ? { review_note: note } : {};
      await adminApi.post(`/admin/website-signup-applications/${app.id}/approve`, body);
      toast.success('Application approved');
      setApproveNote('');
      await fetchApplications({ quiet: true });
    } catch (error) {
      if (isAdminAuthRedirectError(error)) return;
      const status = axiosStatus(error);
      const message = formatApiError(error, 'Failed to approve application');
      if (status === 409) {
        toast.error(`Conflict: ${message}. Refreshing the queue.`);
        await fetchApplications({ quiet: true });
      } else if (isPotentiallyAppliedDecisionError(status, message)) {
        toast.error(
          `${message} The decision may already be applied — refresh and verify before retrying.`
        );
        await fetchApplications({ quiet: true });
      } else {
        toast.error(message);
        await fetchApplications({ quiet: true });
      }
    } finally {
      setDecisionBusyId(null);
    }
  };

  const openReject = (app: WebsiteSignupApplication) => {
    if (app.status !== 'pending' || decisionBusyId) return;
    setRejectTarget(app);
    setRejectNote('');
  };

  const submitReject = async () => {
    if (!rejectTarget || decisionBusyId) return;
    const note = rejectNote.trim();
    if (note.length > REVIEW_NOTE_MAX) {
      toast.error(`Review note must be at most ${REVIEW_NOTE_MAX} characters`);
      return;
    }

    setDecisionBusyId(rejectTarget.id);
    try {
      const body = note ? { review_note: note } : {};
      await adminApi.post(`/admin/website-signup-applications/${rejectTarget.id}/reject`, body);
      toast.success('Application rejected. Existing CRM customers were not modified.');
      setRejectTarget(null);
      setRejectNote('');
      await fetchApplications({ quiet: true });
    } catch (error) {
      if (isAdminAuthRedirectError(error)) return;
      const status = axiosStatus(error);
      const message = formatApiError(error, 'Failed to reject application');
      if (status === 409) {
        toast.error(`Conflict: ${message}. Refreshing the queue.`);
        setRejectTarget(null);
        await fetchApplications({ quiet: true });
      } else if (isPotentiallyAppliedDecisionError(status, message)) {
        toast.error(
          `${message} The decision may already be applied — refresh and verify before retrying.`
        );
        setRejectTarget(null);
        await fetchApplications({ quiet: true });
      } else {
        toast.error(message);
      }
    } finally {
      setDecisionBusyId(null);
    }
  };

  const tabs: { key: StatusTab; label: string }[] = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className={adminUi.pageTitle}>Website signups</h1>
          <p className={`${adminUi.meta} mt-1 max-w-2xl`}>
            Review storefront registration applications. Approve only new customers with no CRM
            collision. Matches that need identity resolution stay pending until handled separately.
            Rejection does not change existing CRM customer records.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchApplications()}
          disabled={loading || Boolean(decisionBusyId)}
          className={adminUi.btnSecondary}
          aria-label="Refresh website signup applications"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3E5E8]">
        <div className="flex" role="tablist" aria-label="Application status">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={statusTab === tab.key}
              onClick={() => setStatusTab(tab.key)}
              className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px ${
                statusTab === tab.key
                  ? 'border-black text-[#1A1A1A]'
                  : 'border-transparent text-[#6B6C72] hover:text-[#1A1A1A]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className={`${adminUi.helper} pb-2 sm:pb-0`}>
          {pagination.total} application{pagination.total === 1 ? '' : 's'}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
          <span className="sr-only">Loading applications</span>
        </div>
      ) : loadError ? (
        <div className={`${adminUi.panel} p-10 text-center`}>
          <p className="text-sm text-[#1A1A1A]">Could not load applications.</p>
          <p className={`${adminUi.meta} mt-1`}>{loadError}</p>
          <button type="button" onClick={() => fetchApplications()} className={`${adminUi.btnPrimary} mt-4`}>
            Retry
          </button>
        </div>
      ) : applications.length === 0 ? (
        <div className={`${adminUi.panel} p-12 text-center`}>
          <ClipboardList className="w-10 h-10 text-[#C7C7C7] mx-auto mb-3" aria-hidden />
          <p className="text-sm text-[#1A1A1A]">
            No {statusTab === 'all' ? '' : `${statusTab} `}website signup applications.
          </p>
          <p className={`${adminUi.meta} mt-1`}>
            New storefront registrations create an application here for review.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <div className={`xl:col-span-3 ${adminUi.panel} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={adminUi.tableHead}>
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Submitted</th>
                    <th className="text-left px-4 py-3 font-medium">Applicant</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Identity</th>
                    <th className="text-right px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((app) => {
                    const busy = decisionBusyId === app.id;
                    const approvable = canApproveApplication(app);
                    const manual = needsManualResolution(app);
                    const selectedRow = selected?.id === app.id;
                    return (
                      <tr
                        key={app.id}
                        className={`border-t border-[#E3E5E8] ${adminUi.tableRowHover} ${
                          selectedRow ? 'bg-[#F4F5F8]' : ''
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap align-top">
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => setSelected(app)}
                          >
                            <span className="text-[#1A1A1A] block">{formatWhen(app.created_at)}</span>
                            <span className={`${adminUi.helper} font-mono`}>{app.id.slice(-8)}</span>
                          </button>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <button type="button" className="text-left" onClick={() => setSelected(app)}>
                            <span className="font-medium text-[#1A1A1A] block">
                              {displayOrDash(app.submitted_name)}
                            </span>
                            <span className={`${adminUi.helper} block`}>{displayOrDash(app.submitted_email)}</span>
                            <span className={adminUi.helper}>{displayOrDash(app.submitted_phone)}</span>
                          </button>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span className={STATUS_BADGE[app.status] || adminUi.badge}>{app.status}</span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {manual ? (
                            <span className={adminUi.badgeUnpaid}>Manual resolution required</span>
                          ) : app.link_outcome === 'created' && app.match_kind === 'none' ? (
                            <span className={adminUi.badgeDraft}>Safe new customer</span>
                          ) : (
                            <span className={adminUi.badge}>{matchKindLabel(app.match_kind)}</span>
                          )}
                          <span className={`${adminUi.helper} block mt-1`}>
                            {app.link_outcome} · {app.match_kind}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-wrap justify-end gap-2">
                            {app.status === 'pending' && approvable && (
                              <button
                                type="button"
                                disabled={Boolean(decisionBusyId)}
                                onClick={() => handleApprove(app)}
                                className={adminUi.btnPrimary}
                                aria-label={`Approve application for ${displayOrDash(app.submitted_name)}`}
                              >
                                <Check className="w-3.5 h-3.5" />
                                {busy ? 'Working…' : 'Approve'}
                              </button>
                            )}
                            {app.status === 'pending' && (
                              <button
                                type="button"
                                disabled={Boolean(decisionBusyId)}
                                onClick={() => openReject(app)}
                                className={adminUi.btnSecondary}
                                aria-label={`Reject application for ${displayOrDash(app.submitted_name)}`}
                              >
                                <X className="w-3.5 h-3.5" />
                                Reject
                              </button>
                            )}
                            {app.status !== 'pending' && (
                              <button
                                type="button"
                                onClick={() => setSelected(app)}
                                className={adminUi.btnGhost}
                              >
                                View
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#E3E5E8]">
                <p className={adminUi.helper}>
                  Page {pagination.page} of {pagination.totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={adminUi.btnSecondary}
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Prev
                  </button>
                  <button
                    type="button"
                    className={adminUi.btnSecondary}
                    disabled={page >= pagination.totalPages || loading}
                    onClick={() => setPage((p) => p + 1)}
                    aria-label="Next page"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          <aside className={`xl:col-span-2 ${adminUi.panel} p-5 space-y-4`} aria-label="Application details">
            {!selected ? (
              <div className="py-10 text-center">
                <UserPlus className="w-8 h-8 text-[#C7C7C7] mx-auto mb-2" aria-hidden />
                <p className="text-sm text-[#1A1A1A]">Select an application</p>
                <p className={`${adminUi.meta} mt-1`}>
                  Applicant details and identity-resolution metadata appear here.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className={adminUi.sectionTitle}>{displayOrDash(selected.submitted_name)}</h2>
                    <p className={adminUi.meta}>Application detail</p>
                  </div>
                  <span className={STATUS_BADGE[selected.status]}>{selected.status}</span>
                </div>

                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className={adminUi.label}>Email</dt>
                    <dd className="text-[#1A1A1A]">{displayOrDash(selected.submitted_email)}</dd>
                  </div>
                  <div>
                    <dt className={adminUi.label}>Phone</dt>
                    <dd className="text-[#1A1A1A]">{displayOrDash(selected.submitted_phone)}</dd>
                  </div>
                  <div>
                    <dt className={adminUi.label}>Submitted</dt>
                    <dd className="text-[#1A1A1A]">{formatWhen(selected.created_at)}</dd>
                  </div>
                  <div>
                    <dt className={adminUi.label}>User ID</dt>
                    <dd className="text-[#1A1A1A] font-mono text-xs break-all">
                      {displayOrDash(selected.user_id)}
                    </dd>
                  </div>
                  <div>
                    <dt className={adminUi.label}>Customer ID</dt>
                    <dd className="text-[#1A1A1A] font-mono text-xs break-all">
                      {displayOrDash(selected.customer_id)}
                    </dd>
                  </div>
                  <div>
                    <dt className={adminUi.label}>Link outcome</dt>
                    <dd className="text-[#1A1A1A]">{selected.link_outcome}</dd>
                  </div>
                  <div>
                    <dt className={adminUi.label}>Match kind</dt>
                    <dd className="text-[#1A1A1A]">{matchKindLabel(selected.match_kind)}</dd>
                  </div>
                  {selected.matched_customer_ids.length > 0 && (
                    <div>
                      <dt className={adminUi.label}>Matched CRM customer IDs</dt>
                      <dd className="text-[#1A1A1A] font-mono text-xs break-all space-y-1">
                        {selected.matched_customer_ids.map((id) => (
                          <div key={id}>{id}</div>
                        ))}
                      </dd>
                    </div>
                  )}
                  {selected.reviewed_at && (
                    <div>
                      <dt className={adminUi.label}>Reviewed</dt>
                      <dd className="text-[#1A1A1A]">{formatWhen(selected.reviewed_at)}</dd>
                    </div>
                  )}
                  {selected.review_note && (
                    <div>
                      <dt className={adminUi.label}>Review note</dt>
                      <dd className="text-[#1A1A1A] whitespace-pre-wrap">{selected.review_note}</dd>
                    </div>
                  )}
                </dl>

                {needsManualResolution(selected) && (
                  <div className="rounded-md border border-[#F5A623]/40 bg-[#FFF4E5] px-3 py-3">
                    <p className="text-sm font-medium text-[#8A4500]">Manual resolution required</p>
                    <p className={`${adminUi.meta} mt-1 text-[#8A4500]`}>
                      This application cannot be auto-approved. CRM identity must be resolved outside
                      this queue. Reject is still available if the signup should be declined.
                    </p>
                  </div>
                )}

                {canApproveApplication(selected) && (
                  <div className="space-y-2 border-t border-[#E3E5E8] pt-4">
                    <label htmlFor="approve-note" className={adminUi.label}>
                      Optional approve note
                    </label>
                    <textarea
                      id="approve-note"
                      value={approveNote}
                      onChange={(e) => setApproveNote(e.target.value.slice(0, REVIEW_NOTE_MAX))}
                      rows={2}
                      className={adminUi.field}
                      placeholder="Optional note for the audit trail"
                      disabled={Boolean(decisionBusyId)}
                    />
                    <p className={adminUi.helper}>{approveNote.length}/{REVIEW_NOTE_MAX}</p>
                    <button
                      type="button"
                      disabled={Boolean(decisionBusyId)}
                      onClick={() => handleApprove(selected)}
                      className={`${adminUi.btnPrimary} w-full`}
                    >
                      <Check className="w-4 h-4" />
                      {decisionBusyId === selected.id ? 'Approving…' : 'Approve application'}
                    </button>
                  </div>
                )}

                {selected.status === 'pending' && (
                  <button
                    type="button"
                    disabled={Boolean(decisionBusyId)}
                    onClick={() => openReject(selected)}
                    className={`${adminUi.btnSecondary} w-full`}
                  >
                    <X className="w-4 h-4" />
                    Reject application
                  </button>
                )}
              </>
            )}
          </aside>
        </div>
      )}

      {rejectTarget && (
        <div className={adminUi.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="reject-title">
          <div className={`${adminUi.modal} w-full max-w-md p-5 space-y-4`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="reject-title" className={adminUi.sectionTitle}>
                  Reject application
                </h2>
                <p className={`${adminUi.meta} mt-1`}>
                  Reject {displayOrDash(rejectTarget.submitted_name)}. This does not delete or modify
                  an existing CRM customer.
                </p>
              </div>
              <button
                type="button"
                className={adminUi.btnIcon}
                onClick={() => !decisionBusyId && setRejectTarget(null)}
                aria-label="Close reject dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label htmlFor="reject-note" className={adminUi.label}>
                Optional review note
              </label>
              <textarea
                id="reject-note"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value.slice(0, REVIEW_NOTE_MAX))}
                rows={3}
                className={`${adminUi.field} mt-1`}
                placeholder="Reason for rejection (optional)"
                disabled={Boolean(decisionBusyId)}
              />
              <p className={`${adminUi.helper} mt-1`}>
                {rejectNote.length}/{REVIEW_NOTE_MAX}
              </p>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                type="button"
                className={adminUi.btnSecondary}
                disabled={Boolean(decisionBusyId)}
                onClick={() => setRejectTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={adminUi.btnDanger}
                disabled={Boolean(decisionBusyId)}
                onClick={submitReject}
              >
                {decisionBusyId === rejectTarget.id ? 'Rejecting…' : 'Confirm reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
