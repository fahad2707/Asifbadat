import mongoose, { Schema, Document } from 'mongoose';

export interface IBankDetails {
  account_name?: string;
  account_number?: string;
  bank_name?: string;
  ifsc?: string;
  branch?: string;
}

export interface IVendor extends Document {
  supplier_id?: string;
  name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  tax_id?: string;
  gst_number?: string;
  pan?: string;
  /** Payment terms in days: 15, 30, or 45 */
  payment_terms_days?: number;
  payment_terms?: string; // legacy e.g. "Net 30"
  credit_limit?: number;
  rating?: number; // 1-5 or 0-100
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  bank_details?: IBankDetails;
  notes?: string;
  documents?: { name: string; url: string; uploaded_at?: Date }[];
  // Tracks amount vendor owes (Accounts Payable). Credit memos reduce this balance.
  outstanding_balance?: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const BankDetailsSchema = new Schema<IBankDetails>(
  {
    account_name: String,
    account_number: String,
    bank_name: String,
    ifsc: String,
    branch: String,
  },
  { _id: false }
);

const VendorDocumentSchema = new Schema(
  {
    name: String,
    url: String,
    uploaded_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const VendorSchema = new Schema<IVendor>(
  {
    supplier_id: { type: String, unique: true, sparse: true },
    name: { type: String, required: true },
    contact_name: String,
    phone: String,
    email: String,
    address: String,
    city: String,
    state: String,
    zip: String,
    tax_id: String,
    gst_number: String,
    pan: String,
    payment_terms_days: { type: Number, enum: [15, 30, 45] },
    payment_terms: String,
    credit_limit: { type: Number, min: 0 },
    rating: { type: Number, min: 0, max: 100 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'BLOCKED'], default: 'ACTIVE' },
    bank_details: BankDetailsSchema,
    documents: [VendorDocumentSchema],
    notes: String,
    // Tracks amount vendor owes (Accounts Payable). Credit memos reduce this balance.
    outstanding_balance: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

VendorSchema.index({ name: 'text' });
VendorSchema.index({ status: 1 });
VendorSchema.index({ gst_number: 1 });

export default mongoose.model<IVendor>('Vendor', VendorSchema);
