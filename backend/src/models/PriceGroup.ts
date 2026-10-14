import mongoose, { Schema, Document } from 'mongoose';

export interface IPriceGroup extends Document {
  name: string;
  product_ids: mongoose.Types.ObjectId[];
  created_at: Date;
  updated_at: Date;
}

const PriceGroupSchema = new Schema<IPriceGroup>(
  {
    name: { type: String, required: true, trim: true },
    product_ids: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

PriceGroupSchema.index({ name: 1 }, { unique: true });

export default mongoose.model<IPriceGroup>('PriceGroup', PriceGroupSchema);
