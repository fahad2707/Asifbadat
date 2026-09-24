import mongoose, { Schema, Document } from 'mongoose';
import { POS_RETURN_REFUND_METHODS, type PosReturnRefundMethod } from './Return';

export interface IPosReturnSettlement extends Document {
  return_id: mongoose.Types.ObjectId;
  return_number: string;
  amount: number;
  refund_method: PosReturnRefundMethod;
  cheque_reference?: string;
  customer_id?: mongoose.Types.ObjectId;
  admin_id?: mongoose.Types.ObjectId;
  settled_at: Date;
  created_at: Date;
}

const PosReturnSettlementSchema = new Schema<IPosReturnSettlement>(
  {
    return_id: { type: Schema.Types.ObjectId, ref: 'Return', required: true, unique: true },
    return_number: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    refund_method: { type: String, enum: POS_RETURN_REFUND_METHODS, required: true },
    cheque_reference: String,
    customer_id: { type: Schema.Types.ObjectId, ref: 'User' },
    admin_id: { type: Schema.Types.ObjectId, ref: 'Admin' },
    settled_at: { type: Date, required: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

PosReturnSettlementSchema.index({ created_at: -1 });

export default mongoose.model<IPosReturnSettlement>('PosReturnSettlement', PosReturnSettlementSchema);
