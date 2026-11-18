import bcrypt from 'bcryptjs';
import type { Model } from 'mongoose';
import Admin from '../models/Admin';
import AuditLog from '../models/AuditLog';
import BankAccount from '../models/BankAccount';
import Category from '../models/Category';
import Customer from '../models/Customer';
import CustomerProductPrice from '../models/CustomerProductPrice';
import Invoice from '../models/Invoice';
import LedgerEntry from '../models/LedgerEntry';
import OnlineOrder from '../models/OnlineOrder';
import Order from '../models/Order';
import OrderItem from '../models/OrderItem';
import OrderStatusHistory from '../models/OrderStatusHistory';
import OTP from '../models/OTP';
import Payment from '../models/Payment';
import PaymentMethod from '../models/PaymentMethod';
import PosCustomerCredit from '../models/PosCustomerCredit';
import PosReturnSettlement from '../models/PosReturnSettlement';
import POSSale from '../models/POSSale';
import PriceGroup from '../models/PriceGroup';
import Product from '../models/Product';
import PurchaseOrder from '../models/PurchaseOrder';
import Receipt from '../models/Receipt';
import Return from '../models/Return';
import RFQ from '../models/RFQ';
import StockMovement from '../models/StockMovement';
import StoreSettings from '../models/StoreSettings';
import SubCategory from '../models/SubCategory';
import TaxType from '../models/TaxType';
import User from '../models/User';
import Vendor from '../models/Vendor';
import WebsiteSignupApplication from '../models/WebsiteSignupApplication';
import CreditMemo from '../modules/credit-memo/models/CreditMemo';
import Expense from '../modules/expenses/models/Expense';
import ExpenseCategory from '../modules/expenses/models/ExpenseCategory';
import Shipment from '../modules/shipping/models/Shipment';
import ShipmentPackage from '../modules/shipping/models/ShipmentPackage';
import {
  deleteAllOperation,
  deleteAllRawOperation,
  type CleanupConfig,
  type CleanupOperation,
} from './cleanupRunner';
import {
  AUDIT_LOG_COLLECTION,
  CATEGORY_COLLECTION,
  PRODUCT_COLLECTION,
  SUBCATEGORY_COLLECTION,
  assertOperationalCleanupIsSafe,
  catalogueFieldFingerprint,
} from './cleanupSafeguards';

/**
 * What each destructive database script does. This is the ONLY file under
 * src/db that may contain delete or bulk-update calls; every script entry
 * point runs its plan through runGuardedCleanup (see cleanupRunner.ts).
 *
 * No plan here touches Cloudinary. Deleting a record removes the image URL
 * stored on it, never the remote image.
 */

type AnyModel = Model<any>;
type NamedModel = { name: string; model: AnyModel; note?: string };

function deleteAllOperations(models: readonly NamedModel[]): CleanupOperation[] {
  return models.map(({ name, model, note }) => deleteAllOperation(name, model, note));
}

const count = (model: AnyModel) => async () => model.countDocuments();

/* ------------------------------------------------------------------ */
/* db:clear-ops — operational cleanup                                  */
/* ------------------------------------------------------------------ */

/** Collections operational cleanup never deletes, including in its sweep of unlisted collections. */
export const OPERATIONAL_KEEP_COLLECTIONS: ReadonlySet<string> = new Set([
  PRODUCT_COLLECTION,
  CATEGORY_COLLECTION,
  SUBCATEGORY_COLLECTION,
  Admin.collection.name,
  StoreSettings.collection.name,
  AUDIT_LOG_COLLECTION,
]);

export const OPERATIONAL_WIPE_MODELS: readonly NamedModel[] = [
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
  {
    name: 'Customer product prices',
    model: CustomerProductPrice,
    note: 'customer-specific product prices are lost; Product.price is not changed',
  },
  { name: 'Vendors', model: Vendor, note: 'products keep vendor_id values that no longer resolve' },
  { name: 'Tax types', model: TaxType, note: 'products keep tax_type_id values that no longer resolve' },
  { name: 'Bank accounts', model: BankAccount },
  { name: 'Payment methods', model: PaymentMethod },
  {
    name: 'Stock movements',
    model: StockMovement,
    note: 'stock history is lost; Product.stock_quantity is not changed',
  },
  { name: 'Shipment packages', model: ShipmentPackage },
  { name: 'Shipments', model: Shipment },
  { name: 'Expenses', model: Expense },
  { name: 'Expense categories', model: ExpenseCategory },
  { name: 'RFQs', model: RFQ },
  { name: 'Price groups', model: PriceGroup, note: 'price-group membership of products is lost' },
];

async function productFieldFingerprint(): Promise<string> {
  const products = await Product.find({}).select('image_url sku price cost_price stock_quantity').lean();
  return catalogueFieldFingerprint(products as unknown as Record<string, unknown>[]);
}

export const operationalCleanupConfig: CleanupConfig = {
  command: 'npm run db:clear-ops',
  title: 'Operational data cleanup',
  allowsCatalogueDeletion: false,
  allowsAuditLogDeletion: false,
  preflight: () =>
    assertOperationalCleanupIsSafe({
      wipeModels: OPERATIONAL_WIPE_MODELS,
      keepCollections: OPERATIONAL_KEEP_COLLECTIONS,
    }),
  buildOperations: async (context) => {
    const operations = deleteAllOperations(OPERATIONAL_WIPE_MODELS);

    const listed = new Set(operations.map((operation) => operation.collection));
    for (const name of await context.listCollectionNames()) {
      if (name.startsWith('system.')) continue;
      if (OPERATIONAL_KEEP_COLLECTIONS.has(name)) continue;
      if (listed.has(name)) continue;
      const collection = context.rawCollection(name);
      if ((await collection.countDocuments()) === 0) continue;
      operations.push(deleteAllRawOperation(name, collection));
    }

    // Open-order reservations are meaningless once orders are wiped. This is the
    // only write to Product, and it writes committed_quantity and nothing else.
    const reserved = { committed_quantity: { $ne: 0 } };
    operations.push({
      label: 'Products (reservations only)',
      collection: PRODUCT_COLLECTION,
      kind: 'update',
      action: 'set committed_quantity to 0 where it is not 0; no other field is written',
      fields: ['committed_quantity'],
      count: async () => Product.countDocuments(reserved),
      run: async () => (await Product.updateMany(reserved, { $set: { committed_quantity: 0 } })).modifiedCount ?? 0,
    });
    return operations;
  },
  invariants: [
    { label: 'Product count unchanged', read: count(Product), expect: 'unchanged' },
    { label: 'Category count unchanged', read: count(Category), expect: 'unchanged' },
    { label: 'SubCategory count unchanged', read: count(SubCategory), expect: 'unchanged' },
    {
      label: 'Product image_url, sku, price, cost_price and stock_quantity unchanged',
      read: productFieldFingerprint,
      expect: 'unchanged',
    },
    { label: 'Admin count unchanged', read: count(Admin), expect: 'unchanged' },
    // A running server may add audit records during the wipe, so only a decrease is a failure.
    { label: 'Audit log count not decreased', read: count(AuditLog), expect: 'not-decreased' },
  ],
  afterExecute: ['Products, categories, subcategories, admins, store settings and audit logs were not deleted.'],
};

/* ------------------------------------------------------------------ */
/* db:reset — full database reset                                      */
/* ------------------------------------------------------------------ */

export const FULL_RESET_MODELS: readonly NamedModel[] = [
  { name: 'CreditMemos', model: CreditMemo },
  { name: 'Invoices', model: Invoice },
  { name: 'Receipts', model: Receipt },
  { name: 'OrderItems', model: OrderItem },
  { name: 'OrderStatusHistories', model: OrderStatusHistory },
  { name: 'Orders', model: Order },
  { name: 'PurchaseOrders', model: PurchaseOrder },
  { name: 'Expenses', model: Expense },
  { name: 'ExpenseCategories', model: ExpenseCategory },
  { name: 'Shipments', model: Shipment },
  { name: 'StockMovements', model: StockMovement },
  { name: 'Payments', model: Payment },
  { name: 'LedgerEntries', model: LedgerEntry },
  { name: 'Returns', model: Return },
  { name: 'POSSales', model: POSSale },
  { name: 'AuditLogs', model: AuditLog, note: 'audit history is permanently lost' },
  { name: 'Products', model: Product },
  { name: 'SubCategories', model: SubCategory },
  { name: 'Categories', model: Category },
  { name: 'Customers', model: Customer },
  { name: 'Vendors', model: Vendor },
  { name: 'BankAccounts', model: BankAccount },
  { name: 'TaxTypes', model: TaxType },
  { name: 'PaymentMethods', model: PaymentMethod },
  { name: 'StoreSettings', model: StoreSettings },
  { name: 'OTPs', model: OTP },
  { name: 'Users', model: User },
  { name: 'Admins', model: Admin },
];

export const fullResetConfig: CleanupConfig = {
  command: 'npm run db:reset',
  title: 'FULL DATABASE RESET',
  allowsCatalogueDeletion: true,
  allowsAuditLogDeletion: true,
  buildOperations: async () => deleteAllOperations(FULL_RESET_MODELS),
  afterExecute: ['Run "npm run seed" (from the backend folder) to create the default admin again.'],
};

/* ------------------------------------------------------------------ */
/* db:clear-products-categories — product catalogue deletion           */
/* ------------------------------------------------------------------ */

export const productsAndCategoriesCleanupConfig: CleanupConfig = {
  command: 'npm run db:clear-products-categories',
  title: 'PRODUCT CATALOGUE DELETION (products, categories, subcategories, customer product prices)',
  allowsCatalogueDeletion: true,
  allowsAuditLogDeletion: false,
  buildOperations: async () =>
    deleteAllOperations([
      { name: 'CustomerProductPrices', model: CustomerProductPrice },
      { name: 'Products', model: Product },
      { name: 'Categories', model: Category },
      { name: 'SubCategories', model: SubCategory },
    ]),
};

/* ------------------------------------------------------------------ */
/* clear-local-products-only — products on the local dev database      */
/* ------------------------------------------------------------------ */

export const LOCAL_PRODUCTS_ONLY_DATABASE = 'express_distributors_dev';

export const localProductsOnlyCleanupConfig: CleanupConfig = {
  command: 'npx tsx src/db/clear-local-products-only.ts',
  title: 'PRODUCT DELETION on the local development database',
  allowsCatalogueDeletion: true,
  allowsAuditLogDeletion: false,
  requiredDatabaseName: LOCAL_PRODUCTS_ONLY_DATABASE,
  buildOperations: async () => deleteAllOperations([{ name: 'Products', model: Product }]),
  invariants: [
    { label: 'Category count unchanged', read: count(Category), expect: 'unchanged' },
    { label: 'SubCategory count unchanged', read: count(SubCategory), expect: 'unchanged' },
  ],
};

/* ------------------------------------------------------------------ */
/* clear-admin-data — admin portal test data                           */
/* ------------------------------------------------------------------ */

export const adminDataCleanupConfig: CleanupConfig = {
  command: 'npm run clear-admin-data',
  title: 'Admin portal data cleanup (invoices, customers, vendors, receipts, subcategories, categories)',
  allowsCatalogueDeletion: true,
  allowsAuditLogDeletion: false,
  buildOperations: async () =>
    deleteAllOperations([
      { name: 'Invoices', model: Invoice },
      { name: 'Customers', model: Customer },
      { name: 'Vendors (suppliers)', model: Vendor, note: 'products keep vendor_id values that no longer resolve' },
      { name: 'Receipts', model: Receipt },
      {
        name: 'Sub-categories',
        model: SubCategory,
        note: 'products are kept but their sub_category_id values no longer resolve',
      },
      {
        name: 'Categories',
        model: Category,
        note: 'products are kept but their category_id values no longer resolve',
      },
    ]),
};

/* ------------------------------------------------------------------ */
/* reset-admin — single admin credential reset                         */
/* ------------------------------------------------------------------ */

export const RESET_ADMIN_EMAIL = 'admin@edinc.com';
export const RESET_ADMIN_PASSWORD = 'Admin1234';
export const RESET_ADMIN_OLD_EMAIL = 'admin@expressdistributors.com';

export const adminResetConfig: CleanupConfig = {
  command: 'npx tsx src/db/reset-admin.ts',
  title: 'Admin credential reset',
  allowsCatalogueDeletion: false,
  allowsAuditLogDeletion: false,
  buildOperations: async () => [
    {
      label: `Admins with email ${RESET_ADMIN_OLD_EMAIL}`,
      collection: Admin.collection.name,
      kind: 'delete',
      action: `delete admin accounts with email ${RESET_ADMIN_OLD_EMAIL}`,
      count: async () => Admin.countDocuments({ email: RESET_ADMIN_OLD_EMAIL }),
      run: async () => (await Admin.deleteMany({ email: RESET_ADMIN_OLD_EMAIL })).deletedCount ?? 0,
    },
    {
      label: `Admin ${RESET_ADMIN_EMAIL}`,
      collection: Admin.collection.name,
      kind: 'update',
      action: `overwrite password, name and role of ${RESET_ADMIN_EMAIL} with the documented defaults, or create it if missing`,
      fields: ['password_hash', 'name', 'role'],
      count: async () => Admin.countDocuments({ email: RESET_ADMIN_EMAIL }),
      run: async () => {
        const password_hash = await bcrypt.hash(RESET_ADMIN_PASSWORD, 10);
        const existing = await Admin.findOne({ email: RESET_ADMIN_EMAIL });
        if (existing) {
          await Admin.updateOne({ email: RESET_ADMIN_EMAIL }, { password_hash, name: 'Admin', role: 'admin' });
        } else {
          await Admin.create({ email: RESET_ADMIN_EMAIL, password_hash, name: 'Admin', role: 'admin' });
        }
        return 1;
      },
    },
  ],
  afterExecute: [`Email: ${RESET_ADMIN_EMAIL}`, `Password: ${RESET_ADMIN_PASSWORD}`],
};
