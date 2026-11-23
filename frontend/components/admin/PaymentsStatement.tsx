'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { formatApiError } from '@/lib/format-api-error';
import { adminUi } from '@/lib/admin-ui';

export const PAYMENT_PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last week' },
  { id: '2weeks', label: 'Last 2 weeks' },
  { id: 'month', label: 'Last month' },
  { id: '2months', label: 'Last 2 months' },
  { id: '3months', label: 'Last 3 months' },
  { id: '6months', label: 'Last 6 months' },
  { id: '12months', label: 'Last 12 months' },
  { id: 'year', label: 'Last year' },
] as const;

type Line = {
  date: string;
  reference: string;
  customer: string;
  invoice: string;
  type: 'full' | 'partial' | null;
  method: string;
  amount: number;
  deposit: string;
  remaining: number | null;
  balance: number;
};

type Statement = {
  period: string;
  from: string;
  to: string;
  opening_balance: number;
  payments_received: number;
  deposited: number;
  not_deposited: number;
  closing_balance: number;
  lines: Line[];
};

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

function csvCell(value: string | number) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function download(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function PaymentsStatement({ period, onClose }: { period: string; onClose: () => void }) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const label = PAYMENT_PERIODS.find((item) => item.id === period)?.label || period;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi.get<Statement>('/receipts/statement', { params: { period } })
      .then((res) => { if (!cancelled) setStatement(res.data); })
      .catch((err) => { if (!cancelled) setError(formatApiError(err, 'Could not build the statement')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const exportCsv = () => {
    if (!statement) return;
    const rows = [
      ['Payments statement', label, statement.from, statement.to],
      ['Opening', statement.opening_balance],
      ['Received', statement.payments_received],
      ['Deposited', statement.deposited],
      ['Not deposited', statement.not_deposited],
      ['Closing', statement.closing_balance],
      [],
      ['Date', 'Reference', 'Customer', 'Invoice', 'Type', 'Method', 'Amount', 'Deposit', 'Remaining', 'Balance'],
      ...statement.lines.map((line) => [line.date, line.reference, line.customer, line.invoice, line.type || '', line.method, line.amount, line.deposit, line.remaining ?? '', line.balance]),
    ];
    download(`payments-${statement.from}-to-${statement.to}.csv`, rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  };

  const saveHtml = () => {
    const node = document.querySelector('.payments-statement-paper');
    if (!node || !statement) return;
    download(`payments-${statement.from}-to-${statement.to}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>Payments ${statement.from} to ${statement.to}</title><style>body{font-family:Georgia,serif;padding:32px;color:#1a1a1a}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e3e5e8;padding:6px 8px;text-align:left}td.num,th.num{text-align:right}</style></head><body>${node.innerHTML}</body></html>`, 'text/html;charset=utf-8');
  };

  return createPortal(
    <div className="payments-statement-root fixed inset-0 z-[80] flex flex-col bg-[#E7E8EA]">
      <style>{`@media print { body * { visibility: hidden !important; } .payments-statement-root, .payments-statement-root * { visibility: visible !important; } .payments-statement-root { position: absolute; inset: 0; background: white; } .payments-statement-toolbar { display: none !important; } }`}</style>
      <div className="payments-statement-toolbar flex shrink-0 items-center justify-between gap-3 border-b border-[#E3E5E8] bg-white px-5 py-3">
        <p className="text-sm font-medium text-[#1A1A1A]">Payments statement · {label}</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => window.print()} disabled={!statement} className={`${adminUi.btnPrimary} disabled:opacity-50`}><Printer className="w-4 h-4" />Print</button>
          <button type="button" onClick={saveHtml} disabled={!statement} className={`${adminUi.btnSecondary} disabled:opacity-50`}>Save</button>
          <button type="button" onClick={exportCsv} disabled={!statement} className={`${adminUi.btnSecondary} disabled:opacity-50`}><Download className="w-4 h-4" />Export CSV</button>
          <button type="button" onClick={onClose} className={adminUi.btnIcon} aria-label="Close statement"><X className="w-5 h-5" /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {loading ? <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-black border-t-transparent" /></div>
          : error ? <p className="mx-auto max-w-lg rounded-md bg-white p-6 text-sm">{error}</p>
          : statement ? (
            <article className="payments-statement-paper mx-auto max-w-5xl bg-white px-8 py-8 shadow-sm">
              <p className="text-xs uppercase tracking-[0.16em] text-[#6B6C72]">Express Distributors</p>
              <h1 className="mt-1 text-2xl text-[#1A1A1A]">Payments statement</h1>
              <p className="mt-1 text-sm text-[#6B6C72]">{label} · {statement.from} through {statement.to}</p>
              <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#E3E5E8] bg-[#E3E5E8] md:grid-cols-5">
                {[
                  ['Opening', statement.opening_balance],
                  ['Received', statement.payments_received],
                  ['Deposited', statement.deposited],
                  ['Not deposited', statement.not_deposited],
                  ['Closing', statement.closing_balance],
                ].map(([name, amount]) => (
                  <div key={String(name)} className="bg-white px-4 py-3">
                    <p className="text-xs text-[#6B6C72]">{name}</p>
                    <p className="mt-1 text-lg tabular-nums">{money(Number(amount))}</p>
                  </div>
                ))}
              </div>
              <table className="mt-8 w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1A1A1A] text-left text-xs uppercase text-[#6B6C72]">
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Reference</th>
                    <th className="py-2 pr-2">Customer</th>
                    <th className="py-2 pr-2">Invoice</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Method</th>
                    <th className="py-2 pr-2 text-right">Amount</th>
                    <th className="py-2 pr-2">Deposit</th>
                    <th className="py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#E3E5E8]"><td className="py-2" colSpan={8}>Opening balance</td><td className="py-2 text-right tabular-nums">{money(statement.opening_balance)}</td></tr>
                  {statement.lines.length === 0 ? <tr><td colSpan={9} className="py-4 text-[#6B6C72]">No payments in this range.</td></tr> : statement.lines.map((line) => (
                    <tr key={`${line.reference}-${line.invoice}`} className="border-b border-[#E3E5E8]">
                      <td className="py-2 pr-2 whitespace-nowrap">{line.date}</td>
                      <td className="py-2 pr-2">{line.reference}</td>
                      <td className="py-2 pr-2">{line.customer || '—'}</td>
                      <td className="py-2 pr-2">{line.invoice || '—'}</td>
                      <td className="py-2 pr-2 capitalize">{line.type || '—'}</td>
                      <td className="py-2 pr-2">{line.method || '—'}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(line.amount)}</td>
                      <td className="py-2 pr-2 capitalize">{line.deposit === 'deposited' ? 'Deposited' : line.deposit === 'pending' ? 'Not deposited' : line.deposit}</td>
                      <td className="py-2 text-right tabular-nums">{money(line.balance)}</td>
                    </tr>
                  ))}
                  <tr><td className="py-2 font-medium" colSpan={6}>Closing balance</td><td className="py-2 text-right font-medium tabular-nums">{money(statement.payments_received)}</td><td /><td className="py-2 text-right font-medium tabular-nums">{money(statement.closing_balance)}</td></tr>
                </tbody>
              </table>
            </article>
          ) : null}
      </div>
    </div>,
    document.body
  );
}
