'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  fetchProfileAccountStatus,
  routeForAccountStatus,
  type ParsedAccountStatus,
} from '@/lib/account-status';
import { customerAuthTheme, customerAuthUi } from '@/lib/customer-auth-ui';
import { useAuthStore } from '@/lib/store';
import api from '@/lib/api';

type Profile = {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  account_status?: ParsedAccountStatus;
  account_approved?: boolean;
};

export default function AccountHubPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<ParsedAccountStatus>(null);
  const [error, setError] = useState<string | null>(null);

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
      setLoading(true);
      setError(null);
      try {
        const statusFields = await fetchProfileAccountStatus();
        if (cancelled) return;
        setStatus(statusFields.account_status);
        if (statusFields.account_status !== 'approved') {
          router.replace(routeForAccountStatus(statusFields.account_status));
          return;
        }
        const res = await api.get('/user/profile');
        if (cancelled) return;
        setProfile(res.data);
      } catch {
        if (!cancelled) {
          setError('We could not load your account. Please try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated, token, router]);

  const handleLogout = () => {
    logout();
    router.push('/site');
  };

  const displayName =
    profile?.name?.trim() ||
    user?.name?.trim() ||
    profile?.email?.trim() ||
    user?.email?.trim() ||
    'Wholesale customer';

  return (
    <div
      className="min-h-screen px-4 py-10 sm:py-14"
      style={{
        background: `
          radial-gradient(ellipse 80% 50% at 50% -10%, rgba(191,160,106,0.16), transparent 55%),
          radial-gradient(ellipse 60% 40% at 100% 100%, rgba(191,160,106,0.06), transparent 50%),
          ${customerAuthTheme.bg}
        `,
        fontFamily: customerAuthTheme.body,
        color: customerAuthTheme.text,
      }}
    >
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="text-center">
          <Link
            href="/site"
            className="inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#BFA06A] rounded-sm"
          >
            <h1
              className={customerAuthUi.brandTitle}
              style={{ fontFamily: customerAuthTheme.serif }}
            >
              Express <span className={customerAuthUi.brandAccent}>Distributors</span>
            </h1>
          </Link>
          <p className={customerAuthUi.brandSub}>Your account</p>
        </div>

        <div
          className="rounded-2xl border px-6 py-8 sm:px-8 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          style={{
            background: customerAuthTheme.panel,
            borderColor: customerAuthTheme.panelBorder,
          }}
        >
          {(!hydrated || loading) && !error ? (
            <div className="flex flex-col items-center gap-3 py-10" role="status" aria-live="polite">
              <div className="animate-spin rounded-full h-9 w-9 border-2 border-[#BFA06A] border-t-transparent" />
              <p className="text-sm text-[#A8A29A]">Loading your account…</p>
            </div>
          ) : error ? (
            <div className="space-y-4">
              <div className={customerAuthUi.errorBox} role="alert">
                {error}
              </div>
              <button type="button" onClick={() => window.location.reload()} className={customerAuthUi.btnPrimary}>
                Retry
              </button>
              <Link href="/site" className={`${customerAuthUi.btnGhost} w-full text-center py-2`}>
                Back to store
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-[#BFA06A] mb-2">Signed in</p>
                <h2
                  className="text-2xl text-[#F5F1E8]"
                  style={{ fontFamily: customerAuthTheme.serif }}
                >
                  {displayName}
                </h2>
                <p className="mt-2 text-sm text-[#A8A29A]">
                  {profile?.email || user?.email || 'No email on file'}
                  {(profile?.phone || user?.phone) && (
                    <> · {profile?.phone || user?.phone}</>
                  )}
                </p>
                <p className="mt-3 inline-flex items-center rounded-full border border-[#BFA06A]/35 bg-[#BFA06A]/10 px-3 py-1 text-xs font-semibold tracking-wide text-[#D4B88A]">
                  {status === 'approved' ? 'Approved wholesale account' : 'Account status pending verification'}
                </p>
              </div>

              <nav className="grid gap-3" aria-label="Account sections">
                <Link
                  href="/account/orders"
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 hover:border-[#BFA06A]/40 transition-colors"
                >
                  <div className="text-sm font-semibold text-[#F5F1E8]">My orders</div>
                  <p className="mt-1 text-xs text-[#A8A29A]">
                    View previous online orders and tracking details.
                  </p>
                </Link>
                <Link
                  href="/account/settings"
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 hover:border-[#BFA06A]/40 transition-colors"
                >
                  <div className="text-sm font-semibold text-[#F5F1E8]">Account settings</div>
                  <p className="mt-1 text-xs text-[#A8A29A]">
                    Update your name and contact email.
                  </p>
                </Link>
                <Link
                  href="/site#shop"
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 hover:border-[#BFA06A]/40 transition-colors"
                >
                  <div className="text-sm font-semibold text-[#F5F1E8]">Continue shopping</div>
                  <p className="mt-1 text-xs text-[#A8A29A]">
                    Browse the catalog with approved wholesale pricing.
                  </p>
                </Link>
              </nav>

              <div className="flex flex-col gap-2 pt-2">
                <Link href="/site" className={customerAuthUi.btnPrimary}>
                  Back to storefront
                </Link>
                <button type="button" onClick={handleLogout} className={`${customerAuthUi.btnGhost} py-2`}>
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
