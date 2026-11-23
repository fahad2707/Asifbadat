import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Customer from '../models/Customer';
import Invoice from '../models/Invoice';
import Receipt from '../models/Receipt';
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
import { generateCustomerCode } from '../utils/customerCode';
import { provisionOnlineLogin, revealExistingOnlineLogin, type ProvisionedLogin } from '../utils/provisionOnlineUser';
import { ensureWebsiteSignupForUser } from '../services/ensureCustomerWebsiteSignup';

/** First letter of each word, matching the customer form. */
function titleCaseWords(value: string): string {
  return String(value).replace(/(^|[^A-Za-z0-9]+)([A-Za-z])/g, (_m, sep: string, letter: string) => {
    return `${sep}${letter.toUpperCase()}`;
  });
}

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


function catalogPriceDiffers(lastPrice: number, catalogPrice: number | null | undefined): boolean {
  if (catalogPrice == null || Number.isNaN(Number(catalogPrice))) return false;
  return Math.round(lastPrice * 100) !== Math.round(Number(catalogPrice) * 100);
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
          account_position: Math.round((open_balance - credit_memo_total) * 100) / 100,
        };
      }),
    });
  } catch (error) {
    console.error('Customers balances error:', error);
    res.status(500).json({ error: 'Failed to fetch balances' });
  }
});

function localDay(value?: Date | string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

router.get('/statement', authenticateAdmin, async (_req, res) => {
  try {
    const [customers, invoices, receipts, credits] = await Promise.all([
      Customer.find({}).select('name company phone email customer_code payment_terms credit_limit account_status').sort({ name: 1 }).lean(),
      Invoice.find({ invoice_type: 'invoice' }).select('customer_id invoice_number invoice_date total_amount amount_paid').lean(),
      Receipt.find({}).select('customer_id trx_date amount_received pmt_mode invoice_num').sort({ trx_date: -1 }).lean(),
      getCreditMemoTotalsByParty('CUSTOMER'),
    ]);

    const invoicesByCustomer = new Map<string, Array<{ number: string; date: string; total: number; paid: number; balance: number }>>();
    for (const raw of invoices) {
      const doc = raw as { customer_id?: { toString(): string }; invoice_number?: string; invoice_date?: Date; total_amount?: number; amount_paid?: number };
      const id = doc.customer_id ? doc.customer_id.toString() : '';
      if (!id) continue;
      const total = Number(doc.total_amount) || 0;
      const paid = Number(doc.amount_paid) || 0;
      const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
      const row = {
        number: String(doc.invoice_number || ''),
        date: localDay(doc.invoice_date),
        total,
        paid,
        balance,
      };
      invoicesByCustomer.set(id, [...(invoicesByCustomer.get(id) || []), row]);
    }

    const paymentsByCustomer = new Map<string, { count: number; last_date: string; last_amount: number; last_method: string }>();
    for (const raw of receipts) {
      const doc = raw as { customer_id?: { toString(): string }; trx_date?: Date; amount_received?: number; pmt_mode?: string };
      const id = doc.customer_id ? doc.customer_id.toString() : '';
      if (!id) continue;
      const current = paymentsByCustomer.get(id);
      const date = localDay(doc.trx_date);
      if (!current) {
        paymentsByCustomer.set(id, { count: 1, last_date: date, last_amount: Number(doc.amount_received) || 0, last_method: String(doc.pmt_mode || '') });
      } else {
        current.count += 1;
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const rows = customers.map((raw) => {
      const customer = raw as { _id: { toString(): string }; name?: string; company?: string; phone?: string; email?: string; customer_code?: string; payment_terms?: string; credit_limit?: number; account_status?: string };
      const id = customer._id.toString();
      const docs = invoicesByCustomer.get(id) || [];
      const unpaid = docs.filter((doc) => doc.balance > 0);
      const billed = round(docs.reduce((sum, doc) => sum + doc.total, 0));
      const paid = round(docs.reduce((sum, doc) => sum + doc.paid, 0));
      const open = round(unpaid.reduce((sum, doc) => sum + doc.balance, 0));
      const credit = round(credits.get(id) || 0);
      const payment = paymentsByCustomer.get(id);
      const lastInvoice = docs.map((doc) => doc.date).filter(Boolean).sort().at(-1) || '';
      return {
        id,
        name: customer.name || '',
        company: customer.company || '',
        phone: customer.phone || '',
        email: customer.email || '',
        customer_code: customer.customer_code || '',
        payment_terms: customer.payment_terms || '',
        credit_limit: Number(customer.credit_limit) || 0,
        account_status: customer.account_status || '',
        invoice_count: docs.length,
        unpaid_count: unpaid.length,
        partial_count: docs.filter((doc) => doc.paid > 0 && doc.balance > 0).length,
        paid_count: docs.filter((doc) => doc.balance <= 0 && doc.total > 0).length,
        billed,
        paid,
        open_balance: round(open - credit),
        credits: credit,
        last_invoice_date: lastInvoice,
        last_payment_date: payment?.last_date || '',
        last_payment_amount: payment?.last_amount || 0,
        last_payment_method: payment?.last_method || '',
        payment_count: payment?.count || 0,
        unpaid_invoices: unpaid,
      };
    });

    res.json({
      customers: rows,
      totals: {
        customers: rows.length,
        billed: round(rows.reduce((sum, row) => sum + row.billed, 0)),
        paid: round(rows.reduce((sum, row) => sum + row.paid, 0)),
        open_balance: round(rows.reduce((sum, row) => sum + row.open_balance, 0)),
        unpaid_invoices: rows.reduce((sum, row) => sum + row.unpaid_count, 0),
        credits: round(rows.reduce((sum, row) => sum + row.credits, 0)),
      },
    });
  } catch (error) {
    console.error('Customer statement error:', error);
    res.status(500).json({ error: 'Failed to build the customer statement' });
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
    const prices = rows
      .map((row) => {
        const product = row.product_id && typeof row.product_id === 'object' ? (row.product_id as {
          _id?: { toString(): string };
          name?: string;
          price?: number;
          sku?: string;
          product_id?: string;
        }) : null;
        const catalog_price = product?.price != null ? Number(product.price) : null;
        const last_price = Number(row.last_price) || 0;
        return {
          product_id: product?._id?.toString() || String(row.product_id || ''),
          product_name: product?.name || 'Product',
          sku: product?.sku || '',
          catalog_code: product?.product_id || '',
          catalog_price,
          last_price,
          last_invoice_date: row.last_invoice_date || null,
        };
      })
      .filter((row) => catalogPriceDiffers(row.last_price, row.catalog_price));
    res.json({ prices });
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
    createData.name = titleCaseWords(String(createData.name).trim());
    if (createData.company) createData.company = titleCaseWords(String(createData.company).trim());
    if (!createData.customer_code) createData.customer_code = await generateCustomerCode();
    createData.account_status = ACCOUNT_STATUS_PENDING;
    const customer = await Customer.create(createData);
    try {
      // Pending queue only. notify:false so credentials are still issued on approval.
      const login = await provisionOnlineLogin(customer, { notify: false });
      if (login && typeof customer.save === 'function') await customer.save();
      if (customer.user_id) await ensureWebsiteSignupForUser(customer.user_id);
    } catch (err) {
      console.error('Pending website signup for new customer failed:', err);
    }
    res.status(201).json({
      id: customer._id.toString(),
      ...customer.toObject(),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.message });
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
    const doc = {
      name: req.file.originalname || req.file.filename,
      url: `/uploads/customers/${req.file.filename}`,
      uploaded_at: new Date(),
    };
    const existing = Array.isArray((customer as any).documents)
      ? (customer as any).documents
      : (customer as any).documents
        ? [(customer as any).documents]
        : [];
    existing.push(doc);
    (customer as any).documents = existing;
    await customer.save();
    const docs = (customer as any).documents || existing;
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
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.message });
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
    let online_login: ProvisionedLogin | null = null;
    const wasApproved = customer.account_status === ACCOUNT_STATUS_APPROVED;
    if (account_status === ACCOUNT_STATUS_APPROVED) {
      online_login = await provisionOnlineLogin(customer);
      if (!online_login && !wasApproved) {
        online_login = await revealExistingOnlineLogin(customer);
      }
    }
    customer.account_status = account_status;
    await customer.save();
    res.json({
      id: customer._id.toString(),
      ...customerAccountFields(customer),
      ...(online_login ? { online_login } : {}),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.message });
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
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.message });
    console.error('Bulk delete customers error:', error);
    res.status(500).json({ error: 'Failed to delete customers' });
  }
});

export default router;
