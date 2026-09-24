import mongoose, { Schema, Document } from 'mongoose';

export const POS_RETURN_REFUND_METHODS = ['cash', 'cheque', 'credit'] as const;
export type PosReturnRefundMethod = (typeof POS_RETURN_REFUND_METHODS)[number];

export const POS_RETURN_DISPOSITIONS = ['resalable', 'damaged'] as const;
export type PosReturnDisposition = (typeof POS_RETURN_DISPOSITIONS)[number];

export const POS_RETURN_WINDOW_DAYS = [15, 30, 45] as const;
export type PosReturnWindowDays = (typeof POS_RETURN_WINDOW_DAYS)[number];

export const POS_RETURN_STATUSES = ['completed'] as const;
export type PosReturnStatus = (typeof POS_RETURN_STATUSES)[number];

export const POS_RETURN_SETTLEMENT_STATUSES = ['unsettled', 'settled'] as const;
export type PosReturnSettlementStatus = (typeof POS_RETURN_SETTLEMENT_STATUSES)[number];

export interface IReturnItem {
  product_id: mongoose.Types.ObjectId;
  product_name: string;
  quantity: number;
  original_unit_price: number;
  allocated_discount_per_unit: number;
  refundable_unit_amount: number;
  refundable_amount: number;
  inventory_disposition: PosReturnDisposition;
}

export interface IReturn extends Document {
  return_number: string;
  idempotency_key?: string;
  status: PosReturnStatus;
  sale_id: mongoose.Types.ObjectId;
  sale_number: string;
  invoice_id?: mongoose.Types.ObjectId;
  sale_created_at?: Date;
  customer_id?: mongoose.Types.ObjectId;
  pos_customer_id?: mongoose.Types.ObjectId;
  customer_name?: string;
  customer_phone?: string;
  items: IReturnItem[];
  /** Merchandise refund only. Tax is not refunded. */
  total_refund: number;
  refund_method: PosReturnRefundMethod;
  cheque_reference?: string;
  /** Completed return is not financially settled until this is `settled`. */
  settlement_status: PosReturnSettlementStatus;
  settled_at?: Date;
  settlement_id?: mongoose.Types.ObjectId;
  return_window_days: PosReturnWindowDays;
  return_deadline?: Date;
  window_extended?: boolean;
  window_extended_by?: mongoose.Types.ObjectId;
  admin_id?: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const ReturnItemSchema = new Schema<IReturnItem>(
  {
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    product_name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    original_unit_price: { type: Number, required: true, min: 0 },
    allocated_discount_per_unit: { type: Number, required: true, min: 0 },
    refundable_unit_amount: { type: Number, required: true, min: 0 },
    refundable_amount: { type: Number, required: true, min: 0 },
    inventory_disposition: {
      type: String,
      enum: POS_RETURN_DISPOSITIONS,
      required: true,
    },
  },
  { _id: true }
);

const ReturnSchema = new Schema<IReturn>(
  {
    return_number: { type: String, required: true, unique: true },
    idempotency_key: { type: String, unique: true, sparse: true },
    status: { type: String, enum: POS_RETURN_STATUSES, default: 'completed' },
    sale_id: { type: Schema.Types.ObjectId, ref: 'POSSale', required: true },
    sale_number: { type: String, required: true },
    invoice_id: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    sale_created_at: Date,
    customer_id: { type: Schema.Types.ObjectId, ref: 'User' },
    pos_customer_id: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customer_name: String,
    customer_phone: String,
    items: { type: [ReturnItemSchema], required: true },
    total_refund: { type: Number, required: true, min: 0 },
    refund_method: { type: String, enum: POS_RETURN_REFUND_METHODS, required: true },
    cheque_reference: String,
    settlement_status: {
      type: String,
      enum: POS_RETURN_SETTLEMENT_STATUSES,
      default: 'unsettled',
    },
    settled_at: Date,
    settlement_id: { type: Schema.Types.ObjectId, ref: 'PosReturnSettlement' },
    return_window_days: { type: Number, enum: POS_RETURN_WINDOW_DAYS, default: 15 },
    return_deadline: Date,
    window_extended: { type: Boolean, default: false },
    window_extended_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
    admin_id: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

ReturnSchema.index({ sale_id: 1 });
ReturnSchema.index({ sale_id: 1, status: 1 });
ReturnSchema.index({ created_at: -1 });
ReturnSchema.index({ settlement_status: 1 });

export default mongoose.model<IReturn>('Return', ReturnSchema);
