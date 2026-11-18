import mongoose, { Schema, Document } from 'mongoose';

export type ExemptionStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'expired' | 'revoked';

export interface ISalesTaxExemption extends Document {
  customer_id: mongoose.Types.ObjectId;
  certificate_number?: string;
  /** Trimmed, case-folded certificate number. See exemptionDraft.ts. */
  certificate_key?: string;
  exemption_type?: string;
  status: ExemptionStatus;
  effective_on?: Date;
  expires_on?: Date | null;
  reviewed_by?: mongoose.Types.ObjectId;
  review_note?: string;
  created_by?: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const SalesTaxExemptionSchema = new Schema<ISalesTaxExemption>(
  {
    customer_id: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    certificate_number: String,
    certificate_key: String,
    exemption_type: String,
    status: {
      type: String,
      enum: ['draft', 'pending_review', 'approved', 'rejected', 'expired', 'revoked'],
      default: 'draft',
    },
    effective_on: Date,
    expires_on: Date,
    reviewed_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
    review_note: String,
    created_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  {
    collection: 'salestaxexemptions',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    autoIndex: false,
  }
);

/**
 * One active certificate number per customer.
 * Active statuses are draft, pending_review, and approved.
 * Startup does not build this index. Create it with
 * src/db/ensure-active-exemption-index.ts after that command's conflict check.
 */
export const ACTIVE_CUSTOMER_CERTIFICATE_INDEX = {
  fields: { customer_id: 1, certificate_key: 1 } as const,
  options: {
    unique: true,
    name: 'active_customer_certificate',
    partialFilterExpression: {
      status: { $in: ['draft', 'pending_review', 'approved'] },
      certificate_key: { $type: 'string' },
    },
  },
};

SalesTaxExemptionSchema.index(ACTIVE_CUSTOMER_CERTIFICATE_INDEX.fields, ACTIVE_CUSTOMER_CERTIFICATE_INDEX.options);

export default mongoose.model<ISalesTaxExemption>('SalesTaxExemption', SalesTaxExemptionSchema);
