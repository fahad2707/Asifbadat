import './load-env';
import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';

import connectDB from './db/connection';
import Product from './models/Product';
import Category from './models/Category';
import { apiGeneralLimiter } from './middleware/rateLimit';
import { logSecurityEvent } from './utils/securityLog';
import Admin from './models/Admin';
import bcrypt from 'bcryptjs';

// Routes
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import categoryRoutes from './routes/categories';
import subCategoryRoutes from './routes/sub-categories';
import taxTypesRoutes from './routes/tax-types';
import paymentMethodsRoutes from './routes/payment-methods';
import bankAccountsRoutes from './routes/bank-accounts';
import orderRoutes from './routes/orders';
import adminRoutes from './routes/admin';
import posRoutes from './routes/pos';
import invoiceRoutes from './routes/invoices';
import analyticsRoutes from './routes/analytics';
import userRoutes from './routes/user';
import uploadRoutes from './routes/upload';
import customersRoutes from './routes/customers';
import vendorsRoutes from './routes/vendors';
import purchaseOrdersRoutes from './routes/purchase-orders';
import storeSettingsRoutes from './routes/store-settings';
import inventoryRoutes from './routes/inventory';
import returnsRoutes from './routes/returns';
import receiptsRoutes from './routes/receipts';
import creditMemoRoutes from './modules/credit-memo/routes/creditMemo';
import shipmentRoutes from './modules/shipping/routes/shipments';
import expenseRoutes from './modules/expenses/routes/expenses';
import reportRoutes from './modules/reports/routes/reports';
import onlineOrderRoutes from './routes/online-orders';
import rfqRoutes from './routes/rfq';

// Keep the process alive on unhandled promise rejections (e.g. async route errors)
// so the server does not crash and you can see the logged error.
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

const PORT = process.env.PORT || 5001;
const isProd = process.env.NODE_ENV === 'production';

// Default admin bootstrap only outside production (or when explicitly allowed).
// Used by start() only — createApp() does not write to MongoDB.
async function ensureDefaultAdmin() {
  if (String(process.env.ALLOW_DEFAULT_ADMIN || '').toLowerCase() === 'false') {
    return;
  }
  if (isProd && process.env.ALLOW_DEFAULT_ADMIN !== 'true') {
    return;
  }
  try {
    const existing = await Admin.findOne({ email: 'admin@edinc.com' });
    if (existing) return;
    const hashed = await bcrypt.hash('Admin1234', 12);
    await Admin.create({
      email: 'admin@edinc.com',
      password_hash: hashed,
      name: 'Admin',
      role: 'admin',
    });
    console.log('✅ Default admin created (admin@edinc.com / Admin1234) — change password after first login');
  } catch (e) {
    console.error('Could not ensure default admin:', e);
  }
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

// Security middleware – disable cross-origin headers that block API calls from frontend on different origin (e.g. Render)
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
// CORS: allow frontend (same host, localhost, or Render)
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
].filter(Boolean) as string[];
const isAllowedOrigin = (origin: string) =>
  allowedOrigins.includes(origin) ||
  origin.includes('.onrender.com') ||
  origin.includes('.vercel.app') ||
  origin.includes('.netlify.app');
app.use(cors({
  origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return cb(null, true);
    if (isAllowedOrigin(origin)) return cb(null, true);
    if (isProd) {
      console.log(
        '[security]',
        JSON.stringify({ ts: new Date().toISOString(), event: 'cors_reject', origin })
      );
      return cb(null, false);
    }
    return cb(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));


// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', apiGeneralLimiter);

// Health check (add ?detail=1 for DB name + catalog counts — use to verify Railway → correct Atlas database)
app.get('/health', async (req, res) => {
  const st = mongoose.connection.readyState;
  const mongo: {
    connected: boolean;
    name?: string;
    readyState: number;
    productCount?: number;
    categoryCount?: number;
  } = {
    connected: st === 1,
    name: st === 1 ? mongoose.connection.name : undefined,
    readyState: st,
  };
  if (req.query.detail === '1' && st === 1) {
    try {
      const [productCount, categoryCount] = await Promise.all([
        Product.countDocuments(),
        Category.countDocuments(),
      ]);
      mongo.productCount = productCount;
      mongo.categoryCount = categoryCount;
    } catch {
      mongo.productCount = undefined;
      mongo.categoryCount = undefined;
    }
  }
  res.json({ status: 'ok', timestamp: new Date().toISOString(), mongo });
});

// Serve uploaded files (customer documents, etc.)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/sub-categories', subCategoryRoutes);
app.use('/api/tax-types', taxTypesRoutes);
app.use('/api/payment-methods', paymentMethodsRoutes);
app.use('/api/bank-accounts', bankAccountsRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/user', userRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/vendors', vendorsRoutes);
app.use('/api/purchase-orders', purchaseOrdersRoutes);
app.use('/api/store-settings', storeSettingsRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/receipts', receiptsRoutes);
app.use('/api/credit-memos', creditMemoRoutes);
app.use('/api/online-orders', onlineOrderRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/rfq', rfqRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/reports', reportRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  const status = err.status || 500;
  if (status >= 500) {
    logSecurityEvent('api_error', req, { status, code: err.code });
  }
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  return app;
}

export const app = createApp();

let server: ReturnType<typeof app.listen> | null = null;

async function start() {
  await connectDB();
  await ensureDefaultAdmin();
  server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    const dbn = mongoose.connection.name;
    const override = process.env.MONGODB_DB_NAME?.trim();
    console.log(
      `[catalog] MongoDB database="${dbn}"` +
        (override ? ` (MONGODB_DB_NAME=${override})` : ' (from MONGODB_URI path)')
    );
  });
}

function isDirectServerStart(): boolean {
  const entry = process.argv[1] || '';
  return /(?:^|[\\/])server\.(ts|js)$/.test(entry);
}

if (isDirectServerStart()) {
  start();
}

function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down gracefully...`);
  if (server) server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}
if (isDirectServerStart()) {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
