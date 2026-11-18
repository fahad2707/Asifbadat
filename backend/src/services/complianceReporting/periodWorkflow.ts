/**
 * Reporting-period transitions.
 * Preview, review, and approval never become filing-ready or filed.
 */

import { salesTaxFilingBlockers } from '../salesTax/decisions';

export type PeriodStatus = 'draft' | 'preview' | 'needs_review' | 'approved' | 'amended';

const ALLOWED: Record<PeriodStatus, PeriodStatus[]> = {
  draft: ['preview'],
  preview: ['needs_review'],
  needs_review: ['approved', 'preview'],
  approved: ['amended'],
  amended: ['preview'],
};

export type PeriodTransition =
  | { ok: true; status: PeriodStatus; filingReady: false }
  | { ok: false; error: string; blockers?: string[] };

export function transitionReportingPeriod(current: PeriodStatus, next: string): PeriodTransition {
  if (next === 'filing_ready' || next === 'filed' || next === 'reconciled') {
    return {
      ok: false,
      error: 'This period cannot be marked filing-ready, reconciled, or filed while legal decisions are unconfirmed.',
      blockers: salesTaxFilingBlockers().map((item) => item.id),
    };
  }
  if (!Object.prototype.hasOwnProperty.call(ALLOWED, current)) {
    return { ok: false, error: 'Unknown current status.' };
  }
  const allowed = ALLOWED[current];
  if (!allowed.includes(next as PeriodStatus)) {
    return { ok: false, error: `Cannot move a ${current} period to ${next}.` };
  }
  return { ok: true, status: next as PeriodStatus, filingReady: false };
}
