import Order from '../../../models/Order';
import OrderItem from '../../../models/OrderItem';
import POSSale from '../../../models/POSSale';
import Product from '../../../models/Product';
import Return from '../../../models/Return';
import Expense from '../../expenses/models/Expense';
import mongoose from 'mongoose';
import {
  completedPosReturnMatch,
  indexPosSalesById,
  missingPosSaleIds,
  posNetCogs,
  posReturnMerchandiseReversal,
  yearMonthKey,
} from '../../../utils/posFinancialReporting';

/**
 * Revenue = paid orders total + POS sales total − completed POS return merchandise
 * POS sales totals include tax. Return.total_refund is merchandise-only.
 * POS COGS prefers POSSale.items[].cost_price; completed returns reverse that snapshot.
 * Gross Profit = Revenue - COGS
 * Total Expenses = sum(expense.amount) not deleted
 * Net Profit = Gross Profit - Total Expenses
 */
export async function getFinancialOverview(startDate: Date, endDate: Date): Promise<{
  total_revenue: number;
  total_cogs: number;
  gross_profit: number;
  total_expenses: number;
  net_profit: number;
  expense_percent_of_revenue: number;
  profit_margin_percent: number;
}> {
  const orderMatch = { created_at: { $gte: startDate, $lte: endDate }, payment_status: 'paid' };
  const posMatch = { created_at: { $gte: startDate, $lte: endDate } };
  const expenseMatch = {
    date: { $gte: startDate, $lte: endDate },
    $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }],
  };

  const [orderRevenue, orderCogsResult, posRevenue, posCogsResult, expenseTotal, posReturns] = await Promise.all([
    Order.aggregate([{ $match: orderMatch }, { $group: { _id: null, total: { $sum: '$total_amount' } } }]),
    getOrderCogs(startDate, endDate),
    POSSale.aggregate([{ $match: posMatch }, { $group: { _id: null, total: { $sum: '$total_amount' } } }]),
    getPOSCogs(startDate, endDate),
    Expense.aggregate([{ $match: expenseMatch }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Return.find(completedPosReturnMatch(startDate, endDate)).select('status total_refund').lean(),
  ]);

  const total_revenue =
    (orderRevenue[0]?.total || 0) + (posRevenue[0]?.total || 0) - posReturnMerchandiseReversal(posReturns);
  const total_cogs = orderCogsResult + posCogsResult;
  const gross_profit = total_revenue - total_cogs;
  const total_expenses = expenseTotal[0]?.total || 0;
  const net_profit = gross_profit - total_expenses;
  const expense_percent_of_revenue = total_revenue > 0 ? (total_expenses / total_revenue) * 100 : 0;
  const profit_margin_percent = total_revenue > 0 ? (net_profit / total_revenue) * 100 : 0;

  return {
    total_revenue,
    total_cogs,
    gross_profit,
    total_expenses,
    net_profit,
    expense_percent_of_revenue: Math.round(expense_percent_of_revenue * 100) / 100,
    profit_margin_percent: Math.round(profit_margin_percent * 100) / 100,
  };
}

async function getOrderCogs(startDate: Date, endDate: Date): Promise<number> {
  const orders = await Order.find({
    created_at: { $gte: startDate, $lte: endDate },
    payment_status: 'paid',
  })
    .select('_id')
    .lean();
  if (orders.length === 0) return 0;
  const orderIds = orders.map((o: any) => o._id);
  const items = await OrderItem.find({ order_id: { $in: orderIds } })
    .populate('product_id', 'cost_price')
    .lean();
  let cogs = 0;
  for (const item of items as any[]) {
    const qty = item.quantity || 0;
    const cost = item.product_id?.cost_price ?? 0;
    cogs += qty * cost;
  }
  return cogs;
}

async function getPOSCogs(startDate: Date, endDate: Date): Promise<number> {
  const [sales, returns] = await Promise.all([
    POSSale.find({ created_at: { $gte: startDate, $lte: endDate } }).lean(),
    Return.find(completedPosReturnMatch(startDate, endDate)).lean(),
  ]);
  const salesById = indexPosSalesById(sales as Array<{ _id?: unknown }>);
  const extraIds = missingPosSaleIds(returns as Array<{ status?: unknown; sale_id?: unknown }>, salesById)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (extraIds.length) {
    const extraSales = await POSSale.find({ _id: { $in: extraIds } }).lean();
    for (const sale of extraSales) {
      salesById.set(String(sale._id), sale);
    }
  }

  const catalogIds = new Set<string>();
  for (const sale of sales as Array<{ items?: Array<{ product_id?: unknown; cost_price?: unknown }> }>) {
    for (const item of sale.items || []) {
      if (item.cost_price != null && item.cost_price !== '' && Number.isFinite(Number(item.cost_price))) continue;
      if (item.product_id) catalogIds.add(String(item.product_id));
    }
  }
  const catalogCostMap = new Map<string, number>();
  if (catalogIds.size) {
    const objectIds = [...catalogIds]
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (objectIds.length) {
      const rows = await Product.find({ _id: { $in: objectIds } }).select('cost_price').lean();
      for (const row of rows) {
        catalogCostMap.set(String(row._id), Number((row as { cost_price?: number }).cost_price) || 0);
      }
    }
  }

  return posNetCogs(sales, returns, catalogCostMap, salesById);
}

/**
 * Revenue vs Expenses by month for bar chart
 */
export async function getRevenueVsExpensesByMonth(startDate: Date, endDate: Date): Promise<
  { month: string; revenue: number; expenses: number }[]
> {
  const [orderRev, posRev, posReturnRev, expAgg] = await Promise.all([
    Order.aggregate([
      { $match: { created_at: { $gte: startDate, $lte: endDate }, payment_status: 'paid' } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$created_at' } }, revenue: { $sum: '$total_amount' } } },
      { $sort: { _id: 1 } },
    ]),
    POSSale.aggregate([
      { $match: { created_at: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$created_at' } }, revenue: { $sum: '$total_amount' } } },
      { $sort: { _id: 1 } },
    ]),
    Return.find(completedPosReturnMatch(startDate, endDate)).select('status total_refund created_at').lean(),
    Expense.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate }, $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, expenses: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const revenueByMonth = new Map<string, number>();
  for (const r of orderRev as any[]) revenueByMonth.set(r._id, (revenueByMonth.get(r._id) || 0) + (r.revenue || 0));
  for (const r of posRev as any[]) revenueByMonth.set(r._id, (revenueByMonth.get(r._id) || 0) + (r.revenue || 0));
  for (const ret of posReturnRev as Array<{ created_at?: Date; total_refund?: number; status?: string }>) {
    if (ret.status !== 'completed') continue;
    const month = yearMonthKey(ret.created_at);
    revenueByMonth.set(month, (revenueByMonth.get(month) || 0) - (Number(ret.total_refund) || 0));
  }

  const expensesByMonth = new Map<string, number>();
  for (const e of expAgg as any[]) expensesByMonth.set(e._id, e.expenses || 0);

  const allMonths = new Set([...revenueByMonth.keys(), ...expensesByMonth.keys()]);
  return Array.from(allMonths)
    .sort()
    .map((month) => ({
      month,
      revenue: revenueByMonth.get(month) || 0,
      expenses: expensesByMonth.get(month) || 0,
    }));
}

/**
 * Monthly net profit for line chart
 */
export async function getMonthlyNetProfit(startDate: Date, endDate: Date): Promise<{ month: string; net_profit: number }[]> {
  const revVsExp = await getRevenueVsExpensesByMonth(startDate, endDate);
  return revVsExp.map(({ month, revenue, expenses }) => ({
    month,
    net_profit: revenue - expenses,
  }));
}

/**
 * Expense breakdown by expense type (free-text) for donut
 */
export async function getExpenseBreakdownByCategory(startDate: Date, endDate: Date): Promise<{ name: string; value: number }[]> {
  const agg = await Expense.aggregate([
    { $match: { date: { $gte: startDate, $lte: endDate }, $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] } },
    { $group: { _id: '$expense_type', value: { $sum: '$amount' } } },
    { $project: { name: '$_id', value: 1, _id: 0 } },
  ]);
  return (agg || []).map((r: any) => ({ name: r.name || 'Other', value: r.value || 0 }));
}

/**
 * Fixed vs variable expense comparison (no longer from categories; return 0,0 or total as variable)
 */
export async function getFixedVsVariableExpenses(startDate: Date, endDate: Date): Promise<{ fixed: number; variable: number }> {
  const agg = await Expense.aggregate([
    { $match: { date: { $gte: startDate, $lte: endDate }, $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const total = agg[0]?.total ?? 0;
  return { fixed: 0, variable: total };
}
