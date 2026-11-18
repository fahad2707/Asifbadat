import mongoose, { Schema, Document } from 'mongoose';

export interface IComplianceReport extends Document {
  report_key: 'sales_tax_summary' | 'rev_772' | 'rev_777';
  status: 'draft' | 'preview' | 'needs_review' | 'approved' | 'amended';
  filing_ready: false;
  period_start?: string;
  period_end?: string;
  snapshot: Record<string, unknown>;
  blockers: string[];
  created_by?: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const ComplianceReportSchema = new Schema<IComplianceReport>(
  {
    report_key: { type: String, enum: ['sales_tax_summary', 'rev_772', 'rev_777'], required: true },
    status: { type: String, enum: ['draft', 'preview', 'needs_review', 'approved', 'amended'], default: 'preview' },
    filing_ready: { type: Boolean, default: false },
    period_start: String,
    period_end: String,
    snapshot: { type: Schema.Types.Mixed, required: true },
    blockers: { type: [String], default: [] },
    created_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  {
    collection: 'compliancereports',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    autoIndex: false,
  }
);

ComplianceReportSchema.pre('validate', function rejectFilingStatus() {
  this.filing_ready = false;
  if ((this.status as string) === 'filed' || (this.status as string) === 'filing_ready') {
    throw new Error('Filing status is not permitted.');
  }
});

export default mongoose.model<IComplianceReport>('ComplianceReport', ComplianceReportSchema);
