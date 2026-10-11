import express from 'express';
import { z } from 'zod';
import Order from '../models/Order';
import OrderItem from '../models/OrderItem';
import POSSale from '../models/POSSale';
import Invoice from '../models/Invoice';
import Product from '../models/Product';
import PurchaseOrder from '../models/PurchaseOrder';
import Return from '../models/Return';
import User from '../models/User';
import Customer from '../models/Customer';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import Expense from '../modules/expenses/models/Expense';
import mongoose from 'mongoose';
import { dashboardWholesaleInvoiceMatch, receivableOpenBalance } from '../utils/documentType';
import {
  dashboardInvoiceCogs,
  dashboardInvoiceRevenue,
  dashboardPosCogs,
  dashboardPosRevenue,
} from '../utils/dashboardFinancial';
import {
  completedPosReturnMatch,
  indexPosSalesById,
  missingPosSaleIds,
  yearMonthKey,
} from '../utils/posFinancialReporting';
import WebsiteSignupApplication, {
  WEBSITE_SIGNUP_STATUS_APPROVED,
  WEBSITE_SIGNUP_STATUS_PENDING,
  WEBSITE_SIGNUP_STATUS_REJECTED,
  WEBSITE_SIGNUP_STATUSES,
  type WebsiteSignupStatus,
} from '../models/WebsiteSignupApplication';
import AuditLog from '../models/AuditLog';
import {
  ACCOUNT_STATUS_APPROVED,
  ACCOUNT_STATUS_PENDING,
  ACCOUNT_STATUS_REJECTED,
} from '../utils/customerAccount';

const WEBSITE_SIGNUP_AUDIT_ENTITY = 'WebsiteSignupApplication';
const WEBSITE_SIGNUP_AUDIT_APPROVE = 'website_signup_approve';
const WEBSITE_SIGNUP_AUDIT_REJECT = 'website_signup_reject';

type WebsiteSignupAuditOutcome = 'created' | 'already_exists' | 'failed';

const router = express.Router();

const WEBSITE_SIGNUP_LIST_DEFAULT_LIMIT = 50;
const WEBSITE_SIGNUP_LIST_MAX_LIMIT = 100;

function parseWebsiteSignupListPagination(
  pageRaw: unknown,
  limitRaw: unknown
): { page: number; limit: number } | { error: string } {
  const pageProvided = pageRaw !== undefined && pageRaw !== null && String(pageRaw).trim() !== '';
  const limitProvided = limitRaw !== undefined && limitRaw !== null && String(limitRaw).trim() !== '';

  const pageNum = pageProvided ? Number(pageRaw) : 1;
  let limitNum = limitProvided ? Number(limitRaw) : WEBSITE_SIGNUP_LIST_DEFAULT_LIMIT;

  if (!Number.isFinite(pageNum) || !Number.isInteger(pageNum) || pageNum < 1) {
    return { error: 'Invalid page' };
  }
  if (!Number.isFinite(limitNum) || !Number.isInteger(limitNum) || limitNum < 1) {
    return { error: 'Invalid limit' };
  }
  if (limitNum > WEBSITE_SIGNUP_LIST_MAX_LIMIT) {
    limitNum = WEBSITE_SIGNUP_LIST_MAX_LIMIT;
  }
  return { page: pageNum, limit: limitNum };
}

function parseWebsiteSignupStatusFilter(statusRaw: unknown): WebsiteSignupStatus | null | { error: string } {
  if (statusRaw === undefined || statusRaw === null || String(statusRaw).trim() === '') {
    return null; // no filter → all statuses
  }
  const status = String(statusRaw).trim();
  if ((WEBSITE_SIGNUP_STATUSES as readonly string[]).includes(status)) {
    return status as WebsiteSignupStatus;
  }
  return { error: 'Invalid status filter' };
}

const websiteSignupReviewBodySchema = z.object({
  review_note: z.string().trim().max(2000).optional(),
});

function serializeWebsiteSignupApplication(row: any) {
  return {
    id: row._id.toString(),
    user_id: row.user_id ? String(row.user_id) : null,
    submitted_name: row.submitted_name ?? null,
    submitted_email: row.submitted_email ?? null,
    submitted_phone: row.submitted_phone ?? null,
    status: row.status,
    link_outcome: row.link_outcome,
    customer_id: row.customer_id ? String(row.customer_id) : null,
    matched_customer_ids: Array.isArray(row.matched_customer_ids)
      ? row.matched_customer_ids.map((id: unknown) => String(id))
      : [],
    match_kind: row.match_kind,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewed_by: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewed_at: row.reviewed_at ?? null,
    review_note: row.review_note ?? null,
  };
}

/** Basic approve path: new website Customer created for this User (no CRM collision). */
function isSafeCreatedWebsiteSignupPath(app: {
  link_outcome?: unknown;
  match_kind?: unknown;
  customer_id?: unknown;
}): boolean {
  return (
    app.link_outcome === 'created' &&
    app.match_kind === 'none' &&
    Boolean(app.customer_id)
  );
}

function updateMatched(result: { matchedCount?: number; modifiedCount?: number } | null | undefined): boolean {
  if (!result) return false;
  if (typeof result.matchedCount === 'number') return result.matchedCount > 0;
  return (result.modifiedCount ?? 0) > 0;
}

type CompensationOutcome = 'succeeded' | 'failed_no_match' | 'failed_threw';

/** Structured server log for approval consistency / recovery (no secrets or tokens). */
function logWebsiteSignupApprovalIssue(payload: {
  stage: string;
  applicationId: string;
  customerId: string;
  userId: string;
  compensation?: CompensationOutcome | 'not_attempted';
  errorMessage?: string;
}): void {
  console.error('[website-signup-approval]', JSON.stringify(payload));
}

async function compensateCustomerApproval(opts: {
  customerId: string;
  userId: string;
}): Promise<CompensationOutcome> {
  try {
    const upd = await Customer.updateOne(
      {
        _id: new mongoose.Types.ObjectId(opts.customerId),
        user_id: new mongoose.Types.ObjectId(opts.userId),
        account_status: ACCOUNT_STATUS_APPROVED,
      },
      { $set: { account_status: ACCOUNT_STATUS_PENDING } }
    );
    return updateMatched(upd) ? 'succeeded' : 'failed_no_match';
  } catch {
    return 'failed_threw';
  }
}

function websiteSignupReviewAuditPayload(opts: {
  adminId: string;
  applicationId: string;
  action: typeof WEBSITE_SIGNUP_AUDIT_APPROVE | typeof WEBSITE_SIGNUP_AUDIT_REJECT;
  customerId?: string | null;
  reviewNote?: string | null;
  ip?: string;
}) {
  const status =
    opts.action === WEBSITE_SIGNUP_AUDIT_APPROVE
      ? WEBSITE_SIGNUP_STATUS_APPROVED
      : WEBSITE_SIGNUP_STATUS_REJECTED;
  const newValue: Record<string, unknown> = {
    status,
    reviewed_by: opts.adminId,
  };
  if (opts.customerId) {
    newValue.customer_id = opts.customerId;
  }
  const detailsBase =
    opts.action === WEBSITE_SIGNUP_AUDIT_APPROVE
      ? 'Website signup application approved'
      : 'Website signup application rejected';
  const details =
    opts.reviewNote && opts.reviewNote.trim()
      ? `${detailsBase}: ${opts.reviewNote.trim()}`
      : detailsBase;
  return {
    admin_id: new mongoose.Types.ObjectId(opts.adminId),
    action: opts.action,
    entity_type: WEBSITE_SIGNUP_AUDIT_ENTITY,
    entity_id: opts.applicationId,
    old_value: { status: WEBSITE_SIGNUP_STATUS_PENDING },
    new_value: newValue,
    details,
    ...(opts.ip ? { ip: opts.ip } : {}),
  };
}

/** Append-only create for a persisted pending→decision transition. */
async function createWebsiteSignupReviewAudit(opts: {
  adminId: string;
  applicationId: string;
  action: typeof WEBSITE_SIGNUP_AUDIT_APPROVE | typeof WEBSITE_SIGNUP_AUDIT_REJECT;
  customerId?: string | null;
  reviewNote?: string | null;
  ip?: string;
}): Promise<WebsiteSignupAuditOutcome> {
  try {
    const created = await AuditLog.create(websiteSignupReviewAuditPayload(opts));
    if (!created || !(created as { _id?: unknown })._id) {
      return 'failed';
    }
    return 'created';
  } catch {
    return 'failed';
  }
}

/**
 * Idempotent / repair path: if a decision audit already exists, do not duplicate.
 * Best-effort only — schema has no unique constraint for concurrent repair races.
 */
async function ensureWebsiteSignupReviewAudit(opts: {
  adminId: string;
  applicationId: string;
  action: typeof WEBSITE_SIGNUP_AUDIT_APPROVE | typeof WEBSITE_SIGNUP_AUDIT_REJECT;
  customerId?: string | null;
  reviewNote?: string | null;
  ip?: string;
}): Promise<WebsiteSignupAuditOutcome> {
  try {
    const existing = await AuditLog.findOne({
      entity_type: WEBSITE_SIGNUP_AUDIT_ENTITY,
      entity_id: opts.applicationId,
      action: opts.action,
    })
      .select('_id')
      .lean();
    if (existing) {
      return 'already_exists';
    }
  } catch {
    return 'failed';
  }
  return createWebsiteSignupReviewAudit(opts);
}

async function loadCostPriceMap(ids: Iterable<string>): Promise<Map<string, number>> {
  const unique = [...new Set([...ids].filter(Boolean))];
  const map = new Map<string, number>();
  if (!unique.length) return map;
  const objectIds = unique
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!objectIds.length) return map;
  const rows = await Product.find({ _id: { $in: objectIds } })
    .select('cost_price')
    .lean();
  for (const row of rows) {
    map.set(String(row._id), Number((row as { cost_price?: number }).cost_price) || 0);
  }
  return map;
}

// Get dashboard stats (AIC-style KPIs + charts)
router.get('/dashboard', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { period = '90' } = req.query;
    const days = Math.min(parseInt(period as string) || 90, 365);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [orders, posSales, invoices, pos_agg, expenseAgg, posReturns] = await Promise.all([
      Order.find({ created_at: { $gte: startDate }, payment_status: 'paid' }).lean(),
      POSSale.find({ created_at: { $gte: startDate } }).lean(),
      Invoice.find({ created_at: { $gte: startDate }, ...dashboardWholesaleInvoiceMatch }).lean(),
      PurchaseOrder.aggregate([
        { $match: { created_at: { $gte: startDate } } },
        { $group: { _id: null, total: { $sum: '$total_amount' } } },
      ]),
      Expense.aggregate([
        {
          $match: {
            date: { $gte: startDate, $lte: new Date() },
            $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }],
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Return.find(completedPosReturnMatch(startDate)).lean(),
    ]);

    const posSalesById = indexPosSalesById(posSales as Array<{ _id?: unknown }>);
    const extraSaleIds = missingPosSaleIds(posReturns as Array<{ status?: unknown; sale_id?: unknown }>, posSalesById)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const extraPosSales = extraSaleIds.length
      ? await POSSale.find({ _id: { $in: extraSaleIds } }).lean()
      : [];
    for (const sale of extraPosSales) {
      posSalesById.set(String(sale._id), sale);
    }

    const onlineRevenue = orders.reduce((sum, order) => sum + (order.total_amount || 0), 0);
    const offlineRevenue = dashboardPosRevenue(posSales, posReturns);
    const invoiceRevenue = dashboardInvoiceRevenue(invoices);
    const totalSales = Math.round((Number(onlineRevenue) + Number(offlineRevenue) + Number(invoiceRevenue)) * 100) / 100;
    const totalPurchases = Math.round(Number(pos_agg[0]?.total || 0) * 100) / 100;
    const totalExpenses = Number(expenseAgg[0]?.total || 0);

    const costProductIds: string[] = [];
    const orderIds = orders.map((o: { _id: unknown }) => String(o._id));
    const orderItemsCogs = await OrderItem.find({ order_id: { $in: orderIds } })
      .select('product_id quantity')
      .lean();
    for (const item of orderItemsCogs as { product_id?: { toString: () => string }; quantity?: number }[]) {
      if (item.product_id) costProductIds.push(String(item.product_id));
    }
    for (const sale of posSales as { items?: { product_id?: unknown; quantity?: number }[] }[]) {
      for (const it of sale.items || []) {
        if (it.product_id) costProductIds.push(String(it.product_id));
      }
    }
    for (const inv of invoices as { items?: { product_id?: unknown; quantity?: number }[] }[]) {
      for (const it of inv.items || []) {
        if (it.product_id) costProductIds.push(String(it.product_id));
      }
    }
    const costMap = await loadCostPriceMap(costProductIds);

    let totalCOGS = 0;
    for (const item of orderItemsCogs as { product_id?: { toString: () => string }; quantity?: number }[]) {
      const pid = item.product_id ? String(item.product_id) : '';
      totalCOGS += (item.quantity || 0) * (costMap.get(pid) ?? 0);
    }
    totalCOGS += dashboardPosCogs(posSales, costMap, posReturns, posSalesById);
    totalCOGS += dashboardInvoiceCogs(invoices, costMap);

    const netProfit = totalSales - totalCOGS - totalExpenses;

    const totalReceivable = invoices.reduce((sum: number, inv: { invoice_type?: string; total_amount?: number; amount_paid?: number }) => {
      return sum + receivableOpenBalance(inv);
    }, 0);

    const totalPayable = Number(pos_agg[0]?.total || 0);

    const locMap = new Map<string, number>();
    orders.forEach((o: { pickup_location?: string; total_amount?: number }) => {
      const loc = o.pickup_location || 'Unknown';
      locMap.set(loc, (locMap.get(loc) || 0) + (o.total_amount || 0));
    });
    invoices.forEach((inv: { customer_address?: string; total_amount?: number }) => {
      const loc = inv.customer_address || 'Unknown';
      locMap.set(loc, (locMap.get(loc) || 0) + (inv.total_amount || 0));
    });

    const orderItems = await OrderItem.find({ order_id: { $in: orderIds } })
      .populate({ path: 'product_id', populate: { path: 'category_id', model: 'Category' } })
      .lean();

    const categoryRevenue = new Map<string, number>();
    orderItems.forEach((item: any) => {
      const catName = item.product_id?.category_id?.name || 'Uncategorized';
      categoryRevenue.set(catName, (categoryRevenue.get(catName) || 0) + (item.subtotal || 0));
    });
    invoices.forEach((inv: { items?: { category_name?: string; subtotal?: number }[] }) => {
      (inv.items || []).forEach((it) => {
        const catName = it.category_name || 'Uncategorized';
        categoryRevenue.set(catName, (categoryRevenue.get(catName) || 0) + (it.subtotal || 0));
      });
    });
    const topSellingItem =
      Array.from(categoryRevenue.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

    const monthMap = new Map<string, number>();
    const monthsToShow = Math.min(24, Math.ceil(days / 30) + 1);
    for (let i = 0; i < monthsToShow; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap.set(key, 0);
    }
    orders.forEach((o: { created_at: Date; total_amount?: number }) => {
      const d = new Date(o.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap.set(key, (monthMap.get(key) || 0) + (o.total_amount || 0));
    });
    posSales.forEach((s: { created_at: Date; total_amount?: number }) => {
      const key = yearMonthKey(s.created_at);
      monthMap.set(key, (monthMap.get(key) || 0) + (s.total_amount || 0));
    });
    posReturns.forEach((ret: { created_at?: Date; total_refund?: number; status?: string }) => {
      if (ret.status !== 'completed') return;
      const key = yearMonthKey(ret.created_at);
      monthMap.set(key, (monthMap.get(key) || 0) - (Number(ret.total_refund) || 0));
    });
    invoices.forEach((inv: { created_at: Date; total_amount?: number }) => {
      const d = new Date(inv.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap.set(key, (monthMap.get(key) || 0) + (inv.total_amount || 0));
    });
    const salesTrend = Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, sales]) => ({ month, sales: Math.round(sales * 100) / 100 }));

    const top10Customers: Array<{ name: string; sales: number }> = [];
    const customerMap = new Map<string, number>();
    invoices.forEach((inv: { customer_name?: string; total_amount?: number }) => {
      const name = inv.customer_name || 'Customer';
      customerMap.set(name, (customerMap.get(name) || 0) + (inv.total_amount || 0));
    });
    customerMap.forEach((value, name) => {
      top10Customers.push({ name, sales: Math.round(value) });
    });
    top10Customers.sort((a, b) => b.sales - a.sales);
    if (top10Customers.length > 10) top10Customers.splice(10);

    const poList = await PurchaseOrder.find({ created_at: { $gte: startDate } })
      .populate('vendor_id', 'state')
      .lean();

    const purchaseByLocationMap = new Map<string, number>();
    poList.forEach((po: any) => {
      const state = po.vendor_id?.state || 'Unknown';
      purchaseByLocationMap.set(state, (purchaseByLocationMap.get(state) || 0) + (po.total_amount || 0));
    });
    const totalPurchLoc = Array.from(purchaseByLocationMap.values()).reduce((a, b) => a + b, 0);
    const purchaseByLocation = Array.from(purchaseByLocationMap.entries()).map(([name, value]) => ({
      name,
      value: totalPurchLoc ? Math.round((value / totalPurchLoc) * 1000) / 10 : 0,
    }));

    const poProductIds: string[] = [];
    for (const po of poList as { items?: { product_id?: unknown }[] }[]) {
      for (const it of po.items || []) {
        if (it.product_id) poProductIds.push(String(it.product_id));
      }
    }
    const poProducts = poProductIds.length
      ? await Product.find({
          _id: {
            $in: poProductIds
              .filter((id) => mongoose.Types.ObjectId.isValid(id))
              .map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .populate('category_id', 'name')
          .select('category_id')
          .lean()
      : [];
    const poCatByProductId = new Map<string, string>();
    for (const prod of poProducts) {
      poCatByProductId.set(
        String(prod._id),
        (prod as { category_id?: { name?: string } }).category_id?.name || 'Uncategorized'
      );
    }

    const purchaseByCategoryMap = new Map<string, { y2024: number; y2025: number }>();
    for (const po of poList as { created_at: Date; items?: { product_id?: unknown; subtotal?: number }[] }[]) {
      const year = new Date(po.created_at).getFullYear();
      for (const it of po.items || []) {
        const catName = it.product_id
          ? poCatByProductId.get(String(it.product_id)) || 'Uncategorized'
          : 'Uncategorized';
        const entry = purchaseByCategoryMap.get(catName) || { y2024: 0, y2025: 0 };
        if (year === 2024) entry.y2024 += it.subtotal || 0;
        else entry.y2025 += it.subtotal || 0;
        purchaseByCategoryMap.set(catName, entry);
      }
    }
    const purchaseByCategory = Array.from(purchaseByCategoryMap.entries()).map(([name, v]) => ({
      name,
      y2024: Math.round(v.y2024),
      y2025: Math.round(v.y2025),
    }));

    const salesByLocation = Array.from(locMap.entries())
      .map(([name, value]) => ({ name, sales: Math.round(value) }))
      .sort((a, b) => b.sales - a.sales);

    const totalCat = Array.from(categoryRevenue.values()).reduce((a, b) => a + b, 0);
    const salesByCategory = Array.from(categoryRevenue.entries()).map(([name, value]) => ({
      name,
      value: totalCat ? Math.round((value / totalCat) * 1000) / 10 : 0,
    }));

    const cityMap = new Map<string, number>();
    orders.forEach((o: { pickup_location?: string; total_amount?: number }) => {
      const loc = o.pickup_location || 'Unknown';
      cityMap.set(loc, (cityMap.get(loc) || 0) + (o.total_amount || 0));
    });
    invoices.forEach((inv: { customer_address?: string; total_amount?: number }) => {
      const loc = inv.customer_address || 'Unknown';
      cityMap.set(loc, (cityMap.get(loc) || 0) + (inv.total_amount || 0));
    });
    const salesByCity = Array.from(cityMap.entries())
      .map(([name, value]) => ({ name, size: Math.round(value) }))
      .sort((a, b) => b.size - a.size);

    const lowStockCount = await Product.countDocuments({
      is_active: { $ne: false },
      $expr: { $lte: ['$stock_quantity', { $ifNull: ['$low_stock_threshold', 10] }] },
    });

    const productSales = new Map<
      string,
      { name: string; image_url?: string; total_sold: number; revenue: number }
    >();
    orderItems.forEach((item: {
      product_id?: { _id?: { toString: () => string }; name?: string; image_url?: string };
      quantity?: number;
      subtotal?: number;
    }) => {
      if (!item.product_id) return;
      const productId = String(item.product_id._id);
      const existing = productSales.get(productId) || {
        name: item.product_id.name || 'Product',
        image_url: item.product_id.image_url,
        total_sold: 0,
        revenue: 0,
      };
      existing.total_sold += item.quantity || 0;
      existing.revenue += item.subtotal || 0;
      productSales.set(productId, existing);
    });
    invoices.forEach((inv: { items?: { product_id?: unknown; product_name?: string; quantity?: number; subtotal?: number }[] }) => {
      (inv.items || []).forEach((it) => {
        if (!it.product_id) return;
        const productId = String(it.product_id);
        const existing = productSales.get(productId) || {
          name: it.product_name || 'Product',
          image_url: undefined,
          total_sold: 0,
          revenue: 0,
        };
        existing.total_sold += it.quantity || 0;
        existing.revenue += it.subtotal || 0;
        productSales.set(productId, existing);
      });
    });
    const posTopIds: string[] = [];
    for (const sale of posSales as { items?: { product_id?: unknown; quantity?: number; subtotal?: number }[] }[]) {
      for (const it of sale.items || []) {
        if (it.product_id) posTopIds.push(String(it.product_id));
      }
    }
    const posTopProducts = posTopIds.length
      ? await Product.find({
          _id: {
            $in: posTopIds
              .filter((id) => mongoose.Types.ObjectId.isValid(id))
              .map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .select('name image_url')
          .lean()
      : [];
    const posMeta = new Map<string, { name: string; image_url?: string }>();
    for (const p of posTopProducts) {
      posMeta.set(String(p._id), {
        name: (p as { name?: string }).name || 'Product',
        image_url: (p as { image_url?: string }).image_url,
      });
    }
    for (const sale of posSales as { items?: { product_id?: unknown; quantity?: number; subtotal?: number }[] }[]) {
      for (const it of sale.items || []) {
        if (!it.product_id) continue;
        const productId = String(it.product_id);
        const meta = posMeta.get(productId);
        if (!meta) continue;
        const existing = productSales.get(productId) || {
          name: meta.name,
          image_url: meta.image_url,
          total_sold: 0,
          revenue: 0,
        };
        existing.total_sold += it.quantity || 0;
        existing.revenue += it.subtotal || 0;
        productSales.set(productId, existing);
      }
    }

    const topProducts = Array.from(productSales.values())
      .sort((a, b) => b.total_sold - a.total_sold)
      .slice(0, 10)
      .map((p, index) => ({
        id: index + 1,
        name: p.name,
        image_url: p.image_url,
        total_sold: p.total_sold,
        revenue: p.revenue,
      }));

    res.json({
      revenue: totalSales,
      totalSales,
      totalPurchases,
      totalCOGS: Math.round(totalCOGS * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      totalReceivable,
      totalPayable,
      topSellingItem,
      salesTrend,
      orders: invoices.length,
      onlineSales: Number(invoiceRevenue),
      offlineSales: Number(offlineRevenue),
      lowStockCount: Number(lowStockCount),
      topProducts: Array.isArray(topProducts) ? topProducts : [],
      top10Customers,
      purchaseByLocation,
      purchaseByCategory,
      salesByLocation,
      salesByCategory,
      salesByCity,
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get low stock products
router.get('/low-stock', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const products = await Product.find({
      is_active: { $ne: false },
      $expr: { $lte: ['$stock_quantity', { $ifNull: ['$low_stock_threshold', 10] }] },
    })
      .populate('category_id', 'name')
      .sort({ stock_quantity: 1 })
      .limit(100)
      .lean();

    res.json(
      products.map((p: any) => ({
        id: p._id.toString(),
        name: p.name,
        price: p.price,
        stock_quantity: p.stock_quantity,
        low_stock_threshold: p.low_stock_threshold,
        category_name: p.category_id?.name,
        image_url: p.image_url,
        sku: p.sku,
        product_id: p.product_id,
      }))
    );
  } catch (error) {
    console.error('Get low stock error:', error);
    res.status(500).json({ error: 'Failed to fetch low stock products' });
  }
});

/**
 * Read-only admin queue of WebsiteSignupApplication records.
 * Does not approve/reject, bind Customers, or grant commercial access.
 * link_outcome / match_kind / matched_customer_ids are historical signup metadata only.
 */
router.get('/website-signup-applications', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const pagination = parseWebsiteSignupListPagination(req.query.page, req.query.limit);
    if ('error' in pagination) {
      return res.status(400).json({ error: pagination.error });
    }
    const statusFilter = parseWebsiteSignupStatusFilter(req.query.status);
    if (statusFilter && typeof statusFilter === 'object' && 'error' in statusFilter) {
      return res.status(400).json({ error: statusFilter.error });
    }

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;
    const query: Record<string, unknown> = {};
    if (typeof statusFilter === 'string') {
      query.status = statusFilter;
    }

    const [rows, total] = await Promise.all([
      WebsiteSignupApplication.find(query)
        .sort({ created_at: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WebsiteSignupApplication.countDocuments(query),
    ]);

    res.json({
      applications: rows.map((row: any) => serializeWebsiteSignupApplication(row)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    });
  } catch (error) {
    console.error('List website signup applications error:', error);
    res.status(500).json({ error: 'Failed to fetch website signup applications' });
  }
});

/**
 * Approve a pending website signup that used the safe new-Customer path only.
 * Does not bind CRM matches (approved_crm / non_approved_crm / ambiguous / already_linked).
 * Commercial access requires Customer.account_status approved + live user_id link.
 */
router.post(
  '/website-signup-applications/:id/approve',
  authenticateAdmin,
  async (req: AuthRequest, res) => {
    try {
      const appId = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(appId)) {
        return res.status(404).json({ error: 'Application not found' });
      }

      const body = websiteSignupReviewBodySchema.parse(req.body ?? {});
      const adminId = typeof req.userId === 'string' ? req.userId.trim() : '';
      if (!adminId || !mongoose.Types.ObjectId.isValid(adminId)) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const reviewedBy = new mongoose.Types.ObjectId(adminId);
      const reviewedAt = new Date();

      const app = await WebsiteSignupApplication.findById(appId).lean();
      if (!app) {
        return res.status(404).json({ error: 'Application not found' });
      }

      if (app.status === WEBSITE_SIGNUP_STATUS_REJECTED) {
        return res.status(409).json({ error: 'Application is rejected and cannot be approved' });
      }

      if (!isSafeCreatedWebsiteSignupPath(app)) {
        return res.status(409).json({
          error:
            'Application requires manual identity resolution and cannot be auto-approved',
        });
      }

      const userId = app.user_id ? String(app.user_id) : '';
      const customerId = app.customer_id ? String(app.customer_id) : '';
      if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      const user = await User.findById(userId).select('_id').lean();
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const customer = await Customer.findById(customerId)
        .select('_id user_id account_status')
        .lean();
      if (!customer) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      if (!customer.user_id || String(customer.user_id) !== userId) {
        return res.status(409).json({
          error: 'Customer is not linked to this application user',
        });
      }

      // Idempotent re-approve when already approved and live invariants still hold.
      // Repair missing audit from a prior decision+audit-write failure (best-effort).
      if (app.status === WEBSITE_SIGNUP_STATUS_APPROVED) {
        if ((customer as { account_status?: unknown }).account_status === ACCOUNT_STATUS_APPROVED) {
          const auditRepair = await ensureWebsiteSignupReviewAudit({
            adminId,
            applicationId: appId,
            action: WEBSITE_SIGNUP_AUDIT_APPROVE,
            customerId,
            reviewNote: typeof app.review_note === 'string' ? app.review_note : undefined,
            ip: req.ip,
          });
          if (auditRepair === 'failed') {
            logWebsiteSignupApprovalIssue({
              stage: 'audit_repair_failed_after_approve',
              applicationId: appId,
              customerId,
              userId,
              compensation: 'not_attempted',
            });
            return res.status(500).json({
              error: 'Application already approved but audit logging failed; requires investigation',
            });
          }
          return res.json({ application: serializeWebsiteSignupApplication(app) });
        }
        return res.status(409).json({
          error: 'Application is approved but Customer is not in an approved state',
        });
      }

      if (app.status !== WEBSITE_SIGNUP_STATUS_PENDING) {
        return res.status(409).json({ error: 'Application is not pending' });
      }

      const reviewSet: Record<string, unknown> = {
        status: WEBSITE_SIGNUP_STATUS_APPROVED,
        reviewed_by: reviewedBy,
        reviewed_at: reviewedAt,
      };
      if (body.review_note !== undefined) {
        reviewSet.review_note = body.review_note;
      }

      const customerStatus = (customer as { account_status?: unknown }).account_status;

      // Recovery: Customer already approved + still linked; finish application-only transition.
      // Do not re-run Customer approval or alter Customer on this path.
      if (customerStatus === ACCOUNT_STATUS_APPROVED) {
        try {
          const recoveredApp = await WebsiteSignupApplication.findOneAndUpdate(
            { _id: new mongoose.Types.ObjectId(appId), status: WEBSITE_SIGNUP_STATUS_PENDING },
            { $set: reviewSet },
            { new: true }
          ).lean();
          if (!recoveredApp) {
            return res.status(409).json({
              error: 'Application approval conflict; another reviewer may have acted',
            });
          }
          const recoveryAudit = await createWebsiteSignupReviewAudit({
            adminId,
            applicationId: appId,
            action: WEBSITE_SIGNUP_AUDIT_APPROVE,
            customerId,
            reviewNote: body.review_note,
            ip: req.ip,
          });
          if (recoveryAudit === 'failed') {
            logWebsiteSignupApprovalIssue({
              stage: 'audit_write_failed_after_recovery_approve',
              applicationId: appId,
              customerId,
              userId,
              compensation: 'not_attempted',
            });
            return res.status(500).json({
              error: 'Application approved but audit logging failed; requires investigation',
            });
          }
          return res.json({ application: serializeWebsiteSignupApplication(recoveredApp) });
        } catch (recoveryErr: any) {
          logWebsiteSignupApprovalIssue({
            stage: 'recovery_application_transition_threw',
            applicationId: appId,
            customerId,
            userId,
            compensation: 'not_attempted',
            errorMessage: String(recoveryErr?.message || recoveryErr),
          });
          return res.status(500).json({
            error: 'Approval recovery failed and requires investigation',
          });
        }
      }

      if (customerStatus !== ACCOUNT_STATUS_PENDING) {
        return res.status(409).json({
          error: 'Customer is not in a pending state eligible for approval',
        });
      }

      // 1) Conditionally approve Customer while link holds.
      const customerUpd = await Customer.updateOne(
        {
          _id: new mongoose.Types.ObjectId(customerId),
          user_id: new mongoose.Types.ObjectId(userId),
          account_status: ACCOUNT_STATUS_PENDING,
        },
        { $set: { account_status: ACCOUNT_STATUS_APPROVED } }
      );
      if (!updateMatched(customerUpd)) {
        return res.status(409).json({
          error: 'Customer approval conflict; live state changed',
        });
      }

      // 2) Conditionally approve application (only one concurrent reviewer wins).
      let approvedApp: any = null;
      let appTransitionThrew = false;
      let appTransitionErrorMessage: string | undefined;
      try {
        approvedApp = await WebsiteSignupApplication.findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(appId), status: WEBSITE_SIGNUP_STATUS_PENDING },
          { $set: reviewSet },
          { new: true }
        ).lean();
      } catch (appErr: any) {
        appTransitionThrew = true;
        appTransitionErrorMessage = String(appErr?.message || appErr);
      }

      if (approvedApp) {
        const auditOutcome = await createWebsiteSignupReviewAudit({
          adminId,
          applicationId: appId,
          action: WEBSITE_SIGNUP_AUDIT_APPROVE,
          customerId,
          reviewNote: body.review_note,
          ip: req.ip,
        });
        if (auditOutcome === 'failed') {
          logWebsiteSignupApprovalIssue({
            stage: 'audit_write_failed_after_approve',
            applicationId: appId,
            customerId,
            userId,
            compensation: 'not_attempted',
          });
          return res.status(500).json({
            error: 'Application approved but audit logging failed; requires investigation',
          });
        }
        return res.json({ application: serializeWebsiteSignupApplication(approvedApp) });
      }

      // Application did not transition — compensate Customer approval if still ours.
      const compensation = await compensateCustomerApproval({ customerId, userId });
      if (compensation !== 'succeeded') {
        logWebsiteSignupApprovalIssue({
          stage: appTransitionThrew
            ? 'application_transition_threw_compensation_failed'
            : 'application_transition_conflict_compensation_failed',
          applicationId: appId,
          customerId,
          userId,
          compensation,
          errorMessage: appTransitionErrorMessage,
        });
        return res.status(500).json({
          error: 'Approval incomplete and requires recovery',
        });
      }

      if (appTransitionThrew) {
        logWebsiteSignupApprovalIssue({
          stage: 'application_transition_threw_compensated',
          applicationId: appId,
          customerId,
          userId,
          compensation: 'succeeded',
          errorMessage: appTransitionErrorMessage,
        });
        return res.status(500).json({
          error: 'Failed to approve website signup application',
        });
      }

      return res.status(409).json({
        error: 'Application approval conflict; another reviewer may have acted',
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
      }
      console.error('Approve website signup application error:', error);
      res.status(500).json({ error: 'Failed to approve website signup application' });
    }
  }
);

/**
 * Reject a pending website signup application.
 * Never reassigns Customer.user_id.
 * Safe created-path apps also mark the linked website Customer pending → rejected
 * so profile/routing match the review decision. CRM-collision apps leave Customer untouched.
 */
router.post(
  '/website-signup-applications/:id/reject',
  authenticateAdmin,
  async (req: AuthRequest, res) => {
    try {
      const appId = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(appId)) {
        return res.status(404).json({ error: 'Application not found' });
      }

      const body = websiteSignupReviewBodySchema.parse(req.body ?? {});
      const adminId = typeof req.userId === 'string' ? req.userId.trim() : '';
      if (!adminId || !mongoose.Types.ObjectId.isValid(adminId)) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const reviewedBy = new mongoose.Types.ObjectId(adminId);
      const reviewedAt = new Date();

      const app = await WebsiteSignupApplication.findById(appId).lean();
      if (!app) {
        return res.status(404).json({ error: 'Application not found' });
      }

      if (app.status === WEBSITE_SIGNUP_STATUS_APPROVED) {
        return res.status(409).json({ error: 'Application is approved and cannot be rejected' });
      }

      if (app.status === WEBSITE_SIGNUP_STATUS_REJECTED) {
        const rejectCustomerId = app.customer_id ? String(app.customer_id) : null;
        // Idempotent repair: if safe-path Customer is still pending, align it to rejected.
        if (
          isSafeCreatedWebsiteSignupPath(app) &&
          app.customer_id &&
          app.user_id
        ) {
          await Customer.updateOne(
            {
              _id: app.customer_id,
              user_id: app.user_id,
              account_status: ACCOUNT_STATUS_PENDING,
            },
            { $set: { account_status: ACCOUNT_STATUS_REJECTED } }
          );
        }
        const auditRepair = await ensureWebsiteSignupReviewAudit({
          adminId,
          applicationId: appId,
          action: WEBSITE_SIGNUP_AUDIT_REJECT,
          customerId: rejectCustomerId,
          reviewNote: typeof app.review_note === 'string' ? app.review_note : undefined,
          ip: req.ip,
        });
        if (auditRepair === 'failed') {
          logWebsiteSignupApprovalIssue({
            stage: 'audit_repair_failed_after_reject',
            applicationId: appId,
            customerId: rejectCustomerId || '',
            userId: app.user_id ? String(app.user_id) : '',
            compensation: 'not_attempted',
          });
          return res.status(500).json({
            error: 'Application already rejected but audit logging failed; requires investigation',
          });
        }
        return res.json({ application: serializeWebsiteSignupApplication(app) });
      }

      if (app.status !== WEBSITE_SIGNUP_STATUS_PENDING) {
        return res.status(409).json({ error: 'Application is not pending' });
      }

      const safeCreatedPath = isSafeCreatedWebsiteSignupPath(app);
      let customerMarkedRejected = false;

      // Safe created path: mark the linked website Customer rejected first so profile
      // routing matches. CRM-collision paths never mutate Customer records.
      if (safeCreatedPath && app.customer_id && app.user_id) {
        const customer = await Customer.findById(app.customer_id).lean();
        if (!customer) {
          return res.status(409).json({
            error: 'Linked website Customer is missing; cannot reject this application safely',
          });
        }
        if (String(customer.user_id || '') !== String(app.user_id)) {
          return res.status(409).json({
            error: 'Customer link mismatch; cannot reject this application safely',
          });
        }
        const customerReject = await Customer.updateOne(
          {
            _id: app.customer_id,
            user_id: app.user_id,
            account_status: ACCOUNT_STATUS_PENDING,
          },
          { $set: { account_status: ACCOUNT_STATUS_REJECTED } }
        );
        if (!updateMatched(customerReject)) {
          // Already rejected is recoverable; other statuses conflict.
          const live = await Customer.findById(app.customer_id).lean();
          if (live?.account_status !== ACCOUNT_STATUS_REJECTED) {
            return res.status(409).json({
              error: 'Customer rejection conflict; another reviewer may have acted',
            });
          }
        } else {
          customerMarkedRejected = true;
        }
      }

      const reviewSet: Record<string, unknown> = {
        status: WEBSITE_SIGNUP_STATUS_REJECTED,
        reviewed_by: reviewedBy,
        reviewed_at: reviewedAt,
      };
      if (body.review_note !== undefined) {
        reviewSet.review_note = body.review_note;
      }

      let rejectedApp;
      try {
        rejectedApp = await WebsiteSignupApplication.findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(appId), status: WEBSITE_SIGNUP_STATUS_PENDING },
          { $set: reviewSet },
          { new: true }
        ).lean();
      } catch (appErr) {
        if (customerMarkedRejected && app.customer_id && app.user_id) {
          try {
            await Customer.updateOne(
              {
                _id: app.customer_id,
                user_id: app.user_id,
                account_status: ACCOUNT_STATUS_REJECTED,
              },
              { $set: { account_status: ACCOUNT_STATUS_PENDING } }
            );
          } catch {
            logWebsiteSignupApprovalIssue({
              stage: 'reject_app_threw_customer_compensation_failed',
              applicationId: appId,
              customerId: String(app.customer_id),
              userId: String(app.user_id),
              compensation: 'failed_threw',
              errorMessage: appErr instanceof Error ? appErr.message : String(appErr),
            });
          }
        }
        throw appErr;
      }

      if (!rejectedApp) {
        if (customerMarkedRejected && app.customer_id && app.user_id) {
          const compensate = await Customer.updateOne(
            {
              _id: app.customer_id,
              user_id: app.user_id,
              account_status: ACCOUNT_STATUS_REJECTED,
            },
            { $set: { account_status: ACCOUNT_STATUS_PENDING } }
          );
          if (!updateMatched(compensate)) {
            logWebsiteSignupApprovalIssue({
              stage: 'reject_app_conflict_customer_compensation_failed',
              applicationId: appId,
              customerId: String(app.customer_id),
              userId: String(app.user_id),
              compensation: 'failed_no_match',
            });
            return res.status(500).json({
              error:
                'Application rejection conflicted after Customer was marked rejected; requires investigation',
            });
          }
        }
        return res.status(409).json({
          error: 'Application rejection conflict; another reviewer may have acted',
        });
      }

      const rejectCustomerId = rejectedApp.customer_id ? String(rejectedApp.customer_id) : null;
      const rejectAudit = await createWebsiteSignupReviewAudit({
        adminId,
        applicationId: appId,
        action: WEBSITE_SIGNUP_AUDIT_REJECT,
        customerId: rejectCustomerId,
        reviewNote: body.review_note,
        ip: req.ip,
      });
      if (rejectAudit === 'failed') {
        logWebsiteSignupApprovalIssue({
          stage: 'audit_write_failed_after_reject',
          applicationId: appId,
          customerId: rejectCustomerId || '',
          userId: rejectedApp.user_id ? String(rejectedApp.user_id) : '',
          compensation: 'not_attempted',
        });
        return res.status(500).json({
          error: 'Application rejected but audit logging failed; requires investigation',
        });
      }

      return res.json({ application: serializeWebsiteSignupApplication(rejectedApp) });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
      }
      console.error('Reject website signup application error:', error);
      res.status(500).json({ error: 'Failed to reject website signup application' });
    }
  }
);

export default router;
