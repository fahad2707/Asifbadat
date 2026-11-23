import mongoose from 'mongoose';
import { recordAdminNotice } from './adminNotice';
import Customer from '../models/Customer';
import WebsiteSignupApplication, {
  WEBSITE_SIGNUP_STATUS_APPROVED,
  WEBSITE_SIGNUP_STATUS_PENDING,
  WEBSITE_SIGNUP_STATUS_REJECTED,
  type WebsiteSignupStatus,
} from '../models/WebsiteSignupApplication';

type LinkedCustomer = {
  _id: mongoose.Types.ObjectId;
  user_id?: mongoose.Types.ObjectId;
  name?: string;
  email?: string;
  phone?: string;
  account_status?: string;
};

function signupStatusForAccount(status: unknown): WebsiteSignupStatus {
  if (status === 'approved') return WEBSITE_SIGNUP_STATUS_APPROVED;
  if (status === 'rejected') return WEBSITE_SIGNUP_STATUS_REJECTED;
  return WEBSITE_SIGNUP_STATUS_PENDING;
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

async function createSignupForCustomer(customer: LinkedCustomer): Promise<void> {
  if (!customer.user_id) return;
  const status = signupStatusForAccount(customer.account_status);
  try {
    await WebsiteSignupApplication.create({
      user_id: customer.user_id,
      submitted_name: customer.name,
      submitted_email: customer.email,
      submitted_phone: customer.phone,
      status,
      // Already bound to this CRM customer. match_kind none keeps it off the
      // email/phone collision workflow; Approve still checks the live user_id link.
      link_outcome: 'linked',
      customer_id: customer._id,
      matched_customer_ids: [],
      match_kind: 'none',
    });
    if (status === WEBSITE_SIGNUP_STATUS_PENDING) {
      void recordAdminNotice({
        kind: 'website_signup',
        title: 'Website signup',
        body: `${customer.name || customer.email || 'Customer'} is waiting for website approval`,
        href: `/admin/website-signups?q=${encodeURIComponent(String(customer.email || customer.name || ''))}`,
        ref: String(customer.user_id),
      });
    }
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
}

/**
 * A CRM customer who signs into the website should appear in Website signups.
 * Pending online approval stays pending. An already decided customer is filed
 * under that same status so the pending queue stays the approval list.
 */
export async function ensureWebsiteSignupsForLinkedCustomers(): Promise<void> {
  const customers = (await Customer.find({
    user_id: { $exists: true, $ne: null },
  })
    .select('user_id name email phone account_status')
    .lean()) as LinkedCustomer[];

  if (!customers.length) return;

  const userIds = customers.map((c) => c.user_id).filter(Boolean);
  const existing = await WebsiteSignupApplication.find({ user_id: { $in: userIds } })
    .select('user_id status')
    .lean();
  const byUser = new Map(existing.map((row) => [String(row.user_id), row]));

  for (const customer of customers) {
    const key = String(customer.user_id);
    const row = byUser.get(key);
    if (!row) {
      await createSignupForCustomer(customer);
      continue;
    }
    const desired = signupStatusForAccount(customer.account_status);
    if (row.status === WEBSITE_SIGNUP_STATUS_PENDING && desired !== WEBSITE_SIGNUP_STATUS_PENDING) {
      await WebsiteSignupApplication.updateOne(
        { _id: row._id, status: WEBSITE_SIGNUP_STATUS_PENDING },
        { $set: { status: desired } }
      );
    }
  }
}

export async function ensureWebsiteSignupForUser(
  userId: string | mongoose.Types.ObjectId | null | undefined
): Promise<void> {
  if (userId == null || userId === '') return;
  const id = String(userId);
  if (!mongoose.Types.ObjectId.isValid(id)) return;
  const customer = (await Customer.findOne({ user_id: new mongoose.Types.ObjectId(id) })
    .select('user_id name email phone account_status')
    .lean()) as LinkedCustomer | null;
  if (!customer?.user_id) return;

  const existing = await WebsiteSignupApplication.findOne({ user_id: customer.user_id })
    .select('_id status')
    .lean();
  if (!existing) {
    await createSignupForCustomer(customer);
    return;
  }
  const desired = signupStatusForAccount(customer.account_status);
  if (existing.status === WEBSITE_SIGNUP_STATUS_PENDING && desired !== WEBSITE_SIGNUP_STATUS_PENDING) {
    await WebsiteSignupApplication.updateOne(
      { _id: existing._id, status: WEBSITE_SIGNUP_STATUS_PENDING },
      { $set: { status: desired } }
    );
  }
}
