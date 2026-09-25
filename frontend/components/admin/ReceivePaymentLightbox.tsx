'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { formatApiError } from '@/lib/format-api-error';
import toast from 'react-hot-toast';

interface Customer {
  id: string;
  name: string;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  customer_id?: string;
  total_amount: number;
  amount_paid: number;
  payment_status: string;
  invoice_type?: string;
  created_at: string;
}

interface ReceivePaymentLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  onRecorded: () => void;
  preselectedCustomerId?: string;
  preselectedInvoiceId?: string;
}

export default function ReceivePaymentLightbox({ isOpen, onClose, onRecorded, preselectedCustomerId, preselectedInvoiceId }: ReceivePaymentLightboxProps) {
  const [dirty, setDirty] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [outstandingInvoices, setOutstandingInvoices] = useState<InvoiceRow[]>([]);
  const [amountReceived, setAmountReceived] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string }[]>([]);
  const [showAddPaymentMethod, setShowAddPaymentMethod] = useState(false);
  const [newPaymentMethodName, setNewPaymentMethodName] = useState('');
  const [addingPaymentMethod, setAddingPaymentMethod] = useState(false);
  const [referenceNo, setReferenceNo] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDirty(false);
    setCustomerId(preselectedCustomerId || '');
    setAmountReceived('');
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setReferenceNo('');
    setAllocations({});
    setShowAddPaymentMethod(false);
    setNewPaymentMethodName('');
    adminApi.get('/customers', { params: { limit: 500 } }).then((r) => setCustomers(r.data.customers || [])).catch(() => {});
    adminApi.get('/payment-methods').then((r) => {
      const list = Array.isArray(r.data) ? r.data : [];
      setPaymentMethods(list);
      if (list.length > 0 && !list.some((p: { name: string }) => p.name === 'Cash')) setPaymentMethod(list[0].name);
      else if (list.length > 0) setPaymentMethod('Cash');
    }).catch(() => setPaymentMethods([]));
  }, [isOpen, preselectedCustomerId]);

  useEffect(() => {
    if (!isOpen) return;
    if (customerId) {
      setLoading(true);
      adminApi.get('/invoices', { params: { customer_id: customerId, unpaid_only: 'true', limit: 100 } })
        .then((r) => {
          const list = Array.isArray(r.data) ? r.data : (r.data.invoices || r.data);
          setOutstandingInvoices(list.filter((inv: any) => (inv.payment_status || '').toLowerCase() === 'unpaid' && inv.invoice_type !== 'quotation'));
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else {
      setOutstandingInvoices([]);
    }
  }, [isOpen, customerId]);

  useEffect(() => {
    if (preselectedInvoiceId && outstandingInvoices.length > 0) {
      const inv = outstandingInvoices.find((i) => i.id === preselectedInvoiceId);
      if (inv) {
        const openBalance = (inv.total_amount || 0) - (inv.amount_paid || 0);
        setAllocations((prev) => ({ ...prev, [inv.id]: String(openBalance) }));
        setAmountReceived(String(openBalance));
        setDirty(true);
      }
    }
  }, [preselectedInvoiceId, outstandingInvoices]);

  const customerBalance = outstandingInvoices.reduce((s, inv) => s + (inv.total_amount || 0) - (inv.amount_paid || 0), 0);

  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const handleClose = () => {
    if (dirty) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleCloseWithoutSaving = () => {
    setShowCloseConfirm(false);
    setDirty(false);
    onClose();
  };

  const handleAddPaymentMethod = async () => {
    const name = newPaymentMethodName.trim();
    if (!name) {
      toast.error('Enter a payment method name');
      return;
    }
    setAddingPaymentMethod(true);
    try {
      const { data } = await adminApi.post('/payment-methods', { name });
      setPaymentMethods((prev) => [...prev, { id: data.id, name: data.name }]);
      setPaymentMethod(data.name);
      setNewPaymentMethodName('');
      setShowAddPaymentMethod(false);
      setDirty(true);
      toast.success('Payment method added');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to add payment method');
    } finally {
      setAddingPaymentMethod(false);
    }
  };

  const setAllocation = (invoiceId: string, value: string) => {
    setAllocations((prev) => ({ ...prev, [invoiceId]: value }));
    setDirty(true);
    const num = Number(value) || 0;
    const total = Object.entries({ ...allocations, [invoiceId]: value }).reduce((s, [id, v]) => s + (Number(v) || 0), 0);
    setAmountReceived(String(total));
  };

  const handleRecord = async (andClose: boolean) => {
    const allocs = outstandingInvoices
      .map((inv) => ({ invoice_id: inv.id, amount: Number(allocations[inv.id]) || 0 }))
      .filter((a) => a.amount > 0);
    if (allocs.length === 0) {
      toast.error('Apply payment to at least one invoice');
      return;
    }
    const totalAlloc = allocs.reduce((s, a) => s + a.amount, 0);
    setSaving(true);
    try {
      await adminApi.post('/invoices/receive-payment', {
        amount_received: totalAlloc,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        reference_no: referenceNo,
        notes: referenceNo,
        allocations: allocs,
      });
      toast.success('Payment recorded');
      setDirty(false);
      onRecorded();
      if (andClose) onClose();
      else {
        setAmountReceived('');
        setAllocations({});
        if (customerId) {
          const list = await adminApi.get('/invoices', { params: { customer_id: customerId, unpaid_only: 'true', limit: 100 } });
          const data = Array.isArray(list.data) ? list.data : (list.data.invoices || list.data);
          setOutstandingInvoices(data.filter((inv: any) => (inv.payment_status || '').toLowerCase() === 'unpaid'));
        }
      }
    } catch (e: unknown) {
      const msg = formatApiError(e, 'Failed to record payment');
      if (msg.includes('Deposit to bank account') || msg.includes('deposited in')) {
        toast.error('Failed to record payment');
      } else {
        toast.error(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={handleClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Receive Payment</h2>
          <button type="button" onClick={handleClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
            <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setDirty(true); }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Select customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {customerId && (
            <>
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">Customer balance (unpaid)</span>
                <span className="font-semibold text-gray-900">${customerBalance.toFixed(2)}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount received</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={amountReceived}
                  onChange={(e) => {
                    const val = e.target.value;
                    setAmountReceived(val);
                    setDirty(true);
                    if (outstandingInvoices.length === 1) {
                      setAllocations((prev) => ({ ...prev, [outstandingInvoices[0].id]: val }));
                    }
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {outstandingInvoices.length === 1 && (
                  <p className="text-xs text-gray-500 mt-1">This amount will be applied to the invoice below. For partial payment, enter the amount you received.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment date</label>
                  <input type="date" value={paymentDate} onChange={(e) => { setPaymentDate(e.target.value); setDirty(true); }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment method</label>
                  <select
                    value={showAddPaymentMethod ? '__add_new__' : paymentMethod}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__add_new__') {
                        setShowAddPaymentMethod(true);
                        setDirty(true);
                      } else {
                        setShowAddPaymentMethod(false);
                        setPaymentMethod(v);
                        setDirty(true);
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {paymentMethods.map((pm) => (
                      <option key={pm.id} value={pm.name}>{pm.name}</option>
                    ))}
                    {paymentMethods.length === 0 && (
                      <>
                        <option value="Cash">Cash</option>
                        <option value="Check">Check</option>
                        <option value="Card">Card</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Other">Other</option>
                      </>
                    )}
                    <option value="__add_new__">+ Add new payment method</option>
                  </select>
                  {showAddPaymentMethod && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        value={newPaymentMethodName}
                        onChange={(e) => setNewPaymentMethodName(e.target.value)}
                        placeholder="e.g. Venmo, Zelle"
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleAddPaymentMethod}
                        disabled={addingPaymentMethod || !newPaymentMethodName.trim()}
                        className="px-3 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-[#2C2C2C] disabled:opacity-50"
                      >
                        {addingPaymentMethod ? 'Adding…' : 'Add & use'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Comment</label>
                <textarea
                  value={referenceNo}
                  onChange={(e) => { setReferenceNo(e.target.value); setDirty(true); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[72px]"
                  placeholder="Saved on this payment — check, wire ref, note for the timeline"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Apply to invoices</label>
                {loading ? (
                  <div className="py-4 text-center text-gray-500">Loading...</div>
                ) : outstandingInvoices.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">No unpaid invoices for this customer.</p>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left py-2 px-2">Invoice #</th>
                          <th className="text-right py-2 px-2">Open balance</th>
                          <th className="text-right py-2 px-2 w-28">Payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outstandingInvoices.map((inv) => {
                          const openBal = (inv.total_amount || 0) - (inv.amount_paid || 0);
                          return (
                            <tr key={inv.id} className="border-t border-gray-100">
                              <td className="py-2 px-2">{inv.invoice_number}</td>
                              <td className="py-2 px-2 text-right">${openBal.toFixed(2)}</td>
                              <td className="py-2 px-2">
                                <input type="number" min={0} max={openBal} step={0.01} value={allocations[inv.id] ?? ''} onChange={(e) => setAllocation(inv.id, e.target.value)} className="w-full text-right border border-gray-300 rounded px-2 py-1" placeholder="0" />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
          <button type="button" onClick={handleClose} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button type="button" onClick={() => handleRecord(false)} disabled={saving} className="px-4 py-2 bg-white border border-[#CBD5E1] text-[#334155] rounded-lg hover:bg-[#F1F5F9] disabled:opacity-50">Record</button>
          <button type="button" onClick={() => handleRecord(true)} disabled={saving} className="px-4 py-2 bg-black text-white rounded-lg hover:bg-[#2C2C2C] disabled:opacity-50">Record and close</button>
        </div>
      </div>

      {showCloseConfirm && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl z-10" onClick={() => setShowCloseConfirm(false)}>
          <div className="bg-white rounded-lg shadow-xl p-4 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-gray-900 font-medium mb-3">You have unsaved changes.</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCloseConfirm(false)} className="px-3 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button type="button" onClick={handleCloseWithoutSaving} className="px-3 py-2 bg-white border border-[#CBD5E1] text-[#334155] rounded-lg hover:bg-[#F1F5F9]">Close without saving</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
