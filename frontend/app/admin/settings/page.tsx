'use client';

import { useEffect, useState } from 'react';
import { Settings, Save } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface StoreSettings {
  business_name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  tax_id?: string;
  default_tax_rate: number;
  receipt_header?: string;
  receipt_footer?: string;
  currency: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = async () => {
    try {
      const res = await adminApi.get('/store-settings');
      setSettings(res.data);
    } catch {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      await adminApi.put('/store-settings', {
        business_name: settings.business_name,
        address: settings.address,
        city: settings.city,
        state: settings.state,
        zip: settings.zip,
        phone: settings.phone,
        email: settings.email,
        tax_id: settings.tax_id,
        default_tax_rate: settings.default_tax_rate,
        receipt_header: settings.receipt_header,
        receipt_footer: settings.receipt_footer,
        currency: settings.currency,
      });
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3.5 mb-6">
        <Settings className="w-8 h-8 text-teal-400" />
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Settings</h1>
          <p className="text-xs text-slate-400 mt-1">Configure retail invoice headers, default tax brackets, location parameters, and receipt notes.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-slate-900/40 backdrop-blur-lg border border-white/[0.06] border-t-white/[0.18] p-6 max-w-2xl space-y-6 shadow-[0_12px_40px_rgba(0,0,0,0.25)] rounded-2xl">
        <h2 className="text-xs font-bold text-white uppercase tracking-wider border-b border-white/5 pb-2.5">Business Information</h2>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Business Name</label>
          <input
            type="text"
            value={settings.business_name || ''}
            onChange={(e) => setSettings({ ...settings, business_name: e.target.value })}
            className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Full Address</label>
          <input
            type="text"
            value={settings.address || ''}
            onChange={(e) => setSettings({ ...settings, address: e.target.value })}
            className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-202 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">City</label>
            <input
              type="text"
              value={settings.city || ''}
              onChange={(e) => setSettings({ ...settings, city: e.target.value })}
              className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-205 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">State</label>
            <input
              type="text"
              value={settings.state || ''}
              onChange={(e) => setSettings({ ...settings, state: e.target.value })}
              className="w-full bg-slate-955/65 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-205 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">ZIP</label>
            <input
              type="text"
              value={settings.zip || ''}
              onChange={(e) => setSettings({ ...settings, zip: e.target.value })}
              className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-202 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Hotline Phone</label>
          <input
            type="text"
            value={settings.phone || ''}
            onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
            className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Support Email</label>
          <input
            type="email"
            value={settings.email || ''}
            onChange={(e) => setSettings({ ...settings, email: e.target.value })}
            className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Tax ID / EIN</label>
          <input
            type="text"
            value={settings.tax_id || ''}
            onChange={(e) => setSettings({ ...settings, tax_id: e.target.value })}
            className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-202 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono"
          />
        </div>

        <h2 className="text-xs font-bold text-white uppercase tracking-wider border-b border-white/5 pb-2.5 pt-4">Tax & Currency</h2>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Default Tax Rate (%)</label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={settings.default_tax_rate ?? 0}
            onChange={(e) => setSettings({ ...settings, default_tax_rate: parseFloat(e.target.value) || 0 })}
            className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">System Currency Symbol / Code</label>
          <input
            type="text"
            value={settings.currency || 'USD'}
            onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
            className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500 font-bold"
          />
        </div>

        <h2 className="text-xs font-bold text-white uppercase tracking-wider border-b border-white/5 pb-2.5 pt-4">Receipt Custom Print Text</h2>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Receipt Header Notes (HTML allowed)</label>
          <textarea
            value={settings.receipt_header || ''}
            onChange={(e) => setSettings({ ...settings, receipt_header: e.target.value })}
            rows={2}
            className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-202 focus:outline-none focus:ring-1 focus:ring-teal-500"
            placeholder="Welcome message printed on receipt head..."
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Receipt Footer Notes</label>
          <textarea
            value={settings.receipt_footer || ''}
            onChange={(e) => setSettings({ ...settings, receipt_footer: e.target.value })}
            rows={2}
            className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-202 focus:outline-none focus:ring-1 focus:ring-teal-500"
            placeholder="Return terms, warranty rules, social handles..."
          />
        </div>

        <div className="pt-4 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-40"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving Config...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
