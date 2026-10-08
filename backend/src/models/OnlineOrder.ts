import mongoose, { Schema, Document } from 'mongoose';

export interface IOnlineOrderItem {
  product_id: mongoose.Types.ObjectId;
  product_name: string;
  quantity: number;
  price: number;
  tax_rate: number;
  subtotal: number;
}

export interface IStatusEntry {
  status: string;
  timestamp: Date;
  note?: string;
}

export interface IOnlineOrder extends Document {
  order_number: string;
  /** Storefront User who placed the order. Optional: historical rows have none. */
  user_id?: mongoose.Types.ObjectId;
  /** Linked CRM Customer. Optional: historical rows have none. */
  customer_id?: mongoose.Types.ObjectId;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  items: IOnlineOrderItem[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  payment_method: 'cod' | 'card';
  payment_status: 'pending' | 'paid' | 'refunded';
  card_last4?: string;
  card_brand?: string;
  status: 'confirmed' | 'packed' | 'dispatched' | 'delivered' | 'cancelled';
  status_history: IStatusEntry[];
  invoice_id?: mongoose.Types.ObjectId;
  notes?: string;
  /**
   * Client checkout attempt id. Optional for historical rows.
   * Unique with user_id when present (sparse compound index).
   */
  checkout_submission_id?: string;
  created_at: Date;
  updated_at: Date;
}

const OnlineOrderItemSchema = new Schema<IOnlineOrderItem>({
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  product_name: { type: String, required: true },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  tax_rate: { type: Number, default: 0 },
  subtotal: { type: Number, required: true },
});

const StatusEntrySchema = new Schema<IStatusEntry>({
  status: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  note: String,
});

const OnlineOrderSchema = new Schema<IOnlineOrder>(
  {
    order_number: { type: String, required: true, unique: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User' },
    customer_id: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customer_name: { type: String, required: true },
    customer_email: { type: String, required: true },
    customer_phone: { type: String, required: true },
    address_line1: { type: String, required: true },
    address_line2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    zip: { type: String, required: true },
    country: { type: String, default: 'US' },
    items: [OnlineOrderItemSchema],
    subtotal: { type: Number, required: true },
    tax_amount: { type: Number, default: 0 },
    total_amount: { type: Number, required: true },
    payment_method: { type: String, enum: ['cod', 'card'], required: true },
    payment_status: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' },
    card_last4: String,
    card_brand: String,
    status: { type: String, enum: ['confirmed', 'packed', 'dispatched', 'delivered', 'cancelled'], default: 'confirmed' },
    status_history: [StatusEntrySchema],
    invoice_id: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    notes: String,
    // Client-provided checkout attempt key. Compound unique+sparse with user_id:
    // historical docs without this field are excluded from the index.
    checkout_submission_id: { type: String, trim: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

OnlineOrderSchema.index({ status: 1 });
OnlineOrderSchema.index({ created_at: -1 });
OnlineOrderSchema.index({ user_id: 1, created_at: -1 });
OnlineOrderSchema.index(
  { user_id: 1, checkout_submission_id: 1 },
  { unique: true, sparse: true }
);

export default mongoose.model<IOnlineOrder>('OnlineOrder', OnlineOrderSchema);
