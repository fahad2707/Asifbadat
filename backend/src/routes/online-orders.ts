import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import OnlineOrder from '../models/OnlineOrder';
import Product from '../models/Product';
import Invoice from '../models/Invoice';
import { authenticateAdmin, authenticateUser, AuthRequest } from '../middleware/auth';
import { onlineCheckoutLimiter, onlineTrackLimiter } from '../middleware/rateLimit';
import { logSecurityEvent } from '../utils/securityLog';
import { isUserLinkedToApprovedCustomer } from '../utils/customerAccount';
import Customer from '../models/Customer';
import {
  checkoutPayloadMatches,
  formatOnlineOrderCreateResponse,
  isCheckoutSubmissionDuplicateKey,
  waitForCommittedCheckoutOrder,
} from '../utils/onlineOrderIdempotency';
import { DOC_PREFIX, nextPrefixedNumber } from '../utils/documentNumbers';

const router = express.Router();

const QUOTATION_REVIEW_ERROR =
  'Website orders are reviewed as quotations. Draft a quotation, convert it to an invoice, then ship. Stock is deducted when the shipment is marked delivered.';

const placeOrderSchema = z.object({
  checkout_submission_id: z.string().trim().min(8).max(128),
  customer_name: z.string().trim().min(1).max(200),
  customer_email: z.string().trim().toLowerCase().email().max(320),
  customer_phone: z.string().trim().min(4).max(32).regex(/^[\d+\s().-]+$/),
  address_line1: z.string().trim().min(1).max(300),
  address_line2: z.string().trim().max(300).optional(),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().min(1).max(80),
  zip: z.string().trim().min(3).max(20).regex(/^[\w\s-]+$/),
  country: z.string().trim().max(80).optional(),
  payment_method: z.enum(['cod', 'card']),
  card_last4: z.string().regex(/^\d{4}$/).optional(),
  card_brand: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().refine((id) => mongoose.Types.ObjectId.isValid(id), 'Invalid product id'),
        quantity: z.number().int().positive().max(500),
      })
    )
    .min(1)
    .max(80),
});

async function getNextOrderNumber(): Promise<string> {
  return nextPrefixedNumber(OnlineOrder, 'order_number', DOC_PREFIX.onlineOrder);
}

/** Website orders are quotations until converted. Only cancel is allowed from the order itself. */
const ONLINE_ORDER_ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  confirmed: ['cancelled'],
  quoted: ['cancelled'],
  packed: ['cancelled'],
  dispatched: ['cancelled'],
};

function isAllowedOnlineOrderTransition(from: string, to: string): boolean {
  return (ONLINE_ORDER_ALLOWED_TRANSITIONS[from] || []).includes(to);
}

// Approved storefront User only. Guest / unapproved / admin JWT cannot create OnlineOrders.
router.post('/', onlineCheckoutLimiter, authenticateUser, async (req: AuthRequest, res) => {
  try {
    const userId = typeof req.userId === 'string' ? req.userId.trim() : '';
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const approved = await isUserLinkedToApprovedCustomer(userId);
    if (!approved) {
      return res.status(403).json({ error: 'Account is not approved for online ordering' });
    }

    const linkedCustomer = await Customer.findOne({ user_id: userId }).select('_id').lean();
    if (!linkedCustomer) {
      return res.status(403).json({ error: 'Account is not approved for online ordering' });
    }

    const body = placeOrderSchema.parse(req.body);
    const submissionId = body.checkout_submission_id;

    // Fast-path replay: unique index remains the concurrency guarantee.
    const existing = await OnlineOrder.findOne({
      user_id: userId,
      checkout_submission_id: submissionId,
    }).lean();
    if (existing) {
      if (!checkoutPayloadMatches(existing as any, body)) {
        return res.status(409).json({
          error: 'Checkout submission ID was already used for a different checkout',
        });
      }
      return res.status(200).json(formatOnlineOrderCreateResponse(existing as any));
    }

    const orderItems: any[] = [];
    let subtotal = 0;
    let totalTax = 0;

    for (const item of body.items) {
      const product = await Product.findById(item.product_id).lean();
      if (!product || (product as any).is_active === false) {
        return res.status(400).json({ error: 'One or more products are unavailable' });
      }
      const p = product as any;
      const qty = item.quantity;
      const price = Number(p.price);
      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({ error: 'Invalid product configuration' });
      }
      const taxRate = Number(p.tax_rate) || 0;
      const lineSubtotal = Math.round(price * qty * 100) / 100;
      const lineTax = Math.round(lineSubtotal * (taxRate / 100) * 100) / 100;

      subtotal += lineSubtotal;
      totalTax += lineTax;

      orderItems.push({
        product_id: new mongoose.Types.ObjectId(item.product_id),
        product_name: p.name,
        quantity: qty,
        price,
        tax_rate: taxRate,
        subtotal: lineSubtotal,
      });
    }

    const totalAmount = Math.round((subtotal + totalTax) * 100) / 100;
    const orderNumber = await getNextOrderNumber();

    try {
      const order = await OnlineOrder.create({
        order_number: orderNumber,
        user_id: userId,
        customer_id: (linkedCustomer as { _id: mongoose.Types.ObjectId })._id,
        checkout_submission_id: submissionId,
        customer_name: body.customer_name,
        customer_email: body.customer_email,
        customer_phone: body.customer_phone,
        address_line1: body.address_line1,
        address_line2: body.address_line2 || '',
        city: body.city,
        state: body.state,
        zip: body.zip,
        country: body.country?.trim() || 'US',
        items: orderItems,
        subtotal: Math.round(subtotal * 100) / 100,
        tax_amount: Math.round(totalTax * 100) / 100,
        total_amount: totalAmount,
        payment_method: body.payment_method,
        payment_status: 'pending',
        card_last4: body.card_last4 || undefined,
        card_brand: body.card_brand || undefined,
        status: 'confirmed',
        status_history: [{ status: 'confirmed', timestamp: new Date() }],
        notes: body.notes || undefined,
      });

      return res.status(201).json(formatOnlineOrderCreateResponse(order as any));
    } catch (createError: unknown) {
      if (!isCheckoutSubmissionDuplicateKey(createError)) {
        throw createError;
      }
      const committed = await waitForCommittedCheckoutOrder(() =>
        OnlineOrder.findOne({
          user_id: userId,
          checkout_submission_id: submissionId,
        }).lean()
      );
      if (!committed) {
        return res.status(409).json({
          error: 'Checkout with this submission ID is not yet committed. Retry the same request.',
        });
      }
      if (!checkoutPayloadMatches(committed as any, body)) {
        return res.status(409).json({
          error: 'Checkout submission ID was already used for a different checkout',
        });
      }
      return res.status(200).json(formatOnlineOrderCreateResponse(committed as any));
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create online order error:', error);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

// Public: get order by number — requires email used at checkout (prevents IDOR by order number)
router.get('/track/:orderNumber', onlineTrackLimiter, async (req, res) => {
  try {
    const emailRaw = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
    if (!emailRaw) {
      return res.status(400).json({ error: 'Email is required to view this order' });
    }

    const order = await OnlineOrder.findOne({ order_number: req.params.orderNumber }).lean();
    if (!order) {
      logSecurityEvent('order_track_fail', req, { reason: 'not_found' });
      return res.status(404).json({ error: 'Order not found' });
    }
    const o = order as any;
    const stored = (o.customer_email || '').trim().toLowerCase();
    if (stored !== emailRaw) {
      logSecurityEvent('order_track_fail', req, { reason: 'email_mismatch' });
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({
      id: o._id.toString(),
      order_number: o.order_number,
      customer_name: o.customer_name,
      status: o.status,
      quotation_number: o.quotation_number,
      items: o.items,
      subtotal: o.subtotal,
      tax_amount: o.tax_amount,
      total_amount: o.total_amount,
      payment_method: o.payment_method,
      payment_status: o.payment_status,
      status_history: o.status_history,
      created_at: o.created_at,
    });
  } catch (error) {
    console.error('Track order error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Authenticated storefront user: list only their own OnlineOrders (newest first).
// Identity comes from JWT (req.userId) — never from query/body user_id.
router.get('/my-orders', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const userId = typeof req.userId === 'string' ? req.userId.trim() : '';
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const orders = await OnlineOrder.find({ user_id: userId })
      .sort({ created_at: -1 })
      .lean();

    res.json(
      orders.map((o: any) => ({
        id: o._id.toString(),
        order_number: o.order_number,
        customer_email: o.customer_email,
        items: (o.items || []).map((item: any) => ({
          product_name: item.product_name,
          quantity: item.quantity,
          price: item.price,
          subtotal: item.subtotal,
        })),
        subtotal: o.subtotal,
        tax_amount: o.tax_amount,
        total_amount: o.total_amount,
        payment_method: o.payment_method,
        payment_status: o.payment_status,
        status: o.status,
        quotation_id: o.quotation_id?.toString(),
        quotation_number: o.quotation_number,
        status_history: (o.status_history || []).map((h: any) => ({
          status: h.status,
          timestamp: h.timestamp,
          note: h.note,
        })),
        created_at: o.created_at,
      }))
    );
  } catch (error) {
    console.error('Get my online orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Admin: list all online orders
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { status } = req.query;
    const filter: any = {};
    if (status && status !== 'all') filter.status = status;
    const orders = await OnlineOrder.find(filter).sort({ created_at: -1 }).lean();
    res.json(orders.map((o: any) => ({
      id: o._id.toString(),
      order_number: o.order_number,
      customer_name: o.customer_name,
      customer_email: o.customer_email,
      customer_phone: o.customer_phone,
      address_line1: o.address_line1,
      address_line2: o.address_line2,
      city: o.city,
      state: o.state,
      zip: o.zip,
      items: o.items,
      subtotal: o.subtotal,
      tax_amount: o.tax_amount,
      total_amount: o.total_amount,
      payment_method: o.payment_method,
      payment_status: o.payment_status,
      status: o.status,
      status_history: o.status_history,
      invoice_id: o.invoice_id?.toString(),
      quotation_id: o.quotation_id?.toString(),
      quotation_number: o.quotation_number,
      customer_id: o.customer_id?.toString(),
      created_at: o.created_at,
    })));
  } catch (error) {
    console.error('List online orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

const linkQuotationSchema = z.object({
  quotation_id: z.string().min(1),
  quotation_number: z.string().trim().max(80).optional(),
});

/** Admin: attach a quotation (same lightbox as RFQ). Does not invoice or take stock. */
router.post('/:id/link-quotation', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const data = linkQuotationSchema.parse(req.body);
    if (!mongoose.Types.ObjectId.isValid(data.quotation_id)) {
      return res.status(400).json({ error: 'Invalid quotation' });
    }
    const quote = await Invoice.findById(data.quotation_id).select('invoice_type invoice_number').lean();
    if (!quote || (quote as { invoice_type?: string }).invoice_type !== 'quotation') {
      return res.status(400).json({ error: 'That document is not a quotation' });
    }
    const quotationNumber =
      data.quotation_number?.trim() || (quote as { invoice_number?: string }).invoice_number || '';
    const updated = await OnlineOrder.findOneAndUpdate(
      { _id: req.params.id, status: { $nin: ['cancelled', 'delivered'] } },
      {
        $set: {
          quotation_id: data.quotation_id,
          quotation_number: quotationNumber,
          status: 'quoted',
        },
        $push: { status_history: { status: 'quoted', timestamp: new Date() } },
      },
      { new: true }
    );
    if (!updated) {
      const existing = await OnlineOrder.findById(req.params.id).select('status').lean();
      if (!existing) return res.status(404).json({ error: 'Order not found' });
      return res.status(400).json({ error: 'This order can no longer be linked to a quotation' });
    }
    res.json({
      ok: true,
      quotation_id: data.quotation_id,
      quotation_number: quotationNumber,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    console.error('Link online-order quotation:', error);
    res.status(500).json({ error: 'Failed to link quotation' });
  }
});

// Admin: cancel (or legacy status). Packed/dispatched/delivered are not used for new website orders.
router.put('/:id/status', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['confirmed', 'quoted', 'packed', 'dispatched', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const order = await OnlineOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const fromStatus = String(order.status || '');

    if (fromStatus === 'delivered') {
      return res.status(400).json({ error: 'Delivered orders cannot be modified' });
    }
    if (fromStatus === 'cancelled') {
      return res.status(400).json({ error: 'Cancelled orders cannot be modified' });
    }

    if (status === 'delivered' || status === 'packed' || status === 'dispatched' || status === 'quoted') {
      return res.status(400).json({
        error: status === 'quoted' ? 'Link a quotation instead of setting quoted directly' : QUOTATION_REVIEW_ERROR,
      });
    }

    if (!isAllowedOnlineOrderTransition(fromStatus, status)) {
      return res.status(400).json({
        error: `Invalid status transition from ${fromStatus} to ${status}`,
      });
    }

    const updated = await OnlineOrder.findOneAndUpdate(
      { _id: order._id, status: fromStatus },
      {
        $set: { status },
        $push: { status_history: { status, timestamp: new Date() } },
      },
      { new: true }
    );
    if (!updated) {
      return res.status(400).json({
        error: `Order status changed; cannot transition from ${fromStatus} to ${status}`,
      });
    }

    res.json({ message: `Order marked as ${status}`, status: updated.status });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

router.get('/summary', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const [confirmed, quoted, packed, dispatched, delivered, cancelled, total] = await Promise.all([
      OnlineOrder.countDocuments({ status: 'confirmed' }),
      OnlineOrder.countDocuments({ status: 'quoted' }),
      OnlineOrder.countDocuments({ status: 'packed' }),
      OnlineOrder.countDocuments({ status: 'dispatched' }),
      OnlineOrder.countDocuments({ status: 'delivered' }),
      OnlineOrder.countDocuments({ status: 'cancelled' }),
      OnlineOrder.countDocuments(),
    ]);
    res.json({ confirmed, quoted, packed, dispatched, delivered, cancelled, total });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

export default router;
