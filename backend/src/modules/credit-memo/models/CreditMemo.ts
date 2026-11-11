import mongoose, { Schema, Document } from 'mongoose';

export interface ICreditMemoItem {
  product_id: mongoose.Types.ObjectId;
  product_name?: string;
  quantity: number;
  unit_price: number;
  tax_percent: number;
  tax_amount: number;
  total: number;
}

export interface ICreditMemo extends Document {
  credit_memo_number: string;
  type: 'VENDOR' | 'CUSTOMER';
  reference_invoice_id?: mongoose.Types.ObjectId;
  reference_purchase_order_id?: mongoose.Types.ObjectId;
  reference_shipment_id?: mongoose.Types.ObjectId;
  vendor_id?: mongoose.Types.ObjectId;
  customer_id?: mongoose.Types.ObjectId;
  reason: 'DAMAGED' | 'RATE_DIFFERENCE' | 'RETURN' | 'SCHEME' | 'OTHER';
  affects_inventory: boolean;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: 'DRAFT' | 'APPROVED' | 'ADJUSTED' | 'CLOSED' | 'CANCELLED';
  document_url?: string;
  notes?: string;
  created_by?: mongoose.Types.ObjectId;
  approved_at?: Date;
  approved_by?: mongoose.Types.ObjectId;
  received_at?: Date;
  received_by?: mongoose.Types.ObjectId;
  dispatched_at?: Date;
  dispatched_by?: mongoose.Types.ObjectId;
  delivered_at?: Date;
  delivered_by?: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
  items: ICreditMemoItem[];
}

const CreditMemoItemSchema = new Schema<ICreditMemoItem>(
  {
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    product_name: String,
    quantity: { type: Number, required: true },
    unit_price: { type: Number, required: true },
    tax_percent: { type: Number, default: 0 },
    tax_amount: { type: Number, default: 0 },
    total: { type: Number, required: true },
  },
  { _id: true }
);

const CreditMemoSchema = new Schema<ICreditMemo>(
  {
    credit_memo_number: { type: String, required: true, unique: true },
    type: { type: String, enum: ['VENDOR', 'CUSTOMER'], required: true },
    reference_invoice_id: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    reference_purchase_order_id: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    reference_shipment_id: { type: Schema.Types.ObjectId },
    vendor_id: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    customer_id: { type: Schema.Types.ObjectId, ref: 'Customer' },
    reason: { type: String, enum: ['DAMAGED', 'RATE_DIFFERENCE', 'RETURN', 'SCHEME', 'OTHER'], required: true },
    affects_inventory: { type: Boolean, default: true },
    subtotal: { type: Number, required: true, default: 0 },
    tax_amount: { type: Number, default: 0 },
    total_amount: { type: Number, required: true, default: 0 },
    status: { type: String, enum: ['DRAFT', 'APPROVED', 'ADJUSTED', 'CLOSED', 'CANCELLED'], default: 'DRAFT' },
    document_url: String,
    notes: String,
    created_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
    approved_at: Date,
    approved_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
    received_at: Date,
    received_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
    dispatched_at: Date,
    dispatched_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
    delivered_at: Date,
    delivered_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
    items: [CreditMemoItemSchema],
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

CreditMemoSchema.index({ type: 1 });
CreditMemoSchema.index({ vendor_id: 1 });
CreditMemoSchema.index({ customer_id: 1 });
CreditMemoSchema.index({ status: 1 });
CreditMemoSchema.index({ created_at: -1 });

export default mongoose.model<ICreditMemo>('CreditMemo', CreditMemoSchema);
