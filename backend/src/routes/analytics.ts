import express from 'express';
import Order from '../models/Order';
import OrderItem from '../models/OrderItem';
import POSSale from '../models/POSSale';
import Product from '../models/Product';
import Category from '../models/Category';
import Return from '../models/Return';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { applyPosReturnMerchandiseByDate, completedPosReturnMatch } from '../utils/posFinancialReporting';

const router = express.Router();

// Helper function to format date based on groupBy
const formatDate = (date: Date, groupBy: string): string => {
  const d = new Date(date);
  if (groupBy === 'week') {
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    return weekStart.toISOString().split('T')[0];
  } else if (groupBy === 'month') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  } else {
    return d.toISOString().split('T')[0];
  }
};

// Get sales analytics
router.get('/sales', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { period = '30', groupBy = 'day' } = req.query;
    const days = parseInt(period as string);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Online sales
    const orders = await Order.find({
      created_at: { $gte: startDate },
      payment_status: 'paid',
    }).lean();

    const onlineSalesMap = new Map<string, { revenue: number; orders: number }>();
    orders.forEach((order: any) => {
      const dateKey = formatDate(order.created_at, groupBy as string);
      const existing = onlineSalesMap.get(dateKey) || { revenue: 0, orders: 0 };
      existing.revenue += order.total_amount || 0;
      existing.orders += 1;
      onlineSalesMap.set(dateKey, existing);
    });

    const onlineSales = Array.from(onlineSalesMap.entries())
      .map(([date, data]) => ({
        date,
        revenue: data.revenue,
        orders: data.orders,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Offline sales (POS)
    const [posSales, posReturns] = await Promise.all([
      POSSale.find({
        created_at: { $gte: startDate },
      }).lean(),
      Return.find(completedPosReturnMatch(startDate)).lean(),
    ]);

    const offlineSalesMap = new Map<string, { revenue: number; sales: number }>();
    posSales.forEach((sale: any) => {
      const dateKey = formatDate(sale.created_at, groupBy as string);
      const existing = offlineSalesMap.get(dateKey) || { revenue: 0, sales: 0 };
      existing.revenue += sale.total_amount || 0;
      existing.sales += 1;
      offlineSalesMap.set(dateKey, existing);
    });
    applyPosReturnMerchandiseByDate(
      offlineSalesMap,
      posReturns,
      (createdAt) => formatDate(new Date(createdAt as string | number | Date), groupBy as string),
      () => ({ revenue: 0, sales: 0 })
    );

    const offlineSales = Array.from(offlineSalesMap.entries())
      .map(([date, data]) => ({
        date,
        revenue: data.revenue,
        sales: data.sales,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Category-wise sales
    const orderItems = await OrderItem.find({
      order_id: { $in: orders.map((o: any) => o._id) },
    })
      .populate('product_id', 'category_id')
      .lean();

    const categorySalesMap = new Map<string, { revenue: number; quantity: number }>();

    // Process order items
    for (const item of orderItems) {
      if (!item.product_id) continue;
      const product: any = item.product_id;
      const categoryId = product.category_id?.toString();

      if (categoryId) {
        const category = await Category.findById(categoryId).lean();
        const categoryName = category?.name || 'Uncategorized';
        const existing = categorySalesMap.get(categoryName) || { revenue: 0, quantity: 0 };
        existing.revenue += item.subtotal || 0;
        existing.quantity += item.quantity || 0;
        categorySalesMap.set(categoryName, existing);
      }
    }

    // Process POS sales
    for (const sale of posSales) {
      if (sale.items && Array.isArray(sale.items)) {
        for (const item of sale.items) {
          if (item.product_id) {
            const product = await Product.findById(item.product_id).lean();
            if (product?.category_id) {
              const category = await Category.findById(product.category_id).lean();
              const categoryName = category?.name || 'Uncategorized';
              const existing = categorySalesMap.get(categoryName) || { revenue: 0, quantity: 0 };
              existing.revenue += item.subtotal || 0;
              existing.quantity += item.quantity || 0;
              categorySalesMap.set(categoryName, existing);
            }
          }
        }
      }
    }

    for (const ret of posReturns as Array<{ items?: Array<{ product_id?: unknown; quantity?: number; refundable_amount?: number }> }>) {
      for (const item of ret.items || []) {
        if (!item.product_id) continue;
        const product = await Product.findById(item.product_id).lean();
        if (!product?.category_id) continue;
        const category = await Category.findById(product.category_id).lean();
        const categoryName = category?.name || 'Uncategorized';
        const existing = categorySalesMap.get(categoryName) || { revenue: 0, quantity: 0 };
        existing.revenue -= Number(item.refundable_amount) || 0;
        existing.quantity -= Number(item.quantity) || 0;
        categorySalesMap.set(categoryName, existing);
      }
    }

    const categorySales = Array.from(categorySalesMap.entries())
      .map(([category, data]) => ({
        category,
        revenue: data.revenue,
        quantity: data.quantity,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    res.json({
      onlineSales,
      offlineSales,
      categorySales,
    });
  } catch (error) {
    console.error('Get sales analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch sales analytics' });
  }
});

// Get revenue trends
router.get('/revenue', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { period = '30' } = req.query;
    const days = parseInt(period as string);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Online revenue
    const orders = await Order.find({
      created_at: { $gte: startDate },
    }).lean();

    const onlineMap = new Map<string, number>();
    orders.forEach((order: any) => {
      const dateKey = formatDate(order.created_at, 'day');
      const revenue = order.payment_status === 'paid' ? (order.total_amount || 0) : 0;
      onlineMap.set(dateKey, (onlineMap.get(dateKey) || 0) + revenue);
    });

    const online = Array.from(onlineMap.entries())
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // POS revenue
    const [posSales, posReturns] = await Promise.all([
      POSSale.find({
        created_at: { $gte: startDate },
      }).lean(),
      Return.find(completedPosReturnMatch(startDate)).lean(),
    ]);

    const offlineMap = new Map<string, number>();
    posSales.forEach((sale: any) => {
      const dateKey = formatDate(sale.created_at, 'day');
      offlineMap.set(dateKey, (offlineMap.get(dateKey) || 0) + (sale.total_amount || 0));
    });
    const offlineBuckets = new Map<string, { revenue: number }>();
    for (const [date, revenue] of offlineMap) {
      offlineBuckets.set(date, { revenue });
    }
    applyPosReturnMerchandiseByDate(
      offlineBuckets,
      posReturns,
      (createdAt) => formatDate(new Date(createdAt as string | number | Date), 'day'),
      () => ({ revenue: 0 })
    );
    offlineMap.clear();
    for (const [date, bucket] of offlineBuckets) {
      offlineMap.set(date, bucket.revenue);
    }

    const offline = Array.from(offlineMap.entries())
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      online,
      offline,
    });
  } catch (error) {
    console.error('Get revenue trends error:', error);
    res.status(500).json({ error: 'Failed to fetch revenue trends' });
  }
});

export default router;
