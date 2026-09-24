import mongoose, { Schema, Document } from 'mongoose';

export interface IPOSSaleItem {
  product_id?: mongoose.Types.ObjectId;
  quantity: number;
  price: number;
  discount?: number; // Line-level discount
  tax?: number; // Tax amount for this line
  subtotal: number;
}

export interface IPOSSale extends Document {
  sale_number: string;
  invoice_id?: mongoose.Types.ObjectId;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  customer_id?: mongoose.Types.ObjectId; // Link to User if exists (online)
  pos_customer_id?: mongoose.Types.ObjectId; // Link to Customer (POS/walk-in)
  items: IPOSSaleItem[];
  subtotal: number; // Before tax and discount
  discount_amount?: number; // Bill-level discount
  tax_amount?: number; // Total tax
  total_amount: number; // Final amount
  payment_method: string; // 'cash', 'card', 'digital', 'split'
  payment_split?: {
    cash?: number;
    card?: number;
    digital?: number;
  };
  sale_type: string; // 'pos', 'website', 'store_pickup'
  admin_id?: mongoose.Types.ObjectId;
  idempotency_key?: string;
  created_at: Date;
}

const POSSaleItemSchema = new Schema<IPOSSaleItem>({
  product_id: { type: Schema.Types.ObjectId, ref: 'Product' },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  subtotal: { type: Number, required: true },
});

const POSSaleSchema = new Schema<IPOSSale>(
  {
    sale_number: { type: String, required: true, unique: true },
    invoice_id: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    customer_name: String,
    customer_phone: String,
    customer_email: String,
    customer_id: { type: Schema.Types.ObjectId, ref: 'User' },
    pos_customer_id: { type: Schema.Types.ObjectId, ref: 'Customer' },
    items: [POSSaleItemSchema],
    subtotal: { type: Number, required: true },
    discount_amount: { type: Number, default: 0 },
    tax_amount: { type: Number, default: 0 },
    total_amount: { type: Number, required: true },
    payment_method: { type: String, required: true },
    payment_split: {
      cash: Number,
      card: Number,
      digital: Number,
    },
    sale_type: { type: String, default: 'pos' }, // 'pos', 'website', 'store_pickup'
    admin_id: { type: Schema.Types.ObjectId, ref: 'Admin' },
    // Client-provided checkout key. unique+sparse: missing keys may repeat;
    // two documents cannot share the same non-null key.
    idempotency_key: { type: String, unique: true, sparse: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

POSSaleSchema.index({ customer_phone: 1 });
POSSaleSchema.index({ created_at: -1 });
POSSaleSchema.index({ sale_type: 1 });

export default mongoose.model<IPOSSale>('POSSale', POSSaleSchema);
