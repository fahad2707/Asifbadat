'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import toast from 'react-hot-toast';
import { adminUi } from '@/lib/admin-ui';

export interface InvoiceHistoryTarget {
  id: string;
  invoice_number: string;
  invoice_type?: string;
}

interface InvoiceDetail {
  id: string;
  invoice_number: string;
  invoice_type?: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  customer_address?: string;
  location_of_sale?: string;
  invoice_date?: string;
  due_date?: string;
  created_at?: string;
  updated_at?: string;
  terms?: string;
  payment_method?: string;
  shipping_type?: string;
  quote_status?: 'open' | 'rejected' | 'converted';
  converted_invoice_number?: string;
  payment_status?: string;
  subtotal_amount?: number;
  tax_amount?: number;
  total_amount: number;
  amount_paid?: number;
  items?: { product_name?: string; quantity?: number; price?: number; subtotal?: number }[];
}

interface ReceiptRow {
  id: string;
  trx_id?: string;
  trx_date?: string;
  created_at?: string;
  invoice_num?: string;
  pmt_mode?: string;
  amount_received?: number;
  so_id?: string;
  customer_name?: string;
}

interface InvoiceHistoryDrawerProps {
  invoiceId: string | null;
  refreshKey?: number;
  onClose: () => void;
  onEdit: (id: string) => void;
  onReceivePayment: (inv: { id: string; customer_id?: string }) => void;
  onChanged: () => void;
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

function fmtDateTime(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function quoteStatus(inv?: InvoiceDetail | null) {
  if (inv?.quote_status) return inv.quote_status;
  const raw = String(inv?.shipping_type || '');
  if (raw === 'rejected') return 'rejected';
  if (raw.startsWith('converted:')) return 'converted';
  return 'open';
}

export default function InvoiceHistoryDrawer({ invoiceId, refreshKey = 0, onClose, onEdit, onReceivePayment, onChanged }: InvoiceHistoryDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [acting, setActing] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    try {
      const detailRes = await adminApi.get(`/invoices/${id}`);
      const detail = detailRes.data as InvoiceDetail;
      setInvoice(detail);

      if ((detail.invoice_type || 'invoice') === 'quotation') {
        setReceipts([]);
      } else {
        const recRes = await adminApi.get('/receipts', { params: { search: detail.invoice_number, limit: 500 } });
        const list: ReceiptRow[] = recRes.data?.receipts || recRes.data || [];
        const exact = list
          .filter((r) => String(r.invoice_num || '') === String(detail.invoice_number))
          .sort((a, b) => {
            const ta = new Date(a.trx_date || a.created_at || 0).getTime();
            const tb = new Date(b.trx_date || b.created_at || 0).getTime();
            return ta - tb;
          });
        setReceipts(exact);
      }
    } catch (error) {
      if (isAdminAuthRedirectError(error)) return;
      toast.error('Failed to load invoice history');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!invoiceId) {
      setInvoice(null);
      setReceipts([]);
      return;
    }
    load(invoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, refreshKey]);

  if (!invoiceId) return null;

  const quote = (invoice?.invoice_type || '') === 'quotation';
  const qStatus = quoteStatus(invoice);
  const total = Number(invoice?.total_amount || 0);
  const paid = Number(invoice?.amount_paid || 0);
  const remaining = Math.max(0, total - paid);
  const paidStatus = (invoice?.payment_status || '').toLowerCase() === 'paid' || remaining <= 0;

  const handleConvert = async () => {
    if (!invoice || acting) return;
    if (!confirm(`Convert ${invoice.invoice_number} to an invoice?\n\nStock will be deducted and the customer will be billed the quoted amounts.`)) return;
    setActing(true);
    try {
      const res = await adminApi.post(`/invoices/${invoice.id}/convert`);
      toast.success(`Converted to ${res.data.invoice_number}`);
      onChanged();
      onClose();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Could not convert quotation');
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    if (!invoice || acting) return;
    if (!confirm(`Mark ${invoice.invoice_number} as rejected?`)) return;
    setActing(true);
    try {
      await adminApi.post(`/invoices/${invoice.id}/reject`);
      toast.success('Quotation marked rejected');
      onChanged();
      await load(invoice.id);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Could not reject quotation');
    } finally {
      setActing(false);
    }
  };

  let runningPaid = 0;

  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label="Close invoice history" className="absolute inset-0 bg-[rgba(26,26,26,0.35)]" onClick={onClose} />
      <aside className="invoice-history-drawer absolute right-0 top-0 h-full w-full max-w-[440px] bg-white border-l border-[#E3E5E8] shadow-xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#E3E5E8]">
          <div>
            <p className={adminUi.helper}>{quote ? 'Quotation' : 'Invoice history'}</p>
            <h2 className="text-xl font-medium text-[#1A1A1A] mt-0.5">{invoice?.invoice_number || '…'}</h2>
          </div>
          <button type="button" onClick={onClose} className={adminUi.btnIcon} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading || !invoice ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-[#E3E5E8] px-3 py-2">
                <p className={adminUi.helper}>Total</p>
                <p className="text-sm font-medium tabular-nums">{money(total)}</p>
              </div>
              <div className="rounded-md border border-[#E3E5E8] px-3 py-2">
                <p className={adminUi.helper}>{quote ? 'Status' : 'Paid'}</p>
                <p className="text-sm font-medium tabular-nums">
                  {quote ? (qStatus === 'converted' ? 'Converted' : qStatus === 'rejected' ? 'Rejected' : 'Open') : money(paid)}
                </p>
              </div>
              <div className="rounded-md border border-[#E3E5E8] px-3 py-2">
                <p className={adminUi.helper}>{quote ? 'Outcome' : 'Remaining'}</p>
                <p className={`text-sm font-medium tabular-nums ${!quote && remaining > 0 ? 'text-[#8A4500]' : ''}`}>
                  {quote
                    ? invoice.converted_invoice_number || (qStatus === 'rejected' ? 'Rejected' : 'Awaiting reply')
                    : remaining <= 0 ? 'Paid' : money(remaining)}
                </p>
              </div>
            </div>

            <section>
              <h3 className={adminUi.sectionTitle}>Customer</h3>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Name</dt><dd className="text-right">{invoice.customer_name || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Phone</dt><dd className="text-right">{invoice.customer_phone || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Email</dt><dd className="text-right break-all">{invoice.customer_email || '—'}</dd></div>
                {invoice.customer_address && (
                  <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Address</dt><dd className="text-right">{invoice.customer_address}</dd></div>
                )}
              </dl>
            </section>

            <section>
              <h3 className={adminUi.sectionTitle}>Document</h3>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Date</dt><dd>{fmtDate(invoice.invoice_date || invoice.created_at)}</dd></div>
                {!quote && <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Due</dt><dd>{fmtDate(invoice.due_date)}</dd></div>}
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Terms</dt><dd>{invoice.terms || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Subtotal</dt><dd className="tabular-nums">{money(Number(invoice.subtotal_amount ?? total - Number(invoice.tax_amount || 0)))}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Tax</dt><dd className="tabular-nums">{money(Number(invoice.tax_amount || 0))}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Total</dt><dd className="tabular-nums font-medium">{money(total)}</dd></div>
                {!quote && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#6B6C72]">Payment status</dt>
                    <dd>
                      <span className={paidStatus ? adminUi.badgePaid : adminUi.badgeUnpaid}>{paidStatus ? 'Paid' : 'Unpaid'}</span>
                    </dd>
                  </div>
                )}
                {quote && invoice.converted_invoice_number && (
                  <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Invoice</dt><dd>{invoice.converted_invoice_number}</dd></div>
                )}
              </dl>
            </section>

            {invoice.items && invoice.items.length > 0 && (
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
                      {invoice.items.map((item, idx) => (
                        <tr key={idx} className="border-t border-[#E3E5E8]">
                          <td className="px-2 py-1.5">{item.product_name || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{Number(item.quantity || 0)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{money(Number(item.price || 0))}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{money(Number(item.subtotal || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {!quote && (
              <section>
                <h3 className={adminUi.sectionTitle}>Payment timeline</h3>
                <ol className="mt-3 space-y-0 relative">
                  <li className="relative pl-5 pb-4">
                    <span className="absolute left-1 top-1.5 h-2 w-2 rounded-full bg-[#C7C7C7]" />
                    <span className="absolute left-[7px] top-4 bottom-0 w-px bg-[#E3E5E8]" />
                    <p className="text-sm text-[#1A1A1A]">Invoice created · {money(total)} unpaid</p>
                    <p className={adminUi.helper}>{fmtDateTime(invoice.invoice_date || invoice.created_at)}</p>
                  </li>
                  {receipts.map((r, idx) => {
                    runningPaid += Number(r.amount_received || 0);
                    const after = Math.max(0, total - runningPaid);
                    const last = idx === receipts.length - 1;
                    return (
                      <li key={r.id} className="relative pl-5 pb-4">
                        <span className="absolute left-1 top-1.5 h-2 w-2 rounded-full bg-[#2CA01C]" />
                        {!last && <span className="absolute left-[7px] top-4 bottom-0 w-px bg-[#E3E5E8]" />}
                        <p className="text-sm text-[#1A1A1A]">
                          Paid {money(Number(r.amount_received || 0))}
                          {r.pmt_mode ? ` · ${r.pmt_mode}` : ''}
                        </p>
                        <p className={adminUi.helper}>{fmtDateTime(r.trx_date || r.created_at)}{r.trx_id ? ` · ${r.trx_id}` : ''}</p>
                        {r.so_id && <p className="text-sm text-[#393A3D] mt-1">{r.so_id}</p>}
                        <p className={`${adminUi.helper} mt-1`}>
                          Running paid {money(Math.min(runningPaid, total))} · remaining {after <= 0 ? 'Paid in full' : money(after)}
                        </p>
                      </li>
                    );
                  })}
                  {receipts.length === 0 && (
                    <li className="relative pl-5">
                      <span className="absolute left-1 top-1.5 h-2 w-2 rounded-full bg-[#F5A623]" />
                      <p className="text-sm text-[#8A4500]">No payments yet · {money(remaining)} remaining</p>
                    </li>
                  )}
                </ol>
              </section>
            )}
          </div>
        )}

        {invoice && (
          <div className="border-t border-[#E3E5E8] px-5 py-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => onEdit(invoice.id)} className={adminUi.btnSecondary}>
              View/Edit
            </button>
            {quote && qStatus === 'open' && (
              <>
                <button type="button" onClick={handleConvert} disabled={acting} className={`${adminUi.btnPrimary} disabled:opacity-50`}>
                  {acting ? 'Working…' : 'Convert to invoice'}
                </button>
                <button type="button" onClick={handleReject} disabled={acting} className={`${adminUi.btnDanger} disabled:opacity-50`}>
                  Mark rejected
                </button>
              </>
            )}
            {!quote && remaining > 0 && (
              <button
                type="button"
                onClick={() => onReceivePayment({ id: invoice.id, customer_id: invoice.customer_id })}
                className={adminUi.btnPrimary}
              >
                Receive payment
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
