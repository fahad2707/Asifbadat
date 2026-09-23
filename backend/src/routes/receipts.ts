import express from 'express';
import Receipt from '../models/Receipt';
import Customer from '../models/Customer';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { httpErrorFromPayment, paymentApplication } from '../services/paymentApplication';

const router = express.Router();

function generateTrxId() {
  return 'RT' + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).substring(2, 5).toUpperCase();
}

// List receipts (bank transactions)
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { search, bank_account_id } = req.query;
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
    res.json({
      receipts: receipts.map((r: any) => ({
        id: r._id.toString(),
        trx_date: r.trx_date,
        trx_id: r.trx_id,
        customer_id: r.customer_id?.toString(),
        customer_name: r.customer_name,
        bank_account_id: r.bank_account_id?._id?.toString(),
        bank_account_name: r.bank_account_id?.name,
        state: r.state,
        city: r.city,
        so_id: r.so_id,
        invoice_num: r.invoice_num,
        pmt_mode: r.pmt_mode,
        amount_received: r.amount_received,
        created_at: r.created_at,
      })),
    });
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
    const receipt = await Receipt.create({
      trx_id: finalTrxId,
      trx_date: trx_date ? new Date(trx_date) : new Date(),
      customer_id: customer_id || null,
      customer_name: customer_name || '',
      bank_account_id: bank_account_id || null,
      state: state || '',
      city: city || '',
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

// Update receipt
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const receipt = await Receipt.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    ).lean();
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.json(receipt);
  } catch (error) {
    console.error('Update receipt error:', error);
    res.status(500).json({ error: 'Failed to update receipt' });
  }
});

// Delete receipt
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const receipt = await Receipt.findByIdAndDelete(req.params.id);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete receipt error:', error);
    res.status(500).json({ error: 'Failed to delete receipt' });
  }
});

export default router;
