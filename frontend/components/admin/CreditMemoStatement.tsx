'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { formatApiError } from '@/lib/format-api-error';
import { adminUi } from '@/lib/admin-ui';

export const CREDIT_PERIODS = [
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
  memo: string;
  customer: string;
  company: string;
  invoice: string;
  reason: string;
  item: string;
  quantity: number;
  unit_price: number;
  merchandise: number;
  tax: number;
  credit: number;
  status: string;
  settlement: string;
  we_owe: number;
  balance: number;
};

type Statement = {
  period: string;
  type: string;
  from: string;
  to: string;
  opening_owed: number;
  credits_issued: number;
  settled: number;
  still_owed: number;
  closing_owed: number;
  lines: Line[];
};

const money = (n: number) => {
  const value = Number(n || 0);
  const body = `$${Math.abs(value).toFixed(2)}`;
  return value < 0 ? `-${body}` : body;
};

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

export default function CreditMemoStatement({
  period,
  type,
  onClose,
}: {
  period: string;
  type: 'CUSTOMER' | 'VENDOR';
  onClose: () => void;
}) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const label = CREDIT_PERIODS.find((item) => item.id === period)?.label || period;
  const party = type === 'VENDOR' ? 'Vendor' : 'Customer';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi.get<Statement>('/credit-memos/statement', { params: { period, type } })
      .then((res) => { if (!cancelled) setStatement(res.data); })
      .catch((err) => { if (!cancelled) setError(formatApiError(err, 'Could not build the statement')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, type]);

  const exportCsv = () => {
    if (!statement) return;
    const rows = [
      ['Credit memo statement', label, statement.from, statement.to],
      ['Opening owed', statement.opening_owed],
      ['Credits issued', statement.credits_issued],
      ['Settled', statement.settled],
      ['Still owed', statement.still_owed],
      ['Closing owed', statement.closing_owed],
      [],
      ['Date', 'Memo', party, 'Company', 'Invoice', 'Reason', 'Item', 'Qty', 'Price', 'Merchandise', 'Tax', 'Credit', 'Status', 'Settlement', 'We owe', 'Balance'],
      ...statement.lines.map((line) => [line.date, line.memo, line.customer, line.company, line.invoice, line.reason, line.item, line.quantity, line.unit_price, line.merchandise, line.tax, line.credit, line.status, line.settlement, line.we_owe, line.balance]),
    ];
    download(`credit-memos-${statement.from}-to-${statement.to}.csv`, rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  };

  const saveHtml = () => {
    const node = document.querySelector('.credit-statement-paper');
    if (!node || !statement) return;
    download(`credit-memos-${statement.from}-to-${statement.to}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>Credit memos ${statement.from} to ${statement.to}</title><style>body{font-family:Georgia,serif;padding:32px;color:#1a1a1a}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #e3e5e8;padding:6px 8px;text-align:left}td.num,th.num{text-align:right}</style></head><body>${node.innerHTML}</body></html>`, 'text/html;charset=utf-8');
  };

  return createPortal(
    <div className="credit-statement-root fixed inset-0 z-[80] flex flex-col bg-[#E7E8EA]">
      <style>{`@media print { body * { visibility: hidden !important; } .credit-statement-root, .credit-statement-root * { visibility: visible !important; } .credit-statement-root { position: absolute; inset: 0; background: white; } .credit-statement-toolbar { display: none !important; } }`}</style>
      <div className="credit-statement-toolbar flex shrink-0 items-center justify-between gap-3 border-b border-[#E3E5E8] bg-white px-5 py-3">
        <p className="text-sm font-medium text-[#1A1A1A]">Credit memo statement · {label}</p>
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
            <article className="credit-statement-paper mx-auto max-w-6xl bg-white px-8 py-8 shadow-sm">
              <p className="text-xs uppercase tracking-[0.16em] text-[#6B6C72]">Express Distributors</p>
              <h1 className="mt-1 text-2xl text-[#1A1A1A]">Credit memo statement</h1>
              <p className="mt-1 text-sm text-[#6B6C72]">{label} · {statement.from} through {statement.to}</p>
              <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#E3E5E8] bg-[#E3E5E8] md:grid-cols-5">
                {[
                  ['Opening owed', statement.opening_owed],
                  ['Credits issued', statement.credits_issued],
                  ['Settled', statement.settled],
                  ['Still owed', statement.still_owed],
                  ['Closing owed', statement.closing_owed],
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
                    <th className="py-2 pr-2">Memo</th>
                    <th className="py-2 pr-2">{party}</th>
                    <th className="py-2 pr-2">{type === 'VENDOR' ? 'PO' : 'Invoice'}</th>
                    <th className="py-2 pr-2">Item</th>
                    <th className="py-2 pr-2 text-right">Qty</th>
                    <th className="py-2 pr-2 text-right">Credit</th>
                    <th className="py-2 pr-2">Settlement</th>
                    <th className="py-2 text-right">We owe</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#E3E5E8]"><td className="py-2" colSpan={8}>Opening owed</td><td className="py-2 text-right tabular-nums">{money(statement.opening_owed)}</td></tr>
                  {statement.lines.length === 0 ? <tr><td colSpan={9} className="py-4 text-[#6B6C72]">No credit memos in this range.</td></tr> : statement.lines.map((line, index) => (
                    <tr key={`${line.memo}-${line.item}-${index}`} className="border-b border-[#E3E5E8]">
                      <td className="py-2 pr-2 whitespace-nowrap">{line.date}</td>
                      <td className="py-2 pr-2">{line.memo}</td>
                      <td className="py-2 pr-2">{line.customer || '—'}{line.company ? <span className="block text-xs text-[#6B6C72]">{line.company}</span> : null}</td>
                      <td className="py-2 pr-2">{line.invoice || '—'}</td>
                      <td className="py-2 pr-2">{line.item || '—'}<span className="block text-xs text-[#6B6C72]">{line.reason} · {line.status} · {line.quantity} × {money(line.unit_price)} · merchandise {money(line.merchandise)} · tax {money(line.tax)}</span></td>
                      <td className="py-2 pr-2 text-right tabular-nums">{line.quantity}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(line.credit)}</td>
                      <td className="py-2 pr-2">{line.settlement}</td>
                      <td className="py-2 text-right tabular-nums">{money(line.balance)}</td>
                    </tr>
                  ))}
                  <tr><td className="py-2 font-medium" colSpan={6}>Closing owed</td><td className="py-2 text-right font-medium tabular-nums">{money(statement.credits_issued)}</td><td /><td className="py-2 text-right font-medium tabular-nums">{money(statement.closing_owed)}</td></tr>
                </tbody>
              </table>
            </article>
          ) : null}
      </div>
    </div>,
    document.body
  );
}
