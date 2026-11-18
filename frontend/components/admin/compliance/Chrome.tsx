'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { adminUi } from '@/lib/admin-ui';
import { formatCents, formatCount, reasonText, statusLabel, type CountView, type MoneyView } from '@/lib/compliance-display';

export function ModuleTabs({ tabs, current }: { tabs: Array<{ id: string; label: string; href: string }>; current: string }) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-[#E3E5E8]">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className={`px-3 py-2 text-sm ${current === tab.id ? 'border-b-2 border-black text-[#1A1A1A] font-medium' : 'text-[#6B6C72] hover:text-[#1A1A1A]'}`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

export function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className={`p-4 ${adminUi.panel}`}>
      <p className={adminUi.label}>{label}</p>
      <p className={`mt-2 ${adminUi.metric}`}>{value}</p>
      {detail && <p className={`mt-1 ${adminUi.meta}`}>{detail}</p>}
    </div>
  );
}

export function CountCard({ label, value, detail }: { label: string; value: CountView | null; detail?: string }) {
  return <MetricCard label={label} value={formatCount(value)} detail={value?.availability === 'unavailable' ? value.reason : detail} />;
}

export function StatusBadge({ status }: { status: string }) {
  const warning = status === 'incomplete' || status === 'discrepancy' || status === 'needs_review' || status === 'pending_review';
  const className = warning ? adminUi.badgeUnpaid : status === 'recorded' || status === 'approved' ? adminUi.badgePaid : adminUi.badge;
  return <span className={className}>{statusLabel(status)}</span>;
}

export function Money({ value }: { value: MoneyView | null | undefined }) {
  return <span className="tabular-nums">{formatCents(value)}</span>;
}

export function ReasonList({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return <p className={adminUi.meta}>No missing fields were returned for this record.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {reasons.map((reason) => (
        <li key={reason}>{reasonText(reason)}</li>
      ))}
    </ul>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[rgba(26,26,26,0.45)]">
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <h2 className={adminUi.sectionTitle}>{title}</h2>
          <button className={adminUi.btnGhost} type="button" onClick={onClose}>Close</button>
        </div>
        <div className="mt-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className={adminUi.modalBackdrop}>
      <div className={`w-full max-w-md p-6 ${adminUi.modal}`}>
        <h2 className={adminUi.sectionTitle}>{title}</h2>
        <p className={`mt-2 ${adminUi.body}`}>{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className={adminUi.btnSecondary} type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={adminUi.btnPrimary} type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Saving…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function ReadStatus({ phase, error, onRetry }: { phase: 'loading' | 'refreshing' | 'error' | 'auth' | string; error?: string; onRetry?: () => void }) {
  if (phase === 'loading') return <p className={adminUi.meta}>Loading…</p>;
  if (phase === 'refreshing') return <p className={adminUi.meta}>Refreshing…</p>;
  if (phase === 'auth') return <p className={adminUi.meta}>The administrator session is not available.</p>;
  if (phase === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-[#8A100E]">{error || 'The request failed.'}</p>
        {onRetry && <button className={adminUi.btnSecondary} type="button" onClick={onRetry}>Retry</button>}
      </div>
    );
  }
  return null;
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td className={adminUi.tableCell} colSpan={colSpan}>{text}</td>
    </tr>
  );
}

export function PreviewBanner() {
  return <p className="text-sm text-[#8A4500]">PREVIEW — NOT AN OFFICIAL FILING. Filing ready: no.</p>;
}
