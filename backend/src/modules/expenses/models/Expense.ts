import mongoose, { Schema, Document } from 'mongoose';

export interface IExpense extends Document {
  expense_number: string;
  date: Date;
  /** Free-text expense type (e.g. Electricity, WiFi, Shipping, Transport, Manpower) — not product category */
  expense_type: string;
  description?: string;
  amount: number;
  payment_mode: string;
  vendor_name?: string;
  attachment?: string;
  is_recurring: boolean;
  recurrence_type: 'MONTHLY' | 'YEARLY' | 'NONE';
  created_by?: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date; // soft delete
  bank_account_id?: mongoose.Types.ObjectId;
  deposit_state?: string;
  deposited_at?: Date;
}

const ExpenseSchema = new Schema<IExpense>(
  {
    expense_number: { type: String, required: true, unique: true },
    date: { type: Date, required: true },
    expense_type: { type: String, required: true, trim: true },
    description: String,
    amount: { type: Number, required: true, min: 0 },
    payment_mode: { type: String, required: true, trim: true },
    vendor_name: String,
    attachment: String,
    is_recurring: { type: Boolean, default: false },
    recurrence_type: { type: String, enum: ['MONTHLY', 'YEARLY', 'NONE'], default: 'NONE' },
    created_by: { type: Schema.Types.ObjectId, ref: 'Admin' },
    deleted_at: { type: Date, default: null },
    bank_account_id: { type: Schema.Types.ObjectId, ref: 'BankAccount' },
    deposit_state: { type: String },
    deposited_at: { type: Date },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

ExpenseSchema.index({ date: -1 });
ExpenseSchema.index({ expense_type: 1 });
ExpenseSchema.index({ payment_mode: 1 });
ExpenseSchema.index({ deleted_at: 1 });
ExpenseSchema.index({ is_recurring: 1, recurrence_type: 1 });

export default mongoose.model<IExpense>('Expense', ExpenseSchema);
