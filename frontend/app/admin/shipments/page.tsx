'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Plus, Printer, Search, Truck, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { adminUi } from '@/lib/admin-ui';
import NumberInput from '@/components/admin/NumberInput';
import SearchableProductDropdown, { type ProductOption } from '@/components/admin/SearchableProductDropdown';
import ShipmentDrawer from '@/components/admin/ShipmentDrawer';
import { toastBarcodeNotFound, toastProductAdded } from '@/lib/barcode-feedback';
import { openPdfFromResponse } from '@/lib/download-pdf';
import {
  formatShipmentDate,
  shipmentStatusBadgeClass,
  shipmentStatusLabel,
  shipmentTypeBadgeClass,
  shipmentTypeLabel,
} from '@/lib/shipment-display';

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
  package_count?: number;
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
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState(false);

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

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) setDetailId(id);
  }, []);

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

  const quickPrintLabels = async (s: ShipmentRow) => {
    if (printingId) return;
    setPrintingId(s.id);
    try {
      const res = await adminApi.get(`/shipments/${s.id}/packages`);
      const pkgs = (res.data?.packages || []) as Array<{ id: string; package_code: string }>;
      if (!Array.isArray(pkgs) || pkgs.length === 0) {
        toast.error('No packages found for this shipment. Create packages first.');
        setDetailId(s.id);
        return;
      }
      const pdfRes = await adminApi.post(
        `/packages/labels/pdf`,
        { items: pkgs.map((p) => ({ package_id: p.id, quantity: 1 })) },
        { responseType: 'arraybuffer' }
      );
      const ok = await openPdfFromResponse(pdfRes.data, pdfRes.headers?.['content-type']);
      if (ok) {
        toast.success(`Opened ${pkgs.length} barcode label(s) for ${s.shipment_number}`);
      }
    } catch (err) {
      toast.error(apiError(err, 'Failed to print package labels'));
    } finally {
      setPrintingId(null);
    }
  };

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

  const visible = search.trim()
    ? list.filter((s) => {
        const q = search.trim().toLowerCase();
        return (
          s.shipment_number.toLowerCase().includes(q) ||
          (s.transporter_name || '').toLowerCase().includes(q) ||
          (s.vehicle_number || '').toLowerCase().includes(q) ||
          (s.linked_invoice_id ? (invoiceById.get(s.linked_invoice_id) || '').toLowerCase().includes(q) : false)
        );
      })
    : list;

  const allVisibleSelected = visible.length > 0 && visible.every((s) => selectedIds.has(s.id));
  const someVisibleSelected = visible.some((s) => selectedIds.has(s.id));
  const selectedRows = visible.filter((s) => selectedIds.has(s.id));
  const isTerminal = (status: string) => status === 'DELIVERED' || status === 'RETURNED' || status === 'FAILED';

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        visible.forEach((s) => next.delete(s.id));
        return next;
      }
      const next = new Set(prev);
      visible.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkPatchStatus = async (status: 'PACKED' | 'IN_TRANSIT', label: string) => {
    if (bulkActing) return;
    const rows = selectedRows.filter((s) => !isTerminal(s.status));
    if (rows.length === 0) {
      toast.error('None of the selected shipments can change status');
      return;
    }
    setBulkActing(true);
    let ok = 0;
    const failures: string[] = [];
    for (const s of rows) {
      try {
        await adminApi.patch(`/shipments/${s.id}/status`, { status });
        ok += 1;
      } catch (err) {
        failures.push(`${s.shipment_number}: ${apiError(err, 'failed')}`);
      }
    }
    setBulkActing(false);
    if (ok) toast.success(`${ok} marked ${label.toLowerCase()}`);
    if (failures.length) toast.error(failures.slice(0, 3).join(' · '));
    clearSelection();
    setLoading(true);
    await fetchList();
  };

  const bulkMarkDelivered = async () => {
    if (bulkActing) return;
    const rows = selectedRows.filter((s) => s.shipment_type !== 'GROUND_RG' && !isTerminal(s.status));
    if (rows.length === 0) {
      toast.error('Select outbound shipments that are not already complete');
      return;
    }
    if (!confirm(`Mark ${rows.length} outbound shipment${rows.length === 1 ? '' : 's'} delivered?\n\nStock will be deducted now.`)) {
      return;
    }
    setBulkActing(true);
    let ok = 0;
    const failures: string[] = [];
    for (const s of rows) {
      try {
        await adminApi.post(`/shipments/${s.id}/mark-delivered`, {});
        ok += 1;
      } catch (err) {
        failures.push(`${s.shipment_number}: ${apiError(err, 'failed')}`);
      }
    }
    setBulkActing(false);
    if (ok) toast.success(`${ok} marked delivered`);
    if (failures.length) toast.error(failures.slice(0, 3).join(' · '));
    clearSelection();
    setLoading(true);
    await fetchList();
  };

  const bulkMarkReturnReceived = async () => {
    if (bulkActing) return;
    const rows = selectedRows.filter(
      (s) => s.shipment_type === 'GROUND_RG' && s.status !== 'RETURNED' && s.status !== 'DELIVERED' && s.status !== 'FAILED'
    );
    if (rows.length === 0) {
      toast.error('Select return shipments that are not already complete');
      return;
    }
    if (!confirm(`Mark ${rows.length} return${rows.length === 1 ? '' : 's'} received?\n\nWarehouse stock will update.`)) {
      return;
    }
    setBulkActing(true);
    let ok = 0;
    const failures: string[] = [];
    for (const s of rows) {
      try {
        await adminApi.post(`/shipments/${s.id}/mark-return-received`, {});
        ok += 1;
      } catch (err) {
        failures.push(`${s.shipment_number}: ${apiError(err, 'failed')}`);
      }
    }
    setBulkActing(false);
    if (ok) toast.success(`${ok} marked return received`);
    if (failures.length) toast.error(failures.slice(0, 3).join(' · '));
    clearSelection();
    setLoading(true);
    await fetchList();
  };

  const typeChips = [
    { value: '', label: 'All' },
    { value: 'GROUND', label: 'Outbound' },
    { value: 'GROUND_RG', label: 'Returns' },
  ];
  const statusChips = [
    { value: '', label: 'Any status' },
    { value: 'PACKED', label: 'Ready to ship' },
    { value: 'IN_TRANSIT', label: 'Out for delivery' },
    { value: 'DELIVERED', label: 'Delivered' },
    { value: 'RETURNED', label: 'Return received' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className={adminUi.pageTitle}>Shipments</h1>
          <p className={`${adminUi.helper} mt-1`}>
            Outbound deliveries and supplier returns. Stock comes off when an outbound shipment is marked delivered.
          </p>
        </div>
        <button type="button" onClick={openCreate} className={`${adminUi.btnPrimary} self-start`}>
          <Plus className="w-4 h-4" />
          New shipment
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {typeChips.map((chip) => (
            <button
              key={chip.value || 'all-type'}
              type="button"
              onClick={() => setTypeFilter(chip.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                typeFilter === chip.value
                  ? 'bg-black text-white'
                  : 'bg-[#F4F5F8] text-[#393A3D] hover:bg-[#E8E9EB]'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statusChips.map((chip) => (
            <button
              key={chip.value || 'all-status'}
              type="button"
              onClick={() => setStatusFilter(chip.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                statusFilter === chip.value
                  ? 'bg-black text-white'
                  : 'bg-white text-[#6B6C72] border border-[#E3E5E8] hover:bg-[#F4F5F8] hover:text-[#1A1A1A]'
              }`}
            >
              {chip.label}
            </button>
          ))}
          <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8D9096]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search number, carrier, invoice…"
              className={`${adminUi.field} pl-9 rounded-full`}
            />
          </div>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#E3E5E8] bg-[#F4F5F8] px-4 py-2.5">
          <span className="text-sm font-medium text-[#1A1A1A] mr-1">{selectedIds.size} selected</span>
          <button
            type="button"
            disabled={bulkActing}
            className={`${adminUi.btnSecondary} disabled:opacity-50`}
            onClick={() => bulkPatchStatus('PACKED', 'Ready to ship')}
          >
            Ready to ship
          </button>
          <button
            type="button"
            disabled={bulkActing}
            className={`${adminUi.btnSecondary} disabled:opacity-50`}
            onClick={() => bulkPatchStatus('IN_TRANSIT', 'Out for delivery')}
          >
            Out for delivery
          </button>
          <button
            type="button"
            disabled={bulkActing}
            className={`${adminUi.btnPrimary} disabled:opacity-50`}
            onClick={bulkMarkDelivered}
          >
            Mark delivered
          </button>
          <button
            type="button"
            disabled={bulkActing}
            className={`${adminUi.btnSecondary} disabled:opacity-50`}
            onClick={bulkMarkReturnReceived}
          >
            Mark return received
          </button>
          <button type="button" onClick={clearSelection} className={adminUi.btnGhost} disabled={bulkActing}>
            Clear
          </button>
        </div>
      )}

      <div className={`${adminUi.panel} overflow-hidden`}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
          </div>
        ) : visible.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-[#F4F5F8] flex items-center justify-center mb-3">
              <Truck className="w-5 h-5 text-[#8D9096]" />
            </div>
            <p className="text-sm font-medium text-[#1A1A1A]">
              {list.length === 0 ? 'No shipments yet' : 'No matching shipments'}
            </p>
            <p className={`${adminUi.helper} mt-1`}>
              {list.length === 0
                ? 'Create an outbound shipment from an invoice, or a return from a vendor.'
                : 'Try a different search or filter.'}
            </p>
            {list.length === 0 && (
              <button type="button" onClick={openCreate} className={`${adminUi.btnPrimary} mt-4`}>
                <Plus className="w-4 h-4" />
                New shipment
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className={adminUi.tableHead}>
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all shipments"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                      }}
                      onChange={toggleAllVisible}
                      className="h-4 w-4 rounded border-[#C7C7C7] accent-black cursor-pointer"
                    />
                  </th>
                  <th className="text-left py-3 px-4">Shipment</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-left py-3 px-4">Packages</th>
                  <th className="text-left py-3 px-4">Invoice</th>
                  <th className="text-left py-3 px-4">Carrier</th>
                  <th className="text-left py-3 px-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr
                    key={s.id}
                    className={`${adminUi.tableRowHover} cursor-pointer ${selectedIds.has(s.id) ? 'bg-[#F4F5F8]' : ''}`}
                    onClick={() => setDetailId(s.id)}
                  >
                    <td className={adminUi.tableCell} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${s.shipment_number}`}
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleOne(s.id)}
                        className="h-4 w-4 rounded border-[#C7C7C7] accent-black cursor-pointer"
                      />
                    </td>
                    <td className={adminUi.tableCell}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-[#0077C5]">{s.shipment_number}</span>
                        <span className={shipmentTypeBadgeClass(s.shipment_type)}>{shipmentTypeLabel(s.shipment_type)}</span>
                      </div>
                    </td>
                    <td className={adminUi.tableCell}>
                      <span className={shipmentStatusBadgeClass(s.status)}>{shipmentStatusLabel(s.status)}</span>
                    </td>
                    <td className={adminUi.tableCell} onClick={(e) => e.stopPropagation()}>
                      {typeof s.package_count === 'number' && s.package_count > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailId(s.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-[#F4F5F8] text-[#393A3D] hover:bg-[#E8E9EB]"
                          >
                            <Package className="w-3 h-3" />
                            {s.package_count}
                          </button>
                          <button
                            type="button"
                            disabled={printingId === s.id}
                            onClick={() => quickPrintLabels(s)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border border-[#E3E5E8] text-[#393A3D] hover:bg-[#F4F5F8] disabled:opacity-50"
                            title="Print barcode labels"
                          >
                            {printingId === s.id ? (
                              <span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" />
                            ) : (
                              <Printer className="w-3 h-3" />
                            )}
                            Print
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDetailId(s.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-[#6B6C72] border border-dashed border-[#D1D5DB] hover:bg-[#F4F5F8] hover:text-[#1A1A1A]"
                        >
                          <Plus className="w-3 h-3" />
                          Packages
                        </button>
                      )}
                    </td>
                    <td className={`${adminUi.tableCell} text-[#6B6C72]`}>
                      {s.linked_invoice_id
                        ? invoiceById.get(s.linked_invoice_id) || 'Linked'
                        : '—'}
                    </td>
                    <td className={adminUi.tableCell}>
                      <p className="text-[#1A1A1A]">{s.transporter_name || '—'}</p>
                      {s.vehicle_number ? <p className={`${adminUi.helper} font-mono`}>{s.vehicle_number}</p> : null}
                    </td>
                    <td className={`${adminUi.tableCell} text-[#6B6C72] whitespace-nowrap`}>
                      {formatShipmentDate(s.created_at)}
                    </td>
                  </tr>
                ))}
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
          <div className={`${adminUi.modal} w-full max-w-3xl p-0`}>
            <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-[#E3E5E8]">
              <div>
                <h2 className="text-xl font-medium text-[#1A1A1A]">New shipment</h2>
                <p className={adminUi.helper}>
                  {previewNumber ? `Will save as ${previewNumber}` : 'Number is assigned when you save'}
                </p>
              </div>
              <button type="button" className={adminUi.btnIcon} onClick={() => setShowCreate(false)} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onTypeChange('GROUND')}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    form.shipment_type === 'GROUND'
                      ? 'border-black bg-[#F4F5F8]'
                      : 'border-[#E3E5E8] hover:border-[#C7C7C7]'
                  }`}
                >
                  <p className="text-sm font-medium text-[#1A1A1A]">Outbound</p>
                  <p className={adminUi.helper}>Customer delivery · stock on delivered</p>
                </button>
                <button
                  type="button"
                  onClick={() => onTypeChange('GROUND_RG')}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    form.shipment_type === 'GROUND_RG'
                      ? 'border-black bg-[#F4F5F8]'
                      : 'border-[#E3E5E8] hover:border-[#C7C7C7]'
                  }`}
                >
                  <p className="text-sm font-medium text-[#1A1A1A]">Return</p>
                  <p className={adminUi.helper}>Goods coming back · stock on received</p>
                </button>
              </div>

              <div>
                <h3 className={`${adminUi.sectionTitle} mb-3`}>Details</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block space-y-1 sm:col-span-2">
                    <span className={adminUi.label}>Linked invoice</span>
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
                      placeholder="Carrier name"
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
                    <span className={adminUi.label}>Tracking / LR</span>
                    <input
                      className={adminUi.field}
                      value={form.lr_number}
                      onChange={(e) => setForm((f) => ({ ...f, lr_number: e.target.value }))}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className={adminUi.label}>Freight</span>
                    <NumberInput
                      className={adminUi.field}
                      value={form.freight_charge}
                      showZero
                      onValueChange={(n) => setForm((f) => ({ ...f, freight_charge: n === '' ? '' : n }))}
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
                  <label className="block space-y-1 sm:col-span-2">
                    <span className={adminUi.label}>Notes / ship-to</span>
                    <textarea
                      className={adminUi.field + ' min-h-[64px]'}
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    />
                  </label>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className={adminUi.sectionTitle}>Items</h3>
                  <button type="button" className={adminUi.btnGhost} onClick={addLine}>
                    + Add line
                  </button>
                </div>
                <div className="border border-[#E3E5E8] rounded-xl overflow-hidden">
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
                                    toastProductAdded(p.name || 'item');
                                  })
                                  .catch(() => toastBarcodeNotFound());
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
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[#E3E5E8] flex justify-end gap-2">
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
