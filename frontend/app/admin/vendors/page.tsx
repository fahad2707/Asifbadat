'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Edit, Search, Trash2, X, MapPin, FolderPlus } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import toast from 'react-hot-toast';

interface Vendor {
  id: string;
  supplier_id?: string;
  name: string;
  contact_name?: string;
  company_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  payment_terms?: string;
  notes?: string;
  purchases?: number;
  payments?: number;
  balance?: number;
  open_balance?: number;
  paid_balance?: number;
}

export default function VendorsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [states, setStates] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [form, setForm] = useState<Partial<Vendor>>({
    supplier_id: '',
    name: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    payment_terms: '',
    notes: '',
  });

  const fetchVendors = async () => {
    try {
      const res = await adminApi.get('/vendors', { params: search ? { search } : {} });
      setVendors(res.data.vendors || []);
    } catch (e) {
      if (isAdminAuthRedirectError(e)) {
        return;
      }
      toast.error('Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  };

  const fetchStates = async () => {
    try {
      const res = await adminApi.get('/vendors/locations/states');
      setStates(res.data.states || []);
    } catch {
      setStates(['Arizona', 'California', 'Florida', 'Texas']);
    }
  };

  const fetchCities = async (state?: string) => {
    try {
      const res = await adminApi.get('/vendors/locations/cities', { params: state ? { state } : {} });
      setCities(res.data.cities || []);
    } catch {
      setCities([]);
    }
  };

  useEffect(() => {
    fetchVendors();
  }, [search]);

  // Quick command: /admin/vendors?create=1 opens a blank vendor form.
  useEffect(() => {
    if (searchParams?.get('create') !== '1') return;
    setEditing(null);
    setForm({ supplier_id: '', name: '', contact_name: '', phone: '', email: '', address: '', city: '', state: '', zip: '', payment_terms: '', notes: '' });
    setShowModal(true);
    router.replace('/admin/vendors', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (showModal) {
      fetchStates();
      fetchCities(form.state);
    }
  }, [showModal, form.state]);

  const generateId = async () => {
    try {
      const res = await adminApi.get('/vendors/generate-id');
      setForm((f) => ({ ...f, supplier_id: res.data.supplier_id }));
    } catch {
      setForm((f) => ({ ...f, supplier_id: 'S' + Math.floor(10000 + Math.random() * 90000) }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name?.trim()) {
      toast.error('Supplier name is required');
      return;
    }
    try {
      if (editing) {
        await adminApi.put(`/vendors/${editing.id}`, form);
        toast.success('Supplier updated');
      } else {
        await adminApi.post('/vendors', form);
        toast.success('Supplier created');
      }
      setShowModal(false);
      setEditing(null);
      setForm({ supplier_id: '', name: '', contact_name: '', phone: '', email: '', address: '', city: '', state: '', zip: '', payment_terms: '', notes: '' });
      fetchVendors();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    }
  };

  const openEdit = (v: Vendor) => {
    setEditing(v);
    setForm({
      supplier_id: v.supplier_id,
      name: v.name,
      contact_name: v.contact_name,
      phone: v.phone,
      email: v.email,
      address: v.address,
      city: v.city,
      state: v.state,
      zip: v.zip,
      payment_terms: v.payment_terms,
      notes: v.notes,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this supplier?')) return;
    try {
      await adminApi.delete(`/vendors/${id}`);
      toast.success('Supplier deactivated');
      fetchVendors();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const totalPurchases = vendors.reduce((s, v) => s + (v.purchases ?? 0), 0);
  const totalOpen = vendors.reduce((s, v) => s + (v.open_balance ?? v.balance ?? 0), 0);
  const totalPaid = vendors.reduce((s, v) => s + (v.paid_balance ?? v.payments ?? 0), 0);
  const suppliersWithBalance = vendors.filter((v) => (v.open_balance ?? v.balance ?? 0) > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[28px] font-normal text-[#1A1A1A] tracking-tight">Vendors</h1>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setForm({ supplier_id: '', name: '', contact_name: '', phone: '', email: '', address: '', city: '', state: '', zip: '', payment_terms: '', notes: '' });
            setShowModal(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-black text-white text-sm font-medium hover:bg-[#2C2C2C]"
        >
          New vendor
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3">
        <div className="px-4 py-3 bg-[#E6F7F8]">
          <p className="text-[28px] font-normal text-[#1A1A1A] tabular-nums">${totalPurchases.toFixed(2)}</p>
          <p className="text-xs text-[#6B6C72]">Unbilled last 365 days</p>
          <div className="mt-3 h-1.5 bg-[#2BB3C0] rounded-full" />
        </div>
        <div className="px-4 py-3 bg-[#FFF4E5]">
          <p className="text-[28px] font-normal text-[#1A1A1A] tabular-nums">${totalOpen.toFixed(2)}</p>
          <p className="text-xs text-[#6B6C72]">Unpaid last 365 days · {suppliersWithBalance} open bills</p>
          <div className="mt-3 h-1.5 bg-[#F5A623] rounded-full" />
        </div>
        <div className="px-4 py-3 bg-[#E5F6E3]">
          <p className="text-[28px] font-normal text-[#1A1A1A] tabular-nums">${totalPaid.toFixed(2)}</p>
          <p className="text-xs text-[#6B6C72]">Paid last 30 days</p>
          <div className="mt-3 h-1.5 bg-[#2CA01C] rounded-full" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8D9096]" />
          <input
            type="text"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-[#C7C7C7] rounded-md text-sm text-[#1A1A1A] placeholder-[#8D9096] focus:outline-none focus:ring-2 focus:ring-[#0077C5]"
          />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border border-[#C7C7C7] rounded-md px-3 py-2 text-sm text-[#1A1A1A] bg-white">
          <option value="All">All vendors</option>
        </select>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-white/5">
                <tr>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Supplier ID</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Contact Name</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Company Business</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Open Balance</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Paid Dues</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendors.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-slate-500 text-xs font-semibold">
                      No suppliers registered yet. Click &quot;New Supplier&quot; to add.
                    </td>
                  </tr>
                ) : (
                  vendors.map((v) => (
                    <tr
                      key={v.id}
                      className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer transition-colors"
                      onClick={() => router.push(`/admin/vendors/${v.id}`)}
                    >
                      <td className="py-3.5 px-4 text-xs font-mono font-bold text-teal-450">{v.supplier_id || '—'}</td>
                      <td className="py-3.5 px-4 text-xs font-semibold text-slate-205">{v.contact_name || v.name}</td>
                      <td className="py-3.5 px-4 text-xs text-slate-400">{v.name}</td>
                      <td className="py-3.5 px-4 text-xs text-right font-extrabold text-slate-105 font-mono">${Number(v.open_balance ?? v.balance ?? 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                      <td className="py-3.5 px-4 text-xs text-right font-extrabold text-teal-400 font-mono">${Number(v.paid_balance ?? v.payments ?? 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                      <td className="py-3.5 px-4 text-right text-xs">
                        <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => openEdit(v)}
                            className="text-teal-450 hover:text-teal-350 hover:underline font-semibold"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(v.id)}
                            className="text-slate-450 hover:text-rose-400 hover:underline font-semibold"
                          >
                            Deactivate
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-955/80 backdrop-blur-sm p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <h2 className="text-lg font-semibold text-[#0F172A]">{editing ? 'Edit Supplier' : 'Register Supplier'}</h2>
              <button type="button" onClick={() => setShowModal(false)} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Supplier ID *</label>
                  <input
                    type="text"
                    value={form.supplier_id || ''}
                    onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-205 focus:outline-none"
                  />
                </div>
                <div>
                  <button
                    type="button"
                    onClick={generateId}
                    className="px-3.5 py-2.5 bg-slate-800 border border-white/5 text-slate-350 hover:text-white rounded-xl text-xs font-semibold transition-all shadow-sm"
                  >
                    Generate
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Supplier business Name *</label>
                <input
                  type="text"
                  value={form.name || ''}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Contact Person Name</label>
                <input
                  type="text"
                  value={form.contact_name || ''}
                  onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                  className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none"
                  placeholder="e.g. John Doe"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Contact Phone</label>
                <input
                  type="text"
                  value={form.phone || ''}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none"
                  placeholder="e.g. (480) 555-0592"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Email Address</label>
                <input
                  type="email"
                  value={form.email || ''}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none"
                  placeholder="e.g. sales@vendor.com"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">State *</label>
                <select
                  value={form.state || ''}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, state: e.target.value, city: '' }));
                    fetchCities(e.target.value);
                  }}
                  className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none font-semibold"
                >
                  <option value="">Select state</option>
                  {states.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">City *</label>
                <select
                  value={form.city || ''}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none font-semibold"
                >
                  <option value="">Select city</option>
                  {cities.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {cities.length === 0 && (
                  <input
                    type="text"
                    value={form.city || ''}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    placeholder="Or type city name"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none mt-1.5"
                  />
                )}
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Full Address</label>
                <textarea
                  value={form.address || ''}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  rows={2}
                  className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none"
                  placeholder="Warehouse bay street address"
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-4 border-t border-white/5">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">
                  Close
                </button>
                <button type="submit" className="px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] border-transparent text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}