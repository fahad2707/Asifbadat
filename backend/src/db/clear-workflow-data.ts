/**
 * Wipe transactional / master records so the admin workflow can be retested.
 * Does NOT delete: Products, Categories, SubCategories, Admins, store settings.
 */
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

async function wipe(label: string, fn: () => Promise<{ deletedCount?: number }>) {
  const r = await fn();
  const n = r.deletedCount ?? 0;
  console.log(`  ${label}: ${n} deleted`);
  return n;
}

async function clearWorkflowData() {
  await connectDB();
  console.log('Clearing workflow data (products and categories kept)...\n');

  await wipe('Invoices / quotations', () => Invoice.deleteMany({}));
  await wipe('Receipts (bank transactions)', () => Receipt.deleteMany({}));
  await wipe('Payments', () => Payment.deleteMany({}));
  await wipe('Purchase orders', () => PurchaseOrder.deleteMany({}));
  await wipe('Credit memos', () => CreditMemo.deleteMany({}));
  await wipe('Vendors', () => Vendor.deleteMany({}));
  await wipe('Customers', () => Customer.deleteMany({}));
  await wipe('Customer product prices', () => CustomerProductPrice.deleteMany({}));
  await wipe('Tax types', () => TaxType.deleteMany({}));
  await wipe('Bank accounts', () => BankAccount.deleteMany({}));
  await wipe('Payment methods', () => PaymentMethod.deleteMany({}));
  await wipe('Ledger entries', () => LedgerEntry.deleteMany({}));
  await wipe('Stock movements', () => StockMovement.deleteMany({}));

  console.log('\nProducts, categories, and subcategories were not touched.');
  console.log('Done. You can retest the workflow from a blank slate.');
  process.exit(0);
}

clearWorkflowData().catch((err) => {
  console.error('Failed to clear workflow data:', err);
  process.exit(1);
});
