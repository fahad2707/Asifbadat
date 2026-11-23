import mongoose, { Schema, Document } from 'mongoose';

export const ADMIN_NOTICE_KINDS = [
  'online_order',
  'rfq',
  'website_signup',
  'receipt',
  'receipt_deposit',
  'shipment',
  'credit_memo',
] as const;

export type AdminNoticeKind = (typeof ADMIN_NOTICE_KINDS)[number];

export interface IAdminNotice extends Document {
  kind: AdminNoticeKind;
  title: string;
  body: string;
  href: string;
  ref?: string;
  created_at: Date;
}

const AdminNoticeSchema = new Schema<IAdminNotice>(
  {
    kind: { type: String, enum: ADMIN_NOTICE_KINDS, required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    href: { type: String, required: true },
    ref: { type: String, index: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

AdminNoticeSchema.index({ created_at: -1 });

export default mongoose.model<IAdminNotice>('AdminNotice', AdminNoticeSchema);
