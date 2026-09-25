import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import Expense from '../models/Expense';
import { authenticateAdmin, AuthRequest } from '../../../middleware/auth';
import AuditLog from '../../../models/AuditLog';
import {
  generateExpenseNumber,
  postExpenseLedger,
  getExpenseSummary,
  processRecurringExpenses,
} from '../services/expenseService';

const router = express.Router();

const createSchema = z.object({
  date: z.string(),
  expense_type: z.string().min(1, 'Expense type is required'),
  description: z.string().optional(),
  amount: z.number().min(0),
  payment_mode: z.string().min(1, 'Payment mode is required').max(80),
  vendor_name: z.string().optional(),
  attachment: z.union([z.string().url(), z.literal('')]).optional(),
  is_recurring: z.boolean().default(false),
  recurrence_type: z.enum(['NONE', 'MONTHLY', 'YEARLY']).default('NONE'),
});

// Generate expense number
router.get('/generate-number', authenticateAdmin, (req, res) => {
  res.json({ expense_number: generateExpenseNumber() });
});

// Process recurring expenses (call from cron/scheduler; admin only)
router.post('/process-recurring', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await processRecurringExpenses(req.userId ? new mongoose.Types.ObjectId(req.userId) : undefined);
    res.json({ message: `${result.created} recurring expense(s) created`, created: result.created });
  } catch (e) {
    console.error('Process recurring:', e);
    res.status(500).json({ error: 'Failed to process recurring expenses' });
  }
});

// Summary for date range (this month by default)
router.get('/summary', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { start, end } = req.query;
    let startDate: Date;
    let endDate: Date;
    if (start && end && typeof start === 'string' && typeof end === 'string') {
      startDate = new Date(start);
      endDate = new Date(end);
    } else {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date();
    }
    const summary = await getExpenseSummary(startDate, endDate);
    res.json(summary);
  } catch (e) {
    console.error('Expense summary:', e);
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

// List expenses with filters
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { start, end, expense_type, payment_mode, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter: any = { $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] };
    if (start && typeof start === 'string') {
      filter.date = filter.date || {};
      (filter.date as any).$gte = new Date(start);
    }
    if (end && typeof end === 'string') {
      filter.date = filter.date || {};
      (filter.date as any).$lte = new Date(end);
    }
    if (expense_type && typeof expense_type === 'string' && expense_type.trim()) {
      filter.expense_type = new RegExp(expense_type.trim(), 'i');
    }
    if (payment_mode && typeof payment_mode === 'string') filter.payment_mode = payment_mode;

    const [list, total] = await Promise.all([
      Expense.find(filter)
        .sort({ date: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Expense.countDocuments(filter),
    ]);

    res.json({
      expenses: list.map((e: any) => ({
        id: e._id.toString(),
        expense_number: e.expense_number,
        date: e.date,
        expense_type: e.expense_type,
        description: e.description,
        amount: e.amount,
        payment_mode: e.payment_mode,
        vendor_name: e.vendor_name,
        attachment: e.attachment,
        is_recurring: e.is_recurring,
        recurrence_type: e.recurrence_type,
        created_at: e.created_at,
        bank_account_id: e.bank_account_id?.toString(),
        deposit_state: e.deposit_state,
        deposited_at: e.deposited_at,
        deposit_status: e.deposit_state === 'archived'
          ? 'archived'
          : e.deposit_state === 'deposited' || (e.payment_mode === 'BANK' && e.bank_account_id && e.deposit_state !== 'pending')
            ? 'deposited'
            : 'pending',
      })),
      pagination: { page: Number(page), limit: Number(limit), total, total_pages: Math.ceil(total / Number(limit)) },
    });
  } catch (e) {
    console.error('List expenses:', e);
    res.status(500).json({ error: 'Failed to list expenses' });
  }
});

// Get one
router.get('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const e = await Expense.findOne({ _id: req.params.id, $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] }).lean();
    if (!e) return res.status(404).json({ error: 'Expense not found' });
    const ex = e as any;
    res.json({
      id: ex._id.toString(),
      expense_number: ex.expense_number,
      date: ex.date,
      expense_type: ex.expense_type,
      description: ex.description,
      amount: ex.amount,
      payment_mode: ex.payment_mode,
      vendor_name: ex.vendor_name,
      attachment: ex.attachment,
      is_recurring: ex.is_recurring,
      recurrence_type: ex.recurrence_type,
      created_at: ex.created_at,
    });
  } catch (e) {
    console.error('Get expense:', e);
    res.status(500).json({ error: 'Failed to get expense' });
  }
});

// Create
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const data = createSchema.parse(req.body);

    let expenseNumber = generateExpenseNumber();
    while (await Expense.findOne({ expense_number: expenseNumber })) {
      expenseNumber = generateExpenseNumber();
    }

    const expense = await Expense.create({
      expense_number: expenseNumber,
      date: new Date(data.date),
      expense_type: (data.expense_type || '').trim(),
      description: data.description,
      amount: data.amount,
      payment_mode: data.payment_mode,
      vendor_name: data.vendor_name,
      attachment: data.attachment,
      is_recurring: data.is_recurring,
      recurrence_type: data.recurrence_type || 'NONE',
      created_by: req.userId,
    });

    await postExpenseLedger(
      expense._id,
      expense.amount,
      expense.payment_mode,
      expense.description || `Expense ${expense.expense_number}`,
      expense.date,
      req.userId ? new mongoose.Types.ObjectId(req.userId) : undefined
    );
    if (req.userId) {
      await AuditLog.create({
        admin_id: req.userId,
        action: 'expense_create',
        entity_type: 'Expense',
        entity_id: expense._id.toString(),
        new_value: { expense_number: expense.expense_number, amount: expense.amount, expense_type: expense.expense_type },
        details: `Expense ${expense.expense_number} created`,
      });
    }

    res.status(201).json({
      id: expense._id.toString(),
      expense_number: expense.expense_number,
      amount: expense.amount,
      date: expense.date,
    });
  } catch (e: any) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors?.[0]?.message || 'Validation error' });
    console.error('Create expense:', e);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

// Update (no ledger reversal for simplicity; only allow edit before EOD or add reversal logic later)
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const data = createSchema.partial().parse(req.body);
    const expense = await Expense.findOne({ _id: req.params.id, $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    const update: any = {};
    if (data.date !== undefined) update.date = new Date(data.date);
    if (data.expense_type !== undefined) update.expense_type = String(data.expense_type).trim();
    if (data.description !== undefined) update.description = data.description;
    if (data.amount !== undefined) update.amount = data.amount;
    if (data.payment_mode !== undefined) update.payment_mode = data.payment_mode;
    if (data.vendor_name !== undefined) update.vendor_name = data.vendor_name;
    if (data.attachment !== undefined) update.attachment = data.attachment;
    if (data.is_recurring !== undefined) update.is_recurring = data.is_recurring;
    if (data.recurrence_type !== undefined) update.recurrence_type = data.recurrence_type;

    await Expense.findByIdAndUpdate(req.params.id, update);
    if (req.userId) {
      await AuditLog.create({
        admin_id: req.userId,
        action: 'expense_update',
        entity_type: 'Expense',
        entity_id: req.params.id,
        new_value: update,
        details: 'Expense updated',
      });
    }
    res.json({ success: true });
  } catch (e: any) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors?.[0]?.message || 'Validation error' });
    console.error('Update expense:', e);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

// Soft delete
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const expense = await Expense.findOne({ _id: req.params.id, $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    await Expense.findByIdAndUpdate(req.params.id, { deleted_at: new Date() });
    if (req.userId) {
      await AuditLog.create({
        admin_id: req.userId,
        action: 'expense_delete',
        entity_type: 'Expense',
        entity_id: req.params.id,
        details: 'Expense soft deleted',
      });
    }
    res.json({ success: true, message: 'Expense deleted' });
  } catch (e) {
    console.error('Delete expense:', e);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

router.post('/:id/deposit', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { bank_account_id, deposit_date, deposit_time } = req.body || {};
    if (!bank_account_id || !mongoose.Types.ObjectId.isValid(String(bank_account_id))) {
      return res.status(400).json({ error: 'Select a bank account.' });
    }
    const day = String(deposit_date || '').trim();
    if (!day) return res.status(400).json({ error: 'Deposit date is required.' });
    const time = String(deposit_time || '').trim() || new Date().toISOString().slice(11, 16);
    const depositedAt = new Date(`${day}T${time}`);
    if (Number.isNaN(depositedAt.getTime())) {
      return res.status(400).json({ error: 'Invalid deposit date or time.' });
    }
    const expense = await Expense.findOne({ _id: req.params.id, $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    expense.bank_account_id = new mongoose.Types.ObjectId(String(bank_account_id));
    expense.deposit_state = 'deposited';
    expense.deposited_at = depositedAt;
    await expense.save();
    res.json({ success: true, id: expense._id.toString(), deposit_status: 'deposited', deposited_at: depositedAt.toISOString() });
  } catch (e) {
    console.error('Deposit expense:', e);
    res.status(500).json({ error: 'Failed to mark as deposited' });
  }
});

router.post('/:id/archive', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const expense = await Expense.findOne({ _id: req.params.id, $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    expense.deposit_state = 'archived';
    await expense.save();
    res.json({ success: true, id: expense._id.toString(), deposit_status: 'archived' });
  } catch (e) {
    console.error('Archive expense:', e);
    res.status(500).json({ error: 'Failed to archive paid bill' });
  }
});

export default router;
