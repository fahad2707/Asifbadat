'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { adminUi } from '@/lib/admin-ui';
import { downloadPdfFromResponse } from '@/lib/download-pdf';
import { moneyOut } from '@/lib/moneyTone';

export interface CreditMemoDrawerRecord {
  id: string;
  credit_memo_number: string;
  type: 'VENDOR' | 'CUSTOMER';
  vendor_name?: string;
  customer_name?: string;
  reference_invoice_number?: string;
  reference_po_number?: string;
  reason: string;
  affects_inventory: boolean;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: string;
  received_at?: string;
  dispatched_at?: string;
  delivered_at?: string;
  notes?: string;
  created_at: string;
  items?: {
    product_id?: string | { name?: string };
    product_name?: string;
    quantity?: number;
    unit_price?: number;
    tax_percent?: number;
    total?: number;
  }[];
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

export default function CreditMemoDrawer({
  memoId,
  partyType,
  onClose,
  onEdit,
  onChanged,
}: {
  memoId: string | null;
  partyType?: 'VENDOR' | 'CUSTOMER';
  onClose: () => void;
  onEdit: (id: string) => void;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [memo, setMemo] = useState<CreditMemoDrawerRecord | null>(null);
  const [acting, setActing] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    try {
      const res = await adminApi.get(`/credit-memos/${id}`);
      setMemo(res.data);
    } catch {
      toast.error('Failed to load credit memo');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!memoId) {
      setMemo(null);
      return;
    }
    load(memoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoId]);

  if (!memoId) return null;

  const party = memo?.type === 'VENDOR' ? memo.vendor_name : memo?.customer_name;
  const draft = memo?.status === 'DRAFT';
  const customerReturn = memo?.type === 'CUSTOMER';
  const vendorReturn = memo?.type === 'VENDOR';
  const canMarkReceived = customerReturn && memo?.status === 'APPROVED' && memo.affects_inventory;
  const canMarkDispatched = vendorReturn && memo?.status === 'APPROVED' && memo.affects_inventory;
  const canMarkDelivered = vendorReturn && memo?.status === 'ADJUSTED';

  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label="Close credit memo" className="absolute inset-0 bg-[rgba(26,26,26,0.35)]" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[440px] bg-white border-l border-[#E3E5E8] shadow-xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#E3E5E8]">
          <div>
            <p className={adminUi.helper}>
              {(memo?.type || partyType) === 'VENDOR' ? 'Vendor credit memo' : 'Customer credit memo'}
            </p>
            <h2 className="text-xl font-medium text-[#1A1A1A] mt-0.5">{memo?.credit_memo_number || '…'}</h2>
          </div>
          <button type="button" onClick={onClose} className={adminUi.btnIcon} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        {loading || !memo ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
            {customerReturn && (
              <ol className="text-sm text-[#393A3D] space-y-1.5 list-decimal pl-5">
                <li className={draft ? 'font-medium text-[#1A1A1A]' : 'text-[#6B6C72]'}>Approve credit memo — customer balance updates</li>
                <li className={canMarkReceived ? 'font-medium text-[#1A1A1A]' : 'text-[#6B6C72]'}>
                  Mark as received — stock comes back
                  {memo.received_at ? ' (done)' : ''}
                </li>
              </ol>
            )}
            {vendorReturn && (
              <ol className="text-sm text-[#393A3D] space-y-1.5 list-decimal pl-5">
                <li className={draft ? 'font-medium text-[#1A1A1A]' : 'text-[#6B6C72]'}>Approve — what we owe the supplier updates</li>
                <li className={canMarkDispatched ? 'font-medium text-[#1A1A1A]' : 'text-[#6B6C72]'}>
                  Mark dispatched — stock leaves the warehouse
                  {memo.dispatched_at ? ' (done)' : ''}
                </li>
                <li className={canMarkDelivered ? 'font-medium text-[#1A1A1A]' : 'text-[#6B6C72]'}>
                  Mark delivered to supplier
                  {memo.delivered_at ? ' (done)' : ''}
                </li>
              </ol>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-[#E3E5E8] px-3 py-2">
                <p className={adminUi.helper}>Total</p>
                <p className={`text-sm font-medium tabular-nums ${moneyOut}`}>{money(memo.total_amount)}</p>
              </div>
              <div className="rounded-md border border-[#E3E5E8] px-3 py-2">
                <p className={adminUi.helper}>Status</p>
                <p className="text-sm font-medium">
                  {memo.type === 'CUSTOMER' && memo.status === 'ADJUSTED'
                    ? 'Received'
                    : memo.type === 'VENDOR' && memo.status === 'ADJUSTED'
                      ? 'Dispatched'
                      : memo.type === 'VENDOR' && memo.status === 'CLOSED'
                        ? 'Delivered'
                        : memo.status}
                </p>
              </div>
              <div className="rounded-md border border-[#E3E5E8] px-3 py-2">
                <p className={adminUi.helper}>Inventory</p>
                <p className="text-sm font-medium">{memo.affects_inventory ? 'Yes' : 'No'}</p>
              </div>
            </div>
            <section>
              <h3 className={adminUi.sectionTitle}>{memo.type === 'VENDOR' ? 'Vendor' : 'Customer'}</h3>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Name</dt><dd className="text-right">{party || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Reason</dt><dd>{String(memo.reason || '').replace(/_/g, ' ')}</dd></div>
                {memo.reference_invoice_number && (
                  <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Invoice</dt><dd className="font-mono">{memo.reference_invoice_number}</dd></div>
                )}
                {memo.reference_po_number && (
                  <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">PO</dt><dd className="font-mono">{memo.reference_po_number}</dd></div>
                )}
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Date</dt><dd>{fmtDate(memo.created_at)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Subtotal</dt><dd className="tabular-nums">{money(memo.subtotal)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Tax</dt><dd className="tabular-nums">{money(memo.tax_amount)}</dd></div>
              </dl>
            </section>
            {memo.items && memo.items.length > 0 && (
              <section>
                <h3 className={adminUi.sectionTitle}>Line items</h3>
                <div className="mt-2 border border-[#E3E5E8] rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-[#FAFAFA] text-[#6B6C72]">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-medium">Item</th>
                        <th className="text-right px-2 py-1.5 font-medium">Qty</th>
                        <th className="text-right px-2 py-1.5 font-medium">Price</th>
                        <th className="text-right px-2 py-1.5 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {memo.items.map((item, idx) => (
                        <tr key={idx} className="border-t border-[#E3E5E8]">
                          <td className="px-2 py-1.5">{item.product_name || (typeof item.product_id === 'object' ? item.product_id?.name : '—')}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{Number(item.quantity || 0)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{money(Number(item.unit_price || 0))}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{money(Number(item.total ?? 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {memo.notes && (
              <section>
                <h3 className={adminUi.sectionTitle}>Notes</h3>
                <p className="mt-2 text-sm text-[#1A1A1A]">{memo.notes}</p>
              </section>
            )}
          </div>
        )}
        {memo && (
          <div className="border-t border-[#E3E5E8] px-5 py-3 flex flex-wrap gap-2">
            {draft && memo.type !== 'VENDOR' && (
              <button type="button" onClick={() => onEdit(memo.id)} className={adminUi.btnSecondary}>
                View/Edit
              </button>
            )}
            <button
              type="button"
              className={adminUi.btnSecondary}
              onClick={async () => {
                try {
                  const res = await adminApi.get(`/credit-memos/${memo.id}/pdf`, { responseType: 'blob' });
                  if (await downloadPdfFromResponse(res.data, `credit-memo-${memo.credit_memo_number}.pdf`, res.headers['content-type'])) {
                    toast.success('PDF downloaded');
                  }
                } catch {
                  toast.error('Failed to download PDF');
                }
              }}
            >
              Print / PDF
            </button>
            {draft && (
              <button
                type="button"
                disabled={acting}
                className={`${adminUi.btnPrimary} disabled:opacity-50`}
                onClick={async () => {
                  if (
                    !confirm(
                      customerReturn
                        ? 'Approve this credit memo? The customer balance will update. Stock updates only after you mark it received.'
                        : 'Approve this credit memo? What we owe the supplier will update. Stock leaves only after you mark it dispatched.'
                    )
                  )
                    return;
                  setActing(true);
                  try {
                    await adminApi.post(`/credit-memos/${memo.id}/approve`);
                    toast.success('Credit memo approved');
                    onChanged();
                    await load(memo.id);
                  } catch (err: any) {
                    toast.error(err.response?.data?.error || 'Failed to approve');
                  } finally {
                    setActing(false);
                  }
                }}
              >
                Approve
              </button>
            )}
            {canMarkDispatched && (
              <button
                type="button"
                disabled={acting}
                className={`${adminUi.btnPrimary} disabled:opacity-50`}
                onClick={async () => {
                  if (!confirm(`Mark ${memo.credit_memo_number} as dispatched?\n\nStock will leave the warehouse now.`)) return;
                  setActing(true);
                  try {
                    await adminApi.post(`/credit-memos/${memo.id}/mark-dispatched`);
                    toast.success('Dispatched — stock updated');
                    onChanged();
                    await load(memo.id);
                  } catch (err: any) {
                    toast.error(err.response?.data?.error || 'Failed to mark dispatched');
                  } finally {
                    setActing(false);
                  }
                }}
              >
                Mark dispatched
              </button>
            )}
            {canMarkDelivered && (
              <button
                type="button"
                disabled={acting}
                className={`${adminUi.btnPrimary} disabled:opacity-50`}
                onClick={async () => {
                  if (!confirm(`Mark ${memo.credit_memo_number} as delivered to the supplier?`)) return;
                  setActing(true);
                  try {
                    await adminApi.post(`/credit-memos/${memo.id}/mark-delivered`);
                    toast.success('Delivered to supplier');
                    onChanged();
                    await load(memo.id);
                  } catch (err: any) {
                    toast.error(err.response?.data?.error || 'Failed to mark delivered');
                  } finally {
                    setActing(false);
                  }
                }}
              >
                Mark delivered
              </button>
            )}
            {canMarkReceived && (
              <button
                type="button"
                disabled={acting}
                className={`${adminUi.btnPrimary} disabled:opacity-50`}
                onClick={async () => {
                  if (!confirm(`Mark ${memo.credit_memo_number} as received?\n\nStock will be updated now.`)) return;
                  setActing(true);
                  try {
                    await adminApi.post(`/credit-memos/${memo.id}/mark-received`);
                    toast.success('Marked received — stock updated');
                    onChanged();
                    await load(memo.id);
                  } catch (err: any) {
                    toast.error(err.response?.data?.error || 'Failed to mark received');
                  } finally {
                    setActing(false);
                  }
                }}
              >
                Mark as received
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
