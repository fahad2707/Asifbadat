/**
 * Bank-style statements built only from stored purchase orders, their payments,
 * vendor credit memos, and expenses. Drafts and cancelled documents are listed
 * and do not move the balance.
 */

export const STATEMENT_PERIODS = ['today', 'yesterday', 'week', '2weeks', 'month', '2months', '3months', '6months', '12months', 'year'] as const;

const BOOKED_PO = new Set(['sent', 'partial', 'received']);
const SETTLED_CREDIT = new Set(['APPROVED', 'ADJUSTED', 'CLOSED']);

export function statementWindow(period: string, now = new Date()): { start: Date; end: Date } | null {
  if (!(STATEMENT_PERIODS as readonly string[]).includes(period)) return null;
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

export function statementDayKey(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

const round = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type PurchaseOrderBook = {
  id: string;
  number: string;
  vendorId: string;
  vendorName: string;
  supplierCode: string;
  contact: string;
  phone: string;
  terms: string;
  status: string;
  createdAt: Date;
  subtotal: number;
  tax: number;
  total: number;
  items: { name: string; ordered: number; received: number; unitCost: number; subtotal: number }[];
  payments: { amount: number; at: Date; method: string; reference: string }[];
};

export type VendorCreditBook = {
  number: string;
  vendorId: string;
  vendorName: string;
  supplierCode: string;
  contact: string;
  phone: string;
  terms: string;
  poNumber: string;
  reason: string;
  status: string;
  at: Date;
  merchandise: number;
  tax: number;
  total: number;
  items: { name: string; quantity: number; unitPrice: number; total: number }[];
};

export type ExpenseBook = {
  number: string;
  at: Date;
  expenseType: string;
  description: string;
  payee: string;
  paymentMode: string;
  amount: number;
  recurring: boolean;
};

type LedgerLine = {
  date: string;
  kind: string;
  ref: string;
  supplier: string;
  supplier_code: string;
  detail: string;
  debit: number;
  credit: number;
  balance: number;
};

type SupplierRow = {
  supplier: string;
  supplier_code: string;
  contact: string;
  phone: string;
  terms: string;
  opening: number;
  purchases: number;
  payments: number;
  credits: number;
  closing: number;
};

function bookedPo(status: string) {
  return BOOKED_PO.has(status);
}

function settledCredit(status: string) {
  return SETTLED_CREDIT.has(status);
}

function inRange(at: Date, start: Date, end: Date) {
  return at >= start && at <= end;
}

export function buildPurchaseBooksStatement(
  orders: PurchaseOrderBook[],
  credits: VendorCreditBook[],
  start: Date,
  end: Date
) {
  type Move = {
    at: number;
    date: string;
    kind: 'purchase' | 'payment' | 'supplier_credit';
    ref: string;
    vendorId: string;
    supplier: string;
    supplierCode: string;
    contact: string;
    phone: string;
    terms: string;
    detail: string;
    debit: number;
    credit: number;
    counts: boolean;
  };

  const moves: Move[] = [];
  for (const po of orders) {
    const counts = bookedPo(po.status);
    const itemDetail = po.items
      .map((item) => `${item.name} ${item.ordered} @ ${round(item.unitCost).toFixed(2)} (received ${item.received})`)
      .join('; ');
    moves.push({
      at: po.createdAt.getTime(),
      date: statementDayKey(po.createdAt),
      kind: 'purchase',
      ref: po.number,
      vendorId: po.vendorId,
      supplier: po.vendorName,
      supplierCode: po.supplierCode,
      contact: po.contact,
      phone: po.phone,
      terms: po.terms,
      detail: `${po.status}${itemDetail ? ` · ${itemDetail}` : ''}`,
      debit: counts ? round(po.total) : 0,
      credit: 0,
      counts,
    });
    for (const payment of po.payments) {
      moves.push({
        at: payment.at.getTime() + 1,
        date: statementDayKey(payment.at),
        kind: 'payment',
        ref: po.number,
        vendorId: po.vendorId,
        supplier: po.vendorName,
        supplierCode: po.supplierCode,
        contact: po.contact,
        phone: po.phone,
        terms: po.terms,
        detail: [payment.method, payment.reference].filter(Boolean).join(' · ') || 'Payment',
        debit: 0,
        credit: counts ? round(payment.amount) : 0,
        counts,
      });
    }
  }
  for (const credit of credits) {
    const counts = settledCredit(credit.status);
    const itemDetail = credit.items
      .map((item) => `${item.name} ${item.quantity} @ ${round(item.unitPrice).toFixed(2)}`)
      .join('; ');
    moves.push({
      at: credit.at.getTime() + 2,
      date: statementDayKey(credit.at),
      kind: 'supplier_credit',
      ref: credit.number,
      vendorId: credit.vendorId,
      supplier: credit.vendorName,
      supplierCode: credit.supplierCode,
      contact: credit.contact,
      phone: credit.phone,
      terms: credit.terms,
      detail: [credit.poNumber && `PO ${credit.poNumber}`, credit.reason, credit.status, itemDetail].filter(Boolean).join(' · '),
      debit: 0,
      credit: counts ? round(credit.total) : 0,
      counts,
    });
  }
  moves.sort((a, b) => a.at - b.at || a.ref.localeCompare(b.ref));

  let opening = 0;
  for (const move of moves) {
    if (!move.counts || move.at >= start.getTime()) continue;
    opening = round(opening + move.debit - move.credit);
  }

  const supplier = new Map<string, SupplierRow & { openingMoves: number; period: { purchases: number; payments: number; credits: number } }>();
  const touch = (move: Move) => {
    const current = supplier.get(move.vendorId) || {
      supplier: move.supplier || '—',
      supplier_code: move.supplierCode || '',
      contact: move.contact || '',
      phone: move.phone || '',
      terms: move.terms || '',
      opening: 0,
      purchases: 0,
      payments: 0,
      credits: 0,
      closing: 0,
      openingMoves: 0,
      period: { purchases: 0, payments: 0, credits: 0 },
    };
    if (move.supplier) current.supplier = move.supplier;
    if (move.supplierCode) current.supplier_code = move.supplierCode;
    if (move.contact) current.contact = move.contact;
    if (move.phone) current.phone = move.phone;
    if (move.terms) current.terms = move.terms;
    supplier.set(move.vendorId, current);
    return current;
  };

  for (const move of moves) {
    if (!move.counts || move.at >= start.getTime()) continue;
    const row = touch(move);
    row.openingMoves = round(row.openingMoves + move.debit - move.credit);
  }

  let purchases = 0;
  let payments = 0;
  let supplierCredits = 0;
  let running = opening;
  const ledger: LedgerLine[] = [];
  for (const move of moves) {
    if (move.at < start.getTime() || move.at > end.getTime()) continue;
    const row = touch(move);
    if (move.counts) {
      running = round(running + move.debit - move.credit);
      if (move.kind === 'purchase') {
        purchases = round(purchases + move.debit);
        row.period.purchases = round(row.period.purchases + move.debit);
      } else if (move.kind === 'payment') {
        payments = round(payments + move.credit);
        row.period.payments = round(row.period.payments + move.credit);
      } else {
        supplierCredits = round(supplierCredits + move.credit);
        row.period.credits = round(row.period.credits + move.credit);
      }
    }
    ledger.push({
      date: move.date,
      kind: move.kind,
      ref: move.ref,
      supplier: move.supplier,
      supplier_code: move.supplierCode,
      detail: move.detail,
      debit: move.debit,
      credit: move.credit,
      balance: move.counts ? running : running,
    });
  }

  const suppliers: SupplierRow[] = [...supplier.values()]
    .map((row) => ({
      supplier: row.supplier,
      supplier_code: row.supplier_code,
      contact: row.contact,
      phone: row.phone,
      terms: row.terms,
      opening: row.openingMoves,
      purchases: row.period.purchases,
      payments: row.period.payments,
      credits: row.period.credits,
      closing: round(row.openingMoves + row.period.purchases - row.period.payments - row.period.credits),
    }))
    .filter((row) => row.opening || row.purchases || row.payments || row.credits)
    .sort((a, b) => a.supplier.localeCompare(b.supplier));

  const purchase_orders = orders
    .filter((po) => inRange(po.createdAt, start, end) || stillOpen(po, credits, end))
    .map((po) => {
      const paid = po.payments.filter((payment) => payment.at <= end).reduce((sum, payment) => sum + payment.amount, 0);
      const credited = credits
        .filter((credit) => credit.poNumber && credit.poNumber === po.number && settledCredit(credit.status) && credit.at <= end)
        .reduce((sum, credit) => sum + credit.total, 0);
      const counts = bookedPo(po.status);
      const balance = counts ? round(po.total - paid - credited) : 0;
      return {
        date: statementDayKey(po.createdAt),
        number: po.number,
        supplier: po.vendorName,
        supplier_code: po.supplierCode,
        status: po.status,
        on_books: counts,
        items: po.items.map((item) => ({
          name: item.name,
          ordered: item.ordered,
          received: item.received,
          unit_cost: round(item.unitCost),
          subtotal: round(item.subtotal),
        })),
        subtotal: round(po.subtotal),
        tax: round(po.tax),
        total: round(po.total),
        paid: round(paid),
        credited: round(credited),
        balance,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));

  const credit_memos = credits
    .filter((credit) => inRange(credit.at, start, end))
    .map((credit) => ({
      date: statementDayKey(credit.at),
      number: credit.number,
      supplier: credit.vendorName,
      supplier_code: credit.supplierCode,
      po: credit.poNumber,
      reason: credit.reason,
      status: credit.status,
      on_books: settledCredit(credit.status),
      items: credit.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unit_price: round(item.unitPrice),
        total: round(item.total),
      })),
      merchandise: round(credit.merchandise),
      tax: round(credit.tax),
      total: round(credit.total),
    }));

  return {
    from: statementDayKey(start),
    to: statementDayKey(end),
    opening_owed: opening,
    purchases,
    payments,
    supplier_credits: supplierCredits,
    closing_owed: round(opening + purchases - payments - supplierCredits),
    suppliers,
    ledger,
    purchase_orders,
    credit_memos,
  };
}

function stillOpen(po: PurchaseOrderBook, credits: VendorCreditBook[], end: Date) {
  if (!bookedPo(po.status) || po.createdAt > end) return false;
  const paid = po.payments.filter((payment) => payment.at <= end).reduce((sum, payment) => sum + payment.amount, 0);
  const credited = credits
    .filter((credit) => credit.poNumber === po.number && settledCredit(credit.status) && credit.at <= end)
    .reduce((sum, credit) => sum + credit.total, 0);
  return round(po.total - paid - credited) > 0;
}

export function buildExpenseStatement(expenses: ExpenseBook[], start: Date, end: Date) {
  const sorted = [...expenses].sort((a, b) => a.at.getTime() - b.at.getTime() || a.number.localeCompare(b.number));
  let opening = 0;
  for (const expense of sorted) {
    if (expense.at < start) opening = round(opening + expense.amount);
  }
  let spent = 0;
  let running = opening;
  const lines = [];
  const byType = new Map<string, number>();
  for (const expense of sorted) {
    if (!inRange(expense.at, start, end)) continue;
    spent = round(spent + expense.amount);
    running = round(running + expense.amount);
    byType.set(expense.expenseType || 'Other', round((byType.get(expense.expenseType || 'Other') || 0) + expense.amount));
    lines.push({
      date: statementDayKey(expense.at),
      number: expense.number,
      expense_type: expense.expenseType,
      description: expense.description,
      payee: expense.payee,
      payment_mode: expense.paymentMode,
      recurring: expense.recurring,
      amount: round(expense.amount),
      balance: running,
    });
  }
  const categories = [...byType.entries()]
    .map(([expense_type, amount]) => ({ expense_type, amount }))
    .sort((a, b) => b.amount - a.amount || a.expense_type.localeCompare(b.expense_type));
  return {
    from: statementDayKey(start),
    to: statementDayKey(end),
    opening_spent: opening,
    spent,
    closing_spent: round(opening + spent),
    categories,
    lines,
  };
}
