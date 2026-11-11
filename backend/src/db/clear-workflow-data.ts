/**
 * Wipe operational records so admin/storefront can be retested.
 * Does NOT delete: Products, Categories, SubCategories, Admins, StoreSettings.
 * Does NOT change product image_url, prices, SKU, or stock_quantity.
 * Clears committed_quantity only (open-order reservations become invalid after order wipe).
 */
import mongoose from 'mongoose';
import connectDB from './connection';
import Invoice from '../models/Invoice';
import Receipt from '../models/Receipt';
import Payment from '../models/Payment';
import PurchaseOrder from '../models/PurchaseOrder';
import CreditMemo from '../modules/credit-memo/models/CreditMemo';
import Vendor from '../models/Vendor';
import Customer from '../models/Customer';
import TaxType from '../models/TaxType';
import BankAccount from '../models/BankAccount';
import PaymentMethod from '../models/PaymentMethod';
import LedgerEntry from '../models/LedgerEntry';
import CustomerProductPrice from '../models/CustomerProductPrice';
import StockMovement from '../models/StockMovement';
import Order from '../models/Order';
import OrderItem from '../models/OrderItem';
import OrderStatusHistory from '../models/OrderStatusHistory';
import OnlineOrder from '../models/OnlineOrder';
import WebsiteSignupApplication from '../models/WebsiteSignupApplication';
import User from '../models/User';
import OTP from '../models/OTP';
import POSSale from '../models/POSSale';
import Return from '../models/Return';
import PosReturnSettlement from '../models/PosReturnSettlement';
import PosCustomerCredit from '../models/PosCustomerCredit';
import Expense from '../modules/expenses/models/Expense';
import ExpenseCategory from '../modules/expenses/models/ExpenseCategory';
import Shipment from '../modules/shipping/models/Shipment';
import ShipmentPackage from '../modules/shipping/models/ShipmentPackage';
import RFQ from '../models/RFQ';
import AuditLog from '../models/AuditLog';
import PriceGroup from '../models/PriceGroup';
import Product from '../models/Product';
import Category from '../models/Category';
import SubCategory from '../models/SubCategory';
import Admin from '../models/Admin';
import StoreSettings from '../models/StoreSettings';

const KEEP_COLLECTIONS = new Set([
  'products',
  'categories',
  'subcategories',
  'admins',
  'storesettings',
]);

const WIPE_MODELS: { name: string; model: { deleteMany: (filter?: object) => Promise<{ deletedCount?: number }> } }[] = [
  { name: 'Credit memos', model: CreditMemo },
  { name: 'Invoices / quotations', model: Invoice },
  { name: 'Receipts (bank transactions)', model: Receipt },
  { name: 'Payments', model: Payment },
  { name: 'Ledger entries', model: LedgerEntry },
  { name: 'Purchase orders', model: PurchaseOrder },
  { name: 'Order items', model: OrderItem },
  { name: 'Order status histories', model: OrderStatusHistory },
  { name: 'Orders', model: Order },
  { name: 'Online orders', model: OnlineOrder },
  { name: 'Website signup applications', model: WebsiteSignupApplication },
  { name: 'Storefront users', model: User },
  { name: 'OTPs', model: OTP },
  { name: 'POS sales', model: POSSale },
  { name: 'POS returns', model: Return },
  { name: 'POS return settlements', model: PosReturnSettlement },
  { name: 'POS customer credits', model: PosCustomerCredit },
  { name: 'Customers', model: Customer },
  { name: 'Customer product prices', model: CustomerProductPrice },
  { name: 'Vendors', model: Vendor },
  { name: 'Tax types', model: TaxType },
  { name: 'Bank accounts', model: BankAccount },
  { name: 'Payment methods', model: PaymentMethod },
  { name: 'Stock movements', model: StockMovement },
  { name: 'Shipment packages', model: ShipmentPackage },
  { name: 'Shipments', model: Shipment },
  { name: 'Expenses', model: Expense },
  { name: 'Expense categories', model: ExpenseCategory },
  { name: 'RFQs', model: RFQ },
  { name: 'Price groups', model: PriceGroup },
  { name: 'Audit logs', model: AuditLog },
];

async function wipe(label: string, fn: () => Promise<{ deletedCount?: number }>) {
  const r = await fn();
  const n = r.deletedCount ?? 0;
  console.log(`  ${label}: ${n} deleted`);
  return n;
}

async function count(label: string, fn: () => Promise<number>) {
  const n = await fn();
  console.log(`  ${label}: ${n}`);
  return n;
}

async function clearWorkflowData() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection has no database handle');
  }

  console.log(`\nTarget database: ${mongoose.connection.name}`);
  console.log('Counts BEFORE wipe:');
  const productsBefore = await count('Products', () => Product.countDocuments());
  const categoriesBefore = await count('Categories', () => Category.countDocuments());
  const subcategoriesBefore = await count('SubCategories', () => SubCategory.countDocuments());
  const adminsBefore = await count('Admins', () => Admin.countDocuments());
  await count('Store settings', () => StoreSettings.countDocuments());

  console.log('\nClearing operational data (products and categories kept)...\n');
  for (const { name, model } of WIPE_MODELS) {
    await wipe(name, () => model.deleteMany({}));
  }

  const extra = await db.listCollections().toArray();
  for (const col of extra) {
    const name = col.name;
    if (name.startsWith('system.')) continue;
    if (KEEP_COLLECTIONS.has(name)) continue;
    const remaining = await db.collection(name).countDocuments();
    if (remaining === 0) continue;
    const deleted = await db.collection(name).deleteMany({});
    console.log(`  extra collection ${name}: ${deleted.deletedCount ?? remaining} deleted`);
  }

  const committed = await Product.updateMany(
    { committed_quantity: { $ne: 0 } },
    { $set: { committed_quantity: 0 } }
  );
  console.log(`  Product committed_quantity reset: ${committed.modifiedCount ?? 0} row(s)`);

  console.log('\nCounts AFTER wipe (must match products/categories):');
  const productsAfter = await count('Products', () => Product.countDocuments());
  const categoriesAfter = await count('Categories', () => Category.countDocuments());
  const subcategoriesAfter = await count('SubCategories', () => SubCategory.countDocuments());
  const adminsAfter = await count('Admins', () => Admin.countDocuments());
  await count('Store settings', () => StoreSettings.countDocuments());
  await count('Customers', () => Customer.countDocuments());
  await count('Vendors', () => Vendor.countDocuments());
  await count('Invoices', () => Invoice.countDocuments());
  await count('Website signups', () => WebsiteSignupApplication.countDocuments());
  await count('Online orders', () => OnlineOrder.countDocuments());
  await count('Orders', () => Order.countDocuments());
  await count('POS sales', () => POSSale.countDocuments());
  await count('Purchase orders', () => PurchaseOrder.countDocuments());
  await count('Credit memos', () => CreditMemo.countDocuments());
  await count('Tax types', () => TaxType.countDocuments());
  await count('Receipts', () => Receipt.countDocuments());

  if (
    productsAfter !== productsBefore ||
    categoriesAfter !== categoriesBefore ||
    subcategoriesAfter !== subcategoriesBefore
  ) {
    throw new Error('Safety check failed: product/category counts changed');
  }
  if (adminsAfter !== adminsBefore) {
    throw new Error('Safety check failed: admin accounts changed');
  }

  console.log('\nProducts, categories, subcategories, admins, and store settings were not deleted.');
  console.log('Done.');
  await mongoose.disconnect();
  process.exit(0);
}

clearWorkflowData().catch(async (err) => {
  console.error('Failed to clear workflow data:', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
