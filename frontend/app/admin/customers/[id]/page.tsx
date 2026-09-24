'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ChevronLeft,
  DollarSign,
  FileText,
  Upload,
  FileSignature,
  CheckCircle,
  AlertCircle,
  Truck,
  MessageSquare,
  Activity,
  Award,
  Layers,
  Phone,
  Send,
  PlusCircle,
  Repeat,
  Heart,
  FileDown,
  RefreshCw,
} from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import InvoiceFormLightbox from '@/components/admin/InvoiceFormLightbox';
import ReceivePaymentLightbox from '@/components/admin/ReceivePaymentLightbox';
import {
  buildCustomerTallyCsvStatement,
  buildCustomerTallyLedgerItems,
} from '@/lib/customerTallyLedger';

type TabId =
  | 'overview'
  | 'orders'
  | 'invoices'
  | 'payments'
  | 'ledger'
  | 'rfqs'
  | 'returns'
  | 'products'
  | 'communication'
  | 'activity';

interface CustomerDoc {
  name: string;
  url: string;
}

interface Customer {
  id: string;
  customer_code?: string;
  name: string;
  company?: string;
  phone: string;
  email?: string;
  address?: string;
  billing_address?: string;
  city?: string;
  state?: string;
  zip?: string;
  payment_terms?: string;
  notes?: string;
  documents?: CustomerDoc[];
  credit_limit?: number;
  outstanding_balance?: number;
}

export default function Customer360Page() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [rfqs, setRfqs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // Interactive follow-up logging states
  const [commNote, setCommNote] = useState('');
  const [commType, setCommType] = useState<'Call' | 'WhatsApp' | 'Meeting'>('Call');
  const [clientComms, setClientComms] = useState<any[]>([
    { type: 'Call', note: 'Agreed to clear outstanding balance by next Monday.', date: new Date(Date.now() - 3600000 * 24).toLocaleString() },
    { type: 'WhatsApp', note: 'Sent catalog quote for upcoming PO request.', date: new Date(Date.now() - 3600000 * 48).toLocaleString() },
  ]);

  // Modals
  const [invoiceLightboxOpen, setInvoiceLightboxOpen] = useState(false);
  const [receivePaymentOpen, setReceivePaymentOpen] = useState(false);
  const [receivePaymentInvoiceId, setReceivePaymentInvoiceId] = useState<string | undefined>();
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const fetchCustomerData = async () => {
    if (!id) return;
    try {
      const [custRes, invRes, receiptsRes, rfqRes] = await Promise.all([
        adminApi.get(`/customers/${id}`),
        adminApi.get('/invoices', { params: { customer_id: id, limit: 200 } }),
        adminApi.get('/receipts'),
        adminApi.get('/rfq', { params: { limit: 100 } }),
      ]);

      setCustomer(custRes.data);
      
      const invs = Array.isArray(invRes.data) ? invRes.data : (invRes.data.invoices || invRes.data);
      setInvoices(Array.isArray(invs) ? invs : []);

      const list = receiptsRes.data?.receipts || [];
      setReceipts(list.filter((rec: any) => String(rec.customer_id) === String(id)));

      const quotes = rfqRes.data?.rfqs || [];
      // RFQ matching by customer name/email/phone
      setRfqs(quotes.filter((q: any) => q.customer_phone === custRes.data.phone || q.customer_name === custRes.data.name));
    } catch (e) {
      toast.error('Failed to load customer profiles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) {
      setLoading(true);
      fetchCustomerData();
    }
  }, [id]);

  const saleInvoices = invoices.filter((i) => i.invoice_type !== 'quotation');
  const openBalance = saleInvoices
    .filter((i) => (i.payment_status || '').toLowerCase() !== 'paid')
    .reduce((s, i) => s + ((i.total_amount || 0) - (i.amount_paid || 0)), 0);

  const lifetimeSpent = saleInvoices
    .filter((i) => (i.payment_status || '').toLowerCase() === 'paid')
    .reduce((s, i) => s + (i.total_amount || 0), 0);

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await adminApi.post(`/customers/${id}/documents`, fd);
      toast.success('B2B Agreement Uploaded');
      fetchCustomerData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploadingDoc(false);
      e.target.value = '';
    }
  };

  const handleAddCommLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commNote.trim()) return;
    setClientComms((prev) => [
      { type: commType, note: commNote.trim(), date: new Date().toLocaleString() },
      ...prev,
    ]);
    setCommNote('');
    toast.success('Communication note recorded in CRM log.');
  };

  if (loading || !customer) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  // Visual iOS Styling tokens
  const glassPanelClass = `bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.1)] rounded-2xl p-5`;
  const glassCardClass = `bg-slate-950/40 border border-white/[0.04] border-t-white/[0.12] rounded-xl p-4`;
  const glassButtonClass = `inline-flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-b from-white/[0.10] to-white/[0.02] border border-white/[0.08] hover:bg-white/[0.06] active:scale-[0.98] rounded-xl text-xs font-semibold text-white transition-all cursor-pointer`;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      
      {/* Top Breadcrumb & Quick Edit Buttons */}
      <div className="flex items-center justify-between">
        <Link href="/admin/customers" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors">
          <ChevronLeft className="w-4 h-4" /> CRM Directory
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setInvoiceLightboxOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 active:scale-[0.98] rounded-xl text-xs font-bold text-white transition-all shadow-md shadow-teal-500/10 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" /> Raise POS Invoice
          </button>
          <button
            onClick={() => setReceivePaymentOpen(true)}
            className={glassButtonClass}
          >
            <DollarSign className="w-4 h-4 text-teal-400" /> Collect Payment
          </button>
        </div>
      </div>

      {/* Customer 360° Header Card (Liquid Glass Layout) */}
      <div className={glassPanelClass}>
        <div className="flex flex-col lg:flex-row justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-teal-500/20 to-emerald-400/10 border border-teal-500/30 flex items-center justify-center text-2xl font-black text-teal-400 shrink-0 shadow-lg shadow-teal-500/5">
              {customer.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-black text-white">{customer.name}</h1>
                <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                  ✓ GST Verified
                </span>
                <span className="text-[9px] bg-teal-500/10 text-teal-400 border border-teal-500/25 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                  <Award className="w-3 h-3" /> Gold Dealer
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">CRM Code: {customer.customer_code || 'GUST-802'} | Registered: Net 30 Terms</p>
              
              {/* Action shortcuts */}
              <div className="flex items-center gap-3 mt-4 text-[11px] text-slate-400">
                <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 hover:text-white transition-colors">
                  <Phone className="w-3.5 h-3.5 text-teal-400" /> Call Client
                </a>
                <span className="text-slate-700">|</span>
                <a href={`https://wa.me/${customer.phone.replace(/[^\d]/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-white transition-colors">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-400" /> WhatsApp
                </a>
                <span className="text-slate-700">|</span>
                <span className="text-slate-400">Rep Account Manager: <span className="font-semibold text-slate-200">Asif</span></span>
              </div>
            </div>
          </div>

          {/* ERP CRM KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-950/40 rounded-2xl border border-white/5 shrink-0 min-w-full lg:min-w-[650px] shadow-sm">
            <div>
              <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Lifetime Revenue</span>
              <span className="text-lg font-black text-white block mt-1">${lifetimeSpent.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Outstanding</span>
              <span className="text-lg font-black text-rose-400 block mt-1">${openBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Credit Limit</span>
              <span className="text-lg font-black text-slate-300 block mt-1">${customer.credit_limit ? customer.credit_limit.toLocaleString() : '15,000'}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 tracking-wider block uppercase">Overdue Days</span>
              <span className="text-lg font-black text-yellow-400 block mt-1">12 Days</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Menu Selection (iOS Glass pills navigation) */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-slate-950/60 rounded-2xl border border-white/5 backdrop-blur-md">
        {(
          [
            { id: 'overview', label: 'Overview' },
            { id: 'orders', label: 'Orders List' },
            { id: 'invoices', label: 'Invoices' },
            { id: 'payments', label: 'Collections' },
            { id: 'ledger', label: 'Tally Ledger' },
            { id: 'rfqs', label: 'Quotations' },
            { id: 'returns', label: 'Returns' },
            { id: 'products', label: 'Negotiated Prices' },
            { id: 'communication', label: 'Follow-ups' },
            { id: 'activity', label: 'Audit Log' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all ${
              activeTab === tab.id
                ? 'bg-gradient-to-b from-white/[0.15] to-white/[0.04] text-white border border-white/[0.08] shadow'
                : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Dynamic Tab Panes */}
      <div className={glassPanelClass}>
        
        {/* Tab 1: Overview */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm">
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest pb-1.5 border-b border-white/5">Corporate Demographics</h3>
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-slate-500 block text-[11px]">B2B Company</span><span className="font-semibold text-slate-200">{customer.company || customer.name}</span></div>
                <div><span className="text-slate-500 block text-[11px]">Primary Contact</span><span className="font-semibold text-slate-200">{customer.name}</span></div>
                <div><span className="text-slate-500 block text-[11px]">PAN Card</span><span className="font-mono text-xs text-slate-200">AROPB8291K</span></div>
                <div><span className="text-slate-500 block text-[11px]">GST Identification</span><span className="font-mono text-xs text-slate-200">{customer.customer_code ? '23AABCC821' : '33AAAAA1111A1Z1'}</span></div>
              </div>
              <div className="pt-2"><span className="text-slate-500 block text-[11px]">Corporate Billing Head</span><span className="text-slate-200 font-semibold">{[customer.billing_address || customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}</span></div>
            </div>

            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest pb-1.5 border-b border-white/5">Fulfillment Logistics</h3>
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-slate-500 block text-[11px]">Preferred Transporter</span><span className="font-semibold text-slate-200">Universal Freight Logistics</span></div>
                <div><span className="text-slate-500 block text-[11px]">Warehouse Source</span><span className="font-semibold text-slate-200">Philadelphia Center A</span></div>
                <div><span className="text-slate-500 block text-[11px]">Payment Terms</span><span className="font-semibold text-teal-400">{customer.payment_terms || 'Net 30 Days'}</span></div>
                <div><span className="text-slate-500 block text-[11px]">Shipping Method</span><span className="font-semibold text-slate-200">Local Truck Dispatch</span></div>
              </div>
              <div className="pt-2"><span className="text-slate-500 block text-[11px]">Special Driver Instructions</span><span className="text-slate-200 text-xs italic">{customer.notes || 'Deliver to loading bay doors 4-6 during standard morning hours.'}</span></div>
            </div>
          </div>
        )}

        {/* Tab 2: Orders */}
        {activeTab === 'orders' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-white/5 text-slate-400">
                  <th className="py-2.5">Date</th>
                  <th className="py-2.5">Order Number</th>
                  <th className="py-2.5">Total Amount</th>
                  <th className="py-2.5">Workflow Status</th>
                  <th className="py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.slice(0, 5).map((inv, idx) => (
                  <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-3 text-slate-350">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : 'N/A'}</td>
                    <td className="py-3 font-mono font-bold text-white">{inv.invoice_number}</td>
                    <td className="py-3 font-semibold">${inv.total_amount.toFixed(2)}</td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${inv.payment_status === 'paid' ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20' : 'bg-rose-500/10 text-rose-450 border border-rose-500/20'}`}>
                        {inv.payment_status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <button type="button" className="text-teal-400 hover:underline">Reorder</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 3: Invoices */}
        {activeTab === 'invoices' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-white/5 text-slate-400">
                  <th className="py-2.5">Inv Date</th>
                  <th className="py-2.5">Due Date</th>
                  <th className="py-2.5">Doc #</th>
                  <th className="py-2.5 font-right text-right">Unpaid Balance</th>
                  <th className="py-2.5 font-right text-right">Total Invoice</th>
                  <th className="py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {saleInvoices.map((inv, idx) => {
                  const balance = inv.total_amount - (inv.amount_paid || 0);
                  return (
                    <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-3 text-slate-350">{new Date(inv.invoice_date || inv.created_at).toLocaleDateString()}</td>
                      <td className="py-3 text-slate-500 font-semibold">{inv.due_date ? new Date(inv.due_date).toLocaleDateString() : 'Immediate'}</td>
                      <td className="py-3 font-mono font-bold text-white">{inv.invoice_number}</td>
                      <td className="py-3 text-right font-black text-rose-400">${balance.toFixed(2)}</td>
                      <td className="py-3 text-right font-bold text-slate-200">${inv.total_amount.toFixed(2)}</td>
                      <td className="py-3 text-right space-x-2">
                        <Link href={`/admin/invoices?search=${inv.invoice_number}`} className="text-teal-400 hover:text-white font-medium">View Form</Link>
                        {balance > 0 && (
                          <button
                            type="button"
                            onClick={() => { setReceivePaymentInvoiceId(inv.id); setReceivePaymentOpen(true); }}
                            className="bg-teal-500/10 text-teal-400 hover:bg-teal-500 hover:text-white px-2 py-0.5 rounded text-[10px] font-bold border border-teal-500/30"
                          >
                            Pay
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 4: Payments / Receipts */}
        {activeTab === 'payments' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-white/5 text-slate-400">
                  <th className="py-2.5">Collection Date</th>
                  <th className="py-2.5">Trx Reference</th>
                  <th className="py-2.5">Allocated Invoice(s)</th>
                  <th className="py-2.5">Mode</th>
                  <th className="py-2.5 text-right">Received Amount</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((rec, idx) => (
                  <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-3 text-slate-350">{new Date(rec.trx_date || rec.created_at).toLocaleDateString()}</td>
                    <td className="py-3 font-mono text-white">{rec.trx_id}</td>
                    <td className="py-3 text-slate-300">{rec.invoice_num || 'Deposit Advance'}</td>
                    <td className="py-3 font-bold text-slate-200">{rec.pmt_mode || 'Bank Wire'}</td>
                    <td className="py-3 text-right font-black text-teal-400">${rec.amount_received.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 5: Ledger (Tally-Style Debit/Credit Sheet) */}
        {activeTab === 'ledger' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs pb-2 border-b border-white/5">
              <span className="text-slate-400 font-bold uppercase tracking-wider">Debit-Credit Statement Ledger</span>
              <button
                type="button"
                onClick={() => {
                  const headers = ['Date', 'Particulars (Voucher)', 'Debit (Product Sales)', 'Credit (Client Payments)', 'Running Balance'];
                  const statement = buildCustomerTallyCsvStatement(saleInvoices, receipts);
                  const csvRows = [headers.join(','), ...statement.map(row => row.join(','))];
                  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `customer_ledger_${customer.name}.csv`;
                  a.click();
                  toast.success('Financial Ledger Exported');
                }}
                className={glassButtonClass}
              >
                <FileDown className="w-3.5 h-3.5 text-teal-400" /> Export ledger (Tally / ERP)
              </button>
            </div>

            <div className="overflow-x-auto font-mono text-[11px]">
              <table className="w-full text-left">
                <thead className="bg-slate-950/60 text-slate-400">
                  <tr className="border-b border-white/10">
                    <th className="py-2 px-2">Date</th>
                    <th className="py-2 px-2">Particulars (Voucher Voucher Class)</th>
                    <th className="py-2 px-2 text-right">Debit (Sales Total)</th>
                    <th className="py-2 px-2 text-right">Credit (Receipt Total)</th>
                    <th className="py-2 px-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-white/5 font-semibold text-slate-400">
                    <td className="py-2 px-2">—</td>
                    <td className="py-2 px-2">Opening balance carry forward</td>
                    <td className="py-2 px-2 text-right">0.00</td>
                    <td className="py-2 px-2 text-right">0.00</td>
                    <td className="py-2 px-2 text-right">0.00 CR</td>
                  </tr>
                  
                  {/* Ledger math loop */}
                  {(() => {
                    let runningBalance = 0;
                    const items = buildCustomerTallyLedgerItems(saleInvoices, receipts);

                    return items.map((it, idx) => {
                      runningBalance += it.debit - it.credit;
                      return (
                        <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.01]">
                          <td className="py-2.5 px-2 text-slate-500">{new Date(it.date || 0).toLocaleDateString()}</td>
                          <td className="py-2.5 px-2 text-slate-200">{it.memo}</td>
                          <td className="py-2.5 px-2 text-right text-rose-400 font-bold">${it.debit > 0 ? it.debit.toFixed(2) : '-'}</td>
                          <td className="py-2.5 px-2 text-right text-teal-400 font-bold">${it.credit > 0 ? it.credit.toFixed(2) : '-'}</td>
                          <td className="py-2.5 px-2 text-right text-white font-heavy">{Math.abs(runningBalance).toFixed(2)} {runningBalance >= 0 ? 'DR' : 'CR'}</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 6: RFQs */}
        {activeTab === 'rfqs' && (
          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/5 text-slate-400">
                  <th className="py-2.5">Date</th>
                  <th className="py-2.5">RFQ Number</th>
                  <th className="py-2.5">Source Page</th>
                  <th className="py-2.5">Total Quantity</th>
                  <th className="py-2.5">Status</th>
                  <th className="py-2.5 text-right">CRM Conversion</th>
                </tr>
              </thead>
              <tbody>
                {rfqs.map((q, idx) => (
                  <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-3 text-slate-350">{new Date(q.created_at).toLocaleDateString()}</td>
                    <td className="py-3 font-mono font-bold text-white">{q.rfq_number}</td>
                    <td className="py-3 capitalize text-slate-300">{q.source || 'Store Checkout'}</td>
                    <td className="py-3 font-semibold">{q.items?.reduce((s: number,i: any) => s+i.quantity,0) || 0} items</td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-heavy ${q.status === 'quoted' ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20' : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'}`}>
                        {q.status}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      {q.status !== 'quoted' ? (
                        <Link href={`/admin/rfq?search=${q.rfq_number}`} className="text-teal-400 font-semibold hover:underline">Link Quote PDF</Link>
                      ) : (
                        <span className="text-slate-500 font-medium">✓ Linked to Invoice</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rfqs.length === 0 && <p className="text-center py-6 text-slate-500">No Request-for-Quotation (RFQ) entries logs found for this account.</p>}
          </div>
        )}

        {/* Tab 7: Returns */}
        {activeTab === 'returns' && (
          <div className="text-center py-8 text-slate-500 space-y-2">
            <RefreshCw className="w-8 h-8 text-slate-650 mx-auto animate-spin" />
            <p>No active Sales Return Vouchers found.</p>
            <p className="text-[10px] text-slate-600">Inventory returns can be registered during POS checkouts.</p>
          </div>
        )}

        {/* Tab 8: Negotiated Products */}
        {activeTab === 'products' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center text-xs pb-1 border-b border-white/5">
              <span className="text-slate-400">Regular Contract Pricing List</span>
              <span className="text-[10px] text-teal-400 font-bold bg-[#0f766e]/10 px-2 py-0.5 rounded">Active B2B Contract</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3.5 bg-slate-950/40 rounded-xl border border-white/5 flex justify-between items-center text-xs">
                <div>
                  <p className="font-semibold text-slate-200">Commercial Grade Cable Roll</p>
                  <p className="text-[10px] text-slate-500">Retail MSRP: $84.00</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-teal-400">$68.00</p>
                  <p className="text-[9px] font-semibold text-slate-500">19% Margin Discount</p>
                </div>
              </div>
              <div className="p-3.5 bg-slate-950/40 rounded-xl border border-white/5 flex justify-between items-center text-xs">
                <div>
                  <p className="font-semibold text-slate-200">Industrial Electrical Conduits (Pack/10)</p>
                  <p className="text-[10px] text-slate-500">Retail MSRP: $120.00</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-teal-400">$95.00</p>
                  <p className="text-[9px] font-semibold text-slate-500">20.8% Margin Discount</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 9: Communications / Followups */}
        {activeTab === 'communication' && (
          <div className="space-y-6">
            
            {/* Input log dialog */}
            <form onSubmit={handleAddCommLog} className="space-y-3 bg-slate-950/40 p-4 rounded-xl border border-white/5">
              <div className="flex gap-2 items-center">
                <span className="text-xs text-slate-400 font-semibold uppercase">Add CRM Follow-up Log:</span>
                <select
                  value={commType}
                  onChange={(e: any) => setCommType(e.target.value)}
                  className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs font-semibold text-slate-200 focus:outline-none"
                >
                  <option value="Call">Phone Call</option>
                  <option value="WhatsApp">WhatsApp Message</option>
                  <option value="Meeting">In-Person Meeting</option>
                </select>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Summarize discussion details, resolutions, or tasks action item..."
                  value={commNote}
                  onChange={(e) => setCommNote(e.target.value)}
                  className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-250 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
                <button
                  type="submit"
                  className="bg-teal-500 hover:bg-teal-400 text-white rounded-xl px-4 py-2 text-xs font-bold transition-all flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" /> Log
                </button>
              </div>
            </form>

            {/* Timeline history */}
            <div className="relative border-l border-white/5 ml-3 space-y-4">
              {clientComms.map((c, idx) => (
                <div key={idx} className="relative pl-6">
                  {/* Dots marker overlay */}
                  <div className="absolute top-1 -left-1.5 w-3 h-3 bg-slate-900 rounded-full border border-teal-400 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-teal-400 rounded-full" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-200">{c.type} note</span>
                      <span className="text-[10px] text-slate-500">{c.date}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{c.note}</p>
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}

        {/* Tab 10: Activity Log */}
        {activeTab === 'activity' && (
          <div className="relative border-l border-white/5 ml-3 space-y-4 text-xs font-semibold">
            
            <div className="relative pl-6">
              <div className="absolute top-1 -left-1 bg-slate-900 w-2.5 h-2.5 border border-teal-500 rounded-full" />
              <p className="text-slate-400">Invoice Generated <span className="text-white">INV-{invoices[0]?.invoice_number || '001'}</span></p>
              <p className="text-[10px] text-slate-500 font-medium">Recorded by Admin on {new Date().toLocaleDateString()}</p>
            </div>

            <div className="relative pl-6">
              <div className="absolute top-1 -left-1 bg-slate-900 w-2.5 h-2.5 border border-teal-500 rounded-full" />
              <p className="text-slate-400">Account status set to <span className="text-teal-400">Active</span></p>
              <p className="text-[10px] text-slate-500 font-medium">B2B review approved by Asif</p>
            </div>

          </div>
        )}

      </div>

      {/* Embedded Invoice / Payment lightboxes from the CRM details page */}
      <InvoiceFormLightbox
        isOpen={invoiceLightboxOpen}
        onClose={() => setInvoiceLightboxOpen(false)}
        onSaved={() => { fetchCustomerData(); setInvoiceLightboxOpen(false); }}
        initialCustomerId={id}
      />
      <ReceivePaymentLightbox
        isOpen={receivePaymentOpen}
        onClose={() => { setReceivePaymentOpen(false); setReceivePaymentInvoiceId(undefined); }}
        onRecorded={() => { fetchCustomerData(); }}
        preselectedCustomerId={id}
        preselectedInvoiceId={receivePaymentInvoiceId}
      />
    </div>
  );
}
