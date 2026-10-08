import express from 'express';
import Order from '../models/Order';
import OrderItem from '../models/OrderItem';
import OrderStatusHistory from '../models/OrderStatusHistory';
import { authenticateUser, authenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import Stripe from 'stripe';

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' }) : null;

/**
 * Phase 2N — legacy POST /api/orders create path is retired.
 * Live checkout uses POST /api/online-orders (inventory at delivery).
 * Do not recreate the unsafe stock writer here.
 */
router.post('/', authenticateUser, (_req: AuthRequest, res) => {
  return res.status(410).json({
    error:
      'Legacy order creation is no longer supported. Use POST /api/online-orders for storefront checkout.',
  });
});

// Get user's orders
router.get('/my-orders', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const orders = await Order.find({ user_id: req.userId })
      .sort({ created_at: -1 })
      .lean();

    const ordersWithDetails = await Promise.all(
      orders.map(async (order: any) => {
        const items = await OrderItem.find({ order_id: order._id })
          .populate('product_id', 'name image_url')
          .lean();

        const statusHistory = await OrderStatusHistory.find({ order_id: order._id })
          .sort({ created_at: 1 })
          .lean();

        return {
          id: order._id.toString(),
          order_number: order.order_number,
          status: order.status,
          total_amount: order.total_amount,
          created_at: order.created_at,
          items: items.map((item: any) => ({
            id: item._id.toString(),
            product_id: item.product_id?._id?.toString(),
            product_name: item.product_id?.name || 'Product',
            product_image: item.product_id?.image_url,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.subtotal,
          })),
          status_history: statusHistory.map((hist: any) => ({
            status: hist.status,
            notes: hist.notes,
            created_at: hist.created_at,
          })),
        };
      })
    );

    res.json(ordersWithDetails);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Admin: Get all orders (must be before GET /:id so /admin/all is not matched as id)
router.get('/admin/all', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    let query: any = {};
    if (status) {
      query.status = status;
    }

    const orders = await Order.find(query)
      .populate('user_id', 'phone name email')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const ordersWithItems = await Promise.all(
      orders.map(async (order: any) => {
        const items = await OrderItem.find({ order_id: order._id })
          .populate('product_id', 'name')
          .lean();

        return {
          id: order._id.toString(),
          order_number: order.order_number,
          status: order.status,
          total_amount: order.total_amount,
          created_at: order.created_at,
          user_name: order.user_id?.name,
          user_phone: order.user_id?.phone,
          user_email: order.user_id?.email,
          items: items.map((item: any) => ({
            id: item._id.toString(),
            product_name: item.product_id?.name || 'Product',
            quantity: item.quantity,
            price: item.price,
            subtotal: item.subtotal,
          })),
        };
      })
    );

    res.json(ordersWithItems);
  } catch (error) {
    console.error('Get all orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Admin: Update order status
router.put('/:id/status', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      status: z.enum(['placed', 'packed', 'ready_for_pickup', 'completed', 'cancelled']),
      notes: z.string().optional(),
    });

    const { status, notes } = schema.parse(req.body);

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status, updated_at: new Date() },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Add status history
    await OrderStatusHistory.create({
      order_id: order._id,
      status,
      notes: notes || undefined,
    });

    res.json({
      id: order._id.toString(),
      ...order.toObject(),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// Get order by ID (user's own order)
router.get('/:id', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user_id: req.userId }).lean();

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const items = await OrderItem.find({ order_id: order._id })
      .populate('product_id', 'name image_url')
      .lean();

    const statusHistory = await OrderStatusHistory.find({ order_id: order._id })
      .sort({ created_at: 1 })
      .lean();

    res.json({
      id: order._id.toString(),
      ...order,
      items: items.map((item: any) => ({
        id: item._id.toString(),
        product_id: item.product_id?._id?.toString(),
        product_name: item.product_id?.name || 'Product',
        product_image: item.product_id?.image_url,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.subtotal,
      })),
      status_history: statusHistory.map((hist: any) => ({
        status: hist.status,
        notes: hist.notes,
        created_at: hist.created_at,
      })),
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Create Stripe payment intent
router.post('/create-payment-intent', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe not configured' });
    }

    const schema = z.object({
      amount: z.number().positive(),
    });

    const { amount } = schema.parse(req.body);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      metadata: {
        userId: req.userId!.toString(),
      },
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error: any) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

export default router;
