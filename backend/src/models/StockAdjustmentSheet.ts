import mongoose, { Schema, Document } from 'mongoose';

export type StockSheetKind = 'adjustment' | 'physical_count';

export interface IStockSheetLine {
  product_id: mongoose.Types.ObjectId;
  product_name: string;
  sku?: string;
  quantity_before: number;
  quantity_change: number;
  quantity_after: number;
  counted_quantity?: number;
  notes?: string;
  cost_before?: number | null;
  cost_after?: number | null;
  price_before?: number | null;
  price_after?: number | null;
}

export interface IStockAdjustmentSheet extends Document {
  kind: StockSheetKind;
  sequence: number;
  number: string;
  barcode: string;
  notes?: string;
  lines: IStockSheetLine[];
  admin_id?: mongoose.Types.ObjectId;
  created_at: Date;
}

const LineSchema = new Schema<IStockSheetLine>(
  {
    product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    product_name: { type: String, required: true },
    sku: String,
    quantity_before: { type: Number, required: true },
    quantity_change: { type: Number, required: true },
    quantity_after: { type: Number, required: true },
    counted_quantity: Number,
    notes: String,
    cost_before: Number,
    cost_after: Number,
    price_before: Number,
    price_after: Number,
  },
  { _id: false }
);

const StockAdjustmentSheetSchema = new Schema<IStockAdjustmentSheet>(
  {
    kind: { type: String, enum: ['adjustment', 'physical_count'], required: true },
    sequence: { type: Number, required: true },
    number: { type: String, required: true, unique: true },
    barcode: { type: String, required: true, unique: true },
    notes: String,
    lines: { type: [LineSchema], required: true },
    admin_id: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

StockAdjustmentSheetSchema.index({ kind: 1, created_at: -1 });

export default mongoose.model<IStockAdjustmentSheet>('StockAdjustmentSheet', StockAdjustmentSheetSchema);
