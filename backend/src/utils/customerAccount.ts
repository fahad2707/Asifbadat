/**
 * Storefront account approval — User ↔ Customer link.
 *
 * Missing account_status is NOT approved (historical CRM rows).
 * is_active is CRM on/off and is intentionally ignored here.
 *
 * Website signup matching an existing CRM Customer (approved or not) does NOT
 * auto-bind and does NOT change that Customer's account_status
 * (no silent inherit, no revoke, no identity claim by email/phone alone).
 */
import mongoose from 'mongoose';
import Customer from '../models/Customer';
import User from '../models/User';
import type { WebsiteSignupMatchKind } from '../models/WebsiteSignupApplication';

export const ACCOUNT_STATUS_PENDING = 'pending' as const;
export const ACCOUNT_STATUS_APPROVED = 'approved' as const;
export const ACCOUNT_STATUS_REJECTED = 'rejected' as const;
export type AccountStatus =
  | typeof ACCOUNT_STATUS_PENDING
  | typeof ACCOUNT_STATUS_APPROVED
  | typeof ACCOUNT_STATUS_REJECTED;

export const ACCOUNT_STATUS_VALUES = [
  ACCOUNT_STATUS_PENDING,
  ACCOUNT_STATUS_APPROVED,
  ACCOUNT_STATUS_REJECTED,
] as const;

export type CustomerLinkAction = 'created' | 'linked' | 'unlinked';

export type CustomerLinkResult = {
  action: CustomerLinkAction;
  customerId: string | null;
  matchedCustomerIds: string[];
  matchKind: WebsiteSignupMatchKind;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isApprovedAccountStatus(status: unknown): boolean {
  return status === ACCOUNT_STATUS_APPROVED;
}

export function accountStatusFromDocument(raw: unknown): AccountStatus | null {
  if (raw === ACCOUNT_STATUS_APPROVED) return ACCOUNT_STATUS_APPROVED;
  if (raw === ACCOUNT_STATUS_PENDING) return ACCOUNT_STATUS_PENDING;
  if (raw === ACCOUNT_STATUS_REJECTED) return ACCOUNT_STATUS_REJECTED;
  return null;
}

/**
 * Server-side source of truth for OnlineOrder / price gating.
 * Do not consult request bodies or JWT claims.
 */
export async function isUserLinkedToApprovedCustomer(
  userId: string | mongoose.Types.ObjectId | null | undefined
): Promise<boolean> {
  if (userId == null || userId === '') return false;
  const id = String(userId);
  if (!mongoose.Types.ObjectId.isValid(id)) return false;

  const user = await User.findById(id).select('_id').lean();
  if (!user) return false;

  const customer = await Customer.findOne({ user_id: user._id }).select('account_status').lean();
  if (!customer) return false;
  return isApprovedAccountStatus((customer as { account_status?: unknown }).account_status);
}

/**
 * Read-only UI signal: account_status of the Customer linked by user_id, or null.
 * Uses the same binding as commercial access (Customer.user_id) — never email/phone match.
 * Does not mutate User/Customer. Missing/invalid status → null.
 */
export async function getLinkedCustomerAccountStatus(
  userId: string | mongoose.Types.ObjectId | null | undefined
): Promise<AccountStatus | null> {
  if (userId == null || userId === '') return null;
  const id = String(userId);
  if (!mongoose.Types.ObjectId.isValid(id)) return null;

  const user = await User.findById(id).select('_id').lean();
  if (!user) return null;

  const customer = await Customer.findOne({ user_id: user._id }).select('account_status').lean();
  if (!customer) return null;
  return accountStatusFromDocument((customer as { account_status?: unknown }).account_status);
}

async function customersMatchingEmail(email: string) {
  return Customer.find({
    email: { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') },
  }).lean();
}

async function customersMatchingPhone(phone: string) {
  return Customer.find({ phone }).lean();
}

type MatchRow = {
  _id: mongoose.Types.ObjectId;
  user_id?: mongoose.Types.ObjectId | null;
  account_status?: unknown;
};

function matchedIds(byId: Map<string, MatchRow>): string[] {
  return [...byId.keys()];
}

/**
 * Interpret Customer.updateOne result for a conditional user_id bind.
 * Prefer matchedCount (filter hit). Fall back to modifiedCount for older/mocks.
 * matchedCount > 0 with modifiedCount 0 is success when already bound to the same User.
 */
export function didConditionalCustomerLinkSucceed(result: {
  matchedCount?: number;
  modifiedCount?: number;
}): boolean {
  if (typeof result.matchedCount === 'number') return result.matchedCount > 0;
  return (result.modifiedCount ?? 0) > 0;
}

/**
 * Deterministic User→Customer attach on registration.
 *
 * - 0 matches → create pending website_signup Customer with user_id
 * - 1 match already linked to another User → leave unlinked (never steal user_id)
 * - 1 match with account_status === approved → leave unlinked (no inherit, no revoke)
 * - 1 match unlinked and not approved → leave unlinked with match hint (no auto-claim)
 * - 1 match already linked to this User → report linked (idempotent; no write)
 * - 2+ distinct matches → leave unlinked
 *
 * Email/phone match is a review hint only — not proof of CRM ownership.
 * No fuzzy matching. No auto-approve. No duplicate CRM rows for collision matches.
 * Match metadata is returned for WebsiteSignupApplication only — it does not grant access.
 */
export async function linkOrCreateCustomerForNewUser(opts: {
  userId: mongoose.Types.ObjectId;
  name?: string;
  email?: string;
  phone?: string;
}): Promise<CustomerLinkResult> {
  const email = opts.email?.trim() || undefined;
  const phone = opts.phone?.trim() || undefined;

  const emailHits = email ? await customersMatchingEmail(email) : [];
  const phoneHits = phone ? await customersMatchingPhone(phone) : [];

  const byId = new Map<string, MatchRow>();
  for (const row of [...emailHits, ...phoneHits] as MatchRow[]) {
    byId.set(String(row._id), row);
  }

  if (byId.size > 1) {
    return {
      action: 'unlinked',
      customerId: null,
      matchedCustomerIds: matchedIds(byId),
      matchKind: 'ambiguous',
    };
  }

  if (byId.size === 1) {
    const existing = [...byId.values()][0];
    const ids = matchedIds(byId);
    if (existing.user_id && String(existing.user_id) !== String(opts.userId)) {
      return {
        action: 'unlinked',
        customerId: null,
        matchedCustomerIds: ids,
        matchKind: 'already_linked',
      };
    }
    // Already approved CRM must not grant storefront access to a new signup without
    // admin review, and must not be forced to pending (would revoke CRM online access).
    if (isApprovedAccountStatus(existing.account_status)) {
      return {
        action: 'unlinked',
        customerId: null,
        matchedCustomerIds: ids,
        matchKind: 'approved_crm',
      };
    }

    // Already bound to this User (re-entrant / idempotent) — no write required.
    if (existing.user_id && String(existing.user_id) === String(opts.userId)) {
      return {
        action: 'linked',
        customerId: String(existing._id),
        matchedCustomerIds: ids,
        matchKind: 'non_approved_crm',
      };
    }

    // Unlinked non-approved (or missing-status) CRM: do not auto-claim.
    // Preserve CRM unchanged; surface match hints for admin review via application.
    return {
      action: 'unlinked',
      customerId: null,
      matchedCustomerIds: ids,
      matchKind: 'non_approved_crm',
    };
  }

  try {
    const created = await Customer.create({
      name: (opts.name && opts.name.trim()) || email || phone || 'Online account',
      phone: phone || `account:${String(opts.userId)}`,
      email,
      user_id: opts.userId,
      account_status: ACCOUNT_STATUS_PENDING,
      website_signup: true,
      is_active: true,
      notes: 'Created from storefront registration',
    });

    return {
      action: 'created',
      customerId: created._id.toString(),
      matchedCustomerIds: [],
      matchKind: 'none',
    };
  } catch (err) {
    const code = (err as { code?: number })?.code;
    // Unique phone/email/user_id in Atlas must not abort website registration.
    if (code === 11000) {
      return {
        action: 'unlinked',
        customerId: null,
        matchedCustomerIds: [],
        matchKind: 'none',
      };
    }
    throw err;
  }
}
