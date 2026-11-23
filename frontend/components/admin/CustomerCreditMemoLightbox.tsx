'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { adminUi } from '@/lib/admin-ui';
import NumberInput from '@/components/admin/NumberInput';
import { moneyOut } from '@/lib/moneyTone';

type CustomerOpt = { id: string; name: string; company?: string; customer_code?: string };

type InvoiceLine = {
  product_id: string;
  product_name: string;
  quantity_sold: number;
  quantity_credited: number;
  quantity_remaining: number;
  unit_price: number;
  tax_percent: number;
};

type InvoiceOpt = {
  id: string;
  invoice_number: string;
  invoice_date?: string;
  created_at?: string;
  total_amount: number;
  amount_paid?: number;
  payment_status?: string;
  items: InvoiceLine[];
};

const REASONS = ['RETURN', 'DAMAGED', 'RATE_DIFFERENCE', 'SCHEME', 'OTHER'] as const;

type PurchaseSource = {
  product_id: string;
  rate: number | null;
  matched: boolean;
  vendor_name?: string;
  po_number?: string;
  unit_cost?: number;
};

function sourceCaption(source?: PurchaseSource): string {
  if (!source) return 'Looking up the purchase…';
  if (source.matched && source.vendor_name) {
    return `Bought from ${source.vendor_name} at $${Number(source.unit_cost || 0).toFixed(2)} on ${source.po_number || 'the purchase'}`;
  }
  if (source.rate == null) return 'No cost rate on this product, so the supplier cannot be matched';
  return `No received purchase matches the cost rate $${Number(source.rate).toFixed(2)}`;
}

function money(n: number) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function fmtDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function CustomerCreditMemoLightbox({
  open,
  initialCustomerId,
  onClose,
  onSaved,
}: {
  open: boolean;
  initialCustomerId?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [customerId, setCustomerId] = useState(initialCustomerId || '');
  const [invoices, setInvoices] = useState<InvoiceOpt[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [invoiceId, setInvoiceId] = useState('');
  const [reason, setReason] = useState<(typeof REASONS)[number]>('RETURN');
  const [notes, setNotes] = useState('');
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<Record<string, PurchaseSource>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCustomerId(initialCustomerId || '');
    setInvoiceId('');
    setInvoices([]);
    setReturnQty({});
    setReason('RETURN');
    setNotes('');
    adminApi
      .get('/customers', { params: { limit: 5000 } })
      .then((r) => setCustomers(r.data.customers || []))
      .catch(() => toast.error('Failed to load customers'));
  }, [open, initialCustomerId]);

  useEffect(() => {
    if (!open || !customerId) {
      setInvoices([]);
      setInvoiceId('');
      return;
    }
    setLoadingInvoices(true);
    adminApi
      .get('/credit-memos/customer-invoices', { params: { customer_id: customerId } })
      .then((r) => {
        setInvoices(r.data.invoices || []);
        setInvoiceId('');
        setReturnQty({});
      })
      .catch((err) => {
        toast.error(err?.response?.data?.error || 'Failed to load invoices');
        setInvoices([]);
      })
      .finally(() => setLoadingInvoices(false));
  }, [open, customerId]);

  const selected = invoices.find((inv) => inv.id === invoiceId) || null;
  const returnableLines = useMemo(
    () => selected?.items.filter((line) => line.quantity_remaining > 0) || [],
    [selected]
  );

  useEffect(() => {
    if (!open || reason !== 'DAMAGED' || !selected) {
      setSources({});
      return;
    }
    const ids = [...new Set(selected.items.map((line) => line.product_id).filter(Boolean))];
    if (!ids.length) {
      setSources({});
      return;
    }
    let cancelled = false;
    adminApi
      .get('/credit-memos/purchase-source', { params: { product_ids: ids.join(',') } })
      .then((r) => {
        if (cancelled) return;
        const next: Record<string, PurchaseSource> = {};
        for (const row of r.data.sources || []) next[String(row.product_id)] = row;
        setSources(next);
      })
      .catch(() => {
        if (!cancelled) setSources({});
      });
    return () => {
      cancelled = true;
    };
  }, [open, reason, selected]);

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const line of returnableLines) {
      const qty = Number(returnQty[line.product_id + ':' + line.unit_price] || 0);
      if (qty <= 0) continue;
      subtotal += qty * line.unit_price;
    }
    return { subtotal, total: subtotal };
  }, [returnableLines, returnQty]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      toast.error('Select a customer');
      return;
    }
    if (!selected) {
      toast.error('Choose an invoice');
      return;
    }
    const items = returnableLines
      .map((line) => ({
        product_id: line.product_id,
        product_name: line.product_name,
        quantity: Number(returnQty[line.product_id + ':' + line.unit_price] || 0),
        unit_price: line.unit_price,
        tax_percent: 0,
      }))
      .filter((i) => i.quantity > 0);
    if (!items.length) {
      toast.error('Enter a return quantity on at least one item');
      return;
    }
    setSubmitting(true);
    try {
      const res = await adminApi.post('/credit-memos', {
        type: 'CUSTOMER',
        customer_id: customerId,
        reason,
        reference_invoice_id: selected.id,
        notes: notes || undefined,
        items,
      });
      toast.success(
        reason === 'DAMAGED'
          ? `Credit memo ${res.data.credit_memo_number} saved. After you mark it received, these units stay in damaged stock.`
          : `Credit memo ${res.data.credit_memo_number} saved — approve it, then mark as received`
      );
      onSaved(res.data.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not complete credit memo');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900">New customer credit memo</h2>
            <p className="text-xs text-gray-500 mt-0.5">Pick the customer, then the invoice, then the quantities to return.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.company ? ` (${c.company})` : ''}
                      {c.customer_code ? ` – ${c.customer_code}` : ''}
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

            {!customerId ? (
              <p className="text-sm text-gray-500">Select a customer to see their invoices, newest first.</p>
            ) : loadingInvoices ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
              </div>
            ) : invoices.length === 0 ? (
              <p className="text-sm text-gray-500">No picked-up or delivered invoices for this customer.</p>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium">Invoice</th>
                      <th className="text-left py-2 px-3 font-medium">Date</th>
                      <th className="text-right py-2 px-3 font-medium">Total</th>
                      <th className="text-left py-2 px-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const remaining = inv.items.reduce((s, l) => s + l.quantity_remaining, 0);
                      return (
                        <tr
                          key={inv.id}
                          className={`border-t border-gray-100 cursor-pointer ${invoiceId === inv.id ? 'bg-[#E6F4FB]' : 'hover:bg-gray-50'} ${remaining === 0 ? 'opacity-50' : ''}`}
                          onClick={() => {
                            setInvoiceId(inv.id);
                            setReturnQty({});
                          }}
                        >
                          <td className="py-2 px-3 font-mono font-medium">{inv.invoice_number}</td>
                          <td className="py-2 px-3">{fmtDate(inv.invoice_date || inv.created_at)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{money(inv.total_amount)}</td>
                          <td className="py-2 px-3">
                            {remaining === 0 ? 'Fully credited' : (inv.payment_status || 'unpaid')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {selected && (
              <div>
                <p className="text-sm font-medium text-gray-800 mb-2">
                  {selected.invoice_number} — sold prices, return what came back
                </p>
                {reason === 'DAMAGED' && (
                  <p className="text-xs text-gray-500 mb-2">
                    Damaged units are held out of sellable stock. The supplier is whoever sold them at this product’s cost rate.
                  </p>
                )}
                {returnableLines.length === 0 ? (
                  <div>
                    <p className="text-sm text-gray-500">Every line on this invoice is already credited.</p>
                    {reason === 'DAMAGED' && (
                      <ul className="mt-2 text-xs text-gray-600 space-y-1">
                        {selected.items.map((line) => (
                          <li key={`${line.product_id}:${line.unit_price}`}>
                            {line.product_name || 'Item'}: {sourceCaption(sources[line.product_id])}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="text-left py-2 px-3 font-medium">Item</th>
                          <th className="text-right py-2 px-3 font-medium">Sold</th>
                          <th className="text-right py-2 px-3 font-medium">Already credited</th>
                          <th className="text-right py-2 px-3 font-medium">Price</th>
                          <th className="text-right py-2 px-3 font-medium">Return qty</th>
                          <th className="text-right py-2 px-3 font-medium">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {returnableLines.map((line) => {
                          const key = `${line.product_id}:${line.unit_price}`;
                          const qty = Number(returnQty[key] || 0);
                          const credit = qty * line.unit_price;
                          return (
                            <tr key={key} className="border-t border-gray-100">
                              <td className="py-2 px-3">
                                {line.product_name || 'Item'}
                                {reason === 'DAMAGED' && (
                                  <span className="block text-[11px] text-gray-500">{sourceCaption(sources[line.product_id])}</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right tabular-nums">{line.quantity_sold}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{line.quantity_credited}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{money(line.unit_price)}</td>
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
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Optional"
                  />
                </div>
                <div className="mt-3 text-right text-sm space-y-1">
                  <p>Merchandise: <span className="tabular-nums">{money(totals.subtotal)}</span></p>
                  <p className="text-gray-500">Sales tax is not refunded</p>
                  <p className={`font-semibold ${moneyOut}`}>Credit: {money(totals.total)}</p>
                </div>
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
