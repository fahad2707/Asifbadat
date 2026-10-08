'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { adminUi } from '@/lib/admin-ui';

export type ShipmentStatus =
  | 'PENDING'
  | 'PACKED'
  | 'DISPATCHED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETURNED';

export interface ShipmentDetail {
  id: string;
  shipment_number: string;
  shipment_type: 'GROUND' | 'GROUND_RG';
  linked_invoice_id?: string;
  status: ShipmentStatus;
  transporter_name?: string;
  vehicle_number?: string;
  lr_number?: string;
  dispatch_date?: string;
  expected_delivery_date?: string;
  delivered_date?: string;
  freight_charge?: number;
  weight_kg?: number;
  volume_cbm?: number;
  notes?: string;
  created_at?: string;
  items?: Array<{
    product_id?: string | { _id?: string; name?: string; sku?: string };
    product_name?: string;
    quantity?: number;
    status?: string;
  }>;
}

const STATUS_UPDATES: Array<'PENDING' | 'PACKED' | 'DISPATCHED' | 'IN_TRANSIT'> = [
  'PENDING',
  'PACKED',
  'DISPATCHED',
  'IN_TRANSIT',
];

function fmtDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function itemLabel(item: NonNullable<ShipmentDetail['items']>[number]) {
  if (item.product_name) return item.product_name;
  if (item.product_id && typeof item.product_id === 'object') {
    return item.product_id.name || item.product_id.sku || '—';
  }
  return '—';
}

function apiError(err: unknown, fallback: string) {
  const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

export default function ShipmentDrawer({
  shipmentId,
  invoiceLabel,
  onClose,
  onChanged,
}: {
  shipmentId: string | null;
  invoiceLabel?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [acting, setActing] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    try {
      const res = await adminApi.get(`/shipments/${id}`);
      setShipment(res.data);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load shipment'));
      onClose();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!shipmentId) {
      setShipment(null);
      return;
    }
    load(shipmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipmentId]);

  if (!shipmentId) return null;

  const terminal =
    shipment?.status === 'DELIVERED' ||
    shipment?.status === 'RETURNED' ||
    shipment?.status === 'FAILED';
  const isRg = shipment?.shipment_type === 'GROUND_RG';
  const canUpdateStatus = !!shipment && !terminal;
  const canMarkDelivered = !!shipment && !isRg && shipment.status !== 'DELIVERED' && !terminal;
  const canMarkReturnReceived =
    !!shipment && isRg && shipment.status !== 'RETURNED' && shipment.status !== 'DELIVERED';

  const runAction = async (fn: () => Promise<void>, successMsg: string) => {
    if (acting) return;
    setActing(true);
    try {
      await fn();
      toast.success(successMsg);
      await load(shipmentId);
      onChanged();
    } catch (err) {
      toast.error(apiError(err, 'Action failed'));
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label="Close shipment" className="absolute inset-0 bg-[rgba(26,26,26,0.35)]" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[480px] bg-white border-l border-[#E3E5E8] shadow-xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#E3E5E8]">
          <div>
            <p className={adminUi.helper}>{shipment?.shipment_type || 'Shipment'}</p>
            <h2 className="text-xl font-medium text-[#1A1A1A] mt-0.5 font-mono">
              {shipment?.shipment_number || '…'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className={adminUi.btnIcon} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading || !shipment ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-[#E3E5E8] px-3 py-2">
                <p className={adminUi.helper}>Status</p>
                <p className="text-sm font-medium">{shipment.status}</p>
              </div>
              <div className="rounded-md border border-[#E3E5E8] px-3 py-2">
                <p className={adminUi.helper}>Linked invoice</p>
                <p className="text-sm font-medium truncate">
                  {invoiceLabel || shipment.linked_invoice_id || '—'}
                </p>
              </div>
            </div>

            <section>
              <h3 className={adminUi.sectionTitle}>Logistics</h3>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-[#6B6C72]">Transporter</dt>
                  <dd className="text-right">{shipment.transporter_name || '—'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#6B6C72]">Vehicle</dt>
                  <dd className="text-right font-mono">{shipment.vehicle_number || '—'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#6B6C72]">LR number</dt>
                  <dd className="text-right font-mono">{shipment.lr_number || '—'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#6B6C72]">Freight</dt>
                  <dd className="tabular-nums">
                    {shipment.freight_charge != null
                      ? `$${Number(shipment.freight_charge).toFixed(2)}`
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#6B6C72]">Weight (kg)</dt>
                  <dd className="tabular-nums">{shipment.weight_kg ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#6B6C72]">Volume (cbm)</dt>
                  <dd className="tabular-nums">{shipment.volume_cbm ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#6B6C72]">Dispatch</dt>
                  <dd>{fmtDate(shipment.dispatch_date)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#6B6C72]">ETA</dt>
                  <dd>{fmtDate(shipment.expected_delivery_date)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#6B6C72]">Delivered / returned</dt>
                  <dd>{fmtDate(shipment.delivered_date)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#6B6C72]">Created</dt>
                  <dd>{fmtDate(shipment.created_at)}</dd>
                </div>
              </dl>
            </section>

            {shipment.items && shipment.items.length > 0 && (
              <section>
                <h3 className={adminUi.sectionTitle}>Line items</h3>
                <div className="mt-2 border border-[#E3E5E8] rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-[#FAFAFA] text-[#6B6C72]">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-medium">Item</th>
                        <th className="text-right px-2 py-1.5 font-medium">Qty</th>
                        <th className="text-right px-2 py-1.5 font-medium">Line status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shipment.items.map((item, idx) => (
                        <tr key={idx} className="border-t border-[#E3E5E8]">
                          <td className="px-2 py-1.5">{itemLabel(item)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{Number(item.quantity || 0)}</td>
                          <td className="px-2 py-1.5 text-right">{item.status || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {shipment.notes && (
              <section>
                <h3 className={adminUi.sectionTitle}>Notes</h3>
                <p className="mt-2 text-sm text-[#1A1A1A]">{shipment.notes}</p>
              </section>
            )}
          </div>
        )}

        {shipment && (
          <div className="border-t border-[#E3E5E8] px-5 py-3 space-y-2">
            {canUpdateStatus && (
              <div className="flex flex-wrap gap-2">
                {STATUS_UPDATES.filter((s) => s !== shipment.status).map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={acting}
                    className={adminUi.btnSecondary}
                    onClick={() =>
                      runAction(
                        async () => {
                          await adminApi.patch(`/shipments/${shipment.id}/status`, { status });
                        },
                        `Status set to ${status}`
                      )
                    }
                  >
                    {acting ? 'Updating…' : `Set ${status}`}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {canMarkDelivered && (
                <button
                  type="button"
                  disabled={acting}
                  className={adminUi.btnPrimary}
                  onClick={() => {
                    if (!confirm(`Mark ${shipment.shipment_number} as delivered?`)) return;
                    runAction(async () => {
                      await adminApi.post(`/shipments/${shipment.id}/mark-delivered`, {});
                    }, 'Shipment marked delivered');
                  }}
                >
                  {acting ? 'Marking delivered…' : 'Mark Delivered'}
                </button>
              )}
              {canMarkReturnReceived && (
                <button
                  type="button"
                  disabled={acting}
                  className={adminUi.btnPrimary}
                  onClick={() => {
                    if (
                      !confirm(
                        `Mark Return Received for GROUND_RG shipment ${shipment.shipment_number}?\n\nThis records warehouse receipt of the return. Inventory will update via the shipment return endpoint (not a separate stock adjustment).`
                      )
                    ) {
                      return;
                    }
                    runAction(async () => {
                      await adminApi.post(`/shipments/${shipment.id}/mark-return-received`, {});
                    }, `Return received · ${shipment.shipment_number}`);
                  }}
                >
                  {acting ? 'Marking received…' : 'Mark Return Received'}
                </button>
              )}
              {terminal && (
                <p className={adminUi.helper}>This shipment is {shipment.status.toLowerCase()} and cannot be updated.</p>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
