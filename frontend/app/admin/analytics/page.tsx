'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import adminApi from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import toast from 'react-hot-toast';
import { FileDown, FileText, DollarSign, TrendingDown, TrendingUp, Wallet, Percent } from 'lucide-react';

interface SalesData {
  date: string;
  revenue: number;
  orders?: number;
  sales?: number;
}

interface CategorySales {
  category: string;
  revenue: number;
  quantity: number;
}

interface FinancialOverview {
  total_revenue: number;
  total_cogs: number;
  gross_profit: number;
  total_expenses: number;
  net_profit: number;
  expense_percent_of_revenue: number;
  profit_margin_percent: number;
}

const CHART_COLORS = ['#14b8a6', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#d946ef', '#06b6d4', '#84cc16'];

function downloadCSV(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function AnalyticsPage() {
  const [salesData, setSalesData] = useState<SalesData[]>([]);
  const [categorySales, setCategorySales] = useState<CategorySales[]>([]);
  const [period, setPeriod] = useState('30');
  const [reportPeriod, setReportPeriod] = useState('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [loading, setLoading] = useState(true);
  const [financialOverview, setFinancialOverview] = useState<FinancialOverview | null>(null);
  const [revenueVsExpenses, setRevenueVsExpenses] = useState<{ month: string; revenue: number; expenses: number }[]>([]);
  const [monthlyNetProfit, setMonthlyNetProfit] = useState<{ month: string; net_profit: number }[]>([]);
  const [expenseBreakdown, setExpenseBreakdown] = useState<{ name: string; value: number }[]>([]);
  const [fixedVsVariable, setFixedVsVariable] = useState<{ fixed: number; variable: number }>({ fixed: 0, variable: 0 });

  const reportParams = () => {
    if (reportPeriod === 'custom' && customStart && customEnd) {
      return { start: customStart, end: customEnd };
    }
    return { period: reportPeriod };
  };

  useEffect(() => {
    fetchAnalytics();
  }, [period]);

  useEffect(() => {
    fetchFinancialReports();
  }, [reportPeriod, customStart, customEnd]);

  const fetchAnalytics = async () => {
    try {
      const salesResponse = await adminApi.get('/analytics/sales', { params: { period, groupBy: 'day' } });
      const onlineMap = new Map((salesResponse.data.onlineSales || []).map((s: SalesData) => [s.date, s.revenue || 0]));
      const offlineMap = new Map((salesResponse.data.offlineSales || []).map((s: SalesData) => [s.date, s.revenue || 0]));
      const allDates = new Set([
        ...(salesResponse.data.onlineSales || []).map((s: SalesData) => s.date),
        ...(salesResponse.data.offlineSales || []).map((s: SalesData) => s.date),
      ]);
      const combined: SalesData[] = Array.from(allDates).map((date) => {
        const o = onlineMap.get(date);
        const f = offlineMap.get(date);
        return {
          date,
          revenue: (typeof o === 'number' ? o : 0) + (typeof f === 'number' ? f : 0),
        };
      });
      setSalesData(combined.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
      setCategorySales(salesResponse.data.categorySales || []);
    } catch (error: any) {
      if (isAdminAuthRedirectError(error)) {
        return;
      }
      toast.error(error.response?.data?.error || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  const fetchFinancialReports = async () => {
    try {
      const params = reportParams();
      const [overview, revVsExp, netProfit, breakdown, fixedVar] = await Promise.all([
        adminApi.get('/reports/financial-overview', { params }),
        adminApi.get('/reports/revenue-vs-expenses', { params }),
        adminApi.get('/reports/monthly-net-profit', { params }),
        adminApi.get('/reports/expense-breakdown', { params }),
        adminApi.get('/reports/fixed-vs-variable-expenses', { params }),
      ]);
      setFinancialOverview(overview.data);
      setRevenueVsExpenses(revVsExp.data.data || []);
      setMonthlyNetProfit(netProfit.data.data || []);
      setExpenseBreakdown(breakdown.data.data || []);
      setFixedVsVariable(fixedVar.data.data || { fixed: 0, variable: 0 });
    } catch (e: any) {
      if (isAdminAuthRedirectError(e)) {
        return;
      }
      console.error('Financial reports:', e);
      setFinancialOverview(null);
      setRevenueVsExpenses([]);
      setMonthlyNetProfit([]);
      setExpenseBreakdown([]);
    }
  };

  const handleExportCSV = () => {
    if (!financialOverview) return;
    const rows = [
      ['Metric', 'Value'],
      ['Total Revenue', String(financialOverview.total_revenue)],
      ['Total COGS', String(financialOverview.total_cogs)],
      ['Gross Profit', String(financialOverview.gross_profit)],
      ['Total Expenses', String(financialOverview.total_expenses)],
      ['Net Profit', String(financialOverview.net_profit)],
      ['Expense % of Revenue', String(financialOverview.expense_percent_of_revenue) + '%'],
      ['Profit Margin %', String(financialOverview.profit_margin_percent) + '%'],
    ];
    downloadCSV(`financial-report-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success('CSV downloaded');
  };

  const handleExportPDF = () => {
    window.print();
  };

  // Custom Chart Style configurations
  const glassPanelClass = `bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-5`;
  const customTooltip = {
    contentStyle: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderColor: 'rgba(255,255,255,0.08)',
      borderRadius: '12px',
      fontSize: '11px',
      color: '#fff',
      boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
    },
    itemStyle: { color: '#fff' },
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-2">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Ledger Reports &amp; Analytics</h1>
          <p className="text-slate-400 text-xs mt-1">B2B Financial Overview, Gross Profit Margins, &amp; Operating Cost Trends.</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <select
            value={reportPeriod}
            onChange={(e) => setReportPeriod(e.target.value)}
            className="px-3.5 py-2.5 bg-slate-950/60 border border-white/10 rounded-xl text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-teal-500 cursor-pointer"
          >
            <option value="this_month">This Month</option>
            <option value="last_month">Last Month</option>
            <option value="90">Last 90 Days</option>
            <option value="365">Last Year</option>
            <option value="custom">Custom Range</option>
          </select>
          {reportPeriod === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="px-3.5 py-2 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-white focus:outline-none" />
              <span className="text-slate-500 text-xs">—</span>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="px-3.5 py-2 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-white focus:outline-none" />
            </div>
          )}
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-b from-white/[0.10] to-white/[0.02] border border-white/[0.08] hover:bg-white/[0.06] active:scale-[0.98] rounded-xl text-xs font-semibold text-white transition-all cursor-pointer"
          >
            <FileDown className="w-4 h-4 text-teal-400" /> Export CSV
          </button>
          <button
            onClick={handleExportPDF}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-b from-white/[0.10] to-white/[0.02] border border-white/[0.08] hover:bg-white/[0.06] active:scale-[0.98] rounded-xl text-xs font-semibold text-white transition-all cursor-pointer"
          >
            <FileText className="w-4 h-4 text-emerald-400" /> Print / PDF
          </button>
        </div>
      </div>

      {/* Financial Overview Cards */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Financial Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          
          <div className={glassPanelClass}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                <DollarSign className="w-5 h-5 text-emerald-450" />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Total Revenue</span>
                <span className="text-lg font-black text-white block mt-1">
                  ${financialOverview ? Number(financialOverview.total_revenue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className={glassPanelClass}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                <TrendingDown className="w-5 h-5 text-amber-450" />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Total COGS</span>
                <span className="text-lg font-black text-white block mt-1">
                  ${financialOverview ? Number(financialOverview.total_cogs).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className={glassPanelClass}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                <TrendingUp className="w-5 h-5 text-blue-450" />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Gross Profit</span>
                <span className="text-lg font-black text-white block mt-1">
                  ${financialOverview ? Number(financialOverview.gross_profit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className={glassPanelClass}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5 text-rose-455" />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Total Expenses</span>
                <span className="text-lg font-black text-white block mt-1">
                  ${financialOverview ? Number(financialOverview.total_expenses).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className={glassPanelClass}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center shrink-0">
                <Percent className="w-5 h-5 text-teal-400" />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Net Profit</span>
                <span className={`text-lg font-black block mt-1 ${financialOverview && financialOverview.net_profit < 0 ? 'text-rose-400' : 'text-white'}`}>
                  ${financialOverview ? Number(financialOverview.net_profit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                </span>
                {financialOverview && (
                  <p className="text-[10px] text-slate-450 mt-1 font-semibold leading-relaxed">
                    Margin: {financialOverview.profit_margin_percent}% <br /> Expense ratio: {financialOverview.expense_percent_of_revenue}%
                  </p>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        <div className={glassPanelClass}>
          <h3 className="text-sm font-bold text-white mb-4">Revenue vs Expenses (Bar)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={revenueVsExpenses}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="month" stroke="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace" />
              <YAxis stroke="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace" />
              <Tooltip {...customTooltip} />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
              <Bar dataKey="revenue" fill="#14b8a6" name="Revenue" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" fill="#f43f5e" name="Expenses" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className={glassPanelClass}>
          <h3 className="text-sm font-bold text-white mb-4">Monthly Net Profit (Line)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={monthlyNetProfit}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="month" stroke="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace" />
              <YAxis stroke="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace" />
              <Tooltip {...customTooltip} />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
              <Line type="monotone" dataKey="net_profit" stroke="#10b981" strokeWidth={2.5} name="Net Profit" activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className={glassPanelClass}>
          <h3 className="text-sm font-bold text-white mb-4">Expense Breakdown by Category (Donut)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={expenseBreakdown}
                dataKey="value"
                nameKey="name"
                cx="55%"
                cy="50%"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={3}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {expenseBreakdown.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} className="focus:outline-none" />
                ))}
              </Pie>
              <Legend layout="vertical" verticalAlign="middle" align="left" wrapperStyle={{ fontSize: '10px', color: '#94a3b8' }} />
              <Tooltip formatter={(v: number) => [`$${Number(v).toLocaleString()}`, 'Amount']} {...customTooltip} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className={glassPanelClass}>
          <h3 className="text-sm font-bold text-white mb-4">Fixed vs Variable Expenses</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={[
                { name: 'Fixed cost', amount: fixedVsVariable.fixed },
                { name: 'Variable cost', amount: fixedVsVariable.variable },
              ]}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" stroke="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace" />
              <YAxis stroke="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace" />
              <Tooltip {...customTooltip} />
              <Bar dataKey="amount" name="Cost Amount" radius={[4, 4, 0, 0]}>
                <Cell fill="#06b6d4" />
                <Cell fill="#f59e0b" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

      </div>

      {/* Original Revenue & Category Sales */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-4 border-t border-white/5">
        <h2 className="text-sm font-bold text-white uppercase tracking-widest">Store Sales Analytics</h2>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="px-3.5 py-2 bg-slate-950/60 border border-white/10 rounded-xl text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-teal-500 cursor-pointer w-full sm:w-auto"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center h-64 items-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-teal-500 border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className={glassPanelClass}>
            <h2 className="text-sm font-bold mb-4 text-white">Revenue Trend</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={salesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace" />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace" />
                <Tooltip {...customTooltip} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Line type="monotone" dataKey="revenue" stroke="#0ea5e9" strokeWidth={2} name="Total Daily Revenue" activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className={glassPanelClass}>
            <h2 className="text-sm font-bold mb-4 text-white">Daily Category Sales Map</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categorySales}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="category" stroke="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace" />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace" />
                <Tooltip {...customTooltip} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Bar dataKey="revenue" fill="#14b8a6" name="Revenue Category Map" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] rounded-2xl shadow-xl overflow-hidden p-5">
            <h2 className="text-sm font-bold mb-4 text-white uppercase tracking-wider">Category Revenue Listings</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-semibold">
                <thead>
                  <tr className="border-b border-white/5 text-slate-400">
                    <th className="text-left py-2.5 px-4 font-bold tracking-wider uppercase text-[10px]">Category taxonomy</th>
                    <th className="text-right py-2.5 px-4 font-bold tracking-wider uppercase text-[10px]">Generated Revenue</th>
                    <th className="text-right py-2.5 px-4 font-bold tracking-wider uppercase text-[10px]">Contract Quantity Sold</th>
                  </tr>
                </thead>
                <tbody>
                  {categorySales.map((cat, idx) => (
                    <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-3 px-4 text-white font-bold">{cat.category || 'Uncategorized items'}</td>
                      <td className="py-3 px-4 text-right font-bold text-slate-200">
                        ${parseFloat(cat.revenue.toString()).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-350">{cat.quantity.toLocaleString()} units</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
