'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type StatementLine = {
  id: string;
  created_at: string;
  product_id: string;
  product_name: string;
  product_code: string | null;
  sku: string | null;
  type: string;
  reference: string;
  notes: string | null;
  quantity_in: number;
  quantity_out: number;
  balance_qty: number;
  purchase_value: number | null;
  estimated_value: number | null;
  running_purchase_value: number | null;
  running_estimated_value: number | null;
  performed_by: string | null;
};

export type ProductStatement = {
  id: string;
  product_id: string | null;
  sku: string | null;
  barcode: string | null;
  name: string;
  category_name: string | null;
  sub_category_name: string | null;
  is_active: boolean;
  cost_price: number | null;
  price: number | null;
  buffer: number | null;
  committed_quantity: number;
  available_quantity: number;
  stock_now: number;
  opening_qty: number;
  closing_qty: number;
  units_in: number;
  units_out: number;
  opening_purchase_value: number | null;
  closing_purchase_value: number | null;
  opening_estimated_value: number | null;
  closing_estimated_value: number | null;
  lines: StatementLine[];
};

export type InventoryStatementData = {
  business_name: string;
  generated_at: string;
  period_start: string;
  period_end: string;
  valuation_note: string;
  summary: {
    product_count: number;
    opening_units: number;
    closing_units: number;
    units_in: number;
    units_out: number;
    opening_purchase_value: number;
    closing_purchase_value: number;
    opening_estimated_value: number;
    closing_estimated_value: number;
    products_missing_cost: number;
    products_missing_price: number;
    activity: Array<{ type: string; count: number; units_in: number; units_out: number }>;
  };
  register: StatementLine[];
  products: ProductStatement[];
  damaged_returns?: DamagedStatementRow[];
};

export type DamagedStatementRow = {
  id: string;
  date: string | null;
  product_name: string;
  quantity: number;
  quantity_still_held: number;
  customer_name: string;
  supplier_name: string | null;
  purchase_rate: number | null;
  po_number: string | null;
  invoice_number: string | null;
  credit_memo_number: string;
  supplier_credit_memo_number: string | null;
  hold: 'waiting' | 'held' | 'returned';
};

function money(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function qty(value: number): string {
  return value ? String(value) : '';
}

export default function InventoryStatement({
  statement,
  onClose,
}: {
  statement: InventoryStatementData;
  onClose: () => void;
}) {
  const summary = statement.summary;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#E7E5E4] print:static print:bg-white print:overflow-visible">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .inventory-statement, .inventory-statement * { visibility: visible; }
          .inventory-statement { position: absolute; inset: 0; width: 100%; background: white; }
          .inventory-statement-toolbar { display: none !important; }
        }
      `}</style>
      <div className="inventory-statement-toolbar flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-5 py-3 shadow-sm print:hidden">
        <p className="text-sm font-semibold text-stone-800">Inventory statement</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white">
            Print / Save PDF
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Close
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
      <article className="inventory-statement mx-auto my-6 max-w-5xl bg-white px-8 py-10 text-stone-900 shadow-sm print:my-0 print:max-w-none print:shadow-none">
        <header className="border-b-2 border-stone-900 pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{statement.business_name}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Inventory statement</h1>
          <p className="mt-2 text-sm">
            {when(statement.period_start)} — {when(statement.period_end)}
          </p>
          <p className="mt-1 text-xs text-stone-500">Prepared {when(statement.generated_at)}. {statement.valuation_note}</p>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-x-10 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Opening units</p>
            <p className="font-mono text-lg">{summary.opening_units}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Received</p>
            <p className="font-mono text-lg">{summary.units_in}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Issued</p>
            <p className="font-mono text-lg">{summary.units_out}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Closing units</p>
            <p className="font-mono text-lg">{summary.closing_units}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Opening purchase value</p>
            <p className="font-mono">{money(summary.opening_purchase_value)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Closing purchase value</p>
            <p className="font-mono">{money(summary.closing_purchase_value)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Opening estimated sales</p>
            <p className="font-mono">{money(summary.opening_estimated_value)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Closing estimated sales</p>
            <p className="font-mono">{money(summary.closing_estimated_value)}</p>
          </div>
        </section>
        <p className="mt-3 text-xs text-stone-500">
          {summary.product_count} {summary.product_count === 1 ? 'product' : 'products'}.
          {summary.products_missing_cost > 0 ? ` ${summary.products_missing_cost} have no cost price.` : ''}
          {summary.products_missing_price > 0 ? ` ${summary.products_missing_price} have no selling price.` : ''}
        </p>

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider">Activity in this period</h2>
          {summary.activity.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">No stock movements in this period.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-stone-300 text-left text-[10px] uppercase tracking-wider text-stone-500">
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3 text-right">Entries</th>
                  <th className="py-2 pr-3 text-right">Units in</th>
                  <th className="py-2 text-right">Units out</th>
                </tr>
              </thead>
              <tbody>
                {summary.activity.map((row) => (
                  <tr key={row.type} className="border-b border-stone-100">
                    <td className="py-1.5 pr-3">{row.type}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{row.count}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{row.units_in || '—'}</td>
                    <td className="py-1.5 text-right font-mono">{row.units_out || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider">Damaged products</h2>
          <p className="mt-1 text-xs text-stone-500">
            Customer returns held as damaged, including stock still damaged at the end of this period. The supplier is the purchase received at the product’s cost rate.
          </p>
          {(statement.damaged_returns || []).length === 0 ? (
            <p className="mt-3 border border-dashed border-stone-300 px-3 py-6 text-center text-sm text-stone-500">No damaged products in this period.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[860px] text-xs">
                <thead>
                  <tr className="border-y border-stone-900 text-left uppercase tracking-wider text-stone-500">
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Product</th>
                    <th className="py-2 pr-2 text-right">Qty</th>
                    <th className="py-2 pr-2 text-right">Still damaged</th>
                    <th className="py-2 pr-2">Customer</th>
                    <th className="py-2 pr-2">Supplier</th>
                    <th className="py-2 pr-2">PO</th>
                    <th className="py-2 pr-2">Invoice</th>
                    <th className="py-2 pr-2">Credit memo</th>
                    <th className="py-2">Supplier credit</th>
                  </tr>
                </thead>
                <tbody>
                  {(statement.damaged_returns || []).map((row) => (
                    <tr key={row.id} className="border-b border-stone-100 align-top">
                      <td className="py-1.5 pr-2 whitespace-nowrap">{row.date ? when(row.date) : '—'}</td>
                      <td className="py-1.5 pr-2">
                        <span className="font-medium">{row.product_name}</span>
                        <span className="block text-[10px] text-stone-500">
                          {row.hold === 'held' ? 'Still damaged' : row.hold === 'waiting' ? 'Waiting to receive' : 'Returned to supplier'}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono">{row.quantity}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{row.quantity_still_held}</td>
                      <td className="py-1.5 pr-2">{row.customer_name}</td>
                      <td className="py-1.5 pr-2">
                        {row.supplier_name || (row.purchase_rate != null ? `No purchase at ${money(row.purchase_rate)}` : 'No cost rate')}
                        {row.supplier_name && row.purchase_rate != null ? (
                          <span className="block text-[10px] text-stone-500">{money(row.purchase_rate)}</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-2">{row.po_number || '—'}</td>
                      <td className="py-1.5 pr-2">{row.invoice_number || '—'}</td>
                      <td className="py-1.5 pr-2">{row.credit_memo_number}</td>
                      <td className="py-1.5">{row.supplier_credit_memo_number || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider">Transaction register</h2>
          <p className="mt-1 text-xs text-stone-500">Every stock movement in the period, in the order it was recorded. The running amounts are the whole inventory.</p>
          {statement.register.length === 0 ? (
            <p className="mt-3 border border-dashed border-stone-300 px-3 py-6 text-center text-sm text-stone-500">No transactions in this period.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[860px] text-xs">
                <thead>
                  <tr className="border-y border-stone-900 text-left uppercase tracking-wider text-stone-500">
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Product</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Reference</th>
                    <th className="py-2 pr-2 text-right">In</th>
                    <th className="py-2 pr-2 text-right">Out</th>
                    <th className="py-2 pr-2 text-right">On hand</th>
                    <th className="py-2 pr-2 text-right">Inventory value</th>
                    <th className="py-2 pr-2 text-right">Estimated sales</th>
                    <th className="py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-stone-200">
                    <td className="py-1.5 pr-2" colSpan={6}>Opening balance</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{summary.opening_units}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{money(summary.opening_purchase_value)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{money(summary.opening_estimated_value)}</td>
                    <td />
                  </tr>
                  {statement.register.map((line) => (
                    <tr key={line.id} className="border-b border-stone-100 align-top">
                      <td className="py-1.5 pr-2 whitespace-nowrap">{when(line.created_at)}</td>
                      <td className="py-1.5 pr-2">
                        <span className="font-medium">{line.product_name}</span>
                        <span className="block text-[10px] text-stone-500">{line.product_code || '—'} · {line.sku || '—'}</span>
                      </td>
                      <td className="py-1.5 pr-2">{line.type}</td>
                      <td className="py-1.5 pr-2">{line.reference}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{qty(line.quantity_in)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{qty(line.quantity_out)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{line.balance_qty}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{money(line.running_purchase_value)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{money(line.running_estimated_value)}</td>
                      <td className="py-1.5">{line.notes || '—'}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-stone-900 font-semibold">
                    <td className="py-2 pr-2" colSpan={6}>Closing balance</td>
                    <td className="py-2 pr-2 text-right font-mono">{summary.closing_units}</td>
                    <td className="py-2 pr-2 text-right font-mono">{money(summary.closing_purchase_value)}</td>
                    <td className="py-2 pr-2 text-right font-mono">{money(summary.closing_estimated_value)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider">Product statements</h2>
          <div className="mt-4 space-y-8">
            {statement.products.map((product) => (
              <section key={product.id} className="break-inside-avoid border-t border-stone-300 pt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold">{product.name}</h3>
                  <p className="text-xs text-stone-500">{product.is_active ? 'Active' : 'Inactive'}</p>
                </div>
                <p className="mt-1 text-xs text-stone-600">
                  Product ID {product.product_id || '—'} · SKU {product.sku || '—'} · Barcode {product.barcode || '—'}
                </p>
                <p className="text-xs text-stone-600">
                  {product.category_name || 'No category'}{product.sub_category_name ? ` / ${product.sub_category_name}` : ''}
                  {' · '}Cost {money(product.cost_price)} · Selling {money(product.price)}
                  {' · '}Buffer {product.buffer ?? '—'} · On hand now {product.stock_now} · Committed {product.committed_quantity} · Available {product.available_quantity}
                </p>
                <table className="mt-3 w-full text-xs">
                  <thead>
                    <tr className="border-b border-stone-300 text-left uppercase tracking-wider text-stone-500">
                      <th className="py-1.5 pr-2">Date</th>
                      <th className="py-1.5 pr-2">Particulars</th>
                      <th className="py-1.5 pr-2 text-right">In</th>
                      <th className="py-1.5 pr-2 text-right">Out</th>
                      <th className="py-1.5 pr-2 text-right">Balance</th>
                      <th className="py-1.5 pr-2 text-right">Purchase value</th>
                      <th className="py-1.5 pr-2 text-right">Estimated sales</th>
                      <th className="py-1.5">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-stone-100">
                      <td className="py-1.5 pr-2" colSpan={4}>Opening balance</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{product.opening_qty}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{money(product.opening_purchase_value)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{money(product.opening_estimated_value)}</td>
                      <td />
                    </tr>
                    {product.lines.length === 0 ? (
                      <tr>
                        <td className="py-2 text-stone-500" colSpan={8}>No activity in this period.</td>
                      </tr>
                    ) : (
                      product.lines.map((line) => (
                        <tr key={line.id} className="border-b border-stone-100 align-top">
                          <td className="py-1.5 pr-2 whitespace-nowrap">{when(line.created_at)}</td>
                          <td className="py-1.5 pr-2">{line.type}{line.reference !== '—' ? ` · ${line.reference}` : ''}{line.performed_by ? ` · ${line.performed_by}` : ''}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">{qty(line.quantity_in)}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">{qty(line.quantity_out)}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">{line.balance_qty}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">{money(line.purchase_value)}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">{money(line.estimated_value)}</td>
                          <td className="py-1.5">{line.notes || '—'}</td>
                        </tr>
                      ))
                    )}
                    <tr className="border-t border-stone-400 font-semibold">
                      <td className="py-1.5 pr-2" colSpan={4}>Closing balance · in {product.units_in} · out {product.units_out}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{product.closing_qty}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{money(product.closing_purchase_value)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{money(product.closing_estimated_value)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </section>
      </article>
      </div>
    </div>,
    document.body
  );
}
