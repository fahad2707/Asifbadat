'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import adminApi, { uploadApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { adminUi } from '@/lib/admin-ui';
import { downloadPdfFromResponse } from '@/lib/download-pdf';

interface POItem {
  product_id: string;
  product_name: string;
  quantity_ordered: number;
  quantity_received?: number;
  unit_cost: number;
  subtotal: number;
}

interface PO {
  id: string;
  po_number: string;
  vendor?: { name?: string };
  vendor_name?: string;
  status: string;
  items: POItem[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  notes?: string;
  created_at: string;
  received_at?: string;
  vendor_invoice_url?: string | null;
  vendor_invoice_name?: string | null;
  vendor_invoice_uploaded_at?: string | null;
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

function lineProductId(item: POItem): string {
  const p = item.product_id as unknown;
  if (!p) return '';
  if (typeof p === 'string') return p;
  const rec = p as { _id?: unknown; id?: unknown };
  return String(rec._id || rec.id || p);
}

export default function PurchaseOrderDrawer({
  poId,
  onClose,
  onEdit,
  onChanged,
}: {
  poId: string | null;
  onClose: () => void;
  onEdit: (id: string) => void;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [po, setPo] = useState<PO | null>(null);
  const [acting, setActing] = useState(false);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const vendorInvoiceInputRef = useRef<HTMLInputElement>(null);

  const load = async (id: string) => {
    setLoading(true);
    try {
      const res = await adminApi.get(`/purchase-orders/${id}`);
      setPo(res.data);
    } catch {
      toast.error('Failed to load purchase order');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!poId) {
      setPo(null);
      return;
    }
    load(poId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId]);

  if (!poId) return null;

  const canReceive = po && ['draft', 'sent', 'partial'].includes(po.status);
  const canEdit = po?.status === 'draft';

  const receiveRemaining = async () => {
    if (!po || acting) return;
    const items = (po.items || [])
      .map((i) => {
        const remaining = Number(i.quantity_ordered || 0) - Number(i.quantity_received || 0);
        return { product_id: lineProductId(i), quantity_received: remaining };
      })
      .filter((i) => i.product_id && i.quantity_received > 0);
    if (items.length === 0) {
      toast.error('Nothing left to receive');
      return;
    }
    if (!confirm(`Mark remaining stock as received for ${po.po_number}? Inventory will increase.`)) return;
    setActing(true);
    try {
      await adminApi.post(`/purchase-orders/${po.id}/receive`, { items });
      toast.success('Stock received and inventory updated');
      onChanged();
      await load(po.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to receive stock');
    } finally {
      setActing(false);
    }
  };

  const uploadVendorInvoice = async (file: File | undefined) => {
    if (!po || !file) return;
    const name = file.name.toLowerCase();
    const ok =
      file.type === 'image/jpeg' ||
      file.type === 'application/pdf' ||
      name.endsWith('.jpg') ||
      name.endsWith('.jpeg') ||
      name.endsWith('.pdf');
    if (!ok) {
      toast.error('Upload a JPG or PDF of the vendor invoice');
      return;
    }
    setUploadingInvoice(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await uploadApi.post(`/purchase-orders/${po.id}/vendor-invoice`, form);
      setPo((prev) =>
        prev
          ? {
              ...prev,
              vendor_invoice_url: data.vendor_invoice_url,
              vendor_invoice_name: data.vendor_invoice_name,
              vendor_invoice_uploaded_at: data.vendor_invoice_uploaded_at,
            }
          : prev
      );
      toast.success('Vendor invoice saved for reference');
      onChanged();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to upload vendor invoice');
    } finally {
      setUploadingInvoice(false);
      if (vendorInvoiceInputRef.current) vendorInvoiceInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label="Close purchase order" className="absolute inset-0 bg-[rgba(26,26,26,0.35)]" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[440px] bg-white border-l border-[#E3E5E8] shadow-xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#E3E5E8]">
          <div>
            <p className={adminUi.helper}>Purchase order</p>
            <h2 className="text-xl font-medium text-[#1A1A1A] mt-0.5">{po?.po_number || '…'}</h2>
          </div>
          <button type="button" onClick={onClose} className={adminUi.btnIcon} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        {loading || !po ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-[#E3E5E8] px-3 py-2">
                <p className={adminUi.helper}>Total</p>
                <p className="text-sm font-medium tabular-nums">{money(po.total_amount)}</p>
              </div>
              <div className="rounded-md border border-[#E3E5E8] px-3 py-2">
                <p className={adminUi.helper}>Status</p>
                <p className="text-sm font-medium capitalize">{po.status}</p>
              </div>
              <div className="rounded-md border border-[#E3E5E8] px-3 py-2">
                <p className={adminUi.helper}>Received</p>
                <p className="text-sm font-medium">{fmtDate(po.received_at)}</p>
              </div>
            </div>
            <section>
              <h3 className={adminUi.sectionTitle}>Vendor</h3>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Name</dt><dd className="text-right">{po.vendor?.name || po.vendor_name || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Date</dt><dd>{fmtDate(po.created_at)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Subtotal</dt><dd className="tabular-nums">{money(po.subtotal)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[#6B6C72]">Tax</dt><dd className="tabular-nums">{money(po.tax_amount)}</dd></div>
              </dl>
            </section>
            {po.items && po.items.length > 0 && (
              <section>
                <h3 className={adminUi.sectionTitle}>Line items</h3>
                <div className="mt-2 border border-[#E3E5E8] rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-[#FAFAFA] text-[#6B6C72]">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-medium">Item</th>
                        <th className="text-right px-2 py-1.5 font-medium">Ordered</th>
                        <th className="text-right px-2 py-1.5 font-medium">Received</th>
                        <th className="text-right px-2 py-1.5 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.items.map((item, idx) => (
                        <tr key={idx} className="border-t border-[#E3E5E8]">
                          <td className="px-2 py-1.5">{item.product_name || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{item.quantity_ordered}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{item.quantity_received || 0}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{money(item.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {po.notes && (
              <section>
                <h3 className={adminUi.sectionTitle}>Notes</h3>
                <p className="mt-2 text-sm text-[#1A1A1A]">{po.notes}</p>
              </section>
            )}
            <section>
              <h3 className={adminUi.sectionTitle}>Vendor invoice</h3>
              <p className={`${adminUi.helper} mt-1`}>Upload the JPG or PDF the vendor sent, for future reference. This does not replace the PO we generate.</p>
              <input
                ref={vendorInvoiceInputRef}
                type="file"
                accept=".jpg,.jpeg,.pdf,image/jpeg,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  void uploadVendorInvoice(file);
                }}
              />
              {po.vendor_invoice_url ? (
                <div className="mt-3 rounded-md border border-[#E3E5E8] px-3 py-2 space-y-2">
                  <p className="text-sm font-medium text-[#1A1A1A] break-all">{po.vendor_invoice_name || 'Vendor invoice'}</p>
                  {po.vendor_invoice_uploaded_at && (
                    <p className={adminUi.helper}>Saved {fmtDate(po.vendor_invoice_uploaded_at)}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={po.vendor_invoice_url}
                      target="_blank"
                      rel="noreferrer"
                      className={adminUi.btnSecondary}
                    >
                      View
                    </a>
                    <button
                      type="button"
                      disabled={uploadingInvoice}
                      onClick={() => vendorInvoiceInputRef.current?.click()}
                      className={`${adminUi.btnSecondary} disabled:opacity-50`}
                    >
                      {uploadingInvoice ? 'Uploading…' : 'Replace'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={uploadingInvoice}
                  onClick={() => vendorInvoiceInputRef.current?.click()}
                  className={`${adminUi.btnSecondary} mt-3 disabled:opacity-50`}
                >
                  {uploadingInvoice ? 'Uploading…' : 'Upload JPG or PDF'}
                </button>
              )}
            </section>
          </div>
        )}
        {po && (
          <div className="border-t border-[#E3E5E8] px-5 py-3 flex flex-wrap gap-2">
            {canEdit && (
              <button type="button" onClick={() => onEdit(po.id)} className={adminUi.btnSecondary}>
                View/Edit
              </button>
            )}
            <button
              type="button"
              className={adminUi.btnSecondary}
              onClick={async () => {
                try {
                  const res = await adminApi.get(`/purchase-orders/${po.id}/pdf`, { responseType: 'blob' });
                  if (await downloadPdfFromResponse(res.data, `po-${po.po_number}.pdf`, res.headers['content-type'])) {
                    toast.success('PDF downloaded');
                  }
                } catch {
                  toast.error('Failed to download PDF');
                }
              }}
            >
              Print / PDF
            </button>
            {canReceive && (
              <button type="button" disabled={acting} onClick={receiveRemaining} className={`${adminUi.btnPrimary} disabled:opacity-50`}>
                {acting ? 'Receiving…' : 'Receive stock'}
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
