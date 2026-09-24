'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText, UploadCloud } from 'lucide-react';
import adminApi, { uploadApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface Supplier {
  id: string;
  supplier_id?: string;
  name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  tax_id?: string;
  gst_number?: string;
  payment_terms?: string;
  payment_terms_days?: number;
  credit_limit?: number;
  rating?: number;
  status?: string;
  notes?: string;
  bank_details?: {
    account_name?: string;
    account_number?: string;
    bank_name?: string;
    ifsc?: string;
    branch?: string;
  };
  documents?: { name: string; url: string; uploaded_at?: string }[];
}

interface LedgerEntry {
  id: string;
  date: string;
  reference_type: string;
  reference_id?: string;
  description?: string;
  debit: number;
  credit: number;
  balance: number;
}

export default function SupplierDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'transactions' | 'details' | 'documents'>('transactions');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [vendorRes, balanceRes, ledgerRes] = await Promise.all([
        adminApi.get(`/vendors/${id}`),
        adminApi.get(`/vendors/${id}/balance`),
        adminApi.get(`/vendors/${id}/ledger`, { params: { limit: 100 } }),
      ]);
      setSupplier(vendorRes.data);
      setBalance(balanceRes.data?.balance ?? null);
      setLedger((ledgerRes.data?.entries || []) as LedgerEntry[]);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to load supplier');
      router.push('/admin/vendors');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchData();
  }, [id]);

  const handleUploadDocuments = async (files: FileList | null) => {
    if (!files || !supplier) return;
    setUploading(true);
    try {
      const docs: Supplier['documents'] = supplier.documents ? [...supplier.documents] : [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const form = new FormData();
        form.append('file', file);
        const res = await uploadApi.post(`/vendors/${supplier.id}/documents`, form);
        docs.push(...(res.data.documents || []));
      }
      setSupplier((prev) => (prev ? { ...prev, documents: docs } : prev));
      toast.success('Document(s) uploaded');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to upload documents');
    } finally {
      setUploading(false);
    }
  };

  if (loading || !supplier) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  const openBalance = balance ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/vendors" className="inline-flex items-center gap-2 text-teal-450 hover:text-teal-350 hover:underline text-xs font-bold transition-all">
          <ArrowLeft className="w-4 h-4" />
          Back to Vendors
        </Link>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">{supplier.name}</h1>
          <div className="text-xs text-slate-400 mt-1.5 space-y-1">
            <p>Supplier Unique ID: <span className="font-mono text-slate-350">{supplier.supplier_id || '—'}</span></p>
            {supplier.contact_name && (
              <p>Contact Liaison: <span className="text-slate-300 font-semibold">{supplier.contact_name}</span> {supplier.phone ? `• ${supplier.phone}` : ''}</p>
            )}
            {supplier.email && (
              <p>Email: <a href={`mailto:${supplier.email}`} className="text-teal-450 hover:text-teal-350 hover:underline transition-colors">{supplier.email}</a></p>
            )}
          </div>
        </div>
        <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] px-4 py-3 min-w-[220px] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Outstanding Dues Payable</p>
          <p className="text-2xl font-extrabold text-amber-400 mt-1 font-mono">${openBalance.toFixed(2)}</p>
          {supplier.credit_limit != null && (
            <p className="text-[9px] text-slate-500 font-mono font-bold mt-1.5 uppercase tracking-wider">
              Approved Line Limit: ${supplier.credit_limit.toFixed(2)}
            </p>
          )}
        </div>
      </div>

      <div className="border-b border-white/5 mb-6">
        <nav className="-mb-px flex gap-4">
          <button
            type="button"
            onClick={() => setActiveTab('transactions')}
            className={`pb-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 ${
              activeTab === 'transactions' ? 'border-teal-500 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-350'
            }`}
          >
            Transactions Ledger
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`pb-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 ${
              activeTab === 'details' ? 'border-teal-500 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-350'
            }`}
          >
            Supplier Profile Details
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('documents')}
            className={`pb-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 ${
              activeTab === 'documents' ? 'border-teal-500 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-350'
            }`}
          >
            Documents Archive
          </button>
        </nav>
      </div>

      {activeTab === 'transactions' && (
        <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-slate-950/60">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Transaction log entries</span>
            </div>
            <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-wider">Recent {ledger.length} lines</span>
          </div>
          {ledger.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-xs font-semibold">No transactions occurred on this account list.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                  <tr>
                    <th className="text-left py-3 px-3 text-[10px] font-bold uppercase tracking-wider">Posting Date</th>
                    <th className="text-left py-3 px-3 text-[10px] font-bold uppercase tracking-wider">Type</th>
                    <th className="text-left py-3 px-3 text-[10px] font-bold uppercase tracking-wider">Reference Memo</th>
                    <th className="text-right py-3 px-3 text-[10px] font-bold uppercase tracking-wider">Debit (Cleared)</th>
                    <th className="text-right py-3 px-3 text-[10px] font-bold uppercase tracking-wider">Credit (Add Dues)</th>
                    <th className="text-right py-3 px-3 text-[10px] font-bold uppercase tracking-wider">Account Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((e) => (
                    <tr key={e.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-3 text-xs text-slate-400 font-mono">{e.date ? new Date(e.date).toLocaleDateString() : '—'}</td>
                      <td className="py-3 px-3 text-xs">
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold border border-white/10 bg-slate-800/80 text-slate-350">{e.reference_type || 'Entry'}</span>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-200 font-semibold">{e.description || '—'}</td>
                      <td className="py-3 px-3 text-right text-xs font-mono font-bold text-teal-400">${Number(e.debit || 0).toFixed(2)}</td>
                      <td className="py-3 px-3 text-right text-xs font-mono font-bold text-rose-400">${Number(e.credit || 0).toFixed(2)}</td>
                      <td className="py-3 px-3 text-right text-xs font-mono font-extrabold text-slate-100">${Number(e.balance || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'details' && (
        <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] p-5 shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl space-y-5 text-xs text-slate-300">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Company Channels</h3>
              <p className="mb-2"><span className="text-slate-500 font-bold uppercase tracking-wider text-[9px] mr-2">Contact Name:</span> <span className="text-slate-200 font-semibold">{supplier.contact_name || '—'}</span></p>
              <p className="mb-2"><span className="text-slate-500 font-bold uppercase tracking-wider text-[9px] mr-2">Phone Lines:</span> <span className="text-slate-200 font-mono font-semibold">{supplier.phone || '—'}</span></p>
              <p className="mb-1"><span className="text-slate-500 font-bold uppercase tracking-wider text-[9px] mr-2">Email Inquiries:</span> <span className="text-slate-200 font-semibold">{supplier.email || '—'}</span></p>
            </div>
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Cargo Mailing Address</h3>
              <p className="text-slate-202 leading-relaxed font-semibold">
                {supplier.address || '—'}
                {supplier.city ? `, ${supplier.city}` : ''}
                {supplier.state ? `, ${supplier.state}` : ''}
                {supplier.zip ? `, ${supplier.zip}` : ''}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">Contractual Payment Dues</h3>
              <p className="mb-1.5"><span className="text-slate-500 font-bold uppercase tracking-wider text-[9px] mr-2">Terms:</span> <span className="text-slate-200 font-semibold">{supplier.payment_terms || (supplier.payment_terms_days ? `Net ${supplier.payment_terms_days} days` : '—')}</span></p>
              <p><span className="text-slate-500 font-bold uppercase tracking-wider text-[9px] mr-2">Lead Rating:</span> <span className="text-teal-400 font-bold font-mono">{supplier.rating != null ? `${supplier.rating}/100` : '—'}</span></p>
            </div>
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4 font-mono">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Corporate Registry IDs</h3>
              <p className="mb-1.5"><span className="text-slate-500 font-bold uppercase tracking-wider text-[9px] mr-2">Tax ID:</span> <span className="text-slate-200 font-semibold">{supplier.tax_id || '—'}</span></p>
              <p><span className="text-slate-500 font-bold uppercase tracking-wider text-[9px] mr-2">GST ID:</span> <span className="text-slate-200 font-semibold">{supplier.gst_number || '—'}</span></p>
            </div>
          </div>
          {supplier.notes && (
            <div className="bg-slate-955/40 border border-white/5 p-4 rounded-xl">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Supplier Registry Executive Notes</h3>
              <p className="text-slate-300 leading-relaxed whitespace-pre-line">{supplier.notes}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] p-5 shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UploadCloud className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-350">Supplier documents</span>
            </div>
            <label className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-slate-800 border border-white/5 text-slate-300 hover:text-white rounded-xl text-xs font-semibold hover:bg-slate-800/80 transition-colors cursor-pointerSelect">
              <UploadCloud className="w-4 h-4" />
              <span>{uploading ? 'Uploading Files...' : 'Upload Document Files'}</span>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleUploadDocuments(e.target.files)}
              />
            </label>
          </div>
          {(!supplier.documents || supplier.documents.length === 0) ? (
            <p className="text-xs text-slate-500 font-semibold py-8 text-center bg-slate-950/20 border border-dashed border-white/5 rounded-xl">No documents archived. Upload procurement agreement PDFs or invoices related to this supplier list.</p>
          ) : (
            <ul className="divide-y divide-white/5 text-xs bg-slate-955/20 border border-white/5 rounded-xl overflow-hidden px-4">
              {supplier.documents.map((d, idx) => (
                <li key={`${d.url}-${idx}`} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-slate-202 font-semibold">{d.name}</p>
                    <p className="text-[10px] text-slate-500 font-mono mt-1 font-semibold">
                      {d.uploaded_at ? new Date(d.uploaded_at).toLocaleString() : ''}
                    </p>
                  </div>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal-450 hover:text-teal-300 hover:underline text-xs font-bold"
                  >
                    View File
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
