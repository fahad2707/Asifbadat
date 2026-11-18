export type CountView =
  | { availability: 'recorded'; count: number }
  | { availability: 'unavailable'; reason: string };

export type MoneyView =
  | { availability: 'recorded_preview'; cents: number }
  | { availability: 'unavailable'; reason: string };

const REASONS: Record<string, string> = {
  wholesale_line_tax_snapshot_missing: 'A line is missing its stored tax snapshot.',
  wholesale_amount_unreadable: 'A stored line amount could not be read.',
  header_tax_differs_from_line_snapshots: 'The document tax does not match the line snapshots.',
  pos_line_tax_missing: 'A POS line has no stored tax.',
  pos_header_tax_differs_from_lines: 'The POS tax does not match its lines.',
  pos_taxable_base_unavailable: 'POS has no historical taxable-base snapshot.',
  online_tax_rate_missing: 'An online line has no stored tax rate.',
  online_tax_unreadable: 'The online tax amount could not be read.',
  online_jurisdiction_not_resolved: 'The online jurisdiction has not been resolved.',
  online_taxable_base_unavailable: 'The online taxable base is not available.',
  quotations_are_not_sales: 'Quotations are excluded from sales.',
  pos_slip_is_not_a_second_sale: 'The linked POS slip is not a second sale.',
};

export function formatCount(value: CountView | null | undefined): string {
  if (!value || value.availability !== 'recorded' || !Number.isInteger(value.count)) return 'Not available';
  return String(value.count);
}

export function formatCents(value: MoneyView | null | undefined): string {
  if (!value || value.availability !== 'recorded_preview' || !Number.isInteger(value.cents)) return 'Not available';
  const sign = value.cents < 0 ? '-' : '';
  const dollars = Math.abs(value.cents) / 100;
  return `${sign}$${dollars.toFixed(2)}`;
}

export function reasonText(code: string): string {
  return REASONS[code] || code.replace(/_/g, ' ');
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    recorded: 'Recorded',
    incomplete: 'Incomplete',
    discrepancy: 'Discrepancy',
    draft: 'Draft',
    pending_review: 'Pending review',
    preview: 'Preview',
    needs_review: 'Needs review',
    approved: 'Approved',
    rejected: 'Rejected',
    revoked: 'Revoked',
    expired: 'Expired',
    amended: 'Amended',
    unknown: 'Unknown',
    cigarette: 'Cigarette',
    little_cigar: 'Little cigar',
    otp: 'OTP',
    non_tobacco: 'Non-tobacco',
  };
  return labels[status] || status;
}

export function reportName(key: string): string {
  if (key === 'sales_tax_summary') return 'Sales tax summary';
  if (key === 'rev_772') return 'REV-772';
  if (key === 'rev_777') return 'REV-777';
  return key;
}

export function nextReportAction(status: string): { status: string; label: string } | null {
  if (status === 'draft') return { status: 'preview', label: 'Mark as preview' };
  if (status === 'preview') return { status: 'needs_review', label: 'Send for review' };
  if (status === 'needs_review') return { status: 'approved', label: 'Approve preview' };
  if (status === 'approved') return { status: 'amended', label: 'Amend' };
  if (status === 'amended') return { status: 'preview', label: 'Return to preview' };
  return null;
}

export function validatePeriod(start: string, end: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return 'Choose a start and end date.';
  if (start > end) return 'The start date must be on or before the end date.';
  return null;
}

export function validateMovement(input: { productId?: string; quantity?: string; reason?: string; movementType?: string }): string | null {
  if (!input.productId || !/^[a-f\d]{24}$/i.test(input.productId)) return 'Choose a cigarette product.';
  if (!input.movementType) return 'Choose a movement type.';
  if (!/^-?\d+$/.test(input.quantity || '') || Number(input.quantity) === 0) return 'Quantity must be a non-zero whole number.';
  if (!input.reason || input.reason.trim() === '') return 'A reason is required.';
  return null;
}

export function submissionAllowed(inFlight: boolean): boolean {
  return !inFlight;
}

export function viewState(loading: boolean, error: string, count: number): 'loading' | 'error' | 'empty' | 'ready' {
  if (loading) return 'loading';
  if (error) return 'error';
  if (count === 0) return 'empty';
  return 'ready';
}

export type ListPhase = 'idle' | 'loading' | 'refreshing' | 'ready' | 'empty' | 'error' | 'auth';

/** Distinguishes an unfinished read from a completed empty result. */
export function listPhase(input: {
  requested: boolean;
  loading: boolean;
  error?: string;
  authFailed?: boolean;
  count: number;
}): ListPhase {
  if (input.authFailed) return 'auth';
  if (!input.requested) return input.loading ? 'loading' : 'idle';
  if (input.loading && input.count === 0) return 'loading';
  if (input.loading) return 'refreshing';
  if (input.error) return 'error';
  if (input.count === 0) return 'empty';
  return 'ready';
}

export function formatPacks(value: unknown): string {
  if (value && typeof value === 'object' && 'availability' in value) {
    const pack = value as { availability?: string; packs?: unknown };
    if (pack.availability === 'recorded' && typeof pack.packs === 'number' && Number.isInteger(pack.packs)) return String(pack.packs);
    return 'Not established';
  }
  if (typeof value === 'number' && Number.isInteger(value) && value !== 0) return String(value);
  return 'Not established';
}

/**
 * No business timezone is configured. Times are shown in UTC and labeled
 * as UTC so they are not presented as the business local time.
 */
export function formatAuditTime(value: unknown): string {
  if (typeof value !== 'string' && !(value instanceof Date)) return 'Time not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time not recorded';
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${formatted} UTC`;
}

export function actorLabel(actor?: { label?: string | null } | null): string {
  const label = actor?.label?.trim();
  return label || 'User not recorded';
}

export function filterByText<T>(rows: T[], query: string, text: (row: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => text(row).toLowerCase().includes(q));
}
