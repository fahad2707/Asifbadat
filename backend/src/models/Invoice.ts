import mongoose, { Schema, Document } from 'mongoose';

export interface IInvoiceItem {
  product_id?: mongoose.Types.ObjectId;
  product_name: string;
  category_name?: string;
  quantity: number;
  price: number;
  subtotal: number;
  /** Selling price is tax-exclusive. taxable means a percent TaxType applied at create/edit time. */
  taxable?: boolean;
  tax_type_id?: mongoose.Types.ObjectId | null;
  tax_type_name?: string | null;
  tax_rate_type?: 'percent' | 'amount' | null;
  tax_rate?: number;
  tax_amount?: number;
  tax_type_label?: string;
  /** True when this line was zeroed because the customer was tax-exempt at save time. */
  tax_exempt?: boolean;
  total?: number;
}

export interface IInvoice extends Document {
  invoice_number: string;
  order_id?: mongoose.Types.ObjectId;
  customer_id?: mongoose.Types.ObjectId;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  customer_address?: string; // Bill To address
  location_of_sale?: string; // Our address (e.g. 511 W Germantown Pike...)
  invoice_type: string;
  invoice_date?: Date;
  due_date?: Date;
  total_amount: number;
  subtotal_amount?: number;
  tax_amount: number;
  amount_paid?: number; // For receive payment: balance = total_amount - amount_paid
  discount_amount?: number;
  adjustment?: number;
  shipping_type?: string;
  terms?: string;
  payment_method?: string;
  payment_status: string;
  pdf_path?: string;
  email_sent: boolean;
  items?: IInvoiceItem[];
  created_at: Date;
  updated_at: Date;
}

const InvoiceItemSchema = new Schema<IInvoiceItem>({
  product_id: { type: Schema.Types.ObjectId, ref: 'Product' },
  product_name: { type: String, required: true },
  category_name: { type: String },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  subtotal: { type: Number, required: true },
  taxable: { type: Boolean },
  tax_type_id: { type: Schema.Types.ObjectId, ref: 'TaxType', default: undefined },
  tax_type_name: { type: String },
  tax_rate_type: { type: String, enum: ['percent', 'amount'] },
  tax_rate: { type: Number },
  tax_amount: { type: Number },
  tax_type_label: { type: String },
  tax_exempt: { type: Boolean },
  total: { type: Number },
});

const InvoiceSchema = new Schema<IInvoice>(
  {
    invoice_number: { type: String, required: true, unique: true },
    order_id: { type: Schema.Types.ObjectId, ref: 'Order' },
    customer_id: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customer_name: String,
    customer_phone: String,
    customer_email: String,
    customer_address: String,
    location_of_sale: String,
    invoice_type: { type: String, default: 'manual' },
    invoice_date: Date,
    due_date: Date,
    total_amount: { type: Number, required: true },
    subtotal_amount: Number,
    tax_amount: { type: Number, default: 0 },
    amount_paid: { type: Number, default: 0 },
    discount_amount: { type: Number, default: 0 },
    adjustment: { type: Number, default: 0 },
    shipping_type: String,
    terms: String,
    payment_method: String,
    payment_status: { type: String, default: 'unpaid' },
    pdf_path: String,
    email_sent: { type: Boolean, default: false },
    items: [InvoiceItemSchema],
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

InvoiceSchema.index({ order_id: 1 });

export default mongoose.model<IInvoice>('Invoice', InvoiceSchema);




