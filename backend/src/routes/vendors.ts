import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import Vendor from '../models/Vendor';
import PurchaseOrder from '../models/PurchaseOrder';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { getVendorStatement } from '../modules/vendors/services/vendorLedgerService';
import {
  getVendorOutstanding,
  getVendorOverdue,
  getVendorDeliveryPerformance,
  getVendorReturnsAnalytics,
  getLastPurchasePrices,
} from '../modules/vendors/services/vendorAnalyticsService';
import { getCreditMemoTotalsByParty } from '../modules/credit-memo/services/creditMemoBalances';
import { STATE_PROVINCE_OPTIONS } from '../utils/regions';

const router = express.Router();

// File uploads for supplier documents
const vendorUploadsDir = path.join(__dirname, '../../uploads/vendors');
if (!fs.existsSync(vendorUploadsDir)) {
  fs.mkdirSync(vendorUploadsDir, { recursive: true });
}
const vendorStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, vendorUploadsDir),
  filename: (req, file, cb) => {
    const ext = (file.originalname && path.extname(file.originalname)) || '.bin';
    const name = `${(req as any).params.id}-${Date.now()}${ext}`;
    cb(null, name);
  },
});
const vendorUpload = multer({ storage: vendorStorage, limits: { fileSize: 15 * 1024 * 1024 } }); // 15MB

function generateSupplierId() {
  return 'S' + Math.floor(10000 + Math.random() * 90000).toString();
}

// Generate supplier ID
router.get('/generate-id', authenticateAdmin, (req, res) => {
  res.json({ supplier_id: generateSupplierId() });
});

// List vendors (with purchases/balance from POs)
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    let query: any = { is_active: true };
    if (search && typeof search === 'string') {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { supplier_id: { $regex: search, $options: 'i' } },
        { contact_name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    const [vendors, total] = await Promise.all([
      Vendor.find(query).sort({ name: 1 }).skip(skip).limit(Number(limit)).lean(),
      Vendor.countDocuments(query),
    ]);
    const vendorIds = (vendors as any[]).map((v) => v._id);
    const [poAgg, creditTotals] = await Promise.all([
      PurchaseOrder.aggregate([
        { $match: { vendor_id: { $in: vendorIds }, status: { $ne: 'cancelled' } } },
        {
          $group: {
            _id: '$vendor_id',
            totalPurchases: { $sum: '$total_amount' },
            totalPaid: { $sum: { $ifNull: ['$amount_paid', 0] } },
          },
        },
      ]),
      getCreditMemoTotalsByParty('VENDOR', vendorIds),
    ]);
    const poMap = new Map(
      poAgg.map((r: any) => [
        r._id.toString(),
        {
          purchases: Number(r.totalPurchases || 0),
          paid: Number(r.totalPaid || 0),
        },
      ])
    );
    res.json({
      vendors: (vendors as any[]).map((v) => {
        const id = v._id.toString();
        const poData = poMap.get(id) || { purchases: 0, paid: 0 };
        const purchases = poData.purchases;
        const paid = poData.paid;
        const credits = creditTotals.get(id) ?? 0;
        // Credit memos settle dues like payments: reduce open AP, increase paid dues.
        const paidBalance = paid + credits;
        const balance = Math.max(0, purchases - paidBalance);
        return {
          id,
          supplier_id: v.supplier_id || v._id.toString().slice(-6).toUpperCase(),
          name: v.name,
          contact_name: v.contact_name,
          phone: v.phone,
          email: v.email,
          address: v.address,
          city: v.city,
          state: v.state,
          zip: v.zip,
          tax_id: v.tax_id,
          payment_terms: v.payment_terms,
          notes: v.notes,
          is_active: v.is_active,
          created_at: v.created_at,
          purchases,
          payments: paid,
          credit_memo_total: credits,
          balance,
          open_balance: balance,
          paid_balance: paidBalance,
        };
      }),
      pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    console.error('List vendors error:', error);
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
});

// States/provinces for dropdowns (full US + CA list, plus any custom values already on vendors)
router.get('/locations/states', authenticateAdmin, async (_req: AuthRequest, res) => {
  try {
    const fromVendors = await Vendor.distinct('state').then((r) => r.filter(Boolean) as string[]);
    const combined = [...new Set([...STATE_PROVINCE_OPTIONS, ...fromVendors])].sort((a, b) =>
      a.localeCompare(b)
    );
    res.json({ states: combined });
  } catch {
    res.json({ states: [...STATE_PROVINCE_OPTIONS] });
  }
});

router.get('/locations/cities', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { state } = req.query;
    let query: any = {};
    if (state && typeof state === 'string') query.state = state;
    const cities = await Vendor.distinct('city', query).then((r) => r.filter(Boolean).sort());
    res.json({ cities });
  } catch (error) {
    res.json({ cities: [] });
  }
});

// ---------- Analytics (must be before /:id) ----------
router.get('/analytics/outstanding', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const rows = await getVendorOutstanding();
    res.json({ outstanding: rows });
  } catch (e) {
    console.error('Vendor outstanding:', e);
    res.status(500).json({ error: 'Failed to fetch outstanding' });
  }
});

router.get('/analytics/overdue', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const rows = await getVendorOverdue();
    res.json({ overdue: rows });
  } catch (e) {
    console.error('Vendor overdue:', e);
    res.status(500).json({ error: 'Failed to fetch overdue' });
  }
});

router.get('/analytics/performance', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const vendorId = typeof req.query.vendor_id === 'string' ? req.query.vendor_id : undefined;
    const rows = await getVendorDeliveryPerformance(vendorId);
    res.json({ performance: rows });
  } catch (e) {
    console.error('Vendor performance:', e);
    res.status(500).json({ error: 'Failed to fetch performance' });
  }
});

router.get('/analytics/returns', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const vendorId = typeof req.query.vendor_id === 'string' ? req.query.vendor_id : undefined;
    const rows = await getVendorReturnsAnalytics(vendorId);
    res.json({ returns: rows });
  } catch (e) {
    console.error('Vendor returns analytics:', e);
    res.status(500).json({ error: 'Failed to fetch returns analytics' });
  }
});

router.get('/analytics/last-purchase-prices', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const productId = typeof req.query.product_id === 'string' ? req.query.product_id : undefined;
    const vendorId = typeof req.query.vendor_id === 'string' ? req.query.vendor_id : undefined;
    const rows = await getLastPurchasePrices(productId, vendorId);
    res.json({ last_purchase_prices: rows });
  } catch (e) {
    console.error('Last purchase prices:', e);
    res.status(500).json({ error: 'Failed to fetch last purchase prices' });
  }
});

// Get one vendor
router.get('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id).lean();
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    const v = vendor as any;
    res.json({
      id: v._id.toString(),
      supplier_id: v.supplier_id,
      name: v.name,
      contact_name: v.contact_name,
      phone: v.phone,
      email: v.email,
      address: v.address,
      city: v.city,
      state: v.state,
      zip: v.zip,
      tax_id: v.tax_id,
      gst_number: v.gst_number,
      pan: v.pan,
      payment_terms: v.payment_terms,
      payment_terms_days: v.payment_terms_days,
      credit_limit: v.credit_limit,
      rating: v.rating,
      status: v.status,
      bank_details: v.bank_details,
      notes: v.notes,
      documents: v.documents || [],
      is_active: v.is_active,
      created_at: v.created_at,
    });
  } catch (error) {
    console.error('Get vendor error:', error);
    res.status(500).json({ error: 'Failed to fetch vendor' });
  }
});

// Vendor ledger statement
router.get('/:id/ledger', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const skip = req.query.skip ? Number(req.query.skip) : 0;
    const result = await getVendorStatement(req.params.id, { fromDate: from, toDate: to, limit, skip });
    res.json(result);
  } catch (e) {
    console.error('Vendor ledger:', e);
    res.status(500).json({ error: 'Failed to fetch ledger' });
  }
});

// Vendor balance
router.get('/:id/balance', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    const [poAgg, creditTotals] = await Promise.all([
      PurchaseOrder.aggregate([
        { $match: { vendor_id: vendor._id, status: { $ne: 'cancelled' } } },
        {
          $group: {
            _id: null,
            totalPurchases: { $sum: '$total_amount' },
            totalPaid: { $sum: { $ifNull: ['$amount_paid', 0] } },
          },
        },
      ]),
      getCreditMemoTotalsByParty('VENDOR', [vendor._id as any]),
    ]);
    const totalPurchases = poAgg[0]?.totalPurchases ?? 0;
    const totalPaid = poAgg[0]?.totalPaid ?? 0;
    const creditMemoTotal = creditTotals.get(vendor._id.toString()) ?? 0;
    const totalSettled = totalPaid + creditMemoTotal;
    const balance = Math.max(0, totalPurchases - totalSettled);
    res.json({
      balance,
      total_purchases: totalPurchases,
      total_paid: totalPaid,
      credit_memo_total: creditMemoTotal,
      paid_balance: totalSettled,
    });
  } catch (e) {
    console.error('Vendor balance:', e);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// Upload document for supplier (PDF, JPG, etc.)
router.post('/:id/documents', authenticateAdmin, vendorUpload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Supplier not found' });
    const doc = {
      name: req.file.originalname || req.file.filename,
      url: `/uploads/vendors/${req.file.filename}`,
      uploaded_at: new Date(),
    };
    const docs = ((vendor as any).documents || []) as any[];
    docs.push(doc);
    (vendor as any).documents = docs;
    await vendor.save();
    res.json({ document: doc, documents: docs });
  } catch (error) {
    console.error('Upload supplier document error:', error);
    res.status(500).json({ error: 'Failed to upload' });
  }
});

const bankDetailsSchema = z.object({
  account_name: z.string().optional(),
  account_number: z.string().optional(),
  bank_name: z.string().optional(),
  ifsc: z.string().optional(),
  branch: z.string().optional(),
}).optional();

// Create vendor
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      supplier_id: z.string().optional(),
      name: z.string().min(1),
      contact_name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      tax_id: z.string().optional(),
      gst_number: z.string().optional(),
      pan: z.string().optional(),
      payment_terms_days: z.union([z.literal(15), z.literal(30), z.literal(45)]).optional(),
      payment_terms: z.string().optional(),
      credit_limit: z.number().min(0).optional(),
      rating: z.number().min(0).max(100).optional(),
      status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).optional(),
      bank_details: bankDetailsSchema,
      notes: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const payload: any = { ...data };
    if (!payload.email) delete payload.email;
    if (data.supplier_id) payload.supplier_id = data.supplier_id;
    else payload.supplier_id = generateSupplierId();
    const vendor = await Vendor.create(payload);
    res.status(201).json({ id: vendor._id.toString(), ...vendor.toObject() });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Create vendor error:', error);
    res.status(500).json({ error: 'Failed to create vendor' });
  }
});

// Update vendor
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      contact_name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      tax_id: z.string().optional(),
      gst_number: z.string().optional(),
      pan: z.string().optional(),
      payment_terms_days: z.union([z.literal(15), z.literal(30), z.literal(45)]).optional(),
      payment_terms: z.string().optional(),
      credit_limit: z.number().min(0).optional(),
      rating: z.number().min(0).max(100).optional(),
      status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).optional(),
      bank_details: bankDetailsSchema,
      notes: z.string().optional(),
      is_active: z.boolean().optional(),
    });
    const data = schema.parse(req.body);
    const vendor = await Vendor.findByIdAndUpdate(req.params.id, data, { new: true });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ id: vendor._id.toString(), ...vendor.toObject() });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Update vendor error:', error);
    res.status(500).json({ error: 'Failed to update vendor' });
  }
});

// Delete (soft) vendor
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    await Vendor.findByIdAndUpdate(req.params.id, { is_active: false });
    res.json({ message: 'Vendor deactivated' });
  } catch (error) {
    console.error('Delete vendor error:', error);
    res.status(500).json({ error: 'Failed to delete vendor' });
  }
});

// Bulk delete (soft) vendors
router.post('/bulk-delete', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({ ids: z.array(z.string()).min(1) });
    const { ids } = schema.parse(req.body);
    await Vendor.updateMany({ _id: { $in: ids } }, { is_active: false });
    res.json({ message: `${ids.length} vendor(s) deactivated`, deleted: ids.length });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Bulk delete vendors error:', error);
    res.status(500).json({ error: 'Failed to delete vendors' });
  }
});

export default router;
