import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomerProductPrice extends Document {
  customer_id: mongoose.Types.ObjectId;
  product_id: mongoose.Types.ObjectId;
  last_price: number;
  last_invoice_id?: mongoose.Types.ObjectId;
  last_invoice_date: Date;
}

const CustomerProductPriceSchema = new Schema<ICustomerProductPrice>(
  {
    customer_id: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    last_price: { type: Number, required: true },
    last_invoice_id: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    last_invoice_date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

CustomerProductPriceSchema.index({ customer_id: 1, product_id: 1 }, { unique: true });

export default mongoose.model<ICustomerProductPrice>('CustomerProductPrice', CustomerProductPriceSchema);
