'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import adminApi from '@/lib/admin-api';

type Hold = 'waiting' | 'held' | 'returned';

type DamagedRow = {
  id: string;
  date: string | null;
  product_name: string;
  quantity: number;
  quantity_still_held: number;
  quantity_returned_to_supplier: number;
  customer_name: string;
  supplier_name: string | null;
  supplier_id: string | null;
  purchase_match: 'rate' | 'none' | null;
  purchase_rate: number | null;
  po_id: string | null;
  po_number: string | null;
  invoice_number: string | null;
  credit_memo_id: string;
  credit_memo_number: string;
  supplier_credit_memo_number: string | null;
  hold: Hold;
};

const FILTERS: Array<{ id: 'held' | 'waiting' | 'returned' | 'all'; label: string }> = [
  { id: 'held', label: 'Still here' },
  { id: 'waiting', label: 'Waiting to receive' },
  { id: 'returned', label: 'Returned to supplier' },
  { id: 'all', label: 'All' },
];

function fmtDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function money(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${value.toFixed(2)}`;
}

export default function DamagedReturns() {
  const [rows, setRows] = useState<DamagedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('held');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .get('/inventory/damaged-returns')
      .then((res) => {
        if (!cancelled) setRows(res.data.rows || []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    return {
      held: rows.filter((row) => row.hold === 'held').length,
      waiting: rows.filter((row) => row.hold === 'waiting').length,
      returned: rows.filter((row) => row.hold === 'returned').length,
      heldQty: rows.reduce((sum, row) => sum + row.quantity_still_held, 0),
    };
  }, [rows]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== 'all' && row.hold !== filter) return false;
      if (!needle) return true;
      return [
        row.product_name,
        row.customer_name,
        row.supplier_name,
        row.po_number,
        row.invoice_number,
        row.credit_memo_number,
        row.supplier_credit_memo_number,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [rows, filter, search]);

  return (
    <section className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-[#E2E8F0]">
        <p className="text-xs font-semibold text-red-600 mr-1">{counts.heldQty} still in damaged stock</p>
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              filter === option.id
                ? 'bg-[#E8EEF4] text-[#0F172A] border-[#0F172A]'
                : 'bg-white text-[#334155] border-[#E2E8F0] hover:bg-[#F8FAFC]'
            }`}
          >
            {option.label}
            {option.id === 'held' ? ` (${counts.held})` : ''}
            {option.id === 'waiting' ? ` (${counts.waiting})` : ''}
            {option.id === 'returned' ? ` (${counts.returned})` : ''}
          </button>
        ))}
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Product, customer, supplier, PO, invoice, memo"
          className="ml-auto min-w-[240px] border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs"
          aria-label="Search damaged returns"
        />
      </div>
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-[#0F9F8F] border-t-transparent" />
        </div>
      ) : visible.length === 0 ? (
        <p className="px-4 py-8 text-xs text-[#64748B]">
          {rows.length === 0
            ? 'No damaged returns yet. They appear here after a customer credit memo is approved.'
            : 'Nothing in this view.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[1100px] text-xs">
            <thead className="bg-[#F8FAFC] text-[#64748B]">
              <tr>
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-wider text-[10px]">Date</th>
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-wider text-[10px]">Product</th>
                <th className="text-right py-2.5 px-3 font-bold uppercase tracking-wider text-[10px]">Qty</th>
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-wider text-[10px]">Customer</th>
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-wider text-[10px]">Supplier</th>
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-wider text-[10px]">PO</th>
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-wider text-[10px]">Invoice</th>
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-wider text-[10px]">Credit memo</th>
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-wider text-[10px]">Supplier credit</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-t border-[#E2E8F0]">
                  <td className="py-2.5 px-3 whitespace-nowrap">{fmtDate(row.date)}</td>
                  <td className="py-2.5 px-3 font-semibold text-[#0F172A]">
                    {row.product_name}
                    <span className="block font-normal text-[10px] text-[#64748B]">
                      {row.hold === 'held'
                        ? `${row.quantity_still_held} still damaged`
                        : row.hold === 'waiting'
                          ? 'Not received into stock yet'
                          : 'Sent back to the supplier'}
                    </span>
                  </td>
                  <td className={`py-2.5 px-3 text-right font-mono font-bold ${row.hold === 'held' ? 'text-red-600' : 'text-[#0F172A]'}`}>
                    {row.quantity}
                  </td>
                  <td className="py-2.5 px-3">{row.customer_name}</td>
                  <td className="py-2.5 px-3">
                    {row.supplier_name ? (
                      <>
                        {row.supplier_name}
                        <span className="block text-[10px] text-[#64748B] font-mono">
                          {money(row.purchase_rate)} cost rate
                        </span>
                      </>
                    ) : row.purchase_rate != null ? (
                      <span className="text-[#64748B]">No purchase at {money(row.purchase_rate)}</span>
                    ) : (
                      <span className="text-[#64748B]">No cost rate on file</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono">{row.po_number || '—'}</td>
                  <td className="py-2.5 px-3 font-mono">{row.invoice_number || '—'}</td>
                  <td className="py-2.5 px-3 font-mono">
                    <Link href={`/admin/credit-memos/customers`} className="text-[#0F9F8F] hover:underline">
                      {row.credit_memo_number}
                    </Link>
                  </td>
                  <td className="py-2.5 px-3">
                    {row.supplier_credit_memo_number && (
                      <span className="block font-mono">{row.supplier_credit_memo_number}</span>
                    )}
                    {row.hold === 'held' && row.supplier_id && row.po_id ? (
                      <Link
                        href={`/admin/credit-memos/vendors?from_memo=${row.credit_memo_id}&vendor_id=${row.supplier_id}&po_id=${row.po_id}`}
                        className="text-[#0F9F8F] hover:underline font-semibold"
                      >
                        Credit supplier
                      </Link>
                    ) : (
                      !row.supplier_credit_memo_number && '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
