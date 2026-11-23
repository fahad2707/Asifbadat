'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { formatApiError } from '@/lib/format-api-error';
import { adminUi } from '@/lib/admin-ui';

type Unpaid = { number: string; date: string; total: number; paid: number; balance: number };

type Row = {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  customer_code: string;
  payment_terms: string;
  credit_limit: number;
  account_status: string;
  invoice_count: number;
  unpaid_count: number;
  partial_count: number;
  paid_count: number;
  billed: number;
  paid: number;
  open_balance: number;
  credits: number;
  last_invoice_date: string;
  last_payment_date: string;
  last_payment_amount: number;
  last_payment_method: string;
  payment_count: number;
  unpaid_invoices: Unpaid[];
};

type Statement = {
  customers: Row[];
  totals: { customers: number; billed: number; paid: number; open_balance: number; unpaid_invoices: number; credits: number };
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

export default function CustomerStatement({ onClose }: { onClose: () => void }) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    adminApi.get<Statement>('/customers/statement')
      .then((res) => { if (!cancelled) setStatement(res.data); })
      .catch((err) => { if (!cancelled) setError(formatApiError(err, 'Could not build the customer statement')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const exportCsv = () => {
    if (!statement) return;
    const rows = [
      ['Customer', 'Company', 'Phone', 'Email', 'Code', 'Terms', 'Invoices', 'Billed', 'Paid', 'Open balance', 'Unpaid invoices', 'Partial', 'Paid invoices', 'Credits', 'Last invoice', 'Last payment', 'Last amount', 'Last method', 'Payments'],
      ...statement.customers.map((row) => [row.name, row.company, row.phone, row.email, row.customer_code, row.payment_terms, row.invoice_count, row.billed, row.paid, row.open_balance, row.unpaid_count, row.partial_count, row.paid_count, row.credits, row.last_invoice_date, row.last_payment_date, row.last_payment_amount, row.last_payment_method, row.payment_count]),
    ];
    download('customer-statement.csv', rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  };

  const saveHtml = () => {
    const node = document.querySelector('.customer-statement-paper');
    if (!node) return;
    download('customer-statement.html', `<!doctype html><html><head><meta charset="utf-8"><title>Customer statement</title><style>body{font-family:Georgia,serif;padding:32px;color:#1a1a1a}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e3e5e8;padding:6px 8px;text-align:left}</style></head><body>${node.innerHTML}</body></html>`, 'text/html;charset=utf-8');
  };

  return createPortal(
    <div className="customer-statement-root fixed inset-0 z-[80] flex flex-col bg-[#E7E8EA]">
      <style>{`@media print { body * { visibility: hidden !important; } .customer-statement-root, .customer-statement-root * { visibility: visible !important; } .customer-statement-root { position: absolute; inset: 0; background: white; } .customer-statement-toolbar { display: none !important; } }`}</style>
      <div className="customer-statement-toolbar flex shrink-0 items-center justify-between gap-3 border-b border-[#E3E5E8] bg-white px-5 py-3">
        <p className="text-sm font-medium text-[#1A1A1A]">Customer statement</p>
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
            <article className="customer-statement-paper mx-auto max-w-6xl bg-white px-8 py-8 shadow-sm">
              <p className="text-xs uppercase tracking-[0.16em] text-[#6B6C72]">Express Distributors</p>
              <h1 className="mt-1 text-2xl">Customer statement</h1>
              <p className="mt-1 text-sm text-[#6B6C72]">Every customer, current invoices, and the latest payment on file.</p>
              <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#E3E5E8] bg-[#E3E5E8] md:grid-cols-4">
                {[
                  ['Customers', String(statement.totals.customers)],
                  ['Billed', money(statement.totals.billed)],
                  ['Paid', money(statement.totals.paid)],
                  ['Open balance', money(statement.totals.open_balance)],
                ].map(([name, value]) => (
                  <div key={name} className="bg-white px-4 py-3">
                    <p className="text-xs text-[#6B6C72]">{name}</p>
                    <p className="mt-1 text-lg tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
              <table className="mt-8 w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1A1A1A] text-left text-xs uppercase text-[#6B6C72]">
                    <th className="py-2 pr-2">Customer</th>
                    <th className="py-2 pr-2 text-right">Billed</th>
                    <th className="py-2 pr-2 text-right">Paid</th>
                    <th className="py-2 pr-2 text-right">Open</th>
                    <th className="py-2 pr-2">Unpaid invoices</th>
                    <th className="py-2 pr-2">Last payment</th>
                    <th className="py-2">Last invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.customers.map((row) => (
                    <tr key={row.id} className="border-b border-[#E3E5E8] align-top">
                      <td className="py-2 pr-2">
                        <span className="block">{row.name || '—'}</span>
                        {row.company ? <span className="block text-xs text-[#6B6C72]">{row.company}</span> : null}
                        <span className="block text-xs text-[#6B6C72]">{[row.customer_code, row.phone, row.email].filter(Boolean).join(' · ') || '—'}</span>
                        <span className="block text-xs text-[#6B6C72]">{row.payment_count} payment{row.payment_count === 1 ? '' : 's'} · {row.invoice_count} invoice{row.invoice_count === 1 ? '' : 's'} · {row.partial_count} partial · credits {money(row.credits)}</span>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(row.billed)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(row.paid)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(row.open_balance)}</td>
                      <td className="py-2 pr-2">
                        {row.unpaid_invoices.length === 0 ? '—' : row.unpaid_invoices.map((inv) => (
                          <span key={inv.number} className="block">{inv.number} · {money(inv.balance)} left</span>
                        ))}
                      </td>
                      <td className="py-2 pr-2">
                        {row.last_payment_date ? `${row.last_payment_date} · ${money(row.last_payment_amount)} ${row.last_payment_method}` : '—'}
                      </td>
                      <td className="py-2">{row.last_invoice_date || '—'}</td>
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
