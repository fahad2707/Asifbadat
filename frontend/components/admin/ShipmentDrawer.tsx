'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { adminUi } from '@/lib/admin-ui';
import ShipmentPackagesSection from '@/components/admin/ShipmentPackagesSection';
import {
  formatShipmentDate,
  shipmentStatusBadgeClass,
  shipmentStatusLabel,
  shipmentTypeBadgeClass,
  shipmentTypeLabel,
} from '@/lib/shipment-display';

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

const STATUS_FLOW: Array<{ value: 'PACKED' | 'IN_TRANSIT'; label: string }> = [
  { value: 'PACKED', label: 'Ready to ship' },
  { value: 'IN_TRANSIT', label: 'Out for delivery' },
];

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
  const [logistics, setLogistics] = useState({
    transporter_name: '',
    vehicle_number: '',
    lr_number: '',
    freight_charge: '',
    expected_delivery_date: '',
    notes: '',
  });
  const [savingLogistics, setSavingLogistics] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    try {
      const res = await adminApi.get(`/shipments/${id}`);
      setShipment(res.data);
      const s = res.data as ShipmentDetail;
      setLogistics({
        transporter_name: s.transporter_name || '',
        vehicle_number: s.vehicle_number || '',
        lr_number: s.lr_number || '',
        freight_charge: s.freight_charge != null ? String(s.freight_charge) : '',
        expected_delivery_date: s.expected_delivery_date ? String(s.expected_delivery_date).slice(0, 10) : '',
        notes: s.notes || '',
      });
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

  const steps = isRg
    ? [
        { key: 'PACKED', label: 'Ready' },
        { key: 'IN_TRANSIT', label: 'In transit' },
        { key: 'RETURNED', label: 'Received' },
      ]
    : [
        { key: 'PACKED', label: 'Ready' },
        { key: 'IN_TRANSIT', label: 'Out for delivery' },
        { key: 'DELIVERED', label: 'Delivered' },
      ];
  const stepIndex = (() => {
    if (shipment?.status === 'RETURNED' || shipment?.status === 'DELIVERED') return 2;
    if (shipment?.status === 'IN_TRANSIT' || shipment?.status === 'DISPATCHED') return 1;
    if (shipment?.status === 'FAILED') return -1;
    return 0;
  })();

  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label="Close shipment" className="absolute inset-0 bg-[rgba(26,26,26,0.35)]" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[560px] bg-white border-l border-[#E3E5E8] shadow-xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-[#E3E5E8]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-medium text-[#1A1A1A] font-mono truncate">
                {shipment?.shipment_number || '…'}
              </h2>
              {shipment && (
                <>
                  <span className={shipmentTypeBadgeClass(shipment.shipment_type)}>
                    {shipmentTypeLabel(shipment.shipment_type)}
                  </span>
                  <span className={shipmentStatusBadgeClass(shipment.status)}>
                    {shipmentStatusLabel(shipment.status)}
                  </span>
                </>
              )}
            </div>
            {shipment && (
              <p className={`${adminUi.helper} mt-1`}>
                Invoice {invoiceLabel || shipment.linked_invoice_id || '—'}
                {shipment.created_at ? ` · ${formatShipmentDate(shipment.created_at)}` : ''}
              </p>
            )}
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
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {stepIndex >= 0 && (
              <ol className="flex items-center gap-2">
                {steps.map((step, i) => {
                  const done = i <= stepIndex;
                  return (
                    <li key={step.key} className="flex items-center gap-2 flex-1 min-w-0">
                      <span
                        className={`w-6 h-6 shrink-0 rounded-full text-[11px] font-medium flex items-center justify-center ${
                          done ? 'bg-black text-white' : 'bg-[#F4F5F8] text-[#8D9096]'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className={`text-xs truncate ${done ? 'text-[#1A1A1A] font-medium' : 'text-[#8D9096]'}`}>
                        {step.label}
                      </span>
                      {i < steps.length - 1 && (
                        <span className={`h-px flex-1 ${i < stepIndex ? 'bg-black' : 'bg-[#E3E5E8]'}`} />
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            <section>
              <h3 className={adminUi.sectionTitle}>Carrier</h3>
              {terminal ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className={adminUi.helper}>Transporter</dt>
                    <dd className="mt-0.5">{shipment.transporter_name || '—'}</dd>
                  </div>
                  <div>
                    <dt className={adminUi.helper}>Vehicle</dt>
                    <dd className="mt-0.5 font-mono">{shipment.vehicle_number || '—'}</dd>
                  </div>
                  <div>
                    <dt className={adminUi.helper}>Tracking / LR</dt>
                    <dd className="mt-0.5">{shipment.lr_number || '—'}</dd>
                  </div>
                  <div>
                    <dt className={adminUi.helper}>{isRg ? 'Received' : 'Delivered'}</dt>
                    <dd className="mt-0.5">{formatShipmentDate(shipment.delivered_date)}</dd>
                  </div>
                  {shipment.notes ? (
                    <div className="col-span-2">
                      <dt className={adminUi.helper}>Notes</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap">{shipment.notes}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block space-y-1 col-span-2 sm:col-span-1">
                    <span className={adminUi.label}>Transporter</span>
                    <input className={adminUi.field} value={logistics.transporter_name} onChange={(e) => setLogistics((p) => ({ ...p, transporter_name: e.target.value }))} />
                  </label>
                  <label className="block space-y-1">
                    <span className={adminUi.label}>Vehicle</span>
                    <input className={adminUi.field} value={logistics.vehicle_number} onChange={(e) => setLogistics((p) => ({ ...p, vehicle_number: e.target.value }))} />
                  </label>
                  <label className="block space-y-1">
                    <span className={adminUi.label}>Tracking / LR</span>
                    <input className={adminUi.field} value={logistics.lr_number} onChange={(e) => setLogistics((p) => ({ ...p, lr_number: e.target.value }))} />
                  </label>
                  <label className="block space-y-1">
                    <span className={adminUi.label}>Freight</span>
                    <input className={adminUi.field} value={logistics.freight_charge} onChange={(e) => setLogistics((p) => ({ ...p, freight_charge: e.target.value }))} />
                  </label>
                  <label className="block space-y-1 col-span-2">
                    <span className={adminUi.label}>Expected delivery</span>
                    <input type="date" className={adminUi.field} value={logistics.expected_delivery_date} onChange={(e) => setLogistics((p) => ({ ...p, expected_delivery_date: e.target.value }))} />
                  </label>
                  <label className="block space-y-1 col-span-2">
                    <span className={adminUi.label}>Notes / ship-to</span>
                    <textarea className={adminUi.field} rows={3} value={logistics.notes} onChange={(e) => setLogistics((p) => ({ ...p, notes: e.target.value }))} />
                  </label>
                  <div className="col-span-2">
                    <button
                      type="button"
                      disabled={savingLogistics}
                      className={adminUi.btnSecondary}
                      onClick={async () => {
                        setSavingLogistics(true);
                        try {
                          await adminApi.patch(`/shipments/${shipment.id}`, {
                            transporter_name: logistics.transporter_name,
                            vehicle_number: logistics.vehicle_number,
                            lr_number: logistics.lr_number,
                            freight_charge:
                              logistics.freight_charge === '' || Number.isNaN(Number(logistics.freight_charge))
                                ? undefined
                                : Number(logistics.freight_charge),
                            expected_delivery_date: logistics.expected_delivery_date || undefined,
                            notes: logistics.notes,
                          });
                          toast.success('Shipment details saved');
                          await load(shipment.id);
                          onChanged();
                        } catch (err) {
                          toast.error(apiError(err, 'Could not save shipment'));
                        } finally {
                          setSavingLogistics(false);
                        }
                      }}
                    >
                      {savingLogistics ? 'Saving…' : 'Save details'}
                    </button>
                  </div>
                </div>
              )}
            </section>

            {shipment.items && shipment.items.length > 0 && (
              <section>
                <h3 className={adminUi.sectionTitle}>Items</h3>
                <div className="mt-3 border border-[#E3E5E8] rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className={adminUi.tableHead}>
                      <tr>
                        <th className="text-left px-3 py-2">Item</th>
                        <th className="text-right px-3 py-2">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shipment.items.map((item, idx) => (
                        <tr key={idx} className="border-t border-[#E3E5E8]">
                          <td className="px-3 py-2">{itemLabel(item)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(item.quantity || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <ShipmentPackagesSection shipmentId={shipment.id} onChanged={onChanged} />
          </div>
        )}

        {shipment && (
          <div className="border-t border-[#E3E5E8] px-6 py-3 flex flex-wrap items-center gap-2">
            {canUpdateStatus &&
              STATUS_FLOW.filter((s) => s.value !== shipment.status).map((status) => (
                <button
                  key={status.value}
                  type="button"
                  disabled={acting}
                  className={adminUi.btnSecondary}
                  onClick={() =>
                    runAction(
                      async () => {
                        await adminApi.patch(`/shipments/${shipment.id}/status`, { status: status.value });
                      },
                      status.label
                    )
                  }
                >
                  {acting ? 'Updating…' : status.label}
                </button>
              ))}
            {canMarkDelivered && (
              <button
                type="button"
                disabled={acting}
                className={adminUi.btnPrimary}
                onClick={() => {
                  if (!confirm(`Mark ${shipment.shipment_number} as delivered?\n\nStock will be deducted now.`)) return;
                  runAction(async () => {
                    await adminApi.post(`/shipments/${shipment.id}/mark-delivered`, {});
                  }, 'Delivered — stock taken');
                }}
              >
                {acting ? 'Marking delivered…' : 'Mark delivered'}
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
                      `Mark ${shipment.shipment_number} as return received?\n\nWarehouse stock will update for this return.`
                    )
                  ) {
                    return;
                  }
                  runAction(async () => {
                    await adminApi.post(`/shipments/${shipment.id}/mark-return-received`, {});
                  }, `Return received · ${shipment.shipment_number}`);
                }}
              >
                {acting ? 'Marking received…' : 'Mark return received'}
              </button>
            )}
            {terminal && (
              <p className={adminUi.helper}>This shipment is {shipmentStatusLabel(shipment.status).toLowerCase()} and cannot be updated.</p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
