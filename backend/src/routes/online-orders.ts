import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import OnlineOrder from '../models/OnlineOrder';
import Product from '../models/Product';
import Invoice from '../models/Invoice';
import { authenticateAdmin, authenticateUser, AuthRequest } from '../middleware/auth';
import { onlineCheckoutLimiter, onlineTrackLimiter } from '../middleware/rateLimit';
import { logSecurityEvent } from '../utils/securityLog';
import { httpErrorFromPayment, paymentApplication } from '../services/paymentApplication';
import { isUserLinkedToApprovedCustomer } from '../utils/customerAccount';
import Customer from '../models/Customer';
import { createStockMovement, StockMovementWriteError } from '../utils/createStockMovement';
import { StockMovementType } from '../shared/enums';
import {
  checkoutPayloadMatches,
  formatOnlineOrderCreateResponse,
  isCheckoutSubmissionDuplicateKey,
  waitForCommittedCheckoutOrder,
} from '../utils/onlineOrderIdempotency';

const router = express.Router();

/** Operational reference for OnlineOrder delivery SALE movements (mirrors wholesale Invoice). */
const ONLINE_ORDER_REFERENCE_TYPE = 'OnlineOrder';

type DeliveryLine = { product_id?: unknown; quantity?: unknown };

function aggregateDeliveryInventoryQuantities(items: DeliveryLine[] | undefined): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items || []) {
    if (!item.product_id) continue;
    const pid = String(item.product_id);
    if (!mongoose.Types.ObjectId.isValid(pid)) continue;
    const raw = item.quantity;
    if (raw == null || raw === '') continue;
    const qty = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty === 0) continue;
    totals.set(pid, (totals.get(pid) || 0) + qty);
  }
  return totals;
}

function isSkippedProductType(productType: unknown): boolean {
  return productType === 'service' || productType === 'non_inventory';
}

async function withDeliveryInventoryTransaction<T>(
  work: (session: mongoose.ClientSession) => Promise<T>
): Promise<T> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

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
  const last = await OnlineOrder.findOne().sort({ created_at: -1 }).lean();
  if (!last) return 'WEB-0001';
  const match = (last as any).order_number?.match(/WEB-(\d+)/);
  const next = match ? parseInt(match[1]) + 1 : 1;
  return `WEB-${String(next).padStart(4, '0')}`;
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
        payment_status: body.payment_method === 'card' ? 'paid' : 'pending',
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
      created_at: o.created_at,
    })));
  } catch (error) {
    console.error('List online orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Admin: update order status
router.put('/:id/status', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['confirmed', 'packed', 'dispatched', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const order = await OnlineOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.status === 'delivered') {
      return res.status(400).json({ error: 'Delivered orders cannot be modified' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Cancelled orders cannot be modified' });
    }

    // Delivered: invoice + payment stay outside Mongo txn (paymentApplication has no session).
    // Stock decrement + SALE movement + delivered claim commit together or roll back together.
    if (status === 'delivered') {
      const invoiceNumber = `INV-WEB-${order.order_number.replace('WEB-', '')}`;
      const LOCATION_OF_SALE = '511 W Germantown Pike, Plymouth Meeting, PA 19462-1303';
      let inv;
      try {
        inv = await Invoice.create({
          invoice_number: invoiceNumber,
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          customer_email: order.customer_email,
          customer_address: [order.address_line1, order.address_line2, order.city, order.state, order.zip].filter(Boolean).join(', '),
          location_of_sale: LOCATION_OF_SALE,
          invoice_type: 'invoice',
          invoice_date: new Date(),
          due_date: new Date(),
          subtotal_amount: order.subtotal,
          tax_amount: order.tax_amount,
          total_amount: order.total_amount,
          amount_paid: 0,
          terms: 'Paid',
          payment_status: 'unpaid',
          source: 'ONLINE',
          items: order.items.map((i: any) => ({
            product_id: i.product_id,
            product_name: i.product_name,
            quantity: i.quantity,
            price: i.price,
            subtotal: i.subtotal,
          })),
        });
      } catch (invErr) {
        console.error('Auto invoice error:', invErr);
        return res.status(500).json({ error: 'Failed to create invoice for delivered order' });
      }

      let receiptId = '';
      try {
        const applied = await paymentApplication.applyPaymentToInvoice({
          invoiceId: (inv as any)._id.toString(),
          amount: order.total_amount,
          paymentMethod: order.payment_method === 'cod' ? 'COD' : 'Credit Card',
          customerName: order.customer_name,
        });
        receiptId = String(applied?.receipt?.id || '').trim();
      } catch (payErr) {
        await Invoice.findByIdAndDelete((inv as any)._id).catch((delErr) => {
          console.error('Rollback newly created delivery invoice failed:', delErr);
        });
        const mapped = httpErrorFromPayment(payErr);
        if (mapped) return res.status(mapped.status).json(mapped.body);
        console.error('Delivery payment application error:', payErr);
        return res.status(500).json({ error: 'Failed to apply payment for delivered order' });
      }

      const invoiceId = (inv as any)._id as mongoose.Types.ObjectId;
      const setFields: Record<string, unknown> = {
        status: 'delivered',
        invoice_id: invoiceId,
      };
      if (order.payment_method === 'cod') {
        setFields.payment_status = 'paid';
      }

      try {
        await withDeliveryInventoryTransaction(async (session) => {
          const claimed = await OnlineOrder.findOneAndUpdate(
            {
              _id: order._id,
              status: { $nin: ['delivered', 'cancelled'] },
            },
            {
              $set: setFields,
              $push: { status_history: { status: 'delivered', timestamp: new Date() } },
            },
            { session, new: true }
          );
          if (!claimed) {
            throw Object.assign(new Error('Delivered orders cannot be modified'), { status: 400 });
          }

          const qtyByProduct = aggregateDeliveryInventoryQuantities(order.items as DeliveryLine[]);
          const adminId =
            typeof req.userId === 'string' && mongoose.Types.ObjectId.isValid(req.userId)
              ? req.userId
              : undefined;

          for (const [productId, qty] of qtyByProduct) {
            if (qty <= 0) continue;
            const product = await Product.findById(productId).session(session);
            if (!product) continue;
            if (isSkippedProductType((product as any).product_type)) continue;

            const delta = -qty;
            const updated = await Product.findOneAndUpdate(
              { _id: productId },
              { $inc: { stock_quantity: delta } },
              { session, new: true }
            );
            if (!updated) {
              throw new Error('Product not found during delivery inventory update');
            }
            const after = Number((updated as any).stock_quantity);
            const before = after - delta;
            await createStockMovement({
              session,
              productId,
              movementType: StockMovementType.SALE,
              quantityBefore: before,
              quantityChange: delta,
              quantityAfter: after,
              referenceType: ONLINE_ORDER_REFERENCE_TYPE,
              referenceId: order._id as mongoose.Types.ObjectId,
              referenceNumber: order.order_number,
              reason: `Online Order ${order.order_number} delivered`,
              adminId,
            });
          }
        });
      } catch (deliveryErr: any) {
        // Inventory txn already aborted. Compensate accounting outside the session.
        if (!receiptId) {
          console.error('Delivery inventory failed but payment receipt id is missing', {
            orderId: order._id?.toString?.(),
            invoiceId: invoiceId.toString(),
            deliveryError: deliveryErr?.message || deliveryErr,
          });
          return res.status(500).json({
            error: 'Delivery failed after payment; receipt id missing — manual accounting cleanup required',
          });
        }

        try {
          await paymentApplication.deleteReceiptLifecycle(receiptId);
        } catch (compErr) {
          console.error('Delivery accounting compensation failed (receipt still applied)', {
            orderId: order._id?.toString?.(),
            invoiceId: invoiceId.toString(),
            receiptId,
            deliveryError: deliveryErr?.message || deliveryErr,
            compensationError: (compErr as Error)?.message || compErr,
          });
          const mapped = httpErrorFromPayment(compErr);
          if (mapped) {
            return res.status(500).json({
              error: 'Delivery failed after payment; receipt compensation failed — manual cleanup required',
              detail: mapped.body?.error || mapped.body,
            });
          }
          return res.status(500).json({
            error: 'Delivery failed after payment; receipt compensation failed — manual cleanup required',
          });
        }

        try {
          await Invoice.findByIdAndDelete(invoiceId);
        } catch (delErr) {
          console.error('Delivery accounting compensation: unpaid invoice delete failed', {
            orderId: order._id?.toString?.(),
            invoiceId: invoiceId.toString(),
            receiptId,
            deliveryError: deliveryErr?.message || deliveryErr,
            invoiceDeleteError: (delErr as Error)?.message || delErr,
          });
          return res.status(500).json({
            error: 'Delivery failed after payment; receipt reversed but unpaid invoice delete failed — manual cleanup required',
          });
        }

        if (deliveryErr instanceof StockMovementWriteError) {
          return res.status(deliveryErr.status).json({ error: deliveryErr.message });
        }
        if (deliveryErr?.status === 400) {
          return res.status(400).json({ error: deliveryErr.message || 'Delivered orders cannot be modified' });
        }
        console.error('Delivery inventory transaction error:', deliveryErr);
        return res.status(500).json({ error: 'Failed to update status' });
      }

      return res.json({ message: 'Order marked as delivered', status: 'delivered' });
    }

    order.status = status;
    order.status_history.push({ status, timestamp: new Date() } as any);

    await order.save();
    res.json({ message: `Order marked as ${status}`, status: order.status });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Admin: get order summary counts
router.get('/summary', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const [confirmed, packed, dispatched, delivered, cancelled, total] = await Promise.all([
      OnlineOrder.countDocuments({ status: 'confirmed' }),
      OnlineOrder.countDocuments({ status: 'packed' }),
      OnlineOrder.countDocuments({ status: 'dispatched' }),
      OnlineOrder.countDocuments({ status: 'delivered' }),
      OnlineOrder.countDocuments({ status: 'cancelled' }),
      OnlineOrder.countDocuments(),
    ]);
    res.json({ confirmed, packed, dispatched, delivered, cancelled, total });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

export default router;
