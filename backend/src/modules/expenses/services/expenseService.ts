import mongoose from 'mongoose';
import Expense from '../models/Expense';
import LedgerEntry from '../../../models/LedgerEntry';
import { LedgerAccountType, LedgerReferenceType } from '../../../shared/enums';

export function generateExpenseNumber(): string {
  const prefix = 'EXP';
  const num = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}${num}`;
}

function paymentModeToAccountType(mode: string): string {
  const key = String(mode || '').trim().toUpperCase().replace(/\s+/g, '_');
  switch (key) {
    case 'CASH': return LedgerAccountType.CASH;
    case 'BANK':
    case 'CHEQUE':
    case 'CHECK': return LedgerAccountType.BANK;
    case 'UPI': return LedgerAccountType.UPI;
    case 'CARD':
    case 'CREDIT_CARD': return LedgerAccountType.CARD;
    default: return LedgerAccountType.CASH;
  }
}

/**
 * Post double-entry: DR Expense, CR Cash/Bank/UPI/Card
 */
export async function postExpenseLedger(
  expenseId: mongoose.Types.ObjectId,
  amount: number,
  paymentMode: string,
  description: string,
  date: Date,
  createdBy?: mongoose.Types.ObjectId,
  session?: mongoose.mongo.ClientSession
): Promise<void> {
  const cashAccount = paymentModeToAccountType(paymentMode);
  const entries = [
    {
      date,
      account_type: LedgerAccountType.EXPENSE,
      debit: amount,
      credit: 0,
      reference_type: LedgerReferenceType.EXPENSE,
      reference_id: expenseId,
      description: description || 'Expense',
      created_by: createdBy,
    },
    {
      date,
      account_type: cashAccount,
      debit: 0,
      credit: amount,
      reference_type: LedgerReferenceType.EXPENSE,
      reference_id: expenseId,
      description: description || 'Expense',
      created_by: createdBy,
    },
  ];
  const docs = entries.map((e) => ({
    ...e,
    party_type: undefined,
    party_id: undefined,
  }));
  if (session) {
    await LedgerEntry.insertMany(docs, { session });
  } else {
    await LedgerEntry.insertMany(docs);
  }
}

export async function getExpenseSummary(
  startDate: Date,
  endDate: Date
): Promise<{
  total: number;
  fixed: number;
  variable: number;
  byCategory: { expense_type: string; amount: number }[];
  highestCategory?: { name: string; amount: number };
}> {
  const match = {
    date: { $gte: startDate, $lte: endDate },
    $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }],
  };
  const [totals, byType] = await Promise.all([
    Expense.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$expense_type', amount: { $sum: '$amount' } } },
      { $project: { expense_type: '$_id', amount: 1, _id: 0 } },
    ]),
  ]);

  const total = totals[0]?.total ?? 0;
  const byCategory = (byType || []).map((r: any) => ({
    expense_type: r.expense_type || 'Other',
    amount: r.amount || 0,
  }));
  const highest = byCategory.length ? byCategory.sort((a: any, b: any) => b.amount - a.amount)[0] : null;

  return {
    total,
    fixed: 0,
    variable: 0,
    byCategory,
    highestCategory: highest ? { name: highest.expense_type, amount: highest.amount } : undefined,
  };
}

/**
 * Process recurring expenses: create next period copies for MONTHLY/YEARLY.
 * Call from a scheduler (cron) e.g. daily. Creates expenses for the current month/year if not already created.
 */
export async function processRecurringExpenses(createdBy?: mongoose.Types.ObjectId): Promise<{ created: number }> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const recurring = await Expense.find({
    is_recurring: true,
    recurrence_type: { $in: ['MONTHLY', 'YEARLY'] },
    $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }],
  }).lean();

  let created = 0;
  for (const exp of recurring as any[]) {
    const lastDate = new Date(exp.date);
    let nextDate: Date;
    if (exp.recurrence_type === 'MONTHLY') {
      nextDate = new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, Math.min(lastDate.getDate(), 28));
    } else {
      nextDate = new Date(lastDate.getFullYear() + 1, lastDate.getMonth(), Math.min(lastDate.getDate(), 28));
    }
    if (nextDate < startOfMonth) continue;
    if (nextDate > endOfMonth) continue;
    const existing = await Expense.findOne({
      expense_type: exp.expense_type,
      amount: exp.amount,
      description: exp.description,
      is_recurring: true,
      date: { $gte: startOfMonth, $lte: endOfMonth },
      $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }],
    });
    if (existing) continue;

    let num = generateExpenseNumber();
    while (await Expense.findOne({ expense_number: num })) num = generateExpenseNumber();

    const newExp = await Expense.create({
      expense_number: num,
      date: nextDate,
      expense_type: exp.expense_type,
      description: exp.description || `Recurring: ${exp.expense_number}`,
      amount: exp.amount,
      payment_mode: exp.payment_mode,
      vendor_name: exp.vendor_name,
      is_recurring: true,
      recurrence_type: exp.recurrence_type,
      created_by: createdBy,
    });
    await postExpenseLedger(
      newExp._id,
      newExp.amount,
      newExp.payment_mode,
      newExp.description || `Recurring ${newExp.expense_number}`,
      newExp.date,
      createdBy
    );
    created += 1;
  }
  return { created };
}
