'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { adminUi } from '@/lib/admin-ui';
import NumberInput from '@/components/admin/NumberInput';
import { moneyOut } from '@/lib/moneyTone';

type VendorOpt = { id: string; name: string; supplier_id?: string };

type PoLine = {
  product_id: string;
  product_name: string;
  quantity_received: number;
  quantity_credited: number;
  quantity_remaining: number;
  unit_cost: number;
};

type PoOpt = {
  id: string;
  po_number: string;
  status: string;
  created_at?: string;
  received_at?: string;
  total_amount: number;
  items: PoLine[];
};

const REASONS = ['RETURN', 'DAMAGED', 'RATE_DIFFERENCE', 'SCHEME', 'OTHER'] as const;

function money(n: number) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function fmtDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function VendorCreditMemoLightbox({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [vendors, setVendors] = useState<VendorOpt[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [pos, setPos] = useState<PoOpt[]>([]);
  const [loadingPos, setLoadingPos] = useState(false);
  const [poId, setPoId] = useState('');
  const [reason, setReason] = useState<(typeof REASONS)[number]>('RETURN');
  const [notes, setNotes] = useState('');
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVendorId('');
    setPoId('');
    setPos([]);
    setReturnQty({});
    setReason('RETURN');
    setNotes('');
    adminApi
      .get('/vendors', { params: { limit: 5000 } })
      .then((r) => setVendors(r.data.vendors || []))
      .catch(() => toast.error('Failed to load suppliers'));
  }, [open]);

  useEffect(() => {
    if (!open || !vendorId) {
      setPos([]);
      setPoId('');
      return;
    }
    setLoadingPos(true);
    adminApi
      .get('/credit-memos/vendor-pos', { params: { vendor_id: vendorId } })
      .then((r) => {
        setPos(r.data.purchase_orders || []);
        setPoId('');
        setReturnQty({});
      })
      .catch((err) => {
        toast.error(err?.response?.data?.error || 'Failed to load purchase orders');
        setPos([]);
      })
      .finally(() => setLoadingPos(false));
  }, [open, vendorId]);

  const selected = pos.find((p) => p.id === poId) || null;
  const returnableLines = selected?.items.filter((line) => line.quantity_remaining > 0) || [];

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const line of returnableLines) {
      const qty = Number(returnQty[`${line.product_id}:${line.unit_cost}`] || 0);
      if (qty > 0) subtotal += qty * line.unit_cost;
    }
    return { subtotal, total: subtotal };
  }, [returnableLines, returnQty]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorId) {
      toast.error('Select a supplier');
      return;
    }
    if (!selected) {
      toast.error('Choose a purchase order');
      return;
    }
    const items = returnableLines
      .map((line) => ({
        product_id: line.product_id,
        product_name: line.product_name,
        quantity: Number(returnQty[`${line.product_id}:${line.unit_cost}`] || 0),
        unit_price: line.unit_cost,
      }))
      .filter((i) => i.quantity > 0);
    if (!items.length) {
      toast.error('Enter a return quantity on at least one item');
      return;
    }
    setSubmitting(true);
    try {
      const res = await adminApi.post('/credit-memos', {
        type: 'VENDOR',
        vendor_id: vendorId,
        reason,
        reference_purchase_order_id: selected.id,
        notes: notes || undefined,
        items,
      });
      toast.success(`Credit memo ${res.data.credit_memo_number} saved — approve, dispatch, then mark delivered`);
      onSaved(res.data.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not save credit memo');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900">New supplier credit memo</h2>
            <p className="text-xs text-gray-500 mt-0.5">Pick the supplier, then the purchase order, then the quantities to return.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                <select
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select supplier</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.supplier_id ? ` – ${v.supplier_id}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  {REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!vendorId ? (
              <p className="text-sm text-gray-500">Select a supplier to see their purchase orders, newest first.</p>
            ) : loadingPos ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
              </div>
            ) : pos.length === 0 ? (
              <p className="text-sm text-gray-500">No received purchase orders for this supplier.</p>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium">PO</th>
                      <th className="text-left py-2 px-3 font-medium">Date</th>
                      <th className="text-right py-2 px-3 font-medium">Total</th>
                      <th className="text-left py-2 px-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pos.map((po) => {
                      const remaining = po.items.reduce((s, l) => s + l.quantity_remaining, 0);
                      return (
                        <tr
                          key={po.id}
                          className={`border-t border-gray-100 cursor-pointer ${poId === po.id ? 'bg-[#E6F4FB]' : 'hover:bg-gray-50'} ${remaining === 0 ? 'opacity-50' : ''}`}
                          onClick={() => {
                            setPoId(po.id);
                            setReturnQty({});
                          }}
                        >
                          <td className="py-2 px-3 font-mono font-medium">{po.po_number}</td>
                          <td className="py-2 px-3">{fmtDate(po.received_at || po.created_at)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{money(po.total_amount)}</td>
                          <td className="py-2 px-3">{remaining === 0 ? 'Fully credited' : po.status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {selected && (
              <div>
                <p className="text-sm font-medium text-gray-800 mb-2">{selected.po_number} — costs we paid, return what goes back</p>
                {returnableLines.length === 0 ? (
                  <p className="text-sm text-gray-500">Every received line on this PO is already credited.</p>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="text-left py-2 px-3 font-medium">Item</th>
                          <th className="text-right py-2 px-3 font-medium">Received</th>
                          <th className="text-right py-2 px-3 font-medium">Already credited</th>
                          <th className="text-right py-2 px-3 font-medium">Cost</th>
                          <th className="text-right py-2 px-3 font-medium">Return qty</th>
                          <th className="text-right py-2 px-3 font-medium">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {returnableLines.map((line) => {
                          const key = `${line.product_id}:${line.unit_cost}`;
                          const qty = Number(returnQty[key] || 0);
                          const credit = qty * line.unit_cost;
                          return (
                            <tr key={key} className="border-t border-gray-100">
                              <td className="py-2 px-3">{line.product_name || 'Item'}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{line.quantity_received}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{line.quantity_credited}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{money(line.unit_cost)}</td>
                              <td className="py-2 px-3 text-right">
                                <NumberInput
                                  min={0}
                                  max={line.quantity_remaining}
                                  step={1}
                                  value={qty}
                                  onValueChange={(n) => {
                                    const next = n === '' ? 0 : Math.min(line.quantity_remaining, Math.max(0, Math.floor(Number(n))));
                                    setReturnQty((prev) => ({ ...prev, [key]: next }));
                                  }}
                                  className="w-20 text-right border border-gray-300 rounded px-2 py-1 ml-auto"
                                />
                                <span className="block text-[11px] text-gray-400">of {line.quantity_remaining}</span>
                              </td>
                              <td className={`py-2 px-3 text-right tabular-nums ${qty ? moneyOut : ''}`}>{qty ? money(credit) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Optional" />
                </div>
                <p className={`mt-3 text-right font-semibold ${moneyOut}`}>Total credit: {money(totals.total)}</p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
            <button type="button" onClick={onClose} className={adminUi.btnSecondary}>
              Cancel
            </button>
            <button type="submit" disabled={submitting} className={`${adminUi.btnPrimary} disabled:opacity-50`}>
              {submitting ? 'Saving…' : 'Save credit memo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
