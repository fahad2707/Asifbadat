'use client';

import { useEffect, useState } from 'react';
import adminApi from '@/lib/admin-api';
import { formatApiError } from '@/lib/format-api-error';
import { STATEMENT_PERIODS, type StatementPeriod } from '@/components/admin/statementPeriods';
import StatementFrame, { csvCell, downloadText, saveStatementHtml } from '@/components/admin/StatementFrame';

type Statement = {
  from: string;
  to: string;
  opening_spent: number;
  spent: number;
  closing_spent: number;
  categories: { expense_type: string; amount: number }[];
  lines: { date: string; number: string; expense_type: string; description: string; payee: string; payment_mode: string; recurring: boolean; amount: number; balance: number }[];
};

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

export default function ExpenseStatement({ period, onClose }: { period: StatementPeriod; onClose: () => void }) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const label = STATEMENT_PERIODS.find((item) => item.id === period)?.label || period;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi.get<Statement>('/expenses/statement', { params: { period } })
      .then((res) => { if (!cancelled) setStatement(res.data); })
      .catch((err) => { if (!cancelled) setError(formatApiError(err, 'Could not build the expense statement')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const exportCsv = () => {
    if (!statement) return;
    const rows = [
      ['Expense statement', label, statement.from, statement.to],
      ['Opening spent', statement.opening_spent],
      ['Spent this period', statement.spent],
      ['Closing spent', statement.closing_spent],
      [],
      ['Type', 'Amount'],
      ...statement.categories.map((row) => [row.expense_type, row.amount]),
      [],
      ['Date', 'Number', 'Type', 'Description', 'Payee', 'Payment mode', 'Recurring', 'Amount', 'Balance'],
      ...statement.lines.map((line) => [line.date, line.number, line.expense_type, line.description, line.payee, line.payment_mode, line.recurring ? 'yes' : 'no', line.amount, line.balance]),
    ];
    downloadText(`expenses-${statement.from}-to-${statement.to}.csv`, rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  };

  return (
    <StatementFrame
      title={`Expense statement · ${label}`}
      paperClass="expense-statement-paper"
      ready={Boolean(statement)}
      onSave={() => statement && saveStatementHtml('expense-statement-paper', `expenses-${statement.from}-to-${statement.to}.html`, 'Expense statement')}
      onCsv={exportCsv}
      onClose={onClose}
    >
      {loading ? <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-black border-t-transparent" /></div>
        : error ? <p className="mx-auto max-w-lg rounded-md bg-white p-6 text-sm">{error}</p>
        : statement ? (
          <article className="expense-statement-paper mx-auto max-w-6xl bg-white px-8 py-8 shadow-sm">
            <p className="text-xs uppercase tracking-[0.16em] text-[#6B6C72]">Express Distributors</p>
            <h1 className="mt-1 text-2xl text-[#1A1A1A]">Expense statement</h1>
            <p className="mt-1 text-sm text-[#6B6C72]">{label} · {statement.from} through {statement.to}</p>
            <div className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-[#E3E5E8] bg-[#E3E5E8] md:grid-cols-3">
              {[
                ['Opening spent', statement.opening_spent],
                ['Spent this period', statement.spent],
                ['Closing spent', statement.closing_spent],
              ].map(([name, amount]) => (
                <div key={String(name)} className="bg-white px-4 py-3">
                  <p className="text-xs text-[#6B6C72]">{name}</p>
                  <p className="mt-1 text-lg tabular-nums">{money(Number(amount))}</p>
                </div>
              ))}
            </div>
            <section className="mt-8">
              <h2 className="text-sm font-medium uppercase tracking-[0.12em] text-[#6B6C72]">By type</h2>
              <table className="mt-3 w-full text-sm">
                <thead><tr className="border-b border-[#1A1A1A] text-left text-xs uppercase text-[#6B6C72]"><th className="py-2">Type</th><th className="py-2 text-right">Amount</th></tr></thead>
                <tbody>
                  {statement.categories.length === 0 ? <tr><td colSpan={2} className="py-4 text-[#6B6C72]">No expenses in this period.</td></tr> : statement.categories.map((row) => (
                    <tr key={row.expense_type} className="border-b border-[#E3E5E8]"><td className="py-2">{row.expense_type}</td><td className="py-2 text-right tabular-nums">{money(row.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="mt-8">
              <h2 className="text-sm font-medium uppercase tracking-[0.12em] text-[#6B6C72]">Account</h2>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1A1A1A] text-left text-xs uppercase text-[#6B6C72]">
                    <th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Particulars</th><th className="py-2 pr-2">Payee</th><th className="py-2 pr-2">Paid by</th><th className="py-2 pr-2 text-right">Spent</th><th className="py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#E3E5E8]"><td className="py-2" colSpan={5}>Opening spent</td><td className="py-2 text-right tabular-nums">{money(statement.opening_spent)}</td></tr>
                  {statement.lines.length === 0 ? <tr><td colSpan={6} className="py-4 text-[#6B6C72]">No expenses in this period.</td></tr> : statement.lines.map((line) => (
                    <tr key={line.number} className="border-b border-[#E3E5E8]">
                      <td className="py-2 pr-2 whitespace-nowrap">{line.date}</td>
                      <td className="py-2 pr-2">{line.number} · {line.expense_type}{line.description ? <span className="block text-xs text-[#6B6C72]">{line.description}</span> : null}{line.recurring ? <span className="block text-xs text-[#6B6C72]">Recurring</span> : null}</td>
                      <td className="py-2 pr-2">{line.payee || '—'}</td>
                      <td className="py-2 pr-2">{line.payment_mode || '—'}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(line.amount)}</td>
                      <td className="py-2 text-right tabular-nums">{money(line.balance)}</td>
                    </tr>
                  ))}
                  <tr><td className="py-2 font-medium" colSpan={4}>Closing spent</td><td className="py-2 text-right font-medium tabular-nums">{money(statement.spent)}</td><td className="py-2 text-right font-medium tabular-nums">{money(statement.closing_spent)}</td></tr>
                </tbody>
              </table>
            </section>
          </article>
        ) : null}
    </StatementFrame>
  );
}
