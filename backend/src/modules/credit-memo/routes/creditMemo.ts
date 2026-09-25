import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import CreditMemo from '../models/CreditMemo';
import { authenticateAdmin, AuthRequest } from '../../../middleware/auth';
import { approveCreditMemo, cancelCreditMemo, generateCreditMemoNumber } from '../services/creditMemoService';
import { buildBusinessDocumentPdf } from '../../../utils/businessDocPdf';
import { sendPdfResponse } from '../../../utils/pdfHelpers';

const router = express.Router();

async function generateCreditMemoPDFBuffer(cm: any): Promise<Buffer> {
  const cmNumber = cm.credit_memo_number || cm._id?.toString() || '—';
  const partyName =
    cm.type === 'VENDOR' ? (cm.vendor_id as any)?.name : (cm.customer_id as any)?.name;
  const created = cm.created_at
    ? new Date(cm.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  const items = (cm.items || []).map((item: any) => ({
    name: item.product_name || 'Product',
    qty: item.quantity ?? 0,
    unitPrice: Number(item.unit_price ?? 0),
    lineTotal: Number(item.total ?? (item.quantity ?? 0) * (item.unit_price ?? 0)),
  }));

  return buildBusinessDocumentPdf({
    title: 'CREDIT MEMO',
    subtitle: cmNumber,
    partyLabel: cm.type === 'VENDOR' ? 'Vendor' : 'Customer',
    partyName: partyName || '—',
    meta: [
      { label: 'Credit memo #', value: cmNumber },
      { label: 'Type', value: String(cm.type || '—') },
      { label: 'Date', value: created },
      { label: 'Reason', value: String(cm.reason || '—').replace(/_/g, ' ') },
      { label: 'Status', value: String(cm.status || '—') },
    ],
    items,
    totals: [
      { label: 'Subtotal', value: `$${Number(cm.subtotal ?? 0).toFixed(2)}` },
      { label: 'Tax', value: `$${Number(cm.tax_amount ?? 0).toFixed(2)}` },
      { label: 'Total credit', value: `$${Number(cm.total_amount ?? 0).toFixed(2)}`, bold: true },
    ],
    itemColumns: { showProductId: false },
  });
}

const itemSchema = z.object({
  product_id: z.string(),
  product_name: z.string().optional(),
  quantity: z.number().positive(),
  unit_price: z.number().min(0),
  tax_percent: z.number().min(0).max(100).default(0),
});

const createSchema = z.object({
  type: z.enum(['VENDOR', 'CUSTOMER']),
  reference_invoice_id: z.string().optional(),
  reference_shipment_id: z.string().optional(),
  vendor_id: z.string().optional(),
  customer_id: z.string().optional(),
  reason: z.enum(['DAMAGED', 'RATE_DIFFERENCE', 'RETURN', 'SCHEME', 'OTHER']),
  affects_inventory: z.boolean().default(true),
  items: z.array(itemSchema).min(1),
  document_url: z.string().url().optional(),
  notes: z.string().optional(),
});

// Generate credit memo number
router.get('/generate-number', authenticateAdmin, (req, res) => {
  res.json({ credit_memo_number: generateCreditMemoNumber() });
});

// List credit memos
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { type, status, vendor_id, customer_id, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter: Record<string, unknown> = {};
    if (type && typeof type === 'string') filter.type = type;
    if (status && typeof status === 'string') filter.status = status;
    if (vendor_id && typeof vendor_id === 'string') filter.vendor_id = vendor_id;
    if (customer_id && typeof customer_id === 'string') filter.customer_id = customer_id;

    const [list, total] = await Promise.all([
      CreditMemo.find(filter)
        .populate('vendor_id', 'name supplier_id')
        .populate('customer_id', 'name phone')
        .populate('reference_invoice_id', 'invoice_number total_amount')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      CreditMemo.countDocuments(filter),
    ]);

    res.json({
      credit_memos: list.map((cm: any) => ({
        id: cm._id.toString(),
        credit_memo_number: cm.credit_memo_number,
        type: cm.type,
        reference_invoice_id: cm.reference_invoice_id?._id?.toString(),
        reference_shipment_id: cm.reference_shipment_id?.toString(),
        vendor_id: cm.vendor_id?._id?.toString(),
        vendor_name: cm.vendor_id?.name,
        customer_id: cm.customer_id?._id?.toString(),
        customer_name: cm.customer_id?.name,
        reason: cm.reason,
        affects_inventory: cm.affects_inventory,
        subtotal: cm.subtotal,
        tax_amount: cm.tax_amount,
        total_amount: cm.total_amount,
        status: cm.status,
        document_url: cm.document_url,
        notes: cm.notes,
        created_at: cm.created_at,
        approved_at: cm.approved_at,
        items: cm.items,
      })),
      pagination: { page: Number(page), limit: Number(limit), total, total_pages: Math.ceil(total / Number(limit)) },
    });
  } catch (e) {
    console.error('List credit memos:', e);
    res.status(500).json({ error: 'Failed to list credit memos' });
  }
});

// Credit memo PDF (must be before GET /:id)
router.get('/:id/pdf', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const cm = await CreditMemo.findById(req.params.id)
      .populate('vendor_id', 'name')
      .populate('customer_id', 'name')
      .lean();
    if (!cm) return res.status(404).json({ error: 'Credit memo not found' });
    const buffer = await generateCreditMemoPDFBuffer(cm);
    const filename = `credit-memo-${cm.credit_memo_number || req.params.id}.pdf`;
    sendPdfResponse(res, buffer, filename);
  } catch (e: any) {
    console.error('Credit memo PDF error:', e);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Get one
router.get('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const cm = await CreditMemo.findById(req.params.id)
      .populate('vendor_id')
      .populate('customer_id')
      .populate('reference_invoice_id')
      .populate('items.product_id', 'name sku barcode')
      .lean();
    if (!cm) return res.status(404).json({ error: 'Credit memo not found' });
    const c = cm as any;
    res.json({
      id: c._id.toString(),
      credit_memo_number: c.credit_memo_number,
      type: c.type,
      reference_invoice_id: c.reference_invoice_id?._id?.toString(),
      reference_shipment_id: c.reference_shipment_id?.toString(),
      vendor_id: c.vendor_id?._id?.toString(),
      vendor: c.vendor_id,
      customer_id: c.customer_id?._id?.toString(),
      customer: c.customer_id,
      reason: c.reason,
      affects_inventory: c.affects_inventory,
      subtotal: c.subtotal,
      tax_amount: c.tax_amount,
      total_amount: c.total_amount,
      status: c.status,
      document_url: c.document_url,
      notes: c.notes,
      created_at: c.created_at,
      approved_at: c.approved_at,
      items: c.items,
    });
  } catch (e) {
    console.error('Get credit memo:', e);
    res.status(500).json({ error: 'Failed to get credit memo' });
  }
});

// Create
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const data = createSchema.parse(req.body);
    if (data.type === 'VENDOR' && !data.vendor_id) {
      return res.status(400).json({ error: 'Vendor credit memo requires vendor_id' });
    }
    if (data.type === 'CUSTOMER' && !data.customer_id) {
      return res.status(400).json({ error: 'Customer credit memo requires customer_id' });
    }

    const items = data.items.map((i) => {
      const taxAmount = (i.quantity * i.unit_price * (i.tax_percent || 0)) / 100;
      const total = i.quantity * i.unit_price + taxAmount;
      return {
        product_id: i.product_id,
        product_name: i.product_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        tax_percent: i.tax_percent || 0,
        tax_amount: taxAmount,
        total,
      };
    });
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const tax_amount = items.reduce((s, i) => s + i.tax_amount, 0);
    const total_amount = subtotal + tax_amount;

    const cm = await CreditMemo.create({
      credit_memo_number: generateCreditMemoNumber(),
      type: data.type,
      reference_invoice_id: data.reference_invoice_id || undefined,
      reference_shipment_id: data.reference_shipment_id || undefined,
      vendor_id: data.vendor_id || undefined,
      customer_id: data.customer_id || undefined,
      reason: data.reason,
      affects_inventory: data.affects_inventory,
      subtotal,
      tax_amount,
      total_amount,
      status: 'DRAFT',
      document_url: data.document_url,
      notes: data.notes,
      created_by: req.userId,
      items,
    });

    res.status(201).json({
      id: cm._id.toString(),
      credit_memo_number: cm.credit_memo_number,
      type: cm.type,
      status: cm.status,
      total_amount: cm.total_amount,
      created_at: cm.created_at,
    });
  } catch (e: any) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors?.[0]?.message || 'Validation error' });
    console.error('Create credit memo:', e);
    res.status(500).json({ error: 'Failed to create credit memo' });
  }
});

// Update (draft only)
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const cm = await CreditMemo.findById(req.params.id);
    if (!cm) return res.status(404).json({ error: 'Credit memo not found' });
    if (cm.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Only draft credit memos can be updated' });
    }
    const data = createSchema.partial().extend({ items: z.array(itemSchema).min(1).optional() }).parse(req.body);

    let items = cm.items;
    if (data.items) {
      items = data.items.map((i) => {
        const taxAmount = (i.quantity * i.unit_price * (i.tax_percent || 0)) / 100;
        const total = i.quantity * i.unit_price + taxAmount;
        return {
          product_id: new mongoose.Types.ObjectId(i.product_id),
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          tax_percent: i.tax_percent || 0,
          tax_amount: taxAmount,
          total,
        };
      });
    }
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const tax_amount = items.reduce((s, i) => s + i.tax_amount, 0);
    const total_amount = subtotal + tax_amount;

    await CreditMemo.findByIdAndUpdate(req.params.id, {
      ...(data.reference_invoice_id !== undefined && { reference_invoice_id: data.reference_invoice_id }),
      ...(data.reference_shipment_id !== undefined && { reference_shipment_id: data.reference_shipment_id }),
      ...(data.vendor_id !== undefined && { vendor_id: data.vendor_id }),
      ...(data.customer_id !== undefined && { customer_id: data.customer_id }),
      ...(data.reason !== undefined && { reason: data.reason }),
      ...(data.affects_inventory !== undefined && { affects_inventory: data.affects_inventory }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.document_url !== undefined && { document_url: data.document_url }),
      items,
      subtotal,
      tax_amount,
      total_amount,
    });

    res.json({ success: true });
  } catch (e: any) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors?.[0]?.message || 'Validation error' });
    console.error('Update credit memo:', e);
    res.status(500).json({ error: 'Failed to update credit memo' });
  }
});

// Approve
router.post('/:id/approve', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await approveCreditMemo(req.params.id, req.userId!);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, message: 'Credit memo approved' });
  } catch (e) {
    console.error('Approve credit memo:', e);
    res.status(500).json({ error: 'Failed to approve credit memo' });
  }
});

// Cancel
router.post('/:id/cancel', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await cancelCreditMemo(req.params.id);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, message: 'Credit memo cancelled' });
  } catch (e) {
    console.error('Cancel credit memo:', e);
    res.status(500).json({ error: 'Failed to cancel credit memo' });
  }
});

// Delete (draft / cancelled only — approved memos stay until cancelled)
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const cm = await CreditMemo.findById(req.params.id);
    if (!cm) return res.status(404).json({ error: 'Credit memo not found' });
    const status = String(cm.status || '').toUpperCase();
    if (status === 'APPROVED' || status === 'ADJUSTED') {
      return res.status(400).json({
        error: `${cm.credit_memo_number || 'This credit memo'} is ${status.toLowerCase()} and cannot be deleted. Cancel it first, or export it instead.`,
      });
    }
    await CreditMemo.deleteOne({ _id: cm._id });
    res.json({ success: true, id: cm._id.toString() });
  } catch (e) {
    console.error('Delete credit memo:', e);
    res.status(500).json({ error: 'Failed to delete credit memo' });
  }
});

// Analytics: total returns per vendor, damage %, return ratio by product
router.get('/analytics/returns-by-vendor', authenticateAdmin, async (req, res) => {
  try {
    const agg = await CreditMemo.aggregate([
      { $match: { type: 'VENDOR', status: 'APPROVED' } },
      { $group: { _id: '$vendor_id', total_amount: { $sum: '$total_amount' }, count: { $sum: 1 } } },
      { $lookup: { from: 'vendors', localField: '_id', foreignField: '_id', as: 'vendor' } },
      { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },
      { $project: { vendor_id: '$_id', vendor_name: '$vendor.name', total_amount: 1, count: 1 } },
    ]);
    res.json({ by_vendor: agg });
  } catch (e) {
    console.error('Analytics returns by vendor:', e);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

router.get('/analytics/reason-breakdown', authenticateAdmin, async (req, res) => {
  try {
    const agg = await CreditMemo.aggregate([
      { $match: { status: 'APPROVED' } },
      { $group: { _id: '$reason', count: { $sum: 1 }, total_amount: { $sum: '$total_amount' } } },
    ]);
    const total = agg.reduce((s, x) => s + x.count, 0);
    const withPct = agg.map((x) => ({ ...x, damage_pct: total ? Math.round((x.count / total) * 1000) / 10 : 0 }));
    res.json({ by_reason: withPct });
  } catch (e) {
    console.error('Analytics reason breakdown:', e);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

router.get('/analytics/return-ratio-by-product', authenticateAdmin, async (req, res) => {
  try {
    const agg = await CreditMemo.aggregate([
      { $match: { status: 'APPROVED' } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product_id', quantity_returned: { $sum: '$items.quantity' }, total_value: { $sum: '$items.total' } } },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      { $project: { product_id: '$_id', product_name: '$product.name', quantity_returned: 1, total_value: 1 } },
    ]);
    res.json({ by_product: agg });
  } catch (e) {
    console.error('Analytics return ratio by product:', e);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

export default router;
