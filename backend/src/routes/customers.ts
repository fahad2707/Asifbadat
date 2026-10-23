import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Customer from '../models/Customer';
import Invoice from '../models/Invoice';
import CustomerProductPrice from '../models/CustomerProductPrice';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { derivedUnpaidReceivableMatch } from '../utils/invoiceFinancialState';
import { getCreditMemoTotalsByParty } from '../modules/credit-memo/services/creditMemoBalances';
import User from '../models/User';
import {
  ACCOUNT_STATUS_APPROVED,
  ACCOUNT_STATUS_PENDING,
  ACCOUNT_STATUS_REJECTED,
  ACCOUNT_STATUS_VALUES,
  accountStatusFromDocument,
} from '../utils/customerAccount';
import { z } from 'zod';

function customerAccountFields(c: {
  account_status?: unknown;
  user_id?: unknown;
  is_active?: unknown;
  website_signup?: unknown;
}) {
  return {
    account_status: accountStatusFromDocument(c.account_status),
    user_id: c.user_id ? String(c.user_id) : null,
    website_signup: c.website_signup === true,
    is_active: c.is_active !== false,
  };
}

const router = express.Router();

const uploadsDir = path.join(__dirname, '../../uploads/customers');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = (file.originalname && path.extname(file.originalname)) || '.bin';
    const name = `${(req as any).params.id}-${Date.now()}${ext}`;
    cb(null, name);
  },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } }); // 15MB

async function generateCustomerCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = 'C' + String(Math.floor(100000 + Math.random() * 900000));
    const exists = await Customer.findOne({ customer_code: code });
    if (!exists) return code;
  }
  return 'C' + String(Date.now() % 1000000).padStart(6, '0');
}

// Generate customer ID (for forms)
router.get('/generate-id', authenticateAdmin, async (_req, res) => {
  try {
    const customer_code = await generateCustomerCode();
    res.json({ customer_code });
  } catch (error) {
    console.error('Generate customer code error:', error);
    res.status(500).json({ error: 'Failed to generate' });
  }
});

// List customers
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    let query: any = { is_active: true };
    if (search && typeof search === 'string') {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    const [customers, total] = await Promise.all([
      Customer.find(query).sort({ name: 1 }).skip(skip).limit(Number(limit)).lean(),
      Customer.countDocuments(query),
    ]);
    res.json({
      customers: customers.map((c: any) => ({
        id: c._id.toString(),
        customer_code: c.customer_code,
        name: c.name,
        company: c.company,
        phone: c.phone,
        email: c.email,
        address: c.address,
        billing_address: c.billing_address,
        city: c.city,
        state: c.state,
        zip: c.zip,
        tax_id: c.tax_id,
        tax_exempt: Boolean(c.tax_exempt),
        payment_terms: c.payment_terms,
        credit_limit: c.credit_limit,
        notes: c.notes,
        documents: c.documents || [],
        ...customerAccountFields(c),
        created_at: c.created_at,
      })),
      pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    console.error('List customers error:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// Open balances: unpaid invoice remaining. Credits are returned separately (not netted into open_balance).
router.get('/balances', authenticateAdmin, async (_req, res) => {
  try {
    const [balances, creditTotals] = await Promise.all([
      Invoice.aggregate([
        { $match: { ...derivedUnpaidReceivableMatch, customer_id: { $exists: true, $ne: null } } },
        { $project: { customer_id: 1, balance: { $subtract: ['$total_amount', { $ifNull: ['$amount_paid', 0] }] } } },
        { $group: { _id: '$customer_id', open_balance: { $sum: '$balance' } } },
      ]),
      getCreditMemoTotalsByParty('CUSTOMER'),
    ]);

    const byCustomer = new Map<string, number>();
    for (const b of balances as Array<{ _id?: { toString(): string }; open_balance?: number }>) {
      const id = b._id?.toString();
      if (!id) continue;
      byCustomer.set(id, Number(b.open_balance) || 0);
    }
    for (const id of creditTotals.keys()) {
      if (!byCustomer.has(id)) byCustomer.set(id, 0);
    }

    res.json({
      balances: Array.from(byCustomer.entries()).map(([customer_id, open_balance]) => {
        const credit_memo_total = creditTotals.get(customer_id) ?? 0;
        return {
          customer_id,
          open_balance,
          credit_memo_total,
          net_due: Math.max(0, open_balance - credit_memo_total),
        };
      }),
    });
  } catch (error) {
    console.error('Customers balances error:', error);
    res.status(500).json({ error: 'Failed to fetch balances' });
  }
});

/**
 * Website signup queue for future admin UI.
 * Only Customers created by storefront registration (website_signup: true).
 * Excludes ordinary admin-created / imported CRM rows.
 */
router.get('/website-signups', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const query: Record<string, unknown> = {
      website_signup: true,
      user_id: { $exists: true, $ne: null },
    };
    if (typeof status === 'string' && status.trim()) {
      const parsed = accountStatusFromDocument(status.trim());
      if (!parsed) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      query.account_status = parsed;
    } else {
      query.account_status = { $in: [ACCOUNT_STATUS_PENDING, ACCOUNT_STATUS_REJECTED] };
    }

    const [rows, total] = await Promise.all([
      Customer.find(query).sort({ created_at: -1 }).skip(skip).limit(Number(limit)).lean(),
      Customer.countDocuments(query),
    ]);

    const userIds = rows
      .map((c: { user_id?: unknown }) => c.user_id)
      .filter(Boolean)
      .map((id) => String(id));
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } })
          .select('name email phone email_verified created_at')
          .lean()
      : [];
    const userById = new Map(users.map((u: any) => [String(u._id), u]));

    res.json({
      signups: rows.map((c: any) => {
        const uid = c.user_id ? String(c.user_id) : null;
        const user = uid ? userById.get(uid) : undefined;
        return {
          id: c._id.toString(),
          customer_code: c.customer_code,
          name: c.name,
          company: c.company,
          phone: c.phone,
          email: c.email,
          notes: c.notes,
          created_at: c.created_at,
          ...customerAccountFields(c),
          user: user
            ? {
                id: String(user._id),
                name: user.name || '',
                email: user.email || null,
                phone: user.phone || null,
                email_verified: user.email_verified !== false,
                created_at: user.created_at,
              }
            : null,
        };
      }),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('List website signups error:', error);
    res.status(500).json({ error: 'Failed to fetch website signups' });
  }
});

// Last invoice selling prices for this customer (negotiated / last-charged).
router.get('/:id/product-prices', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid customer' });
    }
    const rows = await CustomerProductPrice.find({ customer_id: new mongoose.Types.ObjectId(id) })
      .populate('product_id', 'name price sku product_id')
      .sort({ last_invoice_date: -1, updated_at: -1 })
      .lean();
    res.json({
      prices: rows.map((row) => {
        const product = row.product_id && typeof row.product_id === 'object' ? (row.product_id as {
          _id?: { toString(): string };
          name?: string;
          price?: number;
          sku?: string;
          product_id?: string;
        }) : null;
        return {
          product_id: product?._id?.toString() || String(row.product_id || ''),
          product_name: product?.name || 'Product',
          sku: product?.sku || '',
          catalog_code: product?.product_id || '',
          catalog_price: product?.price != null ? Number(product.price) : null,
          last_price: Number(row.last_price) || 0,
          last_invoice_date: row.last_invoice_date || null,
        };
      }),
    });
  } catch (error) {
    console.error('Customer product prices error:', error);
    res.status(500).json({ error: 'Failed to fetch negotiated prices' });
  }
});

// Get one customer
router.get('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const customer = await Customer.findById(req.params.id).lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const c = customer as any;
    res.json({
      id: c._id.toString(),
      customer_code: c.customer_code,
      name: c.name,
      company: c.company,
      phone: c.phone,
      email: c.email,
      address: c.address,
      billing_address: c.billing_address,
      city: c.city,
      state: c.state,
      zip: c.zip,
      tax_id: c.tax_id,
      tax_exempt: Boolean(c.tax_exempt),
      payment_terms: c.payment_terms,
      credit_limit: c.credit_limit,
      notes: c.notes,
      documents: c.documents || [],
      ...customerAccountFields(c),
      created_at: c.created_at,
    });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

// Create customer
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      customer_code: z.string().optional(),
      name: z.string().min(1),
      company: z.string().optional(),
      phone: z.string().min(1),
      email: z.string().email().optional().or(z.literal('')),
      address: z.string().optional(),
      billing_address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      tax_id: z.string().optional(),
      payment_terms: z.string().optional(),
      credit_limit: z.number().optional(),
      notes: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const createData: any = { ...data };
    if (data.email === '') createData.email = undefined;
    if (!createData.customer_code) createData.customer_code = await generateCustomerCode();
    createData.account_status = ACCOUNT_STATUS_PENDING;
    const customer = await Customer.create(createData);
    res.status(201).json({
      id: customer._id.toString(),
      ...customer.toObject(),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Create customer error:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// Upload document for customer (PDF, JPG, etc.)
router.post('/:id/documents', authenticateAdmin, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const doc = { name: req.file.originalname || req.file.filename, url: `/uploads/customers/${req.file.filename}` };
    const docs = (customer as any).documents || [];
    docs.push(doc);
    (customer as any).documents = docs;
    await customer.save();
    res.json({ document: doc, documents: docs });
  } catch (error) {
    console.error('Upload customer document error:', error);
    res.status(500).json({ error: 'Failed to upload' });
  }
});

// Update customer
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      customer_code: z.string().optional(),
      name: z.string().min(1).optional(),
      company: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      address: z.string().optional(),
      billing_address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      tax_id: z.string().optional(),
      payment_terms: z.string().optional(),
      credit_limit: z.number().optional(),
      notes: z.string().optional(),
      is_active: z.boolean().optional(),
    });
    // account_status is omitted from this schema so PUT cannot approve/revoke.
    const data = schema.parse(req.body);
    const customer = await Customer.findByIdAndUpdate(req.params.id, data, { new: true });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json({ id: customer._id.toString(), ...customer.toObject(), ...customerAccountFields(customer) });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Update customer error:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// Online-account approval. Not writable via PUT /:id or client body flags.
router.put('/:id/account-status', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      account_status: z.enum(ACCOUNT_STATUS_VALUES),
    });
    const { account_status } = schema.parse(req.body);
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    customer.account_status = account_status;
    await customer.save();
    res.json({
      id: customer._id.toString(),
      ...customerAccountFields(customer),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Update customer account status error:', error);
    res.status(500).json({ error: 'Failed to update account status' });
  }
});

// Delete (soft) customer
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    await Customer.findByIdAndUpdate(req.params.id, { is_active: false });
    res.json({ message: 'Customer deactivated' });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

// Bulk delete (soft) customers
router.post('/bulk-delete', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({ ids: z.array(z.string()).min(1) });
    const { ids } = schema.parse(req.body);
    await Customer.updateMany({ _id: { $in: ids } }, { is_active: false });
    res.json({ message: `${ids.length} customer(s) deactivated`, deleted: ids.length });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Bulk delete customers error:', error);
    res.status(500).json({ error: 'Failed to delete customers' });
  }
});

export default router;
