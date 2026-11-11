import express from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import RFQ from '../models/RFQ';
import Product from '../models/Product';
import Customer from '../models/Customer';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { DOC_PREFIX, nextPrefixedNumber } from '../utils/documentNumbers';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const rfqCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many quote requests. Please try again later.' },
});

async function generateRfqNumber(): Promise<string> {
  return nextPrefixedNumber(RFQ, 'rfq_number', DOC_PREFIX.rfq);
}

const itemSchema = z.object({
  product_id: z.string().optional(),
  product_name: z.string().trim().min(1).max(300),
  category_name: z.string().trim().max(200).optional(),
  image_url: z.string().trim().max(2048).optional(),
  quantity: z
    .number({ invalid_type_error: 'Quantity must be a number' })
    .int()
    .min(1)
    .max(100000),
});

const createSchema = z.object({
  customer_name: z.string().trim().min(1).max(200),
  customer_email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(320)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  customer_phone: z
    .string()
    .trim()
    .min(4)
    .max(40)
    .regex(/^[\d+\s().\-]+$/, 'Invalid phone number'),
  customer_company: z.string().trim().max(200).optional(),
  customer_comments: z.string().trim().max(2000).optional(),
  source: z.enum(['website', 'store', 'manual']).optional(),
  items: z.array(itemSchema).min(1).max(200),
});

/**
 * Public: submit an RFQ from website/store. No auth required so anonymous
 * visitors can request a quote without creating an account first.
 */
router.post('/', rfqCreateLimiter, async (req, res) => {
  try {
    const data = createSchema.parse(req.body);

    const items = await Promise.all(
      data.items.map(async (it) => {
        let resolvedProductId: mongoose.Types.ObjectId | undefined;
        let resolvedName = it.product_name;
        let resolvedCategory = it.category_name;
        let resolvedImage = it.image_url;

        if (it.product_id && mongoose.Types.ObjectId.isValid(it.product_id)) {
          const product = await Product.findById(it.product_id).populate('category_id', 'name').lean();
          if (product) {
            resolvedProductId = product._id as mongoose.Types.ObjectId;
            resolvedName = product.name || resolvedName;
            const cat = (product as any).category_id;
            if (cat && typeof cat === 'object' && cat.name) {
              resolvedCategory = cat.name;
            }
            resolvedImage = product.image_url || resolvedImage;
          }
        }

        return {
          product_id: resolvedProductId,
          product_name: resolvedName,
          category_name: resolvedCategory,
          image_url: resolvedImage,
          quantity: it.quantity,
        };
      })
    );

    const rfqNumber = await generateRfqNumber();
    const rfq = await RFQ.create({
      rfq_number: rfqNumber,
      status: 'pending',
      customer_name: data.customer_name,
      customer_email: data.customer_email,
      customer_phone: data.customer_phone,
      customer_company: data.customer_company,
      customer_comments: data.customer_comments,
      source: data.source || 'website',
      items,
    });

    res.status(201).json({
      id: rfq._id.toString(),
      rfq_number: rfq.rfq_number,
      status: rfq.status,
      created_at: rfq.created_at,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    console.error('Create RFQ error:', error);
    res.status(500).json({ error: 'Failed to submit quote request' });
  }
});

/** Admin: list RFQs */
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { search, status, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const query: any = {};
    if (status && typeof status === 'string' && status !== 'all') {
      query.status = status;
    }
    if (search && typeof search === 'string') {
      query.$or = [
        { rfq_number: { $regex: search, $options: 'i' } },
        { customer_name: { $regex: search, $options: 'i' } },
        { customer_company: { $regex: search, $options: 'i' } },
        { customer_phone: { $regex: search, $options: 'i' } },
        { customer_email: { $regex: search, $options: 'i' } },
      ];
    }

    const [rfqs, total, pending, quoted] = await Promise.all([
      RFQ.find(query)
        .populate({ path: 'items.product_id', select: 'price cost_price product_id sku' })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      RFQ.countDocuments(query),
      RFQ.countDocuments({ status: 'pending' }),
      RFQ.countDocuments({ status: 'quoted' }),
    ]);

    res.json({
      rfqs: rfqs.map((r: any) => ({
        id: r._id.toString(),
        rfq_number: r.rfq_number,
        status: r.status,
        customer_name: r.customer_name,
        customer_email: r.customer_email,
        customer_phone: r.customer_phone,
        customer_company: r.customer_company,
        customer_comments: r.customer_comments,
        items: (r.items || []).map((it: any) => ({
          product_id: it.product_id && it.product_id._id ? String(it.product_id._id) : (it.product_id ? String(it.product_id) : null),
          product_name: it.product_name,
          category_name: it.category_name,
          image_url: it.image_url,
          quantity: it.quantity,
          price: it.product_id && typeof it.product_id === 'object' ? it.product_id.price : undefined,
          cost_price: it.product_id && typeof it.product_id === 'object' ? it.product_id.cost_price : undefined,
        })),
        item_count: (r.items || []).reduce((s: number, it: any) => s + (it.quantity || 0), 0),
        quotation_id: r.quotation_id ? String(r.quotation_id) : null,
        quotation_number: r.quotation_number,
        source: r.source,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)) || 1,
      },
      summary: { pending, quoted },
    });
  } catch (error) {
    console.error('List RFQs error:', error);
    res.status(500).json({ error: 'Failed to load RFQs' });
  }
});

/** Admin: get one RFQ */
router.get('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'RFQ not found' });
    }
    const r: any = await RFQ.findById(req.params.id)
      .populate({ path: 'items.product_id', select: 'price cost_price product_id sku' })
      .lean();
    if (!r) return res.status(404).json({ error: 'RFQ not found' });
    res.json({
      id: r._id.toString(),
      rfq_number: r.rfq_number,
      status: r.status,
      customer_name: r.customer_name,
      customer_email: r.customer_email,
      customer_phone: r.customer_phone,
      customer_company: r.customer_company,
      customer_comments: r.customer_comments,
      items: (r.items || []).map((it: any) => ({
        product_id: it.product_id && it.product_id._id ? String(it.product_id._id) : (it.product_id ? String(it.product_id) : null),
        product_name: it.product_name,
        category_name: it.category_name,
        image_url: it.image_url,
        quantity: it.quantity,
        price: it.product_id && typeof it.product_id === 'object' ? it.product_id.price : undefined,
        cost_price: it.product_id && typeof it.product_id === 'object' ? it.product_id.cost_price : undefined,
      })),
      quotation_id: r.quotation_id ? String(r.quotation_id) : null,
      quotation_number: r.quotation_number,
      source: r.source,
      notes: r.notes,
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  } catch (error) {
    console.error('Get RFQ error:', error);
    res.status(500).json({ error: 'Failed to load RFQ' });
  }
});

const statusSchema = z.object({
  status: z.enum(['pending', 'quoted', 'closed', 'cancelled']),
  notes: z.string().trim().max(2000).optional(),
});

/** Admin: update status / notes */
router.patch('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'RFQ not found' });
    }
    const data = statusSchema.parse(req.body);
    const updated = await RFQ.findByIdAndUpdate(
      req.params.id,
      { $set: { status: data.status, ...(data.notes !== undefined ? { notes: data.notes } : {}) } },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: 'RFQ not found' });
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    console.error('Update RFQ error:', error);
    res.status(500).json({ error: 'Failed to update RFQ' });
  }
});

const linkQuotationSchema = z.object({
  quotation_id: z.string().min(1),
  quotation_number: z.string().trim().max(80).optional(),
});

/** Admin: mark an RFQ as quoted and link the resulting quotation */
router.post('/:id/link-quotation', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'RFQ not found' });
    }
    const data = linkQuotationSchema.parse(req.body);
    const updated = await RFQ.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          quotation_id: mongoose.Types.ObjectId.isValid(data.quotation_id) ? data.quotation_id : undefined,
          quotation_number: data.quotation_number,
          status: 'quoted',
        },
      },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: 'RFQ not found' });
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    console.error('Link RFQ quotation error:', error);
    res.status(500).json({ error: 'Failed to link quotation' });
  }
});

const customerLinkSchema = z.object({
  customer_id: z.string().min(1).optional(),
  create: z.boolean().optional(),
});

/**
 * Admin helper: ensure a CRM Customer exists for this RFQ. If `create=true`
 * (or no existing match), upsert a new Customer using the RFQ contact info.
 * Returns the Customer id so the invoice/quotation lightbox can prefill it.
 */
router.post('/:id/ensure-customer', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'RFQ not found' });
    }
    const data = customerLinkSchema.parse(req.body || {});
    const rfq = await RFQ.findById(req.params.id);
    if (!rfq) return res.status(404).json({ error: 'RFQ not found' });

    if (data.customer_id && mongoose.Types.ObjectId.isValid(data.customer_id)) {
      rfq.customer_id = new mongoose.Types.ObjectId(data.customer_id);
      await rfq.save();
      return res.json({ customer_id: data.customer_id });
    }

    let existing = null as any;
    if (rfq.customer_phone) {
      existing = await Customer.findOne({ phone: rfq.customer_phone });
    }
    if (!existing && rfq.customer_email) {
      existing = await Customer.findOne({ email: rfq.customer_email });
    }
    if (!existing) {
      existing = await Customer.create({
        name: rfq.customer_name,
        company: rfq.customer_company,
        phone: rfq.customer_phone,
        email: rfq.customer_email,
        notes: rfq.customer_comments
          ? `Created from RFQ ${rfq.rfq_number}: ${rfq.customer_comments}`
          : `Created from RFQ ${rfq.rfq_number}`,
      });
    }
    rfq.customer_id = existing._id;
    await rfq.save();
    res.json({ customer_id: existing._id.toString() });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    console.error('Ensure RFQ customer error:', error);
    res.status(500).json({ error: 'Failed to prepare customer' });
  }
});

/** Admin: delete an RFQ */
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'RFQ not found' });
    }
    const deleted = await RFQ.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: 'RFQ not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete RFQ error:', error);
    res.status(500).json({ error: 'Failed to delete RFQ' });
  }
});

export default router;
