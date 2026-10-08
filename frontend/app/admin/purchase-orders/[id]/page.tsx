'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Send, Package, Check, Pencil } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import NumberInput from '@/components/admin/NumberInput';
import SearchableProductDropdown, { type ProductOption } from '@/components/admin/SearchableProductDropdown';

interface POItem {
  product_id: string;
  product_name: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  subtotal: number;
}

interface PO {
  id: string;
  po_number: string;
  vendor_id: string;
  vendor: { name: string; contact_name?: string; phone?: string };
  status: string;
  items: POItem[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  expected_date?: string;
  received_at?: string;
  notes?: string;
  created_at: string;
}

type EditRow = {
  product_id: string;
  product_name: string;
  qty: number | '';
  unit_cost: number | '';
};

function lineProductId(item: POItem): string {
  const p = item.product_id as unknown;
  if (typeof p === 'string') return p;
  const rec = p as { _id?: unknown; id?: unknown };
  return String(rec._id || rec.id || '');
}

function apiError(err: unknown, fallback: string) {
  const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

function poStatusLabel(status: string) {
  if (status === 'received') return 'Fully Received';
  if (status === 'partial') return 'Partially Received';
  if (status === 'sent') return 'Sent';
  if (status === 'cancelled') return 'Cancelled';
  return 'Draft';
}

function emptyEditRow(): EditRow {
  return { product_id: '', product_name: '', qty: '', unit_cost: '' };
}

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const [po, setPo] = useState<PO | null>(null);
  const [loading, setLoading] = useState(true);
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [receiving, setReceiving] = useState(false);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editRows, setEditRows] = useState<EditRow[]>([]);
  const [editNotes, setEditNotes] = useState('');
  const [editTax, setEditTax] = useState<number | ''>(0);
  const [editExpectedDate, setEditExpectedDate] = useState('');
  const [products, setProducts] = useState<ProductOption[]>([]);

  const fetchPO = async () => {
    try {
      const res = await adminApi.get(`/purchase-orders/${id}`);
      setPo(res.data);
      const initial: Record<string, number> = {};
      (res.data.items || []).forEach((i: POItem) => {
        const remaining = i.quantity_ordered - (i.quantity_received || 0);
        initial[lineProductId(i)] = remaining > 0 ? remaining : 0;
      });
      setReceiveQty(initial);
      return res.data as PO;
    } catch (err) {
      toast.error(apiError(err, 'Failed to load purchase order'));
      router.push('/admin/purchase-orders');
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    (async () => {
      const loaded = await fetchPO();
      if (loaded?.status === 'draft' && searchParams.get('edit') === '1') {
        startEdit(loaded);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    adminApi
      .get('/products', { params: { limit: 5000 } })
      .then((res) => {
        const list = res.data?.products || [];
        setProducts(
          list.map((p: { id?: string; _id?: string; name: string; cost_price?: number; sku?: string; product_id?: string }) => ({
            id: p.id || String(p._id),
            name: p.name,
            cost_price: p.cost_price,
            sku: p.sku,
            product_id: p.product_id,
          }))
        );
      })
      .catch(() => {});
  }, []);

  const startEdit = (source?: PO) => {
    const current = source || po;
    if (!current || current.status !== 'draft') return;
    const rows: EditRow[] = (current.items || []).map((i) => ({
      product_id: lineProductId(i),
      product_name: i.product_name,
      qty: i.quantity_ordered,
      unit_cost: i.unit_cost,
    }));
    while (rows.length < 3) rows.push(emptyEditRow());
    setEditRows(rows);
    setEditNotes(current.notes || '');
    setEditTax(Number(current.tax_amount) || 0);
    setEditExpectedDate(current.expected_date ? String(current.expected_date).slice(0, 10) : '');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    if (searchParams.get('edit') === '1') {
      router.replace(`/admin/purchase-orders/${id}`);
    }
  };

  const setEditRow = (index: number, patch: Partial<EditRow>) => {
    setEditRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const handleSaveDraft = async () => {
    if (!po || po.status !== 'draft' || saving) return;
    const items = editRows
      .filter((r) => r.product_id && Number(r.qty) > 0)
      .map((r) => ({
        product_id: r.product_id,
        product_name: r.product_name || 'Item',
        quantity_ordered: Math.trunc(Number(r.qty)),
        unit_cost: Number(r.unit_cost) || 0,
      }));
    if (items.length === 0) {
      toast.error('Add at least one product with a positive quantity');
      return;
    }
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.product_id)) {
        toast.error('Each product can appear only once on a purchase order');
        return;
      }
      seen.add(item.product_id);
    }

    setSaving(true);
    try {
      await adminApi.put(`/purchase-orders/${id}`, {
        items,
        notes: editNotes,
        tax_amount: Number(editTax) || 0,
        expected_date: editExpectedDate || undefined,
      });
      toast.success('Draft purchase order updated');
      setEditing(false);
      setLoading(true);
      await fetchPO();
      if (searchParams.get('edit') === '1') {
        router.replace(`/admin/purchase-orders/${id}`);
      }
    } catch (err) {
      toast.error(apiError(err, 'Failed to update purchase order'));
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (sending || editing) return;
    setSending(true);
    try {
      await adminApi.post(`/purchase-orders/${id}/send`);
      toast.success('PO marked as sent');
      await fetchPO();
    } catch (err: unknown) {
      toast.error(apiError(err, 'Failed to mark purchase order as sent'));
    } finally {
      setSending(false);
    }
  };

  const handleReceive = async () => {
    if (!po || editing) return;
    const items = po.items
      .filter((i) => (receiveQty[lineProductId(i)] || 0) > 0)
      .map((i) => ({ product_id: lineProductId(i), quantity_received: receiveQty[lineProductId(i)] || 0 }));
    if (items.length === 0) {
      toast.error('Enter quantities to receive');
      return;
    }
    setReceiving(true);
    try {
      await adminApi.post(`/purchase-orders/${id}/receive`, { items });
      toast.success('Stock updated');
      fetchPO();
    } catch (err: unknown) {
      toast.error(apiError(err, 'Failed to receive'));
    } finally {
      setReceiving(false);
    }
  };

  if (loading || !po) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  const canReceive = !editing && (po.status === 'sent' || po.status === 'partial' || po.status === 'draft');
  const canSend = !editing && po.status === 'draft';
  const canEditDraft = po.status === 'draft';
  const editSubtotal = editRows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unit_cost) || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/purchase-orders" className="inline-flex items-center gap-2 text-teal-450 hover:text-teal-350 hover:underline text-xs font-bold transition-all">
          <ArrowLeft className="w-4 h-4" />
          Back to Purchase order
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#0F172A] tracking-tight">{po.po_number}</h1>
          <div className="text-xs text-slate-400 mt-1.5 flex items-center gap-2">
            <span className="font-semibold text-slate-200">{po.vendor?.name}</span>
            <span>•</span>
            <span
              className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${
                po.status === 'received'
                  ? 'bg-teal-500/10 text-teal-400 border-teal-500/20'
                  : po.status === 'draft'
                  ? 'bg-slate-800 text-slate-400 border-white/10'
                  : po.status === 'partial'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              }`}
            >
              {poStatusLabel(po.status)}
            </span>
            {editing && <span className="text-amber-600 font-semibold">Editing draft</span>}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Status is receiving lifecycle only — not vendor payment.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canEditDraft && !editing && (
            <button
              type="button"
              onClick={() => startEdit()}
              className="bg-white border border-[#C7C7C7] text-[#393A3D] px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 hover:bg-[#F4F5F8]"
            >
              <Pencil className="w-4 h-4" />
              Edit Draft
            </button>
          )}
          {editing && (
            <>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="bg-white border border-[#C7C7C7] text-[#393A3D] px-3 py-2 rounded-md text-sm font-medium disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={saving}
                className="bg-black text-white px-3 py-2 rounded-md text-sm font-medium disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
            </>
          )}
          {canSend && (
            <button
              type="button"
              onClick={handleSend}
              disabled={sending}
              className="bg-[#0F9F8F] hover:bg-[#0B8275] text-white px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
              {sending ? 'Marking as Sent…' : 'Mark as Sent'}
            </button>
          )}
          {canReceive && (
            <button onClick={handleReceive} disabled={receiving} className="bg-[#0F9F8F] hover:bg-[#0B8275] border-transparent text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 disabled:opacity-40">
              <Check className="w-4 h-4" />
              {receiving ? 'Receiving Stock...' : 'Receive Stock'}
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Vendor cannot be changed here (not supported by draft update API). Editing lines does not receive stock.
          </p>
          <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-[#FAFAFA] text-[#6B6C72] border-b border-[#E3E5E8]">
                <tr>
                  <th className="text-left py-3 px-4">Product</th>
                  <th className="text-right py-3 px-4 w-28">Qty</th>
                  <th className="text-right py-3 px-4 w-32">Unit cost</th>
                  <th className="text-right py-3 px-4 w-32">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {editRows.map((row, idx) => (
                  <tr key={idx} className="border-b border-[#E3E5E8]">
                    <td className="py-2 px-4">
                      <SearchableProductDropdown
                        products={products}
                        value={row.product_id}
                        displayName={row.product_name}
                        showPrice={false}
                        onSelect={(p) =>
                          setEditRow(idx, {
                            product_id: p.id,
                            product_name: p.name,
                            unit_cost: row.unit_cost === '' || row.unit_cost === 0 ? Number(p.cost_price) || 0 : row.unit_cost,
                          })
                        }
                      />
                    </td>
                    <td className="py-2 px-4">
                      <NumberInput
                        className="w-full text-right border border-gray-300 rounded px-2 py-1"
                        value={row.qty}
                        onValueChange={(n) => setEditRow(idx, { qty: n === '' ? '' : Math.trunc(n) })}
                      />
                    </td>
                    <td className="py-2 px-4">
                      <NumberInput
                        className="w-full text-right border border-gray-300 rounded px-2 py-1"
                        value={row.unit_cost}
                        showZero
                        onValueChange={(n) => setEditRow(idx, { unit_cost: n })}
                      />
                    </td>
                    <td className="py-2 px-4 text-right font-mono">
                      ${((Number(row.qty) || 0) * (Number(row.unit_cost) || 0)).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="text-sm text-[#0077C5] hover:underline font-medium"
            onClick={() => setEditRows((prev) => [...prev, emptyEditRow()])}
          >
            + Add line
          </button>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl">
            <label className="block space-y-1 text-sm">
              <span className="text-xs text-[#6B6C72]">Tax amount</span>
              <NumberInput
                className="w-full border border-gray-300 rounded px-2 py-1.5"
                value={editTax}
                showZero
                onValueChange={(n) => setEditTax(n)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-xs text-[#6B6C72]">Expected date</span>
              <input
                type="date"
                className="w-full border border-gray-300 rounded px-2 py-1.5"
                value={editExpectedDate}
                onChange={(e) => setEditExpectedDate(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm sm:col-span-3">
              <span className="text-xs text-[#6B6C72]">Notes</span>
              <textarea
                className="w-full border border-gray-300 rounded px-2 py-1.5 min-h-[72px]"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </label>
          </div>
          <div className="text-sm text-right space-y-1 max-w-xs ml-auto">
            <div className="flex justify-between gap-8">
              <span className="text-[#6B6C72]">Subtotal</span>
              <span className="font-mono">${editSubtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between gap-8">
              <span className="text-[#6B6C72]">Tax</span>
              <span className="font-mono">${(Number(editTax) || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between gap-8 font-semibold">
              <span>Total</span>
              <span className="font-mono">${(editSubtotal + (Number(editTax) || 0)).toFixed(2)}</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden mb-6">
            <table className="w-full border-collapse">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                <tr>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Product</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Ordered</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Received</th>
                  {canReceive && <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Qty to Receive</th>}
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Unit Cost</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {po.items?.map((item) => {
                  const remaining = item.quantity_ordered - (item.quantity_received || 0);
                  return (
                    <tr key={lineProductId(item)} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 px-4 text-xs font-semibold text-slate-200">
                        <div className="flex items-center gap-2.5">
                          <Package className="w-4 h-4 text-slate-500" />
                          {item.product_name}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right text-xs font-bold text-slate-300 font-mono">{item.quantity_ordered}</td>
                      <td className="py-3 px-4 text-right text-xs font-semibold text-slate-400 font-mono">{item.quantity_received || 0}</td>
                      {canReceive && (
                        <td className="py-3 px-4 text-right text-xs">
                          {remaining > 0 ? (
                            <NumberInput
                              min={0}
                              max={remaining}
                              value={receiveQty[lineProductId(item)] ?? remaining}
                              onValueChange={(n) => setReceiveQty({ ...receiveQty, [lineProductId(item)]: n === '' ? 0 : Math.trunc(n) })}
                              className="w-20 bg-slate-950/60 border border-white/10 rounded px-2.5 py-1 text-xs text-right text-slate-205 focus:outline-none"
                            />
                          ) : (
                            <span className="text-teal-400 font-bold">Completely Filled</span>
                          )}
                        </td>
                      )}
                      <td className="py-3 px-4 text-right text-xs font-mono font-semibold text-slate-350">${Number(item.unit_cost).toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-xs font-mono font-extrabold text-slate-100">${Number(item.subtotal).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] p-5 max-w-xs ml-auto shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl space-y-2 text-xs text-slate-350">
            <div className="flex justify-between">
              <span className="text-slate-500 font-bold uppercase text-[9px] tracking-wider">Subtotal</span>
              <span className="font-mono text-slate-200 font-bold">${Number(po.subtotal).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-bold uppercase text-[9px] tracking-wider">Tax</span>
              <span className="font-mono text-slate-200 font-bold">${Number(po.tax_amount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-dashed border-white/10 pt-2 text-xs font-bold text-slate-200">
              <span className="text-[10px] uppercase font-bold tracking-wider">Grand Total</span>
              <span className="text-teal-400 font-mono font-extrabold">${Number(po.total_amount).toFixed(2)}</span>
            </div>
          </div>

          {po.notes && (
            <div className="mt-6 p-4 bg-slate-950/40 border border-white/5 rounded-2xl text-xs">
              <p className="text-[10px] text-slate-505 font-bold uppercase tracking-wider mb-1">Billing Notes / Comments</p>
              <p className="text-slate-300 leading-relaxed">{po.notes}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
