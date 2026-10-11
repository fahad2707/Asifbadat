import mongoose, { Schema, Document } from 'mongoose';

/**
 * Website registration review record.
 *
 * Commercial access is NEVER granted by this document's status.
 * Access remains Customer.account_status === 'approved' + user_id link only.
 */
export const WEBSITE_SIGNUP_STATUS_PENDING = 'pending' as const;
export const WEBSITE_SIGNUP_STATUS_APPROVED = 'approved' as const;
export const WEBSITE_SIGNUP_STATUS_REJECTED = 'rejected' as const;

export const WEBSITE_SIGNUP_STATUSES = [
  WEBSITE_SIGNUP_STATUS_PENDING,
  WEBSITE_SIGNUP_STATUS_APPROVED,
  WEBSITE_SIGNUP_STATUS_REJECTED,
] as const;

export type WebsiteSignupStatus = (typeof WEBSITE_SIGNUP_STATUSES)[number];

export const WEBSITE_SIGNUP_LINK_OUTCOMES = ['created', 'linked', 'unlinked'] as const;
export type WebsiteSignupLinkOutcome = (typeof WEBSITE_SIGNUP_LINK_OUTCOMES)[number];

export const WEBSITE_SIGNUP_MATCH_KINDS = [
  'none',
  'approved_crm',
  'already_linked',
  'ambiguous',
  'non_approved_crm',
] as const;
export type WebsiteSignupMatchKind = (typeof WEBSITE_SIGNUP_MATCH_KINDS)[number];

export interface IWebsiteSignupApplication extends Document {
  user_id: mongoose.Types.ObjectId;
  submitted_name?: string;
  submitted_email?: string;
  submitted_phone?: string;
  status: WebsiteSignupStatus;
  link_outcome: WebsiteSignupLinkOutcome;
  customer_id?: mongoose.Types.ObjectId;
  matched_customer_ids: mongoose.Types.ObjectId[];
  match_kind: WebsiteSignupMatchKind;
  reviewed_by?: mongoose.Types.ObjectId;
  reviewed_at?: Date;
  review_note?: string;
  created_at: Date;
  updated_at: Date;
}

const WebsiteSignupApplicationSchema = new Schema<IWebsiteSignupApplication>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    submitted_name: String,
    submitted_email: String,
    submitted_phone: String,
    status: {
      type: String,
      enum: WEBSITE_SIGNUP_STATUSES,
      required: true,
      default: WEBSITE_SIGNUP_STATUS_PENDING,
    },
    link_outcome: {
      type: String,
      enum: WEBSITE_SIGNUP_LINK_OUTCOMES,
      required: true,
    },
    customer_id: { type: Schema.Types.ObjectId, ref: 'Customer' },
    matched_customer_ids: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Customer' }],
      default: [],
    },
    match_kind: {
      type: String,
      enum: WEBSITE_SIGNUP_MATCH_KINDS,
      required: true,
      default: 'none',
    },
    reviewed_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
    reviewed_at: Date,
    review_note: String,
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// One application per User (every website registration).
WebsiteSignupApplicationSchema.index({ user_id: 1 }, { unique: true });
// Future admin queue: pending applications by newest first.
WebsiteSignupApplicationSchema.index({ status: 1, created_at: -1 });

export default mongoose.model<IWebsiteSignupApplication>(
  'WebsiteSignupApplication',
  WebsiteSignupApplicationSchema
);
