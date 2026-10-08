'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import adminApi, { posApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { adminUi } from '@/lib/admin-ui';
import NumberInput from '@/components/admin/NumberInput';

type RefundMethod = 'cash' | 'cheque' | 'credit';
type Disposition = 'resalable' | 'damaged';

interface ReturnRow {
  id: string;
  return_number: string;
  sale_id?: string;
  sale_number?: string;
  total_refund: number;
  refund_method?: string;
  status?: string;
  settlement_status?: string;
  created_at?: string;
}

interface SaleListItem {
  id: string;
  sale_number: string;
  customer_name?: string;
  customer_phone?: string;
  total_amount?: number;
  created_at?: string;
  items?: SaleItem[];
}

interface SaleItem {
  product_id?: string | { _id?: string; id?: string; name?: string };
  product_name?: string;
  quantity?: number;
  unit_price?: number;
}

interface SaleDetail extends SaleListItem {
  returned_quantities?: Record<string, number>;
  customer_id?: string;
}

type ReturnLineDraft = {
  product_id: string;
  product_name: string;
  sold_qty: number;
  already_returned: number;
  returnable: number;
  quantity: number | '';
  inventory_disposition: Disposition;
};

function apiError(err: unknown, fallback: string) {
  const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

function productIdOf(item: SaleItem): string {
  const p = item.product_id;
  if (!p) return '';
  if (typeof p === 'string') return p;
  return String(p._id || p.id || '');
}

function productNameOf(item: SaleItem): string {
  if (item.product_name) return item.product_name;
  const p = item.product_id;
  if (p && typeof p === 'object' && p.name) return p.name;
  return 'Product';
}

function formatMoney(n: number) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function formatDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ret-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable fingerprint of the create-return payload for idempotency-key reuse on retry. */
function returnPayloadFingerprint(input: {
  sale_id: string;
  items: Array<{ product_id: string; quantity: number; inventory_disposition: string }>;
  refund_method: string;
  cheque_reference?: string;
}) {
  const items = [...input.items]
    .map((i) => `${i.product_id}:${i.quantity}:${i.inventory_disposition}`)
    .sort()
    .join('|');
  return `${input.sale_id}::${input.refund_method}::${input.cheque_reference || ''}::${items}`;
}

function buildReturnLines(sale: SaleDetail): ReturnLineDraft[] {
  const soldByProduct = new Map<string, { name: string; qty: number }>();
  for (const item of sale.items || []) {
    const id = productIdOf(item);
    if (!id) continue;
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    const existing = soldByProduct.get(id);
    if (existing) {
      existing.qty += qty;
    } else {
      soldByProduct.set(id, { name: productNameOf(item), qty });
    }
  }
  const returned = sale.returned_quantities || {};
  const lines: ReturnLineDraft[] = [];
  for (const [product_id, { name, qty }] of soldByProduct) {
    const already = Number(returned[product_id]) || 0;
    const returnable = Math.max(0, qty - already);
    lines.push({
      product_id,
      product_name: name,
      sold_qty: qty,
      already_returned: already,
      returnable,
      quantity: returnable > 0 ? '' : 0,
      inventory_disposition: 'resalable',
    });
  }
  return lines;
}

export default function PosReturnsPage() {
  const [list, setList] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);
  const settleInFlightRef = useRef(false);
  const idempotencyByFingerprintRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);

  const [saleQuery, setSaleQuery] = useState('');
  const [sales, setSales] = useState<SaleListItem[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null);
  const [lines, setLines] = useState<ReturnLineDraft[]>([]);
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('cash');
  const [chequeReference, setChequeReference] = useState('');
  const [lastCreated, setLastCreated] = useState<{
    id: string;
    return_number: string;
    total_refund: number;
    settlement_status?: string;
  } | null>(null);

  const [settleMethod, setSettleMethod] = useState<RefundMethod>('cash');
  const [settleCheque, setSettleCheque] = useState('');

  const fetchReturns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/returns', { params: { limit: 50 } });
      setList(res.data.returns || []);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load returns'));
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReturns();
  }, [fetchReturns]);

  const searchSales = async () => {
    setSalesLoading(true);
    try {
      const res = await posApi.getSales({ limit: 30 });
      const all: SaleListItem[] = res.data.sales || [];
      const q = saleQuery.trim().toLowerCase();
      setSales(
        q
          ? all.filter(
              (s) =>
                s.sale_number?.toLowerCase().includes(q) ||
                s.customer_name?.toLowerCase().includes(q) ||
                s.customer_phone?.includes(q) ||
                s.id?.toLowerCase().includes(q)
            )
          : all
      );
    } catch (err) {
      toast.error(apiError(err, 'Failed to load POS sales'));
      setSales([]);
    } finally {
      setSalesLoading(false);
    }
  };

  useEffect(() => {
    if (showCreate) searchSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCreate]);

  const selectSale = async (saleId: string) => {
    try {
      const res = await posApi.getSale(saleId);
      const sale = res.data as SaleDetail;
      setSelectedSale({ ...sale, id: sale.id || saleId });
      setLines(buildReturnLines({ ...sale, id: sale.id || saleId }));
      setLastCreated(null);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load sale'));
    }
  };

  const returnableLines = useMemo(
    () => lines.filter((l) => l.returnable > 0),
    [lines]
  );

  const selectedReturnItems = useMemo(
    () =>
      lines.filter((l) => {
        const q = Number(l.quantity);
        return Number.isInteger(q) && q > 0;
      }),
    [lines]
  );

  const openCreate = () => {
    setShowCreate(true);
    setSelectedSale(null);
    setLines([]);
    setSaleQuery('');
    setRefundMethod('cash');
    setChequeReference('');
    setLastCreated(null);
    idempotencyByFingerprintRef.current = null;
  };

  const closeCreate = () => {
    if (submitting) return;
    setShowCreate(false);
  };

  const submitReturn = async () => {
    if (submitInFlightRef.current || submitting || !selectedSale) return;
    if (selectedReturnItems.length === 0) {
      toast.error('Enter a return quantity for at least one item');
      return;
    }
    for (const line of selectedReturnItems) {
      const q = Number(line.quantity);
      if (!Number.isInteger(q) || q < 1) {
        toast.error(`Invalid quantity for ${line.product_name}`);
        return;
      }
      if (q > line.returnable) {
        toast.error(
          `"${line.product_name}" returnable quantity is ${line.returnable} (sold ${line.sold_qty}, already returned ${line.already_returned}).`
        );
        return;
      }
    }
    if (refundMethod === 'cheque' && !chequeReference.trim()) {
      toast.error('Cheque reference is required for cheque refunds');
      return;
    }
    if (refundMethod === 'credit' && !selectedSale.customer_id) {
      toast.error('Credit refunds require a customer on the sale');
      return;
    }

    const items = selectedReturnItems.map((l) => ({
      product_id: l.product_id,
      quantity: Number(l.quantity),
      inventory_disposition: l.inventory_disposition,
    }));
    const cheque_reference = refundMethod === 'cheque' ? chequeReference.trim() : undefined;
    const fingerprint = returnPayloadFingerprint({
      sale_id: selectedSale.id,
      items,
      refund_method: refundMethod,
      cheque_reference,
    });
    const cached = idempotencyByFingerprintRef.current;
    const idempotency_key =
      cached && cached.fingerprint === fingerprint ? cached.key : newIdempotencyKey();
    idempotencyByFingerprintRef.current = { fingerprint, key: idempotency_key };

    submitInFlightRef.current = true;
    setSubmitting(true);
    try {
      const res = await adminApi.post('/returns', {
        sale_id: selectedSale.id,
        items,
        refund_method: refundMethod,
        ...(cheque_reference ? { cheque_reference } : {}),
        idempotency_key,
      });
      const created = res.data?.return;
      const id = created?.id || String(created?._id || '');
      // Successful commit: clear key so a later distinct return gets a fresh key.
      idempotencyByFingerprintRef.current = null;
      toast.success(
        `Return ${created?.return_number || ''} created${
          created?.total_refund != null ? ` · refund ${formatMoney(created.total_refund)}` : ''
        }`
      );
      setLastCreated({
        id,
        return_number: created?.return_number || '',
        total_refund: Number(created?.total_refund) || 0,
        settlement_status: created?.settlement_status,
      });
      setSettleMethod((created?.refund_method as RefundMethod) || refundMethod);
      setSettleCheque(created?.cheque_reference || chequeReference);
      await selectSale(selectedSale.id);
      fetchReturns();
    } catch (err) {
      // Keep fingerprint→key mapping so an identical retry reuses the same idempotency key.
      toast.error(apiError(err, 'Failed to create POS return'));
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const settleReturn = async (returnId: string, method: RefundMethod, cheque: string) => {
    if (settleInFlightRef.current || settlingId) return;
    if (method === 'cheque' && !cheque.trim()) {
      toast.error('Cheque reference is required for cheque refunds');
      return;
    }
    settleInFlightRef.current = true;
    setSettlingId(returnId);
    try {
      const res = await adminApi.post(`/returns/${returnId}/settle`, {
        refund_method: method,
        ...(method === 'cheque' ? { cheque_reference: cheque.trim() } : {}),
      });
      const settlement = res.data?.settlement;
      toast.success(
        `Return settled${
          settlement?.amount != null ? ` · ${formatMoney(settlement.amount)} via ${settlement.refund_method}` : ''
        }`
      );
      if (lastCreated?.id === returnId) {
        setLastCreated((prev) => (prev ? { ...prev, settlement_status: 'settled' } : prev));
      }
      fetchReturns();
    } catch (err) {
      toast.error(apiError(err, 'Failed to settle return'));
    } finally {
      settleInFlightRef.current = false;
      setSettlingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#0F172A] tracking-tight">POS returns</h1>
          <p className="text-sm text-[#6B6C72] mt-1">
            Return items from a POS sale. Resalable restores stock; damaged does not.
          </p>
        </div>
        <button type="button" onClick={openCreate} className={adminUi.btnPrimary}>
          <Plus className="w-4 h-4" />
          New return
        </button>
      </div>

      <div className="bg-white border border-[#E3E5E8] rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-[#6B6C72] text-center py-16">No POS returns yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F4F5F8] text-[#6B6C72]">
                <tr>
                  <th className="text-left py-3 px-4 font-medium">Return #</th>
                  <th className="text-left py-3 px-4 font-medium">Sale #</th>
                  <th className="text-right py-3 px-4 font-medium">Refund</th>
                  <th className="text-left py-3 px-4 font-medium">Method</th>
                  <th className="text-left py-3 px-4 font-medium">Settlement</th>
                  <th className="text-left py-3 px-4 font-medium">Created</th>
                  <th className="text-right py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => {
                  const unsettled = (row.settlement_status || 'unsettled') !== 'settled';
                  return (
                    <tr key={row.id} className="border-t border-[#E3E5E8]">
                      <td className="py-3 px-4 font-mono font-medium">{row.return_number}</td>
                      <td className="py-3 px-4 font-mono">{row.sale_number || '—'}</td>
                      <td className="py-3 px-4 text-right tabular-nums">{formatMoney(row.total_refund)}</td>
                      <td className="py-3 px-4 capitalize">{row.refund_method || '—'}</td>
                      <td className="py-3 px-4">
                        <span className={unsettled ? adminUi.badgeUnpaid : adminUi.badgePaid}>
                          {row.settlement_status || 'unsettled'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[#6B6C72] whitespace-nowrap">{formatDate(row.created_at)}</td>
                      <td className="py-3 px-4 text-right">
                        {unsettled ? (
                          <button
                            type="button"
                            disabled={!!settlingId}
                            className="text-[#0077C5] hover:underline font-medium disabled:opacity-50"
                            onClick={() => {
                              const method = (row.refund_method as RefundMethod) || 'cash';
                              if (method === 'cheque') {
                                const ref = window.prompt('Cheque reference for settlement:');
                                if (!ref?.trim()) return;
                                settleReturn(row.id, 'cheque', ref.trim());
                                return;
                              }
                              if (
                                !confirm(
                                  `Settle ${row.return_number} for ${formatMoney(row.total_refund)} via ${method}?`
                                )
                              ) {
                                return;
                              }
                              settleReturn(row.id, method, '');
                            }}
                          >
                            {settlingId === row.id ? 'Settling…' : settlingId ? 'Wait…' : 'Settle'}
                          </button>
                        ) : (
                          <span className="text-[#6B6C72]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div
            className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-bold text-gray-900">New POS return</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Select a sale, choose quantities and disposition, then submit.
                </p>
              </div>
              <button type="button" onClick={closeCreate} className="p-2 rounded-lg hover:bg-gray-100" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {!selectedSale ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={saleQuery}
                        onChange={(e) => setSaleQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            searchSales();
                          }
                        }}
                        placeholder="Filter by sale #, customer, phone…"
                        className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm"
                      />
                    </div>
                    <button type="button" onClick={searchSales} className={adminUi.btnSecondary}>
                      Refresh
                    </button>
                  </div>
                  {salesLoading ? (
                    <div className="flex justify-center py-10">
                      <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
                    </div>
                  ) : sales.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">No POS sales found.</p>
                  ) : (
                    <div className="border border-gray-200 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left py-2 px-3">Sale #</th>
                            <th className="text-left py-2 px-3">Customer</th>
                            <th className="text-right py-2 px-3">Total</th>
                            <th className="text-left py-2 px-3">Date</th>
                            <th className="w-24" />
                          </tr>
                        </thead>
                        <tbody>
                          {sales.map((s) => (
                            <tr key={s.id} className="border-t border-gray-100">
                              <td className="py-2 px-3 font-mono">{s.sale_number}</td>
                              <td className="py-2 px-3">{s.customer_name || s.customer_phone || '—'}</td>
                              <td className="py-2 px-3 text-right">{formatMoney(Number(s.total_amount) || 0)}</td>
                              <td className="py-2 px-3 text-gray-500 whitespace-nowrap">{formatDate(s.created_at)}</td>
                              <td className="py-2 px-3 text-right">
                                <button
                                  type="button"
                                  className="text-[#0077C5] hover:underline font-medium"
                                  onClick={() => selectSale(s.id)}
                                >
                                  Select
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900 font-mono">{selectedSale.sale_number}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {selectedSale.customer_name || selectedSale.customer_phone || 'Walk-in'} ·{' '}
                        {formatDate(selectedSale.created_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-sm text-[#0077C5] hover:underline"
                      onClick={() => {
                        setSelectedSale(null);
                        setLines([]);
                        setLastCreated(null);
                      }}
                    >
                      Change sale
                    </button>
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p>
                      <strong>Resalable</strong> — inventory comes back (RETURN_IN).{' '}
                      <strong>Damaged</strong> — no inventory increase.
                    </p>
                    <p className="mt-1">Quantities cannot exceed the sale&apos;s remaining returnable amount.</p>
                  </div>

                  {returnableLines.length === 0 ? (
                    <p className="text-sm text-gray-500 py-6 text-center">
                      Nothing left to return on this sale.
                    </p>
                  ) : (
                    <div className="border border-gray-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-sm min-w-[720px]">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left py-2 px-3">Product</th>
                            <th className="text-right py-2 px-3">Sold</th>
                            <th className="text-right py-2 px-3">Already returned</th>
                            <th className="text-right py-2 px-3">Returnable</th>
                            <th className="text-right py-2 px-3">Return qty</th>
                            <th className="text-left py-2 px-3">Disposition</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line, idx) => (
                            <tr key={line.product_id} className="border-t border-gray-100">
                              <td className="py-2 px-3 font-medium">{line.product_name}</td>
                              <td className="py-2 px-3 text-right font-mono">{line.sold_qty}</td>
                              <td className="py-2 px-3 text-right font-mono">{line.already_returned}</td>
                              <td className="py-2 px-3 text-right font-mono font-semibold">{line.returnable}</td>
                              <td className="py-2 px-3 text-right">
                                {line.returnable > 0 ? (
                                  <NumberInput
                                    min={0}
                                    max={line.returnable}
                                    value={line.quantity}
                                    onValueChange={(n) => {
                                      setLines((prev) => {
                                        const next = [...prev];
                                        const q = n === '' ? '' : Math.min(line.returnable, Math.max(0, Number(n) || 0));
                                        next[idx] = { ...next[idx], quantity: q };
                                        return next;
                                      });
                                    }}
                                    className="w-20 text-right border border-gray-300 rounded px-2 py-1"
                                  />
                                ) : (
                                  <span className="text-gray-400">0</span>
                                )}
                              </td>
                              <td className="py-2 px-3">
                                <select
                                  value={line.inventory_disposition}
                                  disabled={line.returnable <= 0}
                                  onChange={(e) => {
                                    const v = e.target.value as Disposition;
                                    setLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], inventory_disposition: v };
                                      return next;
                                    });
                                  }}
                                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                                >
                                  <option value="resalable">Resalable (stock +)</option>
                                  <option value="damaged">Damaged (no stock)</option>
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Refund method</label>
                      <select
                        value={refundMethod}
                        onChange={(e) => setRefundMethod(e.target.value as RefundMethod)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="cash">Cash</option>
                        <option value="cheque">Cheque</option>
                        <option value="credit">Credit</option>
                      </select>
                    </div>
                    {refundMethod === 'cheque' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Cheque reference</label>
                        <input
                          type="text"
                          value={chequeReference}
                          onChange={(e) => setChequeReference(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          placeholder="Cheque #"
                        />
                      </div>
                    )}
                  </div>

                  {lastCreated && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 space-y-3">
                      <p className="text-sm text-emerald-900">
                        Created <span className="font-mono font-semibold">{lastCreated.return_number}</span>
                        {' · '}
                        refund {formatMoney(lastCreated.total_refund)}
                        {' · '}
                        settlement: {lastCreated.settlement_status || 'unsettled'}
                      </p>
                      {lastCreated.settlement_status !== 'settled' && lastCreated.id && (
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="block text-xs font-medium text-emerald-900 mb-1">Settle via</label>
                            <select
                              value={settleMethod}
                              onChange={(e) => setSettleMethod(e.target.value as RefundMethod)}
                              className="border border-emerald-300 rounded px-2 py-1.5 text-sm bg-white"
                            >
                              <option value="cash">Cash</option>
                              <option value="cheque">Cheque</option>
                              <option value="credit">Credit</option>
                            </select>
                          </div>
                          {settleMethod === 'cheque' && (
                            <div>
                              <label className="block text-xs font-medium text-emerald-900 mb-1">Cheque ref</label>
                              <input
                                type="text"
                                value={settleCheque}
                                onChange={(e) => setSettleCheque(e.target.value)}
                                className="border border-emerald-300 rounded px-2 py-1.5 text-sm bg-white"
                              />
                            </div>
                          )}
                          <button
                            type="button"
                            disabled={!!settlingId}
                            className={adminUi.btnPrimary}
                            onClick={() => settleReturn(lastCreated.id, settleMethod, settleCheque)}
                          >
                            {settlingId ? 'Settling…' : 'Settle return'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
              <button type="button" onClick={closeCreate} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">
                Close
              </button>
              {selectedSale && !lastCreated && (
                <button
                  type="button"
                  disabled={submitting || returnableLines.length === 0}
                  onClick={submitReturn}
                  className="px-4 py-2 bg-black text-white rounded-lg hover:bg-[#2C2C2C] disabled:opacity-50"
                >
                  {submitting ? 'Submitting…' : 'Submit return'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
