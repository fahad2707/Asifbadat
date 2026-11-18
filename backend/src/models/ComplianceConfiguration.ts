import mongoose, { Schema, Document } from 'mongoose';

export type ComplianceConfigStatus = 'draft' | 'pending_review' | 'approved' | 'inactive';

export interface IComplianceConfiguration extends Document {
  domain: 'sales_tax' | 'tobacco';
  status: ComplianceConfigStatus;
  effective_from?: Date;
  effective_to?: Date | null;
  payload: Record<string, unknown>;
  created_by?: mongoose.Types.ObjectId;
  updated_by?: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const ComplianceConfigurationSchema = new Schema<IComplianceConfiguration>(
  {
    domain: { type: String, enum: ['sales_tax', 'tobacco'], required: true },
    status: { type: String, enum: ['draft', 'pending_review', 'approved', 'inactive'], default: 'draft' },
    effective_from: Date,
    effective_to: Date,
    payload: { type: Schema.Types.Mixed, required: true },
    created_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
    updated_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  {
    collection: 'complianceconfigurations',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    autoIndex: false,
  }
);

export default mongoose.model<IComplianceConfiguration>('ComplianceConfiguration', ComplianceConfigurationSchema);
