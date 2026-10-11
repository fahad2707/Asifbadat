'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { formatApiError } from '@/lib/format-api-error';
import { useAuthStore } from '@/lib/store';
import { customerAuthTheme, customerAuthUi } from '@/lib/customer-auth-ui';
import toast from 'react-hot-toast';

export default function AccountSettingsPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    const mark = () => setHydrated(true);
    const unsub = useAuthStore.persist.onFinishHydration(mark);
    if (useAuthStore.persist.hasHydrated()) mark();
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const session =
      String(token || '').trim() ||
      (typeof window !== 'undefined' ? String(localStorage.getItem('token') || '').trim() : '');
    if (!session) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/user/profile');
        if (cancelled) return;
        setName(res.data?.name || '');
        setEmail(res.data?.email || '');
        setPhone(res.data?.phone || '');
      } catch {
        if (!cancelled) toast.error('Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, token, router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    setSaving(true);
    try {
      await api.put('/user/profile', {
        name: name.trim() || undefined,
        email: email.trim() || undefined,
      });
      toast.success('Profile updated');
    } catch (error: unknown) {
      const message = formatApiError(error, 'Failed to update profile');
      setFieldError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="min-h-screen px-4 py-10 sm:py-14"
      style={{
        background: `
          radial-gradient(ellipse 80% 50% at 50% -10%, rgba(191,160,106,0.16), transparent 55%),
          ${customerAuthTheme.bg}
        `,
        fontFamily: customerAuthTheme.body,
        color: customerAuthTheme.text,
      }}
    >
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/account" className={customerAuthUi.btnGhost}>
            ← Account
          </Link>
          <Link href="/site" className={customerAuthUi.btnGhost}>
            Store
          </Link>
        </div>

        <div
          className="rounded-2xl border px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          style={{
            background: customerAuthTheme.panel,
            borderColor: customerAuthTheme.panelBorder,
          }}
        >
          <h1
            className="text-2xl text-[#F5F1E8] mb-2"
            style={{ fontFamily: customerAuthTheme.serif }}
          >
            Account settings
          </h1>
          <p className="text-sm text-[#A8A29A] mb-6">
            Update the details on your wholesale account.
          </p>

          {!hydrated || loading ? (
            <div className="flex justify-center py-10" role="status">
              <div className="animate-spin rounded-full h-9 w-9 border-2 border-[#BFA06A] border-t-transparent" />
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4" noValidate>
              {fieldError && (
                <div className={customerAuthUi.errorBox} role="alert">
                  {fieldError}
                </div>
              )}
              <div>
                <label htmlFor="settings-name" className={customerAuthUi.label}>
                  Name
                </label>
                <input
                  id="settings-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={customerAuthUi.field}
                  autoComplete="name"
                />
              </div>
              <div>
                <label htmlFor="settings-email" className={customerAuthUi.label}>
                  Email
                </label>
                <input
                  id="settings-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={customerAuthUi.field}
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="settings-phone" className={customerAuthUi.label}>
                  Phone
                </label>
                <input
                  id="settings-phone"
                  type="tel"
                  value={phone}
                  readOnly
                  className={`${customerAuthUi.field} opacity-70`}
                  aria-describedby="phone-help"
                />
                <p id="phone-help" className={customerAuthUi.helper}>
                  Phone changes are not available here. Contact Express Distributors if you need this updated.
                </p>
              </div>
              <button type="submit" disabled={saving} className={customerAuthUi.btnPrimary}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
