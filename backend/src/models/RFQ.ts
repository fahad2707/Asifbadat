import mongoose, { Schema, Document } from 'mongoose';

export type RFQStatus = 'pending' | 'quoted' | 'closed' | 'cancelled';

export interface IRFQItem {
  product_id?: mongoose.Types.ObjectId;
  product_name: string;
  category_name?: string;
  image_url?: string;
  quantity: number;
}

export interface IRFQ extends Document {
  rfq_number: string;
  status: RFQStatus;

  /** Submitted contact info from public website lightbox */
  customer_name: string;
  customer_email?: string;
  customer_phone: string;
  customer_company?: string;
  customer_comments?: string;

  /** Optional link to an existing CRM customer (set later by admin) */
  customer_id?: mongoose.Types.ObjectId;

  items: IRFQItem[];

  /** When admin generates a quotation from this RFQ, store the link */
  quotation_id?: mongoose.Types.ObjectId;
  quotation_number?: string;
  /** Set when that quotation is converted to an invoice (RI#…). */
  invoice_number?: string;

  source: 'website' | 'store' | 'manual';
  notes?: string; // Admin notes
  created_at: Date;
  updated_at: Date;
}

const RFQItemSchema = new Schema<IRFQItem>(
  {
    product_id: { type: Schema.Types.ObjectId, ref: 'Product' },
    product_name: { type: String, required: true },
    category_name: String,
    image_url: String,
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const RFQSchema = new Schema<IRFQ>(
  {
    rfq_number: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'quoted', 'closed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    customer_name: { type: String, required: true },
    customer_email: String,
    customer_phone: { type: String, required: true },
    customer_company: String,
    customer_comments: String,
    customer_id: { type: Schema.Types.ObjectId, ref: 'Customer' },
    items: { type: [RFQItemSchema], default: [] },
    quotation_id: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    quotation_number: String,
    invoice_number: String,
    source: {
      type: String,
      enum: ['website', 'store', 'manual'],
      default: 'website',
    },
    notes: String,
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

RFQSchema.index({ created_at: -1 });
RFQSchema.index({ customer_phone: 1 });
RFQSchema.index({ customer_email: 1 });

export default mongoose.model<IRFQ>('RFQ', RFQSchema);
