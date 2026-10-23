import mongoose, { Schema, Document } from 'mongoose';
import {
  PACKAGE_CODE_MAX_LENGTH,
  normalizePackageCode,
} from '../utils/packageCodes';

export interface IShipmentPackage extends Document {
  package_code: string;
  shipment_id: mongoose.Types.ObjectId;
  shipment_number?: string;
  notes?: string;
  created_by?: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

export const NOTES_MAX_LENGTH = 500;

const ShipmentPackageSchema = new Schema<IShipmentPackage>(
  {
    package_code: {
      type: String,
      required: true,
      unique: true,
      maxlength: PACKAGE_CODE_MAX_LENGTH,
      set: (v: string) => normalizePackageCode(v),
    },
    // Immutable after create — enforce in create/update service (no $set of shipment_id).
    shipment_id: {
      type: Schema.Types.ObjectId,
      ref: 'Shipment',
      required: true,
    },
    shipment_number: { type: String, trim: true },
    notes: { type: String, maxlength: NOTES_MAX_LENGTH, trim: true },
    created_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

ShipmentPackageSchema.index({ shipment_id: 1, created_at: -1 });

export default mongoose.model<IShipmentPackage>('ShipmentPackage', ShipmentPackageSchema);
