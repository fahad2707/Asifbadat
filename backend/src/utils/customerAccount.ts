/**
 * Storefront account approval — User ↔ Customer link.
 *
 * Missing account_status is NOT approved (historical CRM rows).
 * is_active is CRM on/off and is intentionally ignored here.
 */

import mongoose from 'mongoose';
import Customer from '../models/Customer';
import User from '../models/User';

export const ACCOUNT_STATUS_PENDING = 'pending' as const;
export const ACCOUNT_STATUS_APPROVED = 'approved' as const;
export type AccountStatus = typeof ACCOUNT_STATUS_PENDING | typeof ACCOUNT_STATUS_APPROVED;

export type CustomerLinkAction = 'created' | 'linked' | 'unlinked';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isApprovedAccountStatus(status: unknown): boolean {
  return status === ACCOUNT_STATUS_APPROVED;
}

export function accountStatusFromDocument(raw: unknown): AccountStatus | null {
  if (raw === ACCOUNT_STATUS_APPROVED) return ACCOUNT_STATUS_APPROVED;
  if (raw === ACCOUNT_STATUS_PENDING) return ACCOUNT_STATUS_PENDING;
  return null;
}

/**
 * Server-side source of truth for later OnlineOrder gating.
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

async function customersMatchingEmail(email: string) {
  return Customer.find({
    email: { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') },
  }).lean();
}

async function customersMatchingPhone(phone: string) {
  return Customer.find({ phone }).lean();
}

/**
 * Deterministic User→Customer attach on registration.
 *
 * - 0 matches → create pending Customer with user_id
 * - 1 match with no user_id → set user_id only (do not change account_status)
 * - 1 match already linked to another User → leave unlinked
 * - 2+ distinct matches (email vs phone disagree, or duplicate CRM rows) → leave unlinked
 *
 * No fuzzy matching. No auto-approve.
 */
export async function linkOrCreateCustomerForNewUser(opts: {
  userId: mongoose.Types.ObjectId;
  name?: string;
  email?: string;
  phone?: string;
}): Promise<{ action: CustomerLinkAction; customerId: string | null }> {
  const email = opts.email?.trim() || undefined;
  const phone = opts.phone?.trim() || undefined;

  const emailHits = email ? await customersMatchingEmail(email) : [];
  const phoneHits = phone ? await customersMatchingPhone(phone) : [];

  const byId = new Map<string, { _id: mongoose.Types.ObjectId; user_id?: mongoose.Types.ObjectId }>();
  for (const row of [...emailHits, ...phoneHits] as Array<{
    _id: mongoose.Types.ObjectId;
    user_id?: mongoose.Types.ObjectId;
  }>) {
    byId.set(String(row._id), row);
  }

  if (byId.size > 1) {
    return { action: 'unlinked', customerId: null };
  }

  if (byId.size === 1) {
    const existing = [...byId.values()][0];
    if (existing.user_id && String(existing.user_id) !== String(opts.userId)) {
      return { action: 'unlinked', customerId: null };
    }
    if (!existing.user_id) {
      await Customer.updateOne(
        {
          _id: existing._id,
          $or: [{ user_id: { $exists: false } }, { user_id: null }],
        },
        { $set: { user_id: opts.userId } }
      );
    }
    return { action: 'linked', customerId: String(existing._id) };
  }

  const created = await Customer.create({
    name: (opts.name && opts.name.trim()) || email || phone || 'Online account',
    phone: phone || `account:${String(opts.userId)}`,
    email,
    user_id: opts.userId,
    account_status: ACCOUNT_STATUS_PENDING,
    is_active: true,
    notes: 'Created from storefront registration',
  });

  return { action: 'created', customerId: created._id.toString() };
}
