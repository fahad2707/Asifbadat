import express from 'express';
import mongoose from 'mongoose';
import Receipt from '../models/Receipt';
import BankAccount from '../models/BankAccount';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { httpErrorFromPayment, paymentApplication } from '../services/paymentApplication';

const router = express.Router();

function generateTrxId() {
  return 'RT' + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).substring(2, 5).toUpperCase();
}

function isArchivedReceipt(r: { state?: string | null }) {
  return r.state === 'archived';
}

function isDepositedReceipt(r: { state?: string | null; bank_account_id?: unknown }) {
  if (isArchivedReceipt(r)) return false;
  if (r.state === 'deposited') return true;
  if (r.state === 'pending') return false;
  return !!r.bank_account_id;
}

function depositAt(r: { city?: string | null; trx_date?: Date | string }) {
  const raw = String(r.city || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return r.trx_date ? new Date(r.trx_date) : new Date(0);
}

function periodBounds(period: string) {
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - 6);
  else if (period === '2weeks') start.setDate(start.getDate() - 13);
  else if (period === 'month') start.setMonth(start.getMonth() - 1);
  else if (period === '2months') start.setMonth(start.getMonth() - 2);
  return { start, end };
}

function toReceiptRow(r: any) {
  const deposited = isDepositedReceipt({
    state: r.state,
    bank_account_id: r.bank_account_id?._id || r.bank_account_id,
  });
  return {
    id: r._id.toString(),
    trx_date: r.trx_date,
    trx_id: r.trx_id,
    customer_id: r.customer_id?.toString(),
    customer_name: r.customer_name,
    bank_account_id: r.bank_account_id?._id?.toString() || (r.bank_account_id && typeof r.bank_account_id === 'string' ? r.bank_account_id : undefined),
    bank_account_name: r.bank_account_id?.name,
    state: r.state,
    city: r.city,
    so_id: r.so_id,
    invoice_num: r.invoice_num,
    pmt_mode: r.pmt_mode,
    amount_received: r.amount_received,
    created_at: r.created_at,
    deposit_status: isArchivedReceipt(r) ? 'archived' : deposited ? 'deposited' : 'pending',
    deposited_at: deposited || isArchivedReceipt(r) ? depositAt(r).toISOString() : undefined,
  };
}

// Overview of deposited totals by bank for a time window. Sums stored amounts only.
router.get('/overview', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const period = String(req.query.period || 'today');
    const { start, end } = periodBounds(period);
    const [receipts, banks] = await Promise.all([
      Receipt.find({}).populate('bank_account_id', 'name').limit(2000).lean(),
      BankAccount.find({ is_active: true }).select('name').lean(),
    ]);

    let pending_total = 0;
    let pending_count = 0;
    const byBank: Record<string, { id: string; name: string; amount: number; count: number }> = {};
    for (const b of banks) {
      const id = (b as any)._id.toString();
      byBank[id] = { id, name: (b as any).name, amount: 0, count: 0 };
    }
    byBank['unassigned'] = { id: 'unassigned', name: 'Unassigned', amount: 0, count: 0 };

    let total_deposited = 0;
    let deposited_count = 0;
    for (const raw of receipts) {
      const r = raw as any;
      if (isArchivedReceipt(r)) continue;
      const deposited = isDepositedReceipt({ state: r.state, bank_account_id: r.bank_account_id });
      const amount = Number(r.amount_received) || 0;
      if (!deposited) {
        pending_total += amount;
        pending_count += 1;
        continue;
      }
      const when = depositAt(r);
      if (when < start || when > end) continue;
      total_deposited += amount;
      deposited_count += 1;
      const bankId = r.bank_account_id?._id?.toString() || 'unassigned';
      if (!byBank[bankId]) {
        byBank[bankId] = { id: bankId, name: r.bank_account_id?.name || 'Bank', amount: 0, count: 0 };
      }
      byBank[bankId].amount += amount;
      byBank[bankId].count += 1;
    }

    res.json({
      period,
      from: start.toISOString(),
      to: end.toISOString(),
      total_deposited,
      deposited_count,
      pending_total,
      pending_count,
      banks: Object.values(byBank).filter((b) => b.id !== 'unassigned' || b.amount > 0),
    });
  } catch (error) {
    console.error('Receipts overview error:', error);
    res.status(500).json({ error: 'Failed to load bank overview' });
  }
});

// List receipts (bank transactions)
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { search, bank_account_id, deposit_status } = req.query;
    let query: any = {};
    if (search && typeof search === 'string') {
      query.$or = [
        { trx_id: { $regex: search, $options: 'i' } },
        { customer_name: { $regex: search, $options: 'i' } },
        { invoice_num: { $regex: search, $options: 'i' } },
      ];
    }
    if (bank_account_id && typeof bank_account_id === 'string') {
      query.bank_account_id = bank_account_id;
    }
    const receipts = await Receipt.find(query)
      .populate('bank_account_id', 'name')
      .sort({ trx_date: -1, created_at: -1 })
      .limit(500)
      .lean();
    let rows = receipts.map(toReceiptRow);
    if (deposit_status === 'pending' || deposit_status === 'deposited' || deposit_status === 'archived') {
      rows = rows.filter((r) => r.deposit_status === deposit_status);
    }
    res.json({ receipts: rows });
  } catch (error) {
    console.error('List receipts error:', error);
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
});

// Create receipt.
// If invoice_id / invoice_num is present this is an invoice payment and MUST
// go through paymentApplication so Receipt and Invoice.amount_paid stay in sync.
// A receipt with no invoice reference remains a standalone bank record.
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { trx_date, trx_id, customer_id, customer_name, bank_account_id, state, city, so_id, invoice_id, invoice_num, so_balance, pmt_mode, amount_received } = req.body;
    const invoiceRef = (invoice_id && String(invoice_id).trim()) || (invoice_num && String(invoice_num).trim()) || '';

    if (invoiceRef) {
      const applied = await paymentApplication.applyPaymentToInvoice({
        invoiceId: invoice_id ? String(invoice_id).trim() : undefined,
        invoiceNumber: !invoice_id && invoice_num ? String(invoice_num).trim() : undefined,
        amount: Number(amount_received),
        paymentDate: trx_date ? new Date(trx_date) : undefined,
        paymentMethod: pmt_mode,
        bankAccountId: bank_account_id,
        trxId: trx_id,
        customerName: customer_name,
        notes: so_id,
      });
      return res.status(201).json({
        id: applied.receipt.id,
        trx_id: applied.receipt.trx_id,
        trx_date: trx_date ? new Date(trx_date) : new Date(),
        customer_name: customer_name || '',
        amount_received: applied.amount_applied,
        invoice_num: applied.invoice_number,
        amount_paid: applied.amount_paid,
        remaining_balance: applied.remaining_balance,
      });
    }

    const finalTrxId = trx_id || generateTrxId();
    const when = trx_date ? new Date(trx_date) : new Date();
    const hasBank = !!(bank_account_id && mongoose.Types.ObjectId.isValid(String(bank_account_id)));
    const receipt = await Receipt.create({
      trx_id: finalTrxId,
      trx_date: when,
      customer_id: customer_id || null,
      customer_name: customer_name || '',
      bank_account_id: hasBank ? bank_account_id : null,
      state: hasBank ? 'deposited' : (state || 'pending'),
      city: hasBank ? when.toISOString() : (city || ''),
      so_id: so_id || '',
      invoice_num: '',
      so_balance: so_balance != null ? Number(so_balance) : 0,
      pmt_mode: pmt_mode || 'Credit Card',
      amount_received: Number(amount_received) || 0,
    });
    const r = receipt.toObject();
    res.status(201).json({
      id: (r as any)._id.toString(),
      trx_id: (r as any).trx_id,
      trx_date: (r as any).trx_date,
      customer_name: (r as any).customer_name,
      amount_received: (r as any).amount_received,
    });
  } catch (error) {
    const mapped = httpErrorFromPayment(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Create receipt error:', error);
    res.status(500).json({ error: 'Failed to create receipt' });
  }
});

// Generate Trx ID (for UI)
router.get('/generate-id', authenticateAdmin, (req, res) => {
  res.json({ trx_id: generateTrxId() });
});

// Mark a received payment as deposited. Does not change invoice amounts.
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

    const result = await paymentApplication.updateReceiptLifecycle(req.params.id, {
      bank_account_id: String(bank_account_id),
      state: 'deposited',
      city: depositedAt.toISOString(),
    });
    res.json({
      success: true,
      id: result.receipt.id,
      deposit_status: 'deposited',
      deposited_at: depositedAt.toISOString(),
    });
  } catch (error) {
    const mapped = httpErrorFromPayment(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Deposit receipt error:', error);
    res.status(500).json({ error: 'Failed to mark as deposited' });
  }
});

// Hide a receipt from Pending/Deposited without changing invoice amounts.
router.post('/:id/archive', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await paymentApplication.updateReceiptLifecycle(req.params.id, { state: 'archived' });
    res.json({ success: true, id: result.receipt.id, deposit_status: 'archived' });
  } catch (error) {
    const mapped = httpErrorFromPayment(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Archive receipt error:', error);
    res.status(500).json({ error: 'Failed to archive transaction' });
  }
});

// Update receipt. Invoice-applied rows adjust Invoice.amount_paid by the amount delta.
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { trx_date, trx_id, customer_id, customer_name, bank_account_id, state, city, so_id, invoice_num, so_balance, pmt_mode, amount_received } = req.body || {};
    const result = await paymentApplication.updateReceiptLifecycle(req.params.id, {
      ...(amount_received !== undefined ? { amount_received: Number(amount_received) } : {}),
      ...(invoice_num !== undefined ? { invoice_num } : {}),
      ...(trx_date !== undefined ? { trx_date: new Date(trx_date) } : {}),
      ...(trx_id !== undefined ? { trx_id } : {}),
      ...(customer_name !== undefined ? { customer_name } : {}),
      ...(pmt_mode !== undefined ? { pmt_mode } : {}),
      ...(bank_account_id !== undefined ? { bank_account_id } : {}),
      ...(customer_id !== undefined ? { customer_id } : {}),
      ...(state !== undefined ? { state } : {}),
      ...(city !== undefined ? { city } : {}),
      ...(so_id !== undefined ? { so_id } : {}),
      ...(so_balance !== undefined ? { so_balance: Number(so_balance) } : {}),
    });
    res.json({
      id: result.receipt.id,
      trx_id: result.receipt.trx_id,
      invoice_num: result.receipt.invoice_num,
      amount_received: result.receipt.amount_received,
      ...(result.invoice
        ? {
            amount_paid: result.invoice.amount_paid,
            payment_status: result.invoice.payment_status,
            remaining_balance: result.invoice.total_amount - result.invoice.amount_paid,
          }
        : {}),
    });
  } catch (error) {
    const mapped = httpErrorFromPayment(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Update receipt error:', error);
    res.status(500).json({ error: 'Failed to update receipt' });
  }
});

// Delete receipt. Invoice-applied rows reverse Invoice.amount_paid first.
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await paymentApplication.deleteReceiptLifecycle(req.params.id);
    res.json({
      success: true,
      ...(result.invoice
        ? {
            amount_paid: result.invoice.amount_paid,
            payment_status: result.invoice.payment_status,
          }
        : {}),
    });
  } catch (error) {
    const mapped = httpErrorFromPayment(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Delete receipt error:', error);
    res.status(500).json({ error: 'Failed to delete receipt' });
  }
});

export default router;
