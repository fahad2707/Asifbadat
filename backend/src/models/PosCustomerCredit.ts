/**
 * Dedicated POS store-credit ledger. Not wholesale AR.
 * Do not use Customer.outstanding_balance, CreditMemo, Receipt, or Payment.
 */
import mongoose, { Schema, Document } from 'mongoose';

export const POS_CUSTOMER_CREDIT_TYPES = ['pos_return_credit'] as const;
export type PosCustomerCreditType = (typeof POS_CUSTOMER_CREDIT_TYPES)[number];

export const POS_CUSTOMER_CREDIT_DIRECTIONS = ['credit'] as const;
export type PosCustomerCreditDirection = (typeof POS_CUSTOMER_CREDIT_DIRECTIONS)[number];

export interface IPosCustomerCredit extends Document {
  customer_id: mongoose.Types.ObjectId;
  return_id: mongoose.Types.ObjectId;
  settlement_id: mongoose.Types.ObjectId;
  amount: number;
  type: PosCustomerCreditType;
  direction: PosCustomerCreditDirection;
  admin_id?: mongoose.Types.ObjectId;
  created_at: Date;
}

const PosCustomerCreditSchema = new Schema<IPosCustomerCredit>(
  {
    customer_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    return_id: { type: Schema.Types.ObjectId, ref: 'Return', required: true, unique: true },
    settlement_id: { type: Schema.Types.ObjectId, ref: 'PosReturnSettlement', required: true },
    amount: { type: Number, required: true, min: 0 },
    type: { type: String, enum: POS_CUSTOMER_CREDIT_TYPES, required: true },
    direction: { type: String, enum: POS_CUSTOMER_CREDIT_DIRECTIONS, required: true },
    admin_id: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

PosCustomerCreditSchema.index({ customer_id: 1, created_at: -1 });

export default mongoose.model<IPosCustomerCredit>('PosCustomerCredit', PosCustomerCreditSchema);
