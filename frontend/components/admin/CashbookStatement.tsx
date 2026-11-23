'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import { formatApiError } from '@/lib/format-api-error';
import { PAYMENT_PERIODS } from '@/components/admin/PaymentsStatement';

type Line = { date: string; kind: string; party: string; reference: string; method: string; amount: number };
type Statement = {
  from: string;
  to: string;
  opening_balance: number;
  total: number;
  closing_balance: number;
  by_method: Array<{ method: string; amount: number }>;
  lines: Line[];
};

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

export default function CashbookStatement({
  period,
  direction,
  onClose,
}: {
  period: string;
  direction: 'in' | 'out';
  onClose: () => void;
}) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const label = PAYMENT_PERIODS.find((item) => item.id === period)?.label || period;
  const title = direction === 'in' ? 'Money received' : 'Money paid';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi
      .get<Statement>(direction === 'in' ? '/banking/money-in/statement' : '/banking/money-out/statement', { params: { period } })
      .then((res) => {
        if (!cancelled) setStatement(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(formatApiError(err, 'Could not build the statement'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, direction]);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#E7E8EA]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E3E5E8] bg-white px-5 py-3">
        <p className="text-sm font-medium text-[#1A1A1A]">{title} · {label}</p>
        <button type="button" onClick={onClose} className={adminUi.btnIcon} aria-label="Close statement"><X className="w-5 h-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {loading ? <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-black border-t-transparent" /></div>
          : error ? <p className="mx-auto max-w-lg rounded-md bg-white p-6 text-sm">{error}</p>
          : statement ? (
            <article className="mx-auto max-w-5xl bg-white px-8 py-8 shadow-sm">
              <h1 className="text-2xl text-[#1A1A1A]">{title}</h1>
              <p className="mt-1 text-sm text-[#6B6C72]">{statement.from} through {statement.to}</p>
              <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-[#E3E5E8] bg-[#E3E5E8]">
                {[['Opening', statement.opening_balance], ['Total', statement.total], ['Closing', statement.closing_balance]].map(([name, amount]) => (
                  <div key={String(name)} className="bg-white px-4 py-3">
                    <p className="text-xs text-[#6B6C72]">{name}</p>
                    <p className="mt-1 text-lg tabular-nums">{money(Number(amount))}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                {(statement.by_method || []).map((row) => (
                  <span key={row.method} className="rounded-md border border-[#E3E5E8] px-3 py-1">{row.method}: {money(row.amount)}</span>
                ))}
              </div>
              <table className="mt-8 w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1A1A1A] text-left text-xs uppercase text-[#6B6C72]">
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Party</th>
                    <th className="py-2 pr-2">Reference</th>
                    <th className="py-2 pr-2">Method</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.lines.length === 0 ? <tr><td colSpan={6} className="py-4 text-[#6B6C72]">No rows in this range.</td></tr> : statement.lines.map((line) => (
                    <tr key={`${line.reference}-${line.date}-${line.amount}`} className="border-b border-[#E3E5E8]">
                      <td className="py-2 pr-2 whitespace-nowrap">{line.date}</td>
                      <td className="py-2 pr-2">{line.kind}</td>
                      <td className="py-2 pr-2">{line.party}</td>
                      <td className="py-2 pr-2">{line.reference}</td>
                      <td className="py-2 pr-2">{line.method}</td>
                      <td className="py-2 text-right tabular-nums">{money(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ) : null}
      </div>
    </div>,
    document.body
  );
}
