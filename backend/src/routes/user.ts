import express from 'express';
import User from '../models/User';
import Order from '../models/Order';
import OrderItem from '../models/OrderItem';
import OrderStatusHistory from '../models/OrderStatusHistory';
import { authenticateUser, AuthRequest } from '../middleware/auth';
import { isUserLinkedToApprovedCustomer } from '../utils/customerAccount';
import { z } from 'zod';

const router = express.Router();

// Get user profile
router.get('/profile', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.userId).lean();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const account_approved = await isUserLinkedToApprovedCustomer(req.userId);

    res.json({
      id: user._id.toString(),
      phone: user.phone,
      name: user.name || '',
      email: user.email || '',
      loyalty_points: user.loyalty_points || 0,
      total_spent: user.total_spent || 0,
      created_at: user.created_at,
      account_approved,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
router.put('/profile', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().trim().max(200).optional(),
      email: z.string().trim().toLowerCase().email().max(320).optional(),
    });

    const data = schema.parse(req.body);

    const user = await User.findByIdAndUpdate(
      req.userId,
      { ...data, updated_at: new Date() },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user._id.toString(),
      phone: user.phone,
      name: user.name || '',
      email: user.email || '',
      loyalty_points: user.loyalty_points || 0,
      total_spent: user.total_spent || 0,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get user dashboard stats
router.get('/dashboard', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.userId).lean();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get order stats
    const totalOrders = await Order.countDocuments({ user_id: req.userId });
    const recentOrders = await Order.find({ user_id: req.userId })
      .sort({ created_at: -1 })
      .limit(5)
      .lean();

    // Calculate points value
    const pointsValue = user.loyalty_points * 0.01; // 1 point = $0.01

    res.json({
      user: {
        id: user._id.toString(),
        name: user.name || '',
        phone: user.phone,
        email: user.email || '',
        loyalty_points: user.loyalty_points || 0,
        points_value: pointsValue || 0,
        total_spent: user.total_spent || 0,
      },
      stats: {
        total_orders: totalOrders || 0,
        recent_orders: (recentOrders || []).map((order: any) => ({
          id: order._id.toString(),
          order_number: order.order_number,
          status: order.status,
          total_amount: order.total_amount || 0,
          created_at: order.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// Redeem loyalty points
router.post('/redeem-points', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      points: z.number().int().positive(),
    });

    const { points } = schema.parse(req.body);

    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.loyalty_points < points) {
      return res.status(400).json({ error: 'Insufficient loyalty points' });
    }

    // Deduct points
    user.loyalty_points -= points;
    await user.save();

    res.json({
      message: 'Points redeemed successfully',
      remaining_points: user.loyalty_points,
      redeemed_points: points,
      discount_amount: points * 0.01, // 1 point = $0.01
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Redeem points error:', error);
    res.status(500).json({ error: 'Failed to redeem points' });
  }
});

export default router;

