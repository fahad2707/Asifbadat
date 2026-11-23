'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { formatApiError } from '@/lib/format-api-error';
import { useAuthStore } from '@/lib/store';
import { customerAuthTheme, customerAuthUi } from '@/lib/customer-auth-ui';
import toast from 'react-hot-toast';

type Contact = {
  name?: string;
  company?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
};

export default function AccountSettingsPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [approved, setApproved] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState<Contact>({});
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
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
        const nextContact = (res.data?.contact || {}) as Contact;
        setApproved(res.data?.account_approved === true && res.data?.account_status === 'approved');
        setName(nextContact.name || res.data?.name || '');
        setEmail(nextContact.email || res.data?.email || '');
        setContact({
          ...nextContact,
          phone: nextContact.phone || '',
        });
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
    if (!approved) return;
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

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    if (newPassword.trim().length < 8) {
      setFieldError('New password must be at least 8 characters.');
      return;
    }
    setSavingPassword(true);
    try {
      await api.put('/user/password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      toast.success('Password updated');
    } catch (error: unknown) {
      const message = formatApiError(error, 'Failed to update password');
      setFieldError(message);
      toast.error(message);
    } finally {
      setSavingPassword(false);
    }
  };

  const readOnlyClass = `${customerAuthUi.field} opacity-80`;
  const address = [contact.address, [contact.city, contact.state, contact.zip].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join('\n');

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
          <Link href="/site" className={customerAuthUi.btnGhost}>
            ← Store
          </Link>
        </div>

        <div
          className="rounded-2xl border px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          style={{
            background: customerAuthTheme.panel,
            borderColor: customerAuthTheme.panelBorder,
          }}
        >
          <h1 className="text-2xl text-[#F5F1E8] mb-2" style={{ fontFamily: customerAuthTheme.serif }}>
            Change settings
          </h1>
          <p className="text-sm text-[#A8A29A] mb-6">
            {approved
              ? 'Update your login name and email, or change your password.'
              : 'Your personal details are on file. You can change your password here.'}
          </p>

          {!hydrated || loading ? (
            <div className="flex justify-center py-10" role="status">
              <div className="animate-spin rounded-full h-9 w-9 border-2 border-[#BFA06A] border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-8">
              {fieldError && (
                <div className={customerAuthUi.errorBox} role="alert">
                  {fieldError}
                </div>
              )}
              <form onSubmit={handleSave} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="settings-name" className={customerAuthUi.label}>Name</label>
                  <input
                    id="settings-name"
                    type="text"
                    value={approved ? name : contact.name || name}
                    onChange={(e) => setName(e.target.value)}
                    readOnly={!approved}
                    className={approved ? customerAuthUi.field : readOnlyClass}
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label htmlFor="settings-company" className={customerAuthUi.label}>Company</label>
                  <input id="settings-company" type="text" value={contact.company || ''} readOnly className={readOnlyClass} />
                </div>
                <div>
                  <label htmlFor="settings-email" className={customerAuthUi.label}>Email</label>
                  <input
                    id="settings-email"
                    type="email"
                    value={approved ? email : contact.email || email}
                    onChange={(e) => setEmail(e.target.value)}
                    readOnly={!approved}
                    className={approved ? customerAuthUi.field : readOnlyClass}
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label htmlFor="settings-phone" className={customerAuthUi.label}>Phone</label>
                  <input id="settings-phone" type="tel" value={contact.phone || ''} readOnly className={readOnlyClass} />
                </div>
                <div>
                  <label htmlFor="settings-address" className={customerAuthUi.label}>Address</label>
                  <textarea id="settings-address" value={address} readOnly rows={3} className={readOnlyClass} />
                </div>
                {!approved && (
                  <p className={customerAuthUi.helper}>To change personal details, contact admin.</p>
                )}
                {approved && (
                  <button type="submit" disabled={saving} className={customerAuthUi.btnPrimary}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                )}
              </form>

              <form onSubmit={handlePassword} className="space-y-4 border-t border-white/10 pt-6" noValidate>
                <h2 className="text-lg text-[#F5F1E8]" style={{ fontFamily: customerAuthTheme.serif }}>
                  Password
                </h2>
                <div>
                  <label htmlFor="settings-current-password" className={customerAuthUi.label}>Current password</label>
                  <input
                    id="settings-current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className={customerAuthUi.field}
                    autoComplete="current-password"
                  />
                </div>
                <div>
                  <label htmlFor="settings-new-password" className={customerAuthUi.label}>New password</label>
                  <input
                    id="settings-new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={customerAuthUi.field}
                    autoComplete="new-password"
                    minLength={8}
                  />
                </div>
                <button type="submit" disabled={savingPassword} className={customerAuthUi.btnPrimary}>
                  {savingPassword ? 'Updating…' : 'Change password'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
