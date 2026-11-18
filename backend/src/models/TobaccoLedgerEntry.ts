import mongoose, { Schema, Document } from 'mongoose';

export interface ITobaccoLedgerEntry extends Document {
  product_id: mongoose.Types.ObjectId;
  product_name: string;
  movement_type: string;
  movement_date: Date;
  quantity: number;
  stock_unit?: string;
  packs_per_stock_unit?: number;
  cigarette_pack_size?: number;
  tobacco_class?: string;
  stamp?: string;
  source_type: string;
  source_id?: string;
  source_number?: string;
  reason?: string;
  affects_physical_stock: false;
  created_by?: mongoose.Types.ObjectId;
  created_at: Date;
}

const TobaccoLedgerEntrySchema = new Schema<ITobaccoLedgerEntry>(
  {
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    product_name: { type: String, required: true },
    movement_type: { type: String, required: true },
    movement_date: { type: Date, required: true },
    quantity: { type: Number, required: true },
    stock_unit: String,
    packs_per_stock_unit: Number,
    cigarette_pack_size: Number,
    tobacco_class: String,
    stamp: String,
    source_type: { type: String, required: true },
    source_id: String,
    source_number: String,
    reason: String,
    affects_physical_stock: { type: Boolean, default: false },
    created_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  {
    collection: 'tobaccoledgerentries',
    timestamps: { createdAt: 'created_at', updatedAt: false },
    autoIndex: false,
  }
);

TobaccoLedgerEntrySchema.pre('validate', function forceLedgerOffStock() {
  this.affects_physical_stock = false;
});

export default mongoose.model<ITobaccoLedgerEntry>('TobaccoLedgerEntry', TobaccoLedgerEntrySchema);
