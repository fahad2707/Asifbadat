import PurchaseOrder from '../models/PurchaseOrder';
import Receipt from '../models/Receipt';
import CreditMemo from '../modules/credit-memo/models/CreditMemo';
import Expense from '../modules/expenses/models/Expense';

const PERIODS = ['today', 'yesterday', 'week', '2weeks', 'month', '2months', '3months', '6months', '12months', 'year'] as const;

export function cashbookWindow(period: string): { start: Date; end: Date } | null {
  if (!(PERIODS as readonly string[]).includes(period)) return null;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (period === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setTime(start.getTime());
    end.setHours(23, 59, 59, 999);
  } else if (period === 'week') start.setDate(start.getDate() - 6);
  else if (period === '2weeks') start.setDate(start.getDate() - 13);
  else if (period === 'month') start.setMonth(start.getMonth() - 1);
  else if (period === '2months') start.setMonth(start.getMonth() - 2);
  else if (period === '3months') start.setMonth(start.getMonth() - 3);
  else if (period === '6months') start.setMonth(start.getMonth() - 6);
  else if (period === '12months') start.setFullYear(start.getFullYear() - 1);
  else if (period === 'year') {
    start.setFullYear(start.getFullYear() - 1, 0, 1);
    start.setHours(0, 0, 0, 0);
    end.setFullYear(end.getFullYear() - 1, 11, 31);
    end.setHours(23, 59, 59, 999);
  }
  return { start, end };
}

function dayKey(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function round(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type CashbookLine = {
  id: string;
  date: string;
  kind: string;
  party: string;
  reference: string;
  method: string;
  amount: number;
  direction: 'in' | 'out';
};

function tallyMethods(lines: CashbookLine[]) {
  const map = new Map<string, number>();
  for (const line of lines) {
    const key = line.method || 'Other';
    map.set(key, round((map.get(key) || 0) + line.amount));
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([method, amount]) => ({ method, amount }));
}

export async function buildMoneyInStatement(period: string) {
  const window = cashbookWindow(period);
  if (!window) return null;
  const [receipts, vendorSettlements] = await Promise.all([
    Receipt.find({ trx_date: { $lte: window.end } }).sort({ trx_date: 1 }).lean(),
    CreditMemo.find({
      type: 'VENDOR',
      vendor_payment_received_at: { $ne: null, $lte: window.end },
    })
      .populate('vendor_id', 'name')
      .sort({ vendor_payment_received_at: 1 })
      .lean(),
  ]);
  const all: CashbookLine[] = [];
  for (const row of receipts) {
    const when = row.trx_date ? new Date(row.trx_date) : new Date(0);
    all.push({
      id: String(row._id),
      date: dayKey(when),
      kind: 'Customer payment',
      party: String(row.customer_name || 'Customer'),
      reference: String(row.trx_id || row.invoice_num || ''),
      method: String(row.pmt_mode || 'Cash'),
      amount: round(Number(row.amount_received) || 0),
      direction: 'in',
    });
  }
  for (const row of vendorSettlements) {
    const when = row.vendor_payment_received_at ? new Date(row.vendor_payment_received_at) : new Date(0);
    const vendor = row.vendor_id as { name?: string } | null;
    all.push({
      id: String(row._id),
      date: dayKey(when),
      kind: 'Supplier credit collected',
      party: vendor?.name || 'Supplier',
      reference: String(row.credit_memo_number || ''),
      method: String(row.vendor_payment_method || 'Cash'),
      amount: round(Number(row.total_amount) || 0),
      direction: 'in',
    });
  }
  all.sort((a, b) => a.date.localeCompare(b.date));
  let opening = 0;
  const lines: CashbookLine[] = [];
  for (const line of all) {
    const time = new Date(line.date).getTime();
    if (time < window.start.getTime()) {
      opening = round(opening + line.amount);
      continue;
    }
    if (time > window.end.getTime()) continue;
    lines.push(line);
  }
  const total = round(lines.reduce((s, l) => s + l.amount, 0));
  return {
    period,
    from: dayKey(window.start),
    to: dayKey(window.end),
    opening_balance: opening,
    total,
    closing_balance: round(opening + total),
    by_method: tallyMethods(lines),
    lines,
  };
}

export async function buildMoneyOutStatement(period: string) {
  const window = cashbookWindow(period);
  if (!window) return null;
  const [pos, expenses] = await Promise.all([
    PurchaseOrder.find({
      status: { $ne: 'cancelled' },
      'payments.0': { $exists: true },
    })
      .populate('vendor_id', 'name')
      .lean(),
    Expense.find({
      date: { $lte: window.end },
      $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }],
    })
      .sort({ date: 1 })
      .lean(),
  ]);
  const all: CashbookLine[] = [];
  for (const po of pos) {
    const vendor = po.vendor_id as { name?: string } | null;
    for (const pay of po.payments || []) {
      const when = pay.payment_date ? new Date(pay.payment_date) : new Date(0);
      all.push({
        id: `${String(po._id)}:${String(pay._id || pay.created_at || when.toISOString())}`,
        date: dayKey(when),
        kind: 'Purchase order',
        party: vendor?.name || 'Supplier',
        reference: String(po.po_number || ''),
        method: String(pay.payment_method || 'Cash'),
        amount: round(Number(pay.amount) || 0),
        direction: 'out',
      });
    }
  }
  for (const row of expenses) {
    const when = row.date ? new Date(row.date) : new Date(0);
    all.push({
      id: String(row._id),
      date: dayKey(when),
      kind: 'Bill',
      party: String(row.vendor_name || row.expense_type || 'Bill'),
      reference: String(row.expense_number || ''),
      method: String(row.payment_mode || 'Cash'),
      amount: round(Number(row.amount) || 0),
      direction: 'out',
    });
  }
  all.sort((a, b) => a.date.localeCompare(b.date));
  let opening = 0;
  const lines: CashbookLine[] = [];
  for (const line of all) {
    const time = new Date(`${line.date}T00:00:00`).getTime();
    if (time < window.start.getTime()) {
      opening = round(opening + line.amount);
      continue;
    }
    if (time > window.end.getTime()) continue;
    lines.push(line);
  }
  const total = round(lines.reduce((s, l) => s + l.amount, 0));
  return {
    period,
    from: dayKey(window.start),
    to: dayKey(window.end),
    opening_balance: opening,
    total,
    closing_balance: round(opening + total),
    by_method: tallyMethods(lines),
    lines,
  };
}

export async function listMoneyOut(limit = 500) {
  const statement = await buildMoneyOutStatement('12months');
  return (statement?.lines || []).slice(-limit).reverse();
}
