import express from 'express';
import Order from '../models/Order';
import OrderItem from '../models/OrderItem';
import POSSale from '../models/POSSale';
import Invoice from '../models/Invoice';
import Product from '../models/Product';
import PurchaseOrder from '../models/PurchaseOrder';
import Return from '../models/Return';
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

const router = express.Router();

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

export default router;
