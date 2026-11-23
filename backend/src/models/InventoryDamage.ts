import mongoose, { Schema, Document } from 'mongoose';

export interface IInventoryDamage extends Document {
  product_id: mongoose.Types.ObjectId;
  product_name: string;
  quantity: number;
  unit_cost: number;
  vendor_id: mongoose.Types.ObjectId;
  vendor_name: string;
  po_id?: mongoose.Types.ObjectId;
  po_number?: string;
  credit_memo_id?: mongoose.Types.ObjectId;
  credit_memo_number?: string;
  notes?: string;
  created_by?: mongoose.Types.ObjectId;
  created_at: Date;
}

const InventoryDamageSchema = new Schema<IInventoryDamage>(
  {
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    product_name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unit_cost: { type: Number, required: true, min: 0 },
    vendor_id: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendor_name: { type: String, required: true },
    po_id: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    po_number: String,
    credit_memo_id: { type: Schema.Types.ObjectId, ref: 'CreditMemo' },
    credit_memo_number: String,
    notes: String,
    created_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

InventoryDamageSchema.index({ created_at: -1 });
InventoryDamageSchema.index({ vendor_id: 1, credit_memo_id: 1 });

export default mongoose.model<IInventoryDamage>('InventoryDamage', InventoryDamageSchema);
