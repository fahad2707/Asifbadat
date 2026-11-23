'use client';

import { useEffect, useState } from 'react';
import adminApi from '@/lib/admin-api';
import { formatApiError } from '@/lib/format-api-error';
import { STATEMENT_PERIODS, type StatementPeriod } from '@/components/admin/statementPeriods';
import StatementFrame, { csvCell, downloadText, saveStatementHtml } from '@/components/admin/StatementFrame';

type Item = { name: string; ordered: number; received: number; unit_cost: number; subtotal: number };
type CreditItem = { name: string; quantity: number; unit_price: number; total: number };

type Statement = {
  from: string;
  to: string;
  opening_owed: number;
  purchases: number;
  payments: number;
  supplier_credits: number;
  closing_owed: number;
  suppliers: { supplier: string; supplier_code: string; contact: string; phone: string; terms: string; opening: number; purchases: number; payments: number; credits: number; closing: number }[];
  ledger: { date: string; kind: string; ref: string; supplier: string; supplier_code: string; detail: string; debit: number; credit: number; balance: number }[];
  purchase_orders: { date: string; number: string; supplier: string; supplier_code: string; status: string; on_books: boolean; items: Item[]; subtotal: number; tax: number; total: number; paid: number; credited: number; balance: number }[];
  credit_memos: { date: string; number: string; supplier: string; po: string; reason: string; status: string; on_books: boolean; items: CreditItem[]; merchandise: number; tax: number; total: number }[];
};

const money = (n: number) => {
  const value = Number(n || 0);
  const body = `$${Math.abs(value).toFixed(2)}`;
  return value < 0 ? `-${body}` : body;
};

const kindLabel: Record<string, string> = { purchase: 'Purchase', payment: 'Payment', supplier_credit: 'Supplier credit' };

export default function PurchaseBooksStatement({
  period,
  focus,
  onClose,
}: {
  period: StatementPeriod;
  focus: 'suppliers' | 'orders';
  onClose: () => void;
}) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const label = STATEMENT_PERIODS.find((item) => item.id === period)?.label || period;
  const title = focus === 'suppliers' ? 'Supplier statement' : 'Purchase order statement';
  const paper = focus === 'suppliers' ? 'supplier-statement-paper' : 'po-statement-paper';
  const path = focus === 'suppliers' ? '/vendors/statement' : '/purchase-orders/statement';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi.get<Statement>(path, { params: { period } })
      .then((res) => { if (!cancelled) setStatement(res.data); })
      .catch((err) => { if (!cancelled) setError(formatApiError(err, 'Could not build the statement')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, period]);

  const exportCsv = () => {
    if (!statement) return;
    const rows = [
      [title, label, statement.from, statement.to],
      ['Opening owed', statement.opening_owed],
      ['Purchases', statement.purchases],
      ['Payments', statement.payments],
      ['Supplier credits', statement.supplier_credits],
      ['Closing owed', statement.closing_owed],
      [],
      ['Supplier', 'Code', 'Contact', 'Phone', 'Terms', 'Opening', 'Purchases', 'Payments', 'Credits', 'Closing'],
      ...statement.suppliers.map((row) => [row.supplier, row.supplier_code, row.contact, row.phone, row.terms, row.opening, row.purchases, row.payments, row.credits, row.closing]),
      [],
      ['Date', 'Kind', 'Reference', 'Supplier', 'Code', 'Detail', 'Debit', 'Credit', 'Balance'],
      ...statement.ledger.map((line) => [line.date, kindLabel[line.kind] || line.kind, line.ref, line.supplier, line.supplier_code, line.detail, line.debit || '', line.credit || '', line.balance]),
      [],
      ['PO date', 'PO', 'Supplier', 'Status', 'On books', 'Item', 'Ordered', 'Received', 'Unit cost', 'Line', 'Subtotal', 'Tax', 'Total', 'Paid', 'Credited', 'Balance'],
      ...statement.purchase_orders.flatMap((po) => (po.items.length ? po.items : [{ name: '', ordered: 0, received: 0, unit_cost: 0, subtotal: 0 }]).map((item, index) => [
        index === 0 ? po.date : '', po.number, po.supplier, po.status, po.on_books ? 'yes' : 'no', item.name, item.ordered, item.received, item.unit_cost, item.subtotal,
        index === 0 ? po.subtotal : '', index === 0 ? po.tax : '', index === 0 ? po.total : '', index === 0 ? po.paid : '', index === 0 ? po.credited : '', index === 0 ? po.balance : '',
      ])),
      [],
      ['Credit date', 'Memo', 'Supplier', 'PO', 'Reason', 'Status', 'On books', 'Item', 'Qty', 'Price', 'Merchandise', 'Tax', 'Total'],
      ...statement.credit_memos.flatMap((memo) => (memo.items.length ? memo.items : [{ name: '', quantity: 0, unit_price: 0, total: 0 }]).map((item, index) => [
        index === 0 ? memo.date : '', memo.number, memo.supplier, memo.po, memo.reason, memo.status, memo.on_books ? 'yes' : 'no', item.name, item.quantity, item.unit_price, item.total, index === 0 ? memo.tax : '', index === 0 ? memo.total : '',
      ])),
    ];
    downloadText(`${focus}-${statement.from}-to-${statement.to}.csv`, rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  };

  const supplierTable = statement && (
    <section className="mt-8">
      <h2 className="text-sm font-medium uppercase tracking-[0.12em] text-[#6B6C72]">Suppliers</h2>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b border-[#1A1A1A] text-left text-xs uppercase text-[#6B6C72]">
            <th className="py-2 pr-2">Supplier</th><th className="py-2 pr-2">Code</th><th className="py-2 pr-2 text-right">Opening</th><th className="py-2 pr-2 text-right">Purchases</th><th className="py-2 pr-2 text-right">Payments</th><th className="py-2 pr-2 text-right">Credits</th><th className="py-2 text-right">Closing</th>
          </tr>
        </thead>
        <tbody>
          {statement.suppliers.length === 0 ? <tr><td colSpan={7} className="py-4 text-[#6B6C72]">No supplier balance in this period.</td></tr> : statement.suppliers.map((row) => (
            <tr key={`${row.supplier_code}-${row.supplier}`} className="border-b border-[#E3E5E8]">
              <td className="py-2 pr-2">{row.supplier}{row.contact ? <span className="block text-xs text-[#6B6C72]">{row.contact}{row.phone ? ` · ${row.phone}` : ''}{row.terms ? ` · ${row.terms}` : ''}</span> : null}</td>
              <td className="py-2 pr-2">{row.supplier_code || '—'}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{money(row.opening)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{money(row.purchases)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{money(row.payments)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{money(row.credits)}</td>
              <td className="py-2 text-right tabular-nums">{money(row.closing)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  const orderTable = statement && (
    <section className="mt-8">
      <h2 className="text-sm font-medium uppercase tracking-[0.12em] text-[#6B6C72]">Purchase orders</h2>
      <p className="mt-1 text-xs text-[#6B6C72]">Draft and cancelled orders are listed. They are not part of the balance. An order from before this period stays here while it is still unpaid.</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b border-[#1A1A1A] text-left text-xs uppercase text-[#6B6C72]">
            <th className="py-2 pr-2">Date</th><th className="py-2 pr-2">PO</th><th className="py-2 pr-2">Supplier</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2 text-right">Ordered</th><th className="py-2 pr-2 text-right">Received</th><th className="py-2 pr-2 text-right">Cost</th><th className="py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {statement.purchase_orders.length === 0 ? <tr><td colSpan={8} className="py-4 text-[#6B6C72]">No purchase orders in this period.</td></tr> : statement.purchase_orders.map((po) => (
            <tr key={po.number} className="border-b border-[#E3E5E8] align-top">
              <td className="py-2 pr-2 whitespace-nowrap">{po.date}</td>
              <td className="py-2 pr-2">{po.number}<span className="block text-xs text-[#6B6C72]">{po.status}{po.on_books ? '' : ' · not on the books'}</span></td>
              <td className="py-2 pr-2">{po.supplier || '—'}</td>
              <td className="py-2 pr-2">{po.items.length === 0 ? '—' : po.items.map((item) => <span key={`${po.number}-${item.name}`} className="block">{item.name}</span>)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{po.items.map((item) => <span key={`${item.name}-o`} className="block">{item.ordered}</span>)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{po.items.map((item) => <span key={`${item.name}-r`} className="block">{item.received}</span>)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{po.items.map((item) => <span key={`${item.name}-c`} className="block">{money(item.unit_cost)}</span>)}</td>
              <td className="py-2 text-right tabular-nums">{money(po.balance)}<span className="block text-xs text-[#6B6C72]">Total {money(po.total)} · Tax {money(po.tax)} · Paid {money(po.paid)} · Credited {money(po.credited)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  return (
    <StatementFrame
      title={`${title} · ${label}`}
      paperClass={paper}
      ready={Boolean(statement)}
      onSave={() => statement && saveStatementHtml(paper, `${focus}-${statement.from}-to-${statement.to}.html`, title)}
      onCsv={exportCsv}
      onClose={onClose}
    >
      {loading ? <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-black border-t-transparent" /></div>
        : error ? <p className="mx-auto max-w-lg rounded-md bg-white p-6 text-sm">{error}</p>
        : statement ? (
          <article className={`${paper} mx-auto max-w-6xl bg-white px-8 py-8 shadow-sm`}>
            <p className="text-xs uppercase tracking-[0.16em] text-[#6B6C72]">Express Distributors</p>
            <h1 className="mt-1 text-2xl text-[#1A1A1A]">{title}</h1>
            <p className="mt-1 text-sm text-[#6B6C72]">{label} · {statement.from} through {statement.to}</p>
            <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#E3E5E8] bg-[#E3E5E8] md:grid-cols-5">
              {[
                ['Opening owed', statement.opening_owed],
                ['Purchases', statement.purchases],
                ['Payments', statement.payments],
                ['Supplier credits', statement.supplier_credits],
                ['Closing owed', statement.closing_owed],
              ].map(([name, amount]) => (
                <div key={String(name)} className="bg-white px-4 py-3">
                  <p className="text-xs text-[#6B6C72]">{name}</p>
                  <p className="mt-1 text-lg tabular-nums">{money(Number(amount))}</p>
                </div>
              ))}
            </div>
            {focus === 'suppliers' ? supplierTable : orderTable}
            <section className="mt-8">
              <h2 className="text-sm font-medium uppercase tracking-[0.12em] text-[#6B6C72]">Account</h2>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1A1A1A] text-left text-xs uppercase text-[#6B6C72]">
                    <th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Particulars</th><th className="py-2 pr-2 text-right">Debit</th><th className="py-2 pr-2 text-right">Credit</th><th className="py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#E3E5E8]"><td className="py-2" colSpan={4}>Opening owed</td><td className="py-2 text-right tabular-nums">{money(statement.opening_owed)}</td></tr>
                  {statement.ledger.length === 0 ? <tr><td colSpan={5} className="py-4 text-[#6B6C72]">No purchases, payments, or supplier credits in this period.</td></tr> : statement.ledger.map((line, index) => (
                    <tr key={`${line.ref}-${line.kind}-${index}`} className="border-b border-[#E3E5E8]">
                      <td className="py-2 pr-2 whitespace-nowrap">{line.date}</td>
                      <td className="py-2 pr-2">{kindLabel[line.kind] || line.kind} {line.ref} · {line.supplier || '—'}<span className="block text-xs text-[#6B6C72]">{line.detail}</span></td>
                      <td className="py-2 pr-2 text-right tabular-nums">{line.debit ? money(line.debit) : ''}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{line.credit ? money(line.credit) : ''}</td>
                      <td className="py-2 text-right tabular-nums">{money(line.balance)}</td>
                    </tr>
                  ))}
                  <tr><td className="py-2 font-medium" colSpan={4}>Closing owed</td><td className="py-2 text-right font-medium tabular-nums">{money(statement.closing_owed)}</td></tr>
                </tbody>
              </table>
            </section>
            {focus === 'suppliers' ? orderTable : supplierTable}
            <section className="mt-8">
              <h2 className="text-sm font-medium uppercase tracking-[0.12em] text-[#6B6C72]">Supplier credits</h2>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1A1A1A] text-left text-xs uppercase text-[#6B6C72]">
                    <th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Memo</th><th className="py-2 pr-2">Supplier</th><th className="py-2 pr-2">PO</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2 text-right">Qty</th><th className="py-2 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.credit_memos.length === 0 ? <tr><td colSpan={7} className="py-4 text-[#6B6C72]">No supplier credits in this period.</td></tr> : statement.credit_memos.map((memo) => (
                    <tr key={memo.number} className="border-b border-[#E3E5E8] align-top">
                      <td className="py-2 pr-2 whitespace-nowrap">{memo.date}</td>
                      <td className="py-2 pr-2">{memo.number}<span className="block text-xs text-[#6B6C72]">{memo.reason} · {memo.status}{memo.on_books ? '' : ' · not on the books'}</span></td>
                      <td className="py-2 pr-2">{memo.supplier || '—'}</td>
                      <td className="py-2 pr-2">{memo.po || '—'}</td>
                      <td className="py-2 pr-2">{memo.items.length === 0 ? '—' : memo.items.map((item) => <span key={item.name} className="block">{item.name}</span>)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{memo.items.map((item) => <span key={`${item.name}-q`} className="block">{item.quantity}</span>)}</td>
                      <td className="py-2 text-right tabular-nums">{money(memo.total)}<span className="block text-xs text-[#6B6C72]">Merchandise {money(memo.merchandise)} · Tax {money(memo.tax)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </article>
        ) : null}
    </StatementFrame>
  );
}
