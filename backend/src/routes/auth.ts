import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import crypto from 'crypto';
import User from '../models/User';
import Customer from '../models/Customer';
import Admin from '../models/Admin';
import WebsiteSignupApplication, {
  WEBSITE_SIGNUP_STATUS_PENDING,
} from '../models/WebsiteSignupApplication';
import bcrypt from 'bcryptjs';
import {
  linkOrCreateCustomerForNewUser,
  type CustomerLinkResult,
} from '../utils/customerAccount';
import { isSmtpConfigured, sendPasswordResetEmail } from '../utils/mail';
import { logSecurityEvent } from '../utils/securityLog';
import {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
} from '../middleware/rateLimit';
import mongoose from 'mongoose';

const router = express.Router();

const BCRYPT_ROUNDS = 12;

function emptyLinkResult(): CustomerLinkResult {
  return {
    action: 'unlinked',
    customerId: null,
    matchedCustomerIds: [],
    matchKind: 'none',
  };
}

async function createWebsiteSignupApplication(opts: {
  userId: mongoose.Types.ObjectId;
  name?: string;
  email?: string;
  phone?: string;
  link: CustomerLinkResult;
}) {
  const matchedIds = opts.link.matchedCustomerIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  return WebsiteSignupApplication.create({
    user_id: opts.userId,
    submitted_name: opts.name,
    submitted_email: opts.email,
    submitted_phone: opts.phone,
    status: WEBSITE_SIGNUP_STATUS_PENDING,
    link_outcome: opts.link.action,
    customer_id:
      opts.link.customerId && mongoose.Types.ObjectId.isValid(opts.link.customerId)
        ? new mongoose.Types.ObjectId(opts.link.customerId)
        : undefined,
    matched_customer_ids: matchedIds,
    match_kind: opts.link.matchKind,
  });
}

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const phoneSchema = z
  .string()
  .trim()
  .min(4)
  .max(32)
  .regex(/^[\d+\s().-]+$/);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findUserByEmail(email: string) {
  return User.findOne({ email: { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') } });
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Admin login
router.post('/admin/login', loginLimiter, async (req, res) => {
  try {
    if (!process.env.JWT_SECRET?.trim()) {
      console.error('JWT_SECRET is not set in .env');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const schema = z.object({
      email: emailSchema,
      password: z.string().min(1).max(128),
    });

    const { email, password } = schema.parse(req.body);

    const admin = await Admin.findOne({ $expr: { $eq: [{ $toLower: '$email' }, email] } });

    if (!admin) {
      logSecurityEvent('auth_login_fail', req, { kind: 'admin' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, admin.password_hash);

    if (!isValid) {
      logSecurityEvent('auth_login_fail', req, { kind: 'admin' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const secret = process.env.JWT_SECRET!;
    const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
    const token = (jwt as any).sign(
      { adminId: admin._id.toString(), role: admin.role },
      secret,
      { expiresIn }
    );

    logSecurityEvent('auth_login_ok', req, { kind: 'admin' });

    res.json({
      token,
      admin: {
        id: admin._id.toString(),
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Admin login error:', error);
    logSecurityEvent('api_error', req, { where: 'admin_login' });
    res.status(500).json({ error: 'Login failed' });
  }
});

// User registration
router.post('/register', registerLimiter, async (req, res) => {
  try {
    if (!process.env.JWT_SECRET?.trim()) {
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const schema = z
      .object({
        name: z.string().trim().max(200).optional(),
        email: emailSchema.optional(),
        phone: phoneSchema.optional(),
        password: z.string().min(1).max(128),
      })
      .refine((data) => data.email || data.phone, {
        message: 'Either email or phone is required',
        path: ['email'],
      });

    const { name, email, phone, password } = schema.parse(req.body);

    if (email) {
      const existingByEmail = await findUserByEmail(email);
      if (existingByEmail) {
        return res.status(400).json({ error: 'A user with this email already exists' });
      }
    }
    if (phone) {
      const existingByPhone = await User.findOne({ phone });
      if (existingByPhone) {
        return res.status(400).json({ error: 'A user with this phone already exists' });
      }
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Atlas unique indexes on phone are often NOT sparse. Leaving phone unset
    // stores null and the second email-only signup then 500s on duplicate key.
    const uniquePhone =
      phone ||
      (email ? `acct:${hashToken(email).slice(0, 20)}` : `acct:${randomToken().slice(0, 20)}`);

    const user = await User.create({
      name,
      ...(email ? { email } : {}),
      phone: uniquePhone,
      password_hash,
      email_verified: true,
    });

    let link: CustomerLinkResult = emptyLinkResult();
    try {
      link = await linkOrCreateCustomerForNewUser({
        userId: user._id,
        name,
        email,
        phone,
      });
    } catch (linkErr) {
      // Account is already created — CRM link is best-effort so signup is not blocked.
      console.error('Register customer link error:', linkErr);
      link = emptyLinkResult();
    }

    try {
      await createWebsiteSignupApplication({
        userId: user._id,
        name,
        email,
        phone,
        link,
      });
    } catch (appErr) {
      // Review-queue insert must not undo a completed User. Duplicate user_id means
      // the application already exists from a parallel request.
      console.error('Register website signup application error:', appErr);
    }

    const secret = process.env.JWT_SECRET!.trim();
    const expiresIn = String(process.env.JWT_EXPIRES_IN || '8h').trim() || '8h';
    let token: string;
    try {
      token = (jwt as any).sign(
        { userId: user._id.toString(), email: user.email, phone: user.phone },
        secret,
        { expiresIn }
      );
    } catch (signErr) {
      console.error('Register JWT sign failed, retrying with 8h expiry:', signErr);
      token = (jwt as any).sign(
        { userId: user._id.toString(), email: user.email, phone: user.phone },
        secret,
        { expiresIn: '8h' }
      );
    }

    logSecurityEvent('auth_register', req, { verified: true });

    res.status(201).json({
      token,
      user: {
        id: user._id.toString(),
        phone: user.phone,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (isDuplicateKey(error)) {
      return res.status(400).json({ error: 'A user with this email or phone already exists' });
    }
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ error: error.message || 'Invalid registration data' });
    }
    console.error('User register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Verify email (link from message)
router.get('/verify-email', async (req, res) => {
  try {
    const token =
      typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!token || token.length < 32) {
      return res.status(400).json({ error: 'Invalid or missing token' });
    }
    const h = hashToken(token);
    const user = await User.findOne({
      email_verification_token_hash: h,
      email_verification_expires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification link' });
    }
    user.email_verified = true;
    user.email_verification_token_hash = undefined;
    user.email_verification_expires = undefined;
    await user.save();
    res.json({ message: 'Email verified. You can sign in.' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/verify-email', async (req, res) => {
  try {
    const schema = z.object({ token: z.string().trim().min(32) });
    const { token } = schema.parse(req.body);
    const h = hashToken(token);
    const user = await User.findOne({
      email_verification_token_hash: h,
      email_verification_expires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification link' });
    }
    user.email_verified = true;
    user.email_verification_token_hash = undefined;
    user.email_verification_expires = undefined;
    await user.save();
    res.json({ message: 'Email verified. You can sign in.' });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Forgot password
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const generic = { message: 'If an account exists for that email, a reset link was sent.' };
  try {
    const schema = z.object({ email: emailSchema });
    const { email } = schema.parse(req.body);

    if (!isSmtpConfigured()) {
      return res.status(503).json({ error: 'Password reset is not configured (SMTP).' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.password_hash) {
      // Same response to avoid email enumeration
      return res.json(generic);
    }

    const plain = randomToken();
    user.password_reset_token_hash = hashToken(plain);
    user.password_reset_expires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();
    await sendPasswordResetEmail(email, plain);
    res.json(generic);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Request failed' });
  }
});

// Reset password
router.post('/reset-password', loginLimiter, async (req, res) => {
  try {
    const schema = z.object({
      token: z.string().trim().min(32),
      password: z.string().min(8).max(128),
    });
    const { token, password } = schema.parse(req.body);
    const h = hashToken(token);
    const user = await User.findOne({
      password_reset_token_hash: h,
      password_reset_expires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    user.password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    user.password_reset_token_hash = undefined;
    user.password_reset_expires = undefined;
    await user.save();
    res.json({ message: 'Password updated. You can sign in.' });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Reset failed' });
  }
});

// User login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    if (!process.env.JWT_SECRET?.trim()) {
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const schema = z
      .object({
        email: emailSchema.optional(),
        phone: phoneSchema.optional(),
        password: z.string().min(1).max(128),
      })
      .refine((data) => data.email || data.phone, {
        message: 'Either email or phone is required',
        path: ['email'],
      });

    const { email, phone, password } = schema.parse(req.body);

    const query: Record<string, string> = {};
    if (email) query.email = email;
    if (phone) query.phone = phone;

    const user = email ? await findUserByEmail(email) : await User.findOne(query);
    if (!user || !user.password_hash) {
      logSecurityEvent('auth_login_fail', req, { kind: 'user' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.email && user.email_verified === false) {
      return res.status(403).json({ error: 'Please verify your email before signing in.' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      logSecurityEvent('auth_login_fail', req, { kind: 'user' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const secret = process.env.JWT_SECRET!;
    const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
    const token = (jwt as any).sign(
      { userId: user._id.toString(), email: user.email, phone: user.phone },
      secret,
      { expiresIn }
    );

    logSecurityEvent('auth_login_ok', req, { kind: 'user' });

    res.json({
      token,
      user: {
        id: user._id.toString(),
        phone: user.phone,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('User login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

export default router;
