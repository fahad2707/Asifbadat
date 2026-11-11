'use client';

import { Fragment, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { adminUi } from '@/lib/admin-ui';
import InvoiceFormLightbox, { type InvoiceInitialItem } from '@/components/admin/InvoiceFormLightbox';

interface OrderItem {
  product_id?: string | { toString(): string };
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
}

interface StatusEntry {
  status: string;
  timestamp: string;
}

interface OnlineOrder {
  id: string;
  order_number: string;
  customer_id?: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  items: OrderItem[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  payment_method: string;
  payment_status: string;
  status: string;
  status_history: StatusEntry[];
  invoice_id?: string;
  quotation_id?: string;
  quotation_number?: string;
  created_at: string;
}

interface Summary {
  confirmed: number;
  quoted: number;
  cancelled: number;
  total: number;
}

function productIdOf(item: OrderItem): string {
  const raw = item.product_id as unknown;
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw && 'toString' in raw) return String((raw as { toString: () => string }).toString());
  return String(raw);
}

function orderStatusLabel(status: string) {
  if (status === 'confirmed') return 'To review';
  if (status === 'quoted') return 'Quoted';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'packed') return 'Packed';
  if (status === 'dispatched') return 'Dispatched';
  if (status === 'delivered') return 'Delivered';
  return status;
}

function orderStatusBadge(status: string) {
  if (status === 'quoted') return adminUi.badgePaid;
  if (status === 'cancelled') return adminUi.badgeUnpaid;
  if (status === 'confirmed') return adminUi.badge;
  return adminUi.badgeDraft;
}

function fmtWhen(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OnlineOrdersPage() {
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [quotationCustomerId, setQuotationCustomerId] = useState<string | null>(null);
  const [quotationItems, setQuotationItems] = useState<InvoiceInitialItem[]>([]);
  const [quotationEditId, setQuotationEditId] = useState<string | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchOrders = async (statusFilter = filter) => {
    try {
      const [ordersRes, summaryRes] = await Promise.all([
        adminApi.get('/online-orders', { params: statusFilter !== 'all' ? { status: statusFilter } : {} }),
        adminApi.get('/online-orders/summary'),
      ]);
      setOrders(ordersRes.data || []);
      setSummary({
        confirmed: summaryRes.data?.confirmed ?? 0,
        quoted: summaryRes.data?.quoted ?? 0,
        cancelled: summaryRes.data?.cancelled ?? 0,
        total: summaryRes.data?.total ?? 0,
      });
    } catch {
      toast.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedIds(new Set());
    setExpandedId(null);
    (async () => {
      try {
        const [ordersRes, summaryRes] = await Promise.all([
          adminApi.get('/online-orders', { params: filter !== 'all' ? { status: filter } : {} }),
          adminApi.get('/online-orders/summary'),
        ]);
        if (cancelled) return;
        setOrders(ordersRes.data || []);
        setSummary({
          confirmed: summaryRes.data?.confirmed ?? 0,
          quoted: summaryRes.data?.quoted ?? 0,
          cancelled: summaryRes.data?.cancelled ?? 0,
          total: summaryRes.data?.total ?? 0,
        });
      } catch {
        if (!cancelled) toast.error('Failed to load orders');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter]);

  const handleDraftQuotation = (order: OnlineOrder) => {
    if (preparing) return;
    if (!order.customer_id) {
      toast.error('This order has no customer on file');
      return;
    }
    setPreparing(true);
    const items: InvoiceInitialItem[] = (order.items || []).map((it) => ({
      product_id: productIdOf(it) || undefined,
      product_name: it.product_name,
      quantity: it.quantity,
      price: it.price,
    }));
    setQuotationCustomerId(order.customer_id);
    setQuotationItems(items);
    setQuotationEditId(null);
    setPendingOrderId(order.id);
    setQuotationOpen(true);
    setPreparing(false);
  };

  const handleOpenQuotation = (order: OnlineOrder) => {
    if (!order.quotation_id) return;
    setQuotationEditId(order.quotation_id);
    setQuotationItems([]);
    setQuotationCustomerId(null);
    setPendingOrderId(null);
    setQuotationOpen(true);
  };

  const handleQuotationSaved = async (savedId?: string) => {
    if (pendingOrderId && savedId) {
      try {
        await adminApi.post(`/online-orders/${pendingOrderId}/link-quotation`, { quotation_id: savedId });
        toast.success('Quotation saved. Convert it to an invoice, then ship. Stock comes off when delivered.');
      } catch (err: any) {
        toast.error(err.response?.data?.error || 'Quotation saved but could not link to the order');
      }
    }
    fetchOrders();
  };

  const handleQuotationClose = () => {
    setQuotationOpen(false);
    setQuotationCustomerId(null);
    setQuotationItems([]);
    setQuotationEditId(null);
    setPendingOrderId(null);
  };

  const cancelOrder = async (orderId: string) => {
    if (!confirm('Cancel this website order?')) return;
    setUpdating(true);
    try {
      await adminApi.put(`/online-orders/${orderId}/status`, { status: 'cancelled' });
      toast.success('Order cancelled');
      fetchOrders();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to cancel');
    } finally {
      setUpdating(false);
    }
  };

  const filtered = search.trim()
    ? orders.filter(
        (o) =>
          o.order_number.toLowerCase().includes(search.toLowerCase()) ||
          o.customer_name.toLowerCase().includes(search.toLowerCase()) ||
          o.customer_phone.includes(search)
      )
    : orders;

  const allVisibleSelected = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id));
  const someVisibleSelected = filtered.some((o) => selectedIds.has(o.id));
  const selectedRows = filtered.filter((o) => selectedIds.has(o.id));

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
        filtered.forEach((o) => next.delete(o.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((o) => next.add(o.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const cancelSelected = async () => {
    if (updating) return;
    const rows = selectedRows.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled');
    if (rows.length === 0) {
      toast.error('None of the selected orders can be cancelled');
      return;
    }
    if (!confirm(`Cancel ${rows.length} website order${rows.length === 1 ? '' : 's'}?`)) return;
    setUpdating(true);
    let ok = 0;
    const failures: string[] = [];
    for (const o of rows) {
      try {
        await adminApi.put(`/online-orders/${o.id}/status`, { status: 'cancelled' });
        ok += 1;
      } catch (err: any) {
        failures.push(`${o.order_number}: ${err.response?.data?.error || 'failed'}`);
      }
    }
    setUpdating(false);
    if (ok) toast.success(`${ok} cancelled`);
    if (failures.length) toast.error(failures.slice(0, 3).join(' · '));
    clearSelection();
    fetchOrders();
  };

  const chips = [
    { key: 'confirmed', label: 'To review', count: summary?.confirmed },
    { key: 'quoted', label: 'Quoted', count: summary?.quoted },
    { key: 'cancelled', label: 'Cancelled', count: summary?.cancelled },
    { key: 'all', label: 'All', count: summary?.total },
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className={adminUi.pageTitle}>Online sales</h1>
          <p className={`${adminUi.helper} mt-1`}>
            Website orders are quotations to review — not invoices. Convert to an invoice, then ship. Stock comes off when delivered.
          </p>
        </div>
        {summary && <span className={adminUi.meta}>{summary.total} total orders</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === chip.key
                ? 'bg-black text-white'
                : 'bg-white text-[#6B6C72] border border-[#E3E5E8] hover:bg-[#F4F5F8] hover:text-[#1A1A1A]'
            }`}
          >
            {chip.label}
            {typeof chip.count === 'number' ? ` · ${chip.count}` : ''}
          </button>
        ))}
        <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8D9096]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number, customer, or phone…"
            className={`${adminUi.field} pl-9 rounded-full`}
          />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#E3E5E8] bg-[#F4F5F8] px-4 py-2.5">
          <span className="text-sm font-medium text-[#1A1A1A] mr-1">{selectedIds.size} selected</span>
          <button
            type="button"
            disabled={updating}
            className={`${adminUi.btnDanger} disabled:opacity-50`}
            onClick={cancelSelected}
          >
            {updating ? 'Cancelling…' : 'Cancel selected'}
          </button>
          <button type="button" onClick={clearSelection} className={adminUi.btnGhost} disabled={updating}>
            Clear
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={`${adminUi.panel} py-16 text-center`}>
          <p className="text-sm font-medium text-[#1A1A1A]">No orders found</p>
          <p className={`${adminUi.helper} mt-1`}>Website checkout will show here for review.</p>
        </div>
      ) : (
        <div className={`${adminUi.panel} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={adminUi.tableHead}>
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all orders"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                      }}
                      onChange={toggleAllVisible}
                      className="h-4 w-4 rounded border-[#C7C7C7] accent-black cursor-pointer"
                    />
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Order</th>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Quotation</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="text-left px-4 py-3 font-medium">Placed</th>
                  <th className="text-right px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => {
                  const canCancel = order.status !== 'delivered' && order.status !== 'cancelled';
                  const open = expandedId === order.id;
                  return (
                    <Fragment key={order.id}>
                      <tr
                        className={`border-t border-[#E3E5E8] cursor-pointer ${adminUi.tableRowHover} ${selectedIds.has(order.id) ? 'bg-[#F4F5F8]' : ''}`}
                        onClick={() => setExpandedId(open ? null : order.id)}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${order.order_number}`}
                            checked={selectedIds.has(order.id)}
                            onChange={() => toggleOne(order.id)}
                            className="h-4 w-4 rounded border-[#C7C7C7] accent-black cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-mono font-medium text-[#0077C5]">{order.order_number}</p>
                          <p className={adminUi.helper}>
                            {order.items.length} item{order.items.length === 1 ? '' : 's'}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[#1A1A1A]">{order.customer_name}</p>
                          <p className={adminUi.helper}>{order.customer_phone}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={orderStatusBadge(order.status)}>{orderStatusLabel(order.status)}</span>
                        </td>
                        <td className="px-4 py-3 text-[#6B6C72]">{order.quotation_number || '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">${order.total_amount.toFixed(2)}</td>
                        <td className="px-4 py-3 text-[#6B6C72] whitespace-nowrap">{fmtWhen(order.created_at)}</td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {order.quotation_id ? (
                            <button type="button" className={adminUi.btnSecondary} onClick={() => handleOpenQuotation(order)}>
                              Open quotation
                            </button>
                          ) : (
                            order.status !== 'cancelled' && (
                              <button
                                type="button"
                                className={adminUi.btnPrimary}
                                disabled={preparing}
                                onClick={() => handleDraftQuotation(order)}
                              >
                                Draft quotation
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-t border-[#E3E5E8] bg-[#FAFAFA]">
                          <td colSpan={8} className="px-4 py-4">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                              <div className={`${adminUi.panel} overflow-hidden lg:col-span-2`}>
                                <table className="w-full text-sm">
                                  <thead className={adminUi.tableHead}>
                                    <tr>
                                      <th className="text-left px-3 py-2">Product</th>
                                      <th className="text-right px-3 py-2">Qty</th>
                                      <th className="text-right px-3 py-2">Price</th>
                                      <th className="text-right px-3 py-2">Subtotal</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {order.items.map((item, i) => (
                                      <tr key={i} className="border-t border-[#E3E5E8]">
                                        <td className="px-3 py-2">{item.product_name}</td>
                                        <td className="px-3 py-2 text-right">{item.quantity}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">${item.price.toFixed(2)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-medium">${item.subtotal.toFixed(2)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <div className="px-3 py-2 border-t border-[#E3E5E8] flex justify-between text-sm">
                                  <span className="text-[#6B6C72]">Requested total</span>
                                  <span className="font-medium tabular-nums">${order.total_amount.toFixed(2)}</span>
                                </div>
                              </div>
                              <div className="space-y-3">
                                <div>
                                  <p className={adminUi.label}>Customer</p>
                                  <p className="text-sm font-medium mt-1">{order.customer_name}</p>
                                  <p className={adminUi.helper}>{order.customer_email}</p>
                                  <p className={adminUi.helper}>{order.customer_phone}</p>
                                </div>
                                <div>
                                  <p className={adminUi.label}>Ship to</p>
                                  <p className="text-sm mt-1 leading-relaxed">
                                    {order.address_line1}
                                    {order.address_line2 ? `, ${order.address_line2}` : ''}
                                    <br />
                                    {order.city}, {order.state} {order.zip}
                                  </p>
                                </div>
                                {canCancel && (
                                  <button
                                    type="button"
                                    className={adminUi.btnDanger}
                                    disabled={updating}
                                    onClick={() => cancelOrder(order.id)}
                                  >
                                    Cancel order
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <InvoiceFormLightbox
        isOpen={quotationOpen}
        onClose={handleQuotationClose}
        onSaved={handleQuotationSaved}
        editId={quotationEditId}
        initialCustomerId={quotationCustomerId}
        initialDocumentType="quotation"
        initialItems={quotationItems}
        numberOrigin="online"
      />
    </div>
  );
}
