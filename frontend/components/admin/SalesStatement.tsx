'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Download, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { formatApiError } from '@/lib/format-api-error';
import { adminUi } from '@/lib/admin-ui';

type Bucket = { count: number; billed: number; paid: number; balance: number };

type Line = {
  date: string;
  ref: string;
  customer: string;
  company: string;
  kind: 'invoice' | 'payment';
  detail: string;
  debit: number;
  credit: number;
  balance: number;
};

type InvoiceRow = {
  date: string;
  number: string;
  customer: string;
  company: string;
  total: number;
  paid: number;
  balance: number;
  status: 'paid' | 'partial' | 'unpaid';
  tax?: number;
  tax_detail?: string;
};

type TaxGroup = { mark: string; name: string; amount: number };
type TaxLine = { date: string; invoice: string; product: string; tax: string; amount: number };

type Statement = {
  from: string;
  to: string;
  opening_balance: number;
  invoices_issued: number;
  payments_received: number;
  closing_balance: number;
  paid: Bucket;
  partial: Bucket;
  unpaid: Bucket;
  ledger: Line[];
  invoices: InvoiceRow[];
  taxes?: TaxGroup[];
  tax_lines?: TaxLine[];
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

export default function SalesStatement({
  from,
  to,
  onClose,
}: {
  from: string;
  to: string;
  onClose: () => void;
}) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi
      .get<Statement>('/invoices/sales-statement', { params: { from, to } })
      .then((res) => {
        if (!cancelled) setStatement(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(formatApiError(err, 'Could not build the sales statement'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const exportCsv = () => {
    if (!statement) return;
    const rows = [
      ['Sales statement', statement.from, statement.to],
      ['Opening balance', statement.opening_balance],
      ['Invoices issued', statement.invoices_issued],
      ['Payments received', statement.payments_received],
      ['Closing balance', statement.closing_balance],
      [],
      ['Date', 'Reference', 'Customer', 'Company', 'Detail', 'Debit', 'Credit', 'Balance'],
      ...statement.ledger.map((line) => [
        line.date,
        line.ref,
        line.customer,
        line.company,
        line.detail,
        line.debit || '',
        line.credit || '',
        line.balance,
      ]),
      [],
      ['Invoice', 'Date', 'Customer', 'Company', 'Total', 'Paid', 'Balance', 'Status', 'Tax', 'Tax detail'],
      ...statement.invoices.map((row) => [row.number, row.date, row.customer, row.company, row.total, row.paid, row.balance, row.status, row.tax ?? '', row.tax_detail || '']),
      [],
      ['Tax', 'Mark', 'Amount'],
      ...(statement.taxes || []).map((row) => [row.name, row.mark, row.amount]),
      [],
      ['Date', 'Invoice', 'Product', 'Tax', 'Amount'],
      ...(statement.tax_lines || []).map((row) => [row.date, row.invoice, row.product, row.tax, row.amount]),
    ];
    download(
      `sales-statement-${statement.from}-to-${statement.to}.csv`,
      rows.map((row) => row.map(csvCell).join(',')).join('\n'),
      'text/csv;charset=utf-8'
    );
  };

  const saveHtml = () => {
    const node = document.querySelector('.sales-statement-paper');
    if (!node || !statement) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Sales statement ${statement.from} to ${statement.to}</title><style>body{font-family:Georgia,serif;color:#1a1a1a;padding:32px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e3e5e8;padding:6px 8px;text-align:left}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}h1{font-size:22px;margin:0}</style></head><body>${node.innerHTML}</body></html>`;
    download(`sales-statement-${statement.from}-to-${statement.to}.html`, html, 'text/html;charset=utf-8');
  };

  const buckets: { key: keyof Pick<Statement, 'paid' | 'partial' | 'unpaid'>; label: string }[] = [
    { key: 'paid', label: 'Paid' },
    { key: 'partial', label: 'Partially paid' },
    { key: 'unpaid', label: 'Unpaid' },
  ];

  return createPortal(
    <div className="sales-statement-root fixed inset-0 z-[80] flex flex-col bg-[#E7E8EA]">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .sales-statement-root, .sales-statement-root * { visibility: visible !important; }
          .sales-statement-root { position: absolute; inset: 0; background: white; }
          .sales-statement-toolbar { display: none !important; }
        }
      `}</style>
      <div className="sales-statement-toolbar flex shrink-0 items-center justify-between gap-3 border-b border-[#E3E5E8] bg-white px-5 py-3">
        <p className="text-sm font-medium text-[#1A1A1A]">Sales statement</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => window.print()} disabled={!statement} className={`${adminUi.btnPrimary} disabled:opacity-50`}>
            <Printer className="w-4 h-4" />
            Print
          </button>
          <button type="button" onClick={saveHtml} disabled={!statement} className={`${adminUi.btnSecondary} disabled:opacity-50`}>
            Save
          </button>
          <button type="button" onClick={exportCsv} disabled={!statement} className={`${adminUi.btnSecondary} disabled:opacity-50`}>
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button type="button" onClick={onClose} className={adminUi.btnIcon} aria-label="Close sales statement">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-black border-t-transparent" />
          </div>
        ) : error ? (
          <p className="mx-auto max-w-lg rounded-md bg-white p-6 text-sm text-[#1A1A1A]">{error}</p>
        ) : statement ? (
          <article className="sales-statement-paper mx-auto max-w-5xl bg-white px-8 py-8 shadow-sm">
            <p className="text-xs uppercase tracking-[0.16em] text-[#6B6C72]">Express Distributors</p>
            <h1 className="mt-1 text-2xl text-[#1A1A1A]">Sales statement</h1>
            <p className="mt-1 text-sm text-[#6B6C72]">
              {statement.from} through {statement.to}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#E3E5E8] bg-[#E3E5E8] md:grid-cols-4">
              {[
                ['Opening balance', statement.opening_balance],
                ['Invoices issued', statement.invoices_issued],
                ['Payments received', statement.payments_received],
                ['Closing balance', statement.closing_balance],
              ].map(([label, amount]) => (
                <div key={String(label)} className="bg-white px-4 py-3">
                  <p className="text-xs text-[#6B6C72]">{label}</p>
                  <p className="mt-1 text-lg tabular-nums text-[#1A1A1A]">{money(Number(amount))}</p>
                </div>
              ))}
            </div>

            <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-[#6B6C72]">Invoices in this statement</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              {buckets.map((bucket) => {
                const row = statement[bucket.key];
                return (
                  <div key={bucket.key} className="rounded-md border border-[#E3E5E8] px-4 py-3">
                    <p className="text-sm font-medium text-[#1A1A1A]">{bucket.label}</p>
                    <p className="mt-1 text-xs text-[#6B6C72]">{row.count} invoice{row.count === 1 ? '' : 's'}</p>
                    <dl className="mt-2 space-y-1 text-sm">
                      <div className="flex justify-between gap-3"><dt className="text-[#6B6C72]">Billed</dt><dd className="tabular-nums">{money(row.billed)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-[#6B6C72]">Paid</dt><dd className="tabular-nums">{money(row.paid)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-[#6B6C72]">Still owed</dt><dd className="tabular-nums">{money(row.balance)}</dd></div>
                    </dl>
                  </div>
                );
              })}
            </div>

            <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-[#6B6C72]">Activity</h2>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-[#1A1A1A] text-left text-xs uppercase text-[#6B6C72]">
                  <th className="py-2 pr-2 font-medium">Date</th>
                  <th className="py-2 pr-2 font-medium">Reference</th>
                  <th className="py-2 pr-2 font-medium">Customer</th>
                  <th className="py-2 pr-2 font-medium">Detail</th>
                  <th className="py-2 pr-2 text-right font-medium">Debit</th>
                  <th className="py-2 pr-2 text-right font-medium">Credit</th>
                  <th className="py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[#E3E5E8]">
                  <td className="py-2 pr-2">{statement.from}</td>
                  <td className="py-2 pr-2" colSpan={3}>Opening balance</td>
                  <td className="py-2" />
                  <td className="py-2" />
                  <td className="py-2 text-right tabular-nums">{money(statement.opening_balance)}</td>
                </tr>
                {statement.ledger.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-4 text-[#6B6C72]">No invoices or payments in this range.</td>
                  </tr>
                ) : (
                  statement.ledger.map((line, index) => (
                    <tr key={`${line.ref}-${line.kind}-${index}`} className="border-b border-[#E3E5E8]">
                      <td className="py-2 pr-2 whitespace-nowrap">{line.date}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{line.ref}</td>
                      <td className="py-2 pr-2">
                        <span className="block">{line.customer || '—'}</span>
                        {line.company ? <span className="block text-xs text-[#6B6C72]">{line.company}</span> : null}
                      </td>
                      <td className="py-2 pr-2">{line.detail}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{line.debit ? money(line.debit) : ''}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{line.credit ? money(line.credit) : ''}</td>
                      <td className="py-2 text-right tabular-nums">{money(line.balance)}</td>
                    </tr>
                  ))
                )}
                <tr>
                  <td className="py-2 font-medium" colSpan={4}>Closing balance</td>
                  <td className="py-2 text-right tabular-nums font-medium">{money(statement.invoices_issued)}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{money(statement.payments_received)}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{money(statement.closing_balance)}</td>
                </tr>
              </tbody>
            </table>

            <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-[#6B6C72]">Each invoice</h2>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-[#1A1A1A] text-left text-xs uppercase text-[#6B6C72]">
                  <th className="py-2 pr-2 font-medium">Date</th>
                  <th className="py-2 pr-2 font-medium">Number</th>
                  <th className="py-2 pr-2 font-medium">Customer</th>
                  <th className="py-2 pr-2 text-right font-medium">Total</th>
                  <th className="py-2 pr-2 text-right font-medium">Paid</th>
                  <th className="py-2 pr-2 text-right font-medium">Balance</th>
                  <th className="py-2 pr-2 text-right font-medium">Tax</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {statement.invoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-4 text-[#6B6C72]">No invoices to list for this range.</td>
                  </tr>
                ) : (
                  statement.invoices.map((row) => (
                    <tr key={row.number} className="border-b border-[#E3E5E8]">
                      <td className="py-2 pr-2 whitespace-nowrap">{row.date}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{row.number}</td>
                      <td className="py-2 pr-2">
                        <span className="block">{row.customer || '—'}</span>
                        {row.company ? <span className="block text-xs text-[#6B6C72]">{row.company}</span> : null}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(row.total)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(row.paid)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(row.balance)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{row.tax ? money(row.tax) : '—'}{row.tax_detail ? <span className="block text-xs text-[#6B6C72]">{row.tax_detail}</span> : null}</td>
                      <td className="py-2 capitalize">{row.status === 'partial' ? 'Partially paid' : row.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-[#6B6C72]">Tax by product</h2>
            <p className="mt-1 text-xs text-[#6B6C72]">Each named tax on invoices issued in this period. Selling prices stay tax-exclusive.</p>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-[#1A1A1A] text-left text-xs uppercase text-[#6B6C72]">
                  <th className="py-2 pr-2 font-medium">Date</th>
                  <th className="py-2 pr-2 font-medium">Invoice</th>
                  <th className="py-2 pr-2 font-medium">Product</th>
                  <th className="py-2 pr-2 font-medium">Tax</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(statement.tax_lines || []).length === 0 ? (
                  <tr><td colSpan={5} className="py-4 text-[#6B6C72]">No product tax in this period.</td></tr>
                ) : (
                  (statement.tax_lines || []).map((row, index) => (
                    <tr key={`${row.invoice}-${row.product}-${index}`} className="border-b border-[#E3E5E8]">
                      <td className="py-2 pr-2 whitespace-nowrap">{row.date}</td>
                      <td className="py-2 pr-2">{row.invoice}</td>
                      <td className="py-2 pr-2">{row.product || '—'}</td>
                      <td className="py-2 pr-2">{row.tax}</td>
                      <td className="py-2 text-right tabular-nums">{money(row.amount)}</td>
                    </tr>
                  ))
                )}
                {(statement.taxes || []).map((row) => (
                  <tr key={row.name}><td className="py-2 font-medium" colSpan={4}>{row.mark && row.mark !== row.name ? `${row.mark} · ${row.name}` : row.mark || row.name}</td><td className="py-2 text-right font-medium tabular-nums">{money(row.amount)}</td></tr>
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
