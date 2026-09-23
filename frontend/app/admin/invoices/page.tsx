'use client';

import { useEffect, useState } from 'react';
import { Search, Download, Mail, Plus, Edit2, Eye, DollarSign } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import toast from 'react-hot-toast';
import { downloadPdfFromResponse } from '@/lib/download-pdf';
import InvoiceFormLightbox from '@/components/admin/InvoiceFormLightbox';
import ReceivePaymentLightbox from '@/components/admin/ReceivePaymentLightbox';

interface InvoiceItem {
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  total_amount: number;
  amount_paid?: number;
  payment_status: string;
  created_at: string;
  invoice_date?: string;
  items?: InvoiceItem[];
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [receivePaymentOpen, setReceivePaymentOpen] = useState(false);
  const [receivePaymentCustomerId, setReceivePaymentCustomerId] = useState<string | undefined>();
  const [receivePaymentInvoiceId, setReceivePaymentInvoiceId] = useState<string | undefined>();
  const [summary, setSummary] = useState<{ totalPaid: number; totalUnpaid: number } | null>(null);
  const [docTypeFilter, setDocTypeFilter] = useState<'all' | 'invoice' | 'quotation'>('invoice');
  const [createMode, setCreateMode] = useState<'invoice' | 'quotation'>('invoice');

  const fetchInvoices = async () => {
    try {
      const params: Record<string, string> = searchTerm ? { search: searchTerm } : {};
      if (docTypeFilter !== 'all') params.type = docTypeFilter;
      const response = await adminApi.get('/invoices', { params });
      const data = response.data;
      setInvoices(Array.isArray(data) ? data : (data.invoices || []));
    } catch (error) {
      if (isAdminAuthRedirectError(error)) {
        return;
      }
      toast.error('Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await adminApi.get('/invoices/summary');
      setSummary({ totalPaid: res.data.totalPaid ?? 0, totalUnpaid: res.data.totalUnpaid ?? 0 });
    } catch (e) {
      if (isAdminAuthRedirectError(e)) {
        return;
      }
      setSummary(null);
    }
  };

  useEffect(() => {
    fetchInvoices();
    fetchSummary();
  }, []);

  useEffect(() => {
    const debounce = setTimeout(() => { fetchInvoices(); }, 500);
    return () => clearTimeout(debounce);
  }, [searchTerm, docTypeFilter]);

  const handleDownloadPDF = async (invoiceId: string) => {
    try {
      const response = await adminApi.get(`/invoices/${invoiceId}/pdf`, { responseType: 'blob' });
      const ct = response.headers['content-type'] as string | undefined;
      if (downloadPdfFromResponse(response.data, `invoice-${invoiceId}.pdf`, ct)) {
        toast.success('Invoice downloaded');
      }
    } catch (error) {
      toast.error('Failed to download invoice');
    }
  };

  const handleSendEmail = async (invoiceId: string) => {
    try {
      await adminApi.post(`/invoices/${invoiceId}/send-email`);
      toast.success('Invoice sent via email');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to send email');
    }
  };

  const openReceivePayment = (inv: Invoice) => {
    setReceivePaymentCustomerId(inv.customer_id || undefined);
    setReceivePaymentInvoiceId(inv.id);
    setReceivePaymentOpen(true);
  };

  const statusDisplay = (inv: Invoice) => (inv.payment_status || 'unpaid').toLowerCase() === 'paid' ? 'Paid' : 'Unpaid';
  const balance = (inv: Invoice) => (inv.total_amount ?? 0) - (inv.amount_paid ?? 0);
  const balanceLabel = (inv: Invoice) => {
    const b = balance(inv);
    if (b <= 0) return { text: 'Overpaid', value: Math.abs(b), className: 'text-blue-600' };
    return { text: 'Due', value: b, className: 'text-amber-700' };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Invoices & Quotations</h1>
          <p className="text-xs text-slate-400 mt-1">Manage wholesale sales documents, print invoices, and record payments.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setCreateMode('invoice'); setEditId(null); setCreateOpen(true); }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Invoice
          </button>
          <button
            type="button"
            onClick={() => { setCreateMode('quotation'); setEditId(null); setCreateOpen(true); }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 border border-white/5 text-slate-300 hover:text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Quotation
          </button>
        </div>
      </div>

      <div className="flex border-b border-white/10">
        <button
          type="button"
          onClick={() => setDocTypeFilter('invoice')}
          className={`py-3 px-6 font-bold text-xs uppercase tracking-wider border-b-2 transition-all ${
            docTypeFilter === 'invoice'
              ? 'border-teal-500 text-teal-450'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          Invoices
        </button>
        <button
          type="button"
          onClick={() => setDocTypeFilter('quotation')}
          className={`py-3 px-6 font-bold text-xs uppercase tracking-wider border-b-2 transition-all ${
            docTypeFilter === 'quotation'
              ? 'border-teal-500 text-teal-450'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          Quotations
        </button>
      </div>

      {summary !== null && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-5">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Total Outstanding (Unpaid)</p>
            <p className="text-3xl font-extrabold text-amber-500 font-mono">${Number(summary.totalUnpaid).toFixed(2)}</p>
            <div className="mt-4 h-1.5 bg-slate-950/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all"
                style={{ width: summary.totalUnpaid + summary.totalPaid > 0 ? `${(summary.totalUnpaid / (summary.totalUnpaid + summary.totalPaid)) * 100}%` : '0%' }}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-2 font-medium">Pending collection pipeline</p>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-5">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Total Collected (Paid)</p>
            <p className="text-3xl font-extrabold text-teal-400 font-mono">${Number(summary.totalPaid).toFixed(2)}</p>
            <div className="mt-4 h-1.5 bg-slate-950/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-500 rounded-full transition-all"
                style={{ width: summary.totalUnpaid + summary.totalPaid > 0 ? `${(summary.totalPaid / (summary.totalUnpaid + summary.totalPaid)) * 100}%` : '0%' }}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-2 font-medium">Collections finalized</p>
          </div>
        </div>
      )}

      <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl p-4 flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">Search Documents</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search by invoice number, customer name, or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 focus:bg-slate-950/80 transition-all font-semibold"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
        </div>
      ) : (
        <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                <tr>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Date</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Type</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Number</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Customer</th>
                  <th className="text-right py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Amount</th>
                  <th className="text-right py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Paid</th>
                  <th className="text-right py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Balance</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Status</th>
                  <th className="text-right py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-all">
                    <td className="py-3.5 px-4 text-xs text-slate-300">
                      {invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : new Date(invoice.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${(invoice.invoice_type || 'invoice') === 'quotation' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-slate-500/10 text-slate-400 border-white/10'}`}>
                        {(invoice.invoice_type || 'invoice') === 'quotation' ? 'Quotation' : 'Invoice'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-teal-400 font-bold">{invoice.invoice_number}</td>
                    <td className="py-3.5 px-4">
                      <div>
                        {invoice.customer_name && <p className="font-semibold text-slate-200 text-xs">{invoice.customer_name}</p>}
                        {invoice.customer_phone && <p className="text-[10px] text-slate-500 font-medium mt-0.5">{invoice.customer_phone}</p>}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-bold text-slate-200 font-mono text-xs">
                      ${parseFloat(String(invoice.total_amount)).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 text-right text-slate-350 font-mono text-xs">
                      ${parseFloat(String(invoice.amount_paid ?? 0)).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {(() => {
                        const bl = balanceLabel(invoice);
                        return (
                          <span className={`text-xs font-bold font-mono ${bl.className === 'text-blue-600' ? 'text-blue-400' : 'text-amber-500'}`} title={bl.value === 0 ? 'Fully paid' : bl.text}>
                            {bl.value === 0 ? '—' : `${bl.text === 'Due' ? 'Due' : 'Over'}: $${bl.value.toFixed(2)}`}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${
                          statusDisplay(invoice) === 'Paid'
                            ? 'bg-teal-500/10 text-teal-400 border-teal-500/20'
                            : 'bg-amber-500/10 text-amber-450 border-amber-500/20'
                        }`}
                      >
                        {statusDisplay(invoice)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleDownloadPDF(invoice.id)}
                          className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                          title="Download PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {invoice.customer_email && (
                          <button
                            onClick={() => handleSendEmail(invoice.id)}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                            title="Send Email"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => { setEditId(invoice.id); setCreateOpen(true); }}
                          className="p-1.5 text-teal-450 hover:text-teal-350 hover:bg-white/5 rounded-lg transition-all"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {invoice.invoice_type !== 'quotation' && (
                          <button
                            onClick={() => openReceivePayment(invoice)}
                            className="p-1.5 text-emerald-450 hover:text-emerald-350 hover:bg-white/5 rounded-lg transition-all"
                            title="Receive payment"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invoices.length === 0 && (
            <div className="py-16 text-center text-slate-500 text-xs font-semibold">No invoices or quotations yet. Create one to get started.</div>
          )}
        </div>
      )}

      <InvoiceFormLightbox
        isOpen={createOpen}
        onClose={() => { setCreateOpen(false); setEditId(null); }}
        onSaved={() => { fetchInvoices(); fetchSummary(); }}
        editId={editId}
        initialDocumentType={createMode}
      />
      <ReceivePaymentLightbox
        isOpen={receivePaymentOpen}
        onClose={() => { setReceivePaymentOpen(false); setReceivePaymentCustomerId(undefined); setReceivePaymentInvoiceId(undefined); }}
        onRecorded={() => { fetchInvoices(); fetchSummary(); }}
        preselectedCustomerId={receivePaymentCustomerId}
        preselectedInvoiceId={receivePaymentInvoiceId}
      />
    </div>
  );
}
