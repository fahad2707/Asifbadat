'use client';

import { useEffect, useState } from 'react';
import { FolderTree, Layers, Percent, Users, Truck, Plus, Edit, Trash2 } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import NumberInput from '@/components/admin/NumberInput';

type TabId = 'categories' | 'subcategories' | 'tax' | 'vendors' | 'customers';

interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  display_order?: number;
}

interface SubCategory {
  id: string;
  name: string;
  slug: string;
  category_id: string;
  category_name?: string;
}

interface TaxType {
  id: string;
  name: string;
  rate: number;
  rate_type?: string;
}

interface Vendor {
  id: string;
  name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
}

interface Customer {
  id: string;
  name: string;
  company?: string;
  phone: string;
  email?: string;
}

const TABS: { id: TabId; label: string; icon: typeof FolderTree }[] = [
  { id: 'categories', label: 'Categories', icon: FolderTree },
  { id: 'subcategories', label: 'Subcategories', icon: Layers },
  { id: 'tax', label: 'Tax types', icon: Percent },
  { id: 'vendors', label: 'Vendors', icon: Truck },
  { id: 'customers', label: 'Customers', icon: Users },
];

export default function DataPage() {
  const [activeTab, setActiveTab] = useState<TabId>('categories');
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<SubCategory[]>([]);
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ type: TabId; edit?: any } | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
  const [selectedSubcategoryIds, setSelectedSubcategoryIds] = useState<Set<string>>(new Set());
  const [selectedTaxIds, setSelectedTaxIds] = useState<Set<string>>(new Set());
  const [selectedVendorIds, setSelectedVendorIds] = useState<Set<string>>(new Set());
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());

  const toggleSelect = (type: TabId, id: string) => {
    if (type === 'categories') setSelectedCategoryIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    if (type === 'subcategories') setSelectedSubcategoryIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    if (type === 'tax') setSelectedTaxIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    if (type === 'vendors') setSelectedVendorIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    if (type === 'customers') setSelectedCustomerIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleSelectAll = (type: TabId) => {
    if (type === 'categories') setSelectedCategoryIds((prev) => prev.size === categories.length ? new Set() : new Set(categories.map((c) => c.id)));
    if (type === 'subcategories') setSelectedSubcategoryIds((prev) => prev.size === subcategories.length ? new Set() : new Set(subcategories.map((s) => s.id)));
    if (type === 'tax') setSelectedTaxIds((prev) => prev.size === taxTypes.length ? new Set() : new Set(taxTypes.map((t) => t.id)));
    if (type === 'vendors') setSelectedVendorIds((prev) => prev.size === vendors.length ? new Set() : new Set(vendors.map((v) => v.id)));
    if (type === 'customers') setSelectedCustomerIds((prev) => prev.size === customers.length ? new Set() : new Set(customers.map((c) => c.id)));
  };

  const isSelected = (type: TabId, id: string) => {
    if (type === 'categories') return selectedCategoryIds.has(id);
    if (type === 'subcategories') return selectedSubcategoryIds.has(id);
    if (type === 'tax') return selectedTaxIds.has(id);
    if (type === 'vendors') return selectedVendorIds.has(id);
    if (type === 'customers') return selectedCustomerIds.has(id);
    return false;
  };

  const isAllSelected = (type: TabId) => {
    if (type === 'categories') return categories.length > 0 && selectedCategoryIds.size === categories.length;
    if (type === 'subcategories') return subcategories.length > 0 && selectedSubcategoryIds.size === subcategories.length;
    if (type === 'tax') return taxTypes.length > 0 && selectedTaxIds.size === taxTypes.length;
    if (type === 'vendors') return vendors.length > 0 && selectedVendorIds.size === vendors.length;
    if (type === 'customers') return customers.length > 0 && selectedCustomerIds.size === customers.length;
    return false;
  };

  const fetchCategories = async () => {
    try {
      const res = await adminApi.get('/categories');
      setCategories(Array.isArray(res.data) ? res.data : []);
    } catch {
      setCategories([]);
    }
  };

  const fetchSubcategories = async () => {
    try {
      const res = await adminApi.get('/sub-categories');
      setSubcategories(Array.isArray(res.data) ? res.data : []);
    } catch {
      setSubcategories([]);
    }
  };

  const fetchTaxTypes = async () => {
    try {
      const res = await adminApi.get('/tax-types');
      setTaxTypes(Array.isArray(res.data) ? res.data : []);
    } catch {
      setTaxTypes([]);
    }
  };

  const fetchVendors = async () => {
    try {
      const res = await adminApi.get('/vendors');
      setVendors(res.data?.vendors || []);
    } catch {
      setVendors([]);
    }
  };

  const fetchCustomers = async () => {
    try {
      const res = await adminApi.get('/customers');
      setCustomers(res.data?.customers || []);
    } catch {
      setCustomers([]);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchCategories(), fetchSubcategories(), fetchTaxTypes(), fetchVendors(), fetchCustomers()]);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const openAdd = (type: TabId) => {
    if (type === 'categories') setForm({ name: '', description: '', display_order: 0 });
    if (type === 'subcategories') setForm({ name: '', category_id: categories[0]?.id || '', display_order: 0 });
    if (type === 'tax') setForm({ name: '', rate: '', rate_type: 'percent' });
    if (type === 'vendors') setForm({ name: '', contact_name: '', phone: '', email: '' });
    if (type === 'customers') setForm({ name: '', phone: '', email: '', company: '' });
    setModal({ type });
  };

  const openEdit = (type: TabId, row: any) => {
    setForm({ ...row });
    setModal({ type, edit: row });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    const { type, edit } = modal;
    try {
      if (type === 'categories') {
        if (edit) await adminApi.put(`/categories/${edit.id}`, { name: form.name, description: form.description, display_order: form.display_order });
        else await adminApi.post('/categories', { name: form.name, description: form.description, display_order: form.display_order ?? 0 });
      }
      if (type === 'subcategories') {
        if (edit) await adminApi.put(`/sub-categories/${edit.id}`, { name: form.name, category_id: form.category_id, display_order: form.display_order });
        else await adminApi.post('/sub-categories', { name: form.name, category_id: form.category_id, display_order: form.display_order ?? 0 });
      }
      if (type === 'tax') {
        const rate = Number(form.rate);
        if (form.rate === '' || form.rate == null || Number.isNaN(rate) || rate < 0) {
          toast.error('Enter a tax rate');
          return;
        }
        if (edit) await adminApi.put(`/tax-types/${edit.id}`, { name: form.name, rate, rate_type: form.rate_type || 'percent' });
        else await adminApi.post('/tax-types', { name: form.name, rate, rate_type: form.rate_type || 'percent' });
      }
      if (type === 'vendors') {
        if (edit) await adminApi.put(`/vendors/${edit.id}`, form);
        else await adminApi.post('/vendors', form);
      }
      if (type === 'customers') {
        if (edit) await adminApi.put(`/customers/${edit.id}`, form);
        else await adminApi.post('/customers', form);
      }
      toast.success(edit ? 'Updated' : 'Created');
      setModal(null);
      fetchAll();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    }
  };

  const handleDelete = async (type: TabId, id: string) => {
    if (!confirm('Delete this item?')) return;
    try {
      if (type === 'categories') await adminApi.delete(`/categories/${id}`);
      if (type === 'subcategories') await adminApi.delete(`/sub-categories/${id}`);
      if (type === 'tax') await adminApi.delete(`/tax-types/${id}`);
      if (type === 'vendors') await adminApi.delete(`/vendors/${id}`);
      if (type === 'customers') await adminApi.delete(`/customers/${id}`);
      toast.success('Deleted');
      fetchAll();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  return (
    <div>
      <h1 className="text-4xl font-bold text-gray-900 mb-8">Master Data</h1>
      <p className="text-gray-600 mb-6">Manage categories, subcategories, tax types, vendors, and customers in one place.</p>

      <div className="flex flex-wrap gap-2 mb-6 border-b border-gray-200 pb-4">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === tab.id ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          {activeTab === 'categories' && (
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Categories</h2>
                <button onClick={() => openAdd('categories')} className="bg-primary-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 hover:bg-primary-700">
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-12 py-2 px-4 text-center text-gray-700">#</th>
                    <th className="w-12 py-2 px-4">
                      <input type="checkbox" checked={isAllSelected('categories')} onChange={() => toggleSelectAll('categories')} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    </th>
                    <th className="text-left py-2 px-4 text-gray-700">Name</th>
                    <th className="text-left py-2 px-4 text-gray-700">Slug</th>
                    <th className="text-right py-2 px-4 text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c, index) => (
                    <tr key={c.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-4 text-center text-gray-600 font-medium">{index + 1}</td>
                      <td className="py-2 px-4">
                        <input type="checkbox" checked={isSelected('categories', c.id)} onChange={() => toggleSelect('categories', c.id)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      </td>
                      <td className="py-2 px-4 font-medium">{c.name}</td>
                      <td className="py-2 px-4 text-gray-600">{c.slug}</td>
                      <td className="py-2 px-4 text-right">
                        <button onClick={() => openEdit('categories', c)} className="p-1.5 text-primary-600 hover:bg-primary-50 rounded mr-1">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete('categories', c.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {categories.length === 0 && <p className="text-center py-8 text-gray-500">No categories. Add one above.</p>}
            </div>
          )}

          {activeTab === 'subcategories' && (
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Subcategories</h2>
                <button onClick={() => openAdd('subcategories')} className="bg-primary-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 hover:bg-primary-700">
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-12 py-2 px-4 text-center text-gray-700">#</th>
                    <th className="w-12 py-2 px-4">
                      <input type="checkbox" checked={isAllSelected('subcategories')} onChange={() => toggleSelectAll('subcategories')} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    </th>
                    <th className="text-left py-2 px-4 text-gray-700">Name</th>
                    <th className="text-left py-2 px-4 text-gray-700">Category</th>
                    <th className="text-right py-2 px-4 text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subcategories.map((s, index) => (
                    <tr key={s.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-4 text-center text-gray-600 font-medium">{index + 1}</td>
                      <td className="py-2 px-4">
                        <input type="checkbox" checked={isSelected('subcategories', s.id)} onChange={() => toggleSelect('subcategories', s.id)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      </td>
                      <td className="py-2 px-4 font-medium">{s.name}</td>
                      <td className="py-2 px-4 text-gray-600">{s.category_name || s.category_id}</td>
                      <td className="py-2 px-4 text-right">
                        <button onClick={() => openEdit('subcategories', s)} className="p-1.5 text-primary-600 hover:bg-primary-50 rounded mr-1">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete('subcategories', s.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {subcategories.length === 0 && <p className="text-center py-8 text-gray-500">No subcategories. Add one above.</p>}
            </div>
          )}

          {activeTab === 'tax' && (
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Tax types</h2>
                <button onClick={() => openAdd('tax')} className="bg-primary-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 hover:bg-primary-700">
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-12 py-2 px-4 text-center text-gray-700">#</th>
                    <th className="w-12 py-2 px-4">
                      <input type="checkbox" checked={isAllSelected('tax')} onChange={() => toggleSelectAll('tax')} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    </th>
                    <th className="text-left py-2 px-4 text-gray-700">Name</th>
                    <th className="text-right py-2 px-4 text-gray-700">Rate</th>
                    <th className="text-right py-2 px-4 text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {taxTypes.map((t, index) => (
                    <tr key={t.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-4 text-center text-gray-600 font-medium">{index + 1}</td>
                      <td className="py-2 px-4">
                        <input type="checkbox" checked={isSelected('tax', t.id)} onChange={() => toggleSelect('tax', t.id)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      </td>
                      <td className="py-2 px-4 font-medium">{t.name}</td>
                      <td className="py-2 px-4 text-right">{t.rate_type === 'amount' ? `$${Number(t.rate).toFixed(2)}` : `${t.rate}%`}</td>
                      <td className="py-2 px-4 text-right">
                        <button onClick={() => openEdit('tax', t)} className="p-1.5 text-primary-600 hover:bg-primary-50 rounded mr-1">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete('tax', t.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {taxTypes.length === 0 && <p className="text-center py-8 text-gray-500">No tax types. Add one above.</p>}
            </div>
          )}

          {activeTab === 'vendors' && (
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Vendors</h2>
                <button onClick={() => openAdd('vendors')} className="bg-primary-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 hover:bg-primary-700">
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-12 py-2 px-4 text-center text-gray-700">#</th>
                    <th className="w-12 py-2 px-4">
                      <input type="checkbox" checked={isAllSelected('vendors')} onChange={() => toggleSelectAll('vendors')} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    </th>
                    <th className="text-left py-2 px-4 text-gray-700">Name</th>
                    <th className="text-left py-2 px-4 text-gray-700">Contact</th>
                    <th className="text-left py-2 px-4 text-gray-700">Phone</th>
                    <th className="text-right py-2 px-4 text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.map((v, index) => (
                    <tr key={v.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-4 text-center text-gray-600 font-medium">{index + 1}</td>
                      <td className="py-2 px-4">
                        <input type="checkbox" checked={isSelected('vendors', v.id)} onChange={() => toggleSelect('vendors', v.id)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      </td>
                      <td className="py-2 px-4 font-medium">{v.name}</td>
                      <td className="py-2 px-4 text-gray-600">{v.contact_name || '-'}</td>
                      <td className="py-2 px-4 text-gray-600">{v.phone || '-'}</td>
                      <td className="py-2 px-4 text-right">
                        <button onClick={() => openEdit('vendors', v)} className="p-1.5 text-primary-600 hover:bg-primary-50 rounded mr-1">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete('vendors', v.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {vendors.length === 0 && <p className="text-center py-8 text-gray-500">No vendors. Add one above.</p>}
            </div>
          )}

          {activeTab === 'customers' && (
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Customers</h2>
                <button onClick={() => openAdd('customers')} className="bg-primary-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 hover:bg-primary-700">
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-12 py-2 px-4 text-center text-gray-700">#</th>
                    <th className="w-12 py-2 px-4">
                      <input type="checkbox" checked={isAllSelected('customers')} onChange={() => toggleSelectAll('customers')} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    </th>
                    <th className="text-left py-2 px-4 text-gray-700">Name</th>
                    <th className="text-left py-2 px-4 text-gray-700">Phone</th>
                    <th className="text-left py-2 px-4 text-gray-700">Email</th>
                    <th className="text-right py-2 px-4 text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c, index) => (
                    <tr key={c.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-4 text-center text-gray-600 font-medium">{index + 1}</td>
                      <td className="py-2 px-4">
                        <input type="checkbox" checked={isSelected('customers', c.id)} onChange={() => toggleSelect('customers', c.id)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      </td>
                      <td className="py-2 px-4 font-medium">{c.name}</td>
                      <td className="py-2 px-4 text-gray-600">{c.phone}</td>
                      <td className="py-2 px-4 text-gray-600">{c.email || '-'}</td>
                      <td className="py-2 px-4 text-right">
                        <button onClick={() => openEdit('customers', c)} className="p-1.5 text-primary-600 hover:bg-primary-50 rounded mr-1">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete('customers', c.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {customers.length === 0 && <p className="text-center py-8 text-gray-500">No customers. Add one above.</p>}
            </div>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                {modal.edit ? 'Edit' : 'Add'} {TABS.find((t) => t.id === modal!.type)?.label}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                {modal.type === 'categories' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                      <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                      <input type="text" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                  </>
                )}
                {modal.type === 'subcategories' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                      <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                      <select value={form.category_id || ''} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required>
                        <option value="">Select category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                {modal.type === 'tax' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                      <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Rate type</label>
                      <select value={form.rate_type || 'percent'} onChange={(e) => setForm({ ...form, rate_type: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                        <option value="percent">Percentage (%)</option>
                        <option value="amount">Fixed amount (USD)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{form.rate_type === 'amount' ? 'Amount (USD) *' : 'Rate % *'}</label>
                      <NumberInput min={0} step={0.01} value={form.rate} onValueChange={(n) => setForm({ ...form, rate: n === '' ? '' : n })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                    </div>
                  </>
                )}
                {modal.type === 'vendors' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vendor name *</label>
                      <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact name</label>
                      <input type="text" value={form.contact_name || ''} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <input type="text" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                  </>
                )}
                {modal.type === 'customers' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                      <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                      <input type="text" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                      <input type="text" value={form.company || ''} onChange={(e) => setForm({ ...form, company: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                  </>
                )}
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="flex-1 bg-primary-600 text-white py-2 rounded-lg font-medium hover:bg-primary-700">Save</button>
                  <button type="button" onClick={() => setModal(null)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
