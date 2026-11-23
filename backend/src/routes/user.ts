import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User';
import Customer from '../models/Customer';
import OnlineOrder from '../models/OnlineOrder';
import RFQ from '../models/RFQ';
import { authenticateUser, AuthRequest } from '../middleware/auth';
import {
  getLinkedCustomerAccountStatus,
  isApprovedAccountStatus,
} from '../utils/customerAccount';
import { z } from 'zod';

const BCRYPT_ROUNDS = 12;

function displayPhone(value: unknown): string {
  const phone = typeof value === 'string' ? value.trim() : '';
  if (!phone || phone.startsWith('acct:')) return '';
  return phone;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const router = express.Router();

// Get user profile
router.get('/profile', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.userId).lean();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Status from Customer linked by user_id only (not email/phone CRM match).
    // account_approved remains the boolean commercial gate; account_status is for UI routing.
    const account_status = await getLinkedCustomerAccountStatus(req.userId);
    const account_approved = isApprovedAccountStatus(account_status);
    const customer = await Customer.findOne({ user_id: user._id })
      .select('name company phone email address city state zip shipping_address billing_address')
      .lean();
    const contactPhone = displayPhone(customer?.phone) || displayPhone(user.phone);

    res.json({
      id: user._id.toString(),
      phone: user.phone,
      name: user.name || customer?.name || '',
      email: user.email || customer?.email || '',
      loyalty_points: user.loyalty_points || 0,
      total_spent: user.total_spent || 0,
      created_at: user.created_at,
      account_approved,
      account_status,
      contact: {
        name: customer?.name || user.name || '',
        company: customer?.company || '',
        phone: contactPhone,
        email: customer?.email || user.email || '',
        address: customer?.address || '',
        city: customer?.city || '',
        state: customer?.state || '',
        zip: customer?.zip || '',
        shipping_address: customer?.shipping_address || customer?.address || '',
        billing_address: customer?.billing_address || '',
      },
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
      return res.status(400).json({ error: error.message });
    }
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.put('/password', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      current_password: z.string().min(1).max(128),
      new_password: z.string().min(8).max(128),
    });
    const { current_password, new_password } = schema.parse(req.body);
    const user = await User.findById(req.userId);
    if (!user || !user.password_hash) {
      return res.status(404).json({ error: 'User not found' });
    }
    const matches = await bcrypt.compare(current_password, user.password_hash);
    if (!matches) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    user.password_hash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
    user.password_reset_token_hash = undefined;
    user.password_reset_expires = undefined;
    await user.save();
    res.json({ message: 'Password updated' });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

router.get('/rfqs', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.userId).select('email phone').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const customer = await Customer.findOne({ user_id: user._id }).select('email phone').lean();
    const clauses: Record<string, unknown>[] = [];
    if (customer?._id) clauses.push({ customer_id: customer._id });
    const emails = [customer?.email, user.email]
      .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
      .filter((value) => value.includes('@'));
    for (const email of [...new Set(emails)]) {
      clauses.push({ customer_email: { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') } });
    }
    const phones = [customer?.phone, user.phone]
      .map((value) => displayPhone(value))
      .filter(Boolean);
    for (const phone of [...new Set(phones)]) {
      clauses.push({ customer_phone: phone });
    }
    if (!clauses.length) {
      return res.json({ rfqs: [] });
    }
    const rows = await RFQ.find({ $or: clauses }).sort({ created_at: -1 }).limit(100).lean();
    res.json({
      rfqs: rows.map((row) => ({
        id: String(row._id),
        rfq_number: row.rfq_number,
        status: row.status,
        created_at: row.created_at,
        customer_comments: row.customer_comments || '',
        items: (row.items || []).map((item) => ({
          product_name: item.product_name,
          quantity: item.quantity,
        })),
      })),
    });
  } catch (error) {
    console.error('List customer RFQs error:', error);
    res.status(500).json({ error: 'Failed to load quote requests' });
  }
});

// Get user dashboard stats
router.get('/dashboard', authenticateUser, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.userId).lean();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // OnlineOrder stats for the authenticated storefront user (JWT userId only)
    const totalOrders = await OnlineOrder.countDocuments({ user_id: req.userId });
    const recentOrders = await OnlineOrder.find({ user_id: req.userId })
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
      return res.status(400).json({ error: error.message });
    }
    console.error('Redeem points error:', error);
    res.status(500).json({ error: 'Failed to redeem points' });
  }
});

export default router;

