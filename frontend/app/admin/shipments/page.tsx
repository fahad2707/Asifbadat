'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { adminUi } from '@/lib/admin-ui';
import NumberInput from '@/components/admin/NumberInput';
import SearchableProductDropdown, { type ProductOption } from '@/components/admin/SearchableProductDropdown';
import ShipmentDrawer from '@/components/admin/ShipmentDrawer';

interface ShipmentRow {
  id: string;
  shipment_number: string;
  shipment_type: string;
  linked_invoice_id?: string;
  status: string;
  transporter_name?: string;
  vehicle_number?: string;
  dispatch_date?: string;
  expected_delivery_date?: string;
  delivered_date?: string;
  freight_charge?: number;
  created_at: string;
}

interface InvoiceOption {
  id: string;
  invoice_number: string;
}

type LineDraft = {
  product_id: string;
  product_name: string;
  quantity: number | '';
};

const emptyLine = (): LineDraft => ({ product_id: '', product_name: '', quantity: '' });

function apiError(err: unknown, fallback: string) {
  const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

function formatDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function statusBadge(status: string) {
  if (status === 'DELIVERED' || status === 'RETURNED') return adminUi.badgePaid;
  if (status === 'FAILED') return adminUi.badgeUnpaid;
  if (status === 'PENDING') return adminUi.badge;
  return 'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#E6F4FB] text-[#0077C5]';
}

export default function ShipmentsPage() {
  const [list, setList] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [previewNumber, setPreviewNumber] = useState('');

  const [form, setForm] = useState({
    shipment_type: 'GROUND' as 'GROUND' | 'GROUND_RG',
    linked_invoice_id: '',
    transporter_name: '',
    vehicle_number: '',
    lr_number: '',
    freight_charge: 0 as number | '',
    weight_kg: '' as number | '',
    volume_cbm: '' as number | '',
    dispatch_date: '',
    expected_delivery_date: '',
    notes: '',
    items: [emptyLine(), emptyLine(), emptyLine()] as LineDraft[],
  });

  const invoiceById = useMemo(() => {
    const map = new Map<string, string>();
    invoices.forEach((inv) => map.set(inv.id, inv.invoice_number));
    return map;
  }, [invoices]);

  const fetchList = useCallback(async () => {
    try {
      const params: Record<string, string | number> = { page: 1, limit: 100 };
      if (typeFilter) params.shipment_type = typeFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await adminApi.get('/shipments', { params });
      setList(res.data.shipments || []);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load shipments'));
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  const loadLookups = useCallback(async () => {
    try {
      const [prodRes, invRes] = await Promise.all([
        adminApi.get('/products', { params: { limit: 5000 } }),
        adminApi.get('/invoices', { params: { limit: 500 } }),
      ]);
      const rawProducts = prodRes.data?.products || prodRes.data || [];
      setProducts(
        (Array.isArray(rawProducts) ? rawProducts : []).map((p: any) => ({
          id: p.id || p._id?.toString?.() || String(p._id),
          name: p.name,
          sku: p.sku,
          product_id: p.product_id,
          price: p.price,
          stock_quantity: p.stock_quantity,
        }))
      );
      const rawInvoices = Array.isArray(invRes.data) ? invRes.data : invRes.data?.invoices || [];
      setInvoices(
        rawInvoices
          .map((inv: any) => ({
            id: inv.id || inv._id?.toString?.() || String(inv._id),
            invoice_number: inv.invoice_number || inv.id,
          }))
          .filter((inv: InvoiceOption) => inv.id && inv.invoice_number)
      );
    } catch {
      /* lookups optional for list view */
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    loadLookups();
  }, [loadLookups]);

  const openCreate = async () => {
    setForm({
      shipment_type: 'GROUND',
      linked_invoice_id: '',
      transporter_name: '',
      vehicle_number: '',
      lr_number: '',
      freight_charge: 0,
      weight_kg: '',
      volume_cbm: '',
      dispatch_date: '',
      expected_delivery_date: '',
      notes: '',
      items: [emptyLine(), emptyLine(), emptyLine()],
    });
    setShowCreate(true);
    try {
      const res = await adminApi.get('/shipments/generate-number', { params: { type: 'GROUND' } });
      setPreviewNumber(res.data?.shipment_number || '');
    } catch {
      setPreviewNumber('');
    }
  };

  const onTypeChange = async (shipment_type: 'GROUND' | 'GROUND_RG') => {
    setForm((f) => ({ ...f, shipment_type }));
    try {
      const res = await adminApi.get('/shipments/generate-number', { params: { type: shipment_type } });
      setPreviewNumber(res.data?.shipment_number || '');
    } catch {
      setPreviewNumber('');
    }
  };

  const setLine = (index: number, patch: Partial<LineDraft>) => {
    setForm((f) => {
      const items = [...f.items];
      items[index] = { ...items[index], ...patch };
      return { ...f, items };
    });
  };

  const addLine = () => setForm((f) => ({ ...f, items: [...f.items, emptyLine()] }));

  const submitCreate = async () => {
    if (submitting) return;
    const items = form.items
      .filter((i) => i.product_id && Number(i.quantity) > 0)
      .map((i) => ({
        product_id: i.product_id,
        product_name: i.product_name || undefined,
        quantity: Math.trunc(Number(i.quantity)),
      }));
    if (items.length === 0) {
      toast.error('Add at least one product with a positive quantity');
      return;
    }
    if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity <= 0)) {
      toast.error('Quantities must be positive whole numbers');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        shipment_type: form.shipment_type,
        items,
        freight_charge: Number(form.freight_charge) || 0,
      };
      if (form.linked_invoice_id) payload.linked_invoice_id = form.linked_invoice_id;
      if (form.transporter_name.trim()) payload.transporter_name = form.transporter_name.trim();
      if (form.vehicle_number.trim()) payload.vehicle_number = form.vehicle_number.trim();
      if (form.lr_number.trim()) payload.lr_number = form.lr_number.trim();
      if (form.weight_kg !== '' && form.weight_kg != null) payload.weight_kg = Number(form.weight_kg);
      if (form.volume_cbm !== '' && form.volume_cbm != null) payload.volume_cbm = Number(form.volume_cbm);
      if (form.dispatch_date) payload.dispatch_date = form.dispatch_date;
      if (form.expected_delivery_date) payload.expected_delivery_date = form.expected_delivery_date;
      if (form.notes.trim()) payload.notes = form.notes.trim();

      const res = await adminApi.post('/shipments', payload);
      toast.success(`Shipment ${res.data?.shipment_number || ''} created`);
      setShowCreate(false);
      setLoading(true);
      await fetchList();
      if (res.data?.id) setDetailId(res.data.id);
    } catch (err) {
      toast.error(apiError(err, 'Failed to create shipment'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className={adminUi.pageTitle}>Shipments</h1>
          <p className={`${adminUi.helper} mt-1`}>
            Create outbound (GROUND) and return (GROUND_RG) shipments, update logistics status, and mark
            delivered or return-received.
          </p>
        </div>
        <button type="button" onClick={openCreate} className={adminUi.btnPrimary}>
          <Plus className="w-4 h-4" />
          Add New Shipment
        </button>
      </div>

      <div className={`${adminUi.panel} p-4 flex flex-wrap items-center gap-3`}>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className={adminUi.field + ' w-auto min-w-[160px]'}
        >
          <option value="">All types</option>
          <option value="GROUND">GROUND</option>
          <option value="GROUND_RG">GROUND_RG (Return)</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={adminUi.field + ' w-auto min-w-[160px]'}
        >
          <option value="">All statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="PACKED">PACKED</option>
          <option value="DISPATCHED">DISPATCHED</option>
          <option value="IN_TRANSIT">IN_TRANSIT</option>
          <option value="DELIVERED">DELIVERED</option>
          <option value="RETURNED">RETURNED</option>
          <option value="FAILED">FAILED</option>
        </select>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            fetchList();
          }}
          className={adminUi.btnSecondary}
        >
          <Search className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className={`${adminUi.panel} overflow-hidden`}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className={adminUi.tableHead}>
                <tr>
                  <th className="text-left py-3 px-4">Shipment #</th>
                  <th className="text-left py-3 px-4">Type</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-left py-3 px-4">Invoice</th>
                  <th className="text-left py-3 px-4">Transporter</th>
                  <th className="text-left py-3 px-4">Vehicle</th>
                  <th className="text-left py-3 px-4">Dispatch</th>
                  <th className="text-left py-3 px-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-[#8D9096] text-sm">
                      No shipments yet. Create one to start tracking dispatch or returns.
                    </td>
                  </tr>
                ) : (
                  list.map((s) => (
                    <tr
                      key={s.id}
                      className={`${adminUi.tableRowHover} cursor-pointer`}
                      onClick={() => setDetailId(s.id)}
                    >
                      <td className={`${adminUi.tableCell} font-mono font-medium text-[#0077C5]`}>
                        {s.shipment_number}
                      </td>
                      <td className={adminUi.tableCell}>
                        <span className={adminUi.badge}>{s.shipment_type}</span>
                      </td>
                      <td className={adminUi.tableCell}>
                        <span className={statusBadge(s.status)}>{s.status}</span>
                      </td>
                      <td className={adminUi.tableCell}>
                        {s.linked_invoice_id
                          ? invoiceById.get(s.linked_invoice_id) || s.linked_invoice_id.slice(-6)
                          : '—'}
                      </td>
                      <td className={adminUi.tableCell}>{s.transporter_name || '—'}</td>
                      <td className={`${adminUi.tableCell} font-mono text-[#6B6C72]`}>
                        {s.vehicle_number || '—'}
                      </td>
                      <td className={`${adminUi.tableCell} text-[#6B6C72]`}>{formatDate(s.dispatch_date)}</td>
                      <td className={`${adminUi.tableCell} text-[#6B6C72]`}>{formatDate(s.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ShipmentDrawer
        shipmentId={detailId}
        invoiceLabel={
          detailId
            ? (() => {
                const row = list.find((s) => s.id === detailId);
                if (!row?.linked_invoice_id) return undefined;
                return invoiceById.get(row.linked_invoice_id) || row.linked_invoice_id;
              })()
            : undefined
        }
        onClose={() => setDetailId(null)}
        onChanged={() => {
          setLoading(true);
          fetchList();
        }}
      />

      {showCreate && (
        <div className={adminUi.modalBackdrop}>
          <div className={`${adminUi.modal} w-full max-w-3xl p-5`}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-medium text-[#1A1A1A]">New shipment</h2>
                <p className={adminUi.helper}>
                  Number is assigned by the server on save
                  {previewNumber ? ` (preview: ${previewNumber})` : ''}.
                </p>
              </div>
              <button type="button" className={adminUi.btnIcon} onClick={() => setShowCreate(false)} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className={adminUi.label}>Type</span>
                <select
                  className={adminUi.field}
                  value={form.shipment_type}
                  onChange={(e) => onTypeChange(e.target.value as 'GROUND' | 'GROUND_RG')}
                >
                  <option value="GROUND">GROUND (outbound)</option>
                  <option value="GROUND_RG">GROUND_RG (return)</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className={adminUi.label}>Linked invoice (optional)</span>
                <select
                  className={adminUi.field}
                  value={form.linked_invoice_id}
                  onChange={(e) => setForm((f) => ({ ...f, linked_invoice_id: e.target.value }))}
                >
                  <option value="">None</option>
                  {invoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_number}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className={adminUi.label}>Transporter</span>
                <input
                  className={adminUi.field}
                  value={form.transporter_name}
                  onChange={(e) => setForm((f) => ({ ...f, transporter_name: e.target.value }))}
                />
              </label>
              <label className="block space-y-1">
                <span className={adminUi.label}>Vehicle</span>
                <input
                  className={adminUi.field}
                  value={form.vehicle_number}
                  onChange={(e) => setForm((f) => ({ ...f, vehicle_number: e.target.value }))}
                />
              </label>
              <label className="block space-y-1">
                <span className={adminUi.label}>LR number</span>
                <input
                  className={adminUi.field}
                  value={form.lr_number}
                  onChange={(e) => setForm((f) => ({ ...f, lr_number: e.target.value }))}
                />
              </label>
              <label className="block space-y-1">
                <span className={adminUi.label}>Freight charge</span>
                <NumberInput
                  className={adminUi.field}
                  value={form.freight_charge}
                  showZero
                  onValueChange={(n) => setForm((f) => ({ ...f, freight_charge: n === '' ? '' : n }))}
                />
              </label>
              <label className="block space-y-1">
                <span className={adminUi.label}>Weight (kg)</span>
                <NumberInput
                  className={adminUi.field}
                  value={form.weight_kg}
                  onValueChange={(n) => setForm((f) => ({ ...f, weight_kg: n }))}
                />
              </label>
              <label className="block space-y-1">
                <span className={adminUi.label}>Volume (cbm)</span>
                <NumberInput
                  className={adminUi.field}
                  value={form.volume_cbm}
                  onValueChange={(n) => setForm((f) => ({ ...f, volume_cbm: n }))}
                />
              </label>
              <label className="block space-y-1">
                <span className={adminUi.label}>Dispatch date</span>
                <input
                  type="date"
                  className={adminUi.field}
                  value={form.dispatch_date}
                  onChange={(e) => setForm((f) => ({ ...f, dispatch_date: e.target.value }))}
                />
              </label>
              <label className="block space-y-1">
                <span className={adminUi.label}>Expected delivery</span>
                <input
                  type="date"
                  className={adminUi.field}
                  value={form.expected_delivery_date}
                  onChange={(e) => setForm((f) => ({ ...f, expected_delivery_date: e.target.value }))}
                />
              </label>
              <label className="block space-y-1 sm:col-span-2">
                <span className={adminUi.label}>Notes</span>
                <textarea
                  className={adminUi.field + ' rounded-md min-h-[72px]'}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className={adminUi.sectionTitle}>Items</h3>
                <button type="button" className={adminUi.btnGhost} onClick={addLine}>
                  + Add line
                </button>
              </div>
              <div className="border border-[#E3E5E8] rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className={adminUi.tableHead}>
                    <tr>
                      <th className="text-left px-3 py-2">Product</th>
                      <th className="text-right px-3 py-2 w-28">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((line, idx) => (
                      <tr key={idx} className="border-t border-[#E3E5E8]">
                        <td className="px-3 py-2">
                          <SearchableProductDropdown
                            products={products}
                            value={line.product_id}
                            displayName={line.product_name}
                            showPrice={false}
                            onSelect={(p) =>
                              setLine(idx, { product_id: p.id, product_name: p.name })
                            }
                            onBarcodeScan={(code) => {
                              adminApi
                                .get(`/products/barcode/${encodeURIComponent(code)}`)
                                .then((res) => {
                                  const p = res.data;
                                  const id = p.id || p._id?.toString?.();
                                  if (!id) throw new Error('missing id');
                                  setLine(idx, {
                                    product_id: id,
                                    product_name: p.name || '',
                                  });
                                })
                                .catch(() => toast.error('Product not found for this barcode'));
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <NumberInput
                            className={adminUi.field + ' text-right'}
                            value={line.quantity}
                            onValueChange={(n) => setLine(idx, { quantity: n })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={`${adminUi.helper} mt-2`}>
                No payment check is applied. Partial quantities are allowed by the API; remaining
                invoice quantities are not tracked yet.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={adminUi.btnSecondary} onClick={() => setShowCreate(false)} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className={adminUi.btnPrimary} onClick={submitCreate} disabled={submitting}>
                {submitting ? 'Creating…' : 'Create shipment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
