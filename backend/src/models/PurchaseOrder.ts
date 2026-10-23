import mongoose, { Schema, Document } from 'mongoose';

export interface IPurchaseOrderItem {
  product_id: mongoose.Types.ObjectId;
  product_name: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  subtotal: number;
}

export interface IPurchaseOrderPayment {
  _id?: mongoose.Types.ObjectId;
  amount: number;
  payment_date: Date;
  payment_method: string;
  reference?: string;
  notes?: string;
  created_at: Date;
}

export interface IPurchaseOrder extends Document {
  po_number: string;
  vendor_id: mongoose.Types.ObjectId;
  status: 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';
  items: IPurchaseOrderItem[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  amount_paid: number;
  payment_status: 'unpaid' | 'partial' | 'paid';
  payments: IPurchaseOrderPayment[];
  expected_date?: Date;
  received_at?: Date;
  notes?: string;
  created_by?: mongoose.Types.ObjectId;
  vendor_invoice_url?: string;
  vendor_invoice_name?: string;
  vendor_invoice_uploaded_at?: Date;
  created_at: Date;
  updated_at: Date;
}

const PurchaseOrderItemSchema = new Schema<IPurchaseOrderItem>({
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  product_name: { type: String, required: true },
  quantity_ordered: { type: Number, required: true },
  quantity_received: { type: Number, default: 0 },
  unit_cost: { type: Number, required: true },
  subtotal: { type: Number, required: true },
});

const PurchaseOrderPaymentSchema = new Schema<IPurchaseOrderPayment>(
  {
    amount: { type: Number, required: true, min: 0 },
    payment_date: { type: Date, default: Date.now },
    payment_method: { type: String, default: 'Cash' },
    reference: { type: String },
    notes: { type: String },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const PurchaseOrderSchema = new Schema<IPurchaseOrder>(
  {
    po_number: { type: String, required: true, unique: true },
    vendor_id: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    status: { type: String, enum: ['draft', 'sent', 'partial', 'received', 'cancelled'], default: 'draft' },
    items: [PurchaseOrderItemSchema],
    subtotal: { type: Number, default: 0 },
    tax_amount: { type: Number, default: 0 },
    total_amount: { type: Number, default: 0 },
    amount_paid: { type: Number, default: 0, min: 0 },
    payment_status: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
    payments: { type: [PurchaseOrderPaymentSchema], default: [] },
    expected_date: Date,
    received_at: Date,
    notes: String,
    created_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
    vendor_invoice_url: String,
    vendor_invoice_name: String,
    vendor_invoice_uploaded_at: Date,
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

PurchaseOrderSchema.index({ vendor_id: 1 });
PurchaseOrderSchema.index({ status: 1 });
PurchaseOrderSchema.index({ payment_status: 1 });
PurchaseOrderSchema.index({ created_at: -1 });

export default mongoose.model<IPurchaseOrder>('PurchaseOrder', PurchaseOrderSchema);
