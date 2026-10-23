'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CustomerAuthShell from '@/components/auth/CustomerAuthShell';
import { customerAuthUi } from '@/lib/customer-auth-ui';
import { useAuthStore } from '@/lib/store';
import { fetchProfileAccountStatus, routeForAccountStatus } from '@/lib/account-status';

type ExpectedStatus = 'pending' | 'rejected' | 'restricted';

const COPY: Record<
  ExpectedStatus,
  { title: string; lead: string; body: string[]; notice?: string }
> = {
  pending: {
    title: 'Registration under review',
    lead: 'Thanks for creating your wholesale account.',
    body: [
      'Your registration is awaiting review by our team.',
      'Catalog browsing and quote requests remain available. Restricted pricing and online ordering stay unavailable until your account is approved.',
    ],
  },
  rejected: {
    title: 'Account not approved',
    lead: 'We were unable to approve this wholesale account for online ordering.',
    body: [
      'Restricted pricing and online ordering are not available for this account.',
      'You can continue browsing the public catalog. For questions about your registration, please contact Express Distributors using the details on our website.',
    ],
  },
  restricted: {
    title: 'Account access limited',
    lead: 'Commercial pricing and online ordering are not available for this account yet.',
    body: [
      'We could not confirm an approved wholesale account for your login.',
      'If you recently registered, your application may still need review. You can browse the public catalog and submit quote requests while you wait.',
    ],
    notice: 'We will not treat an unverified account status as approved.',
  },
};

function readSessionToken(zustandToken: string | null): string {
  const fromStore = String(zustandToken || '').trim();
  if (fromStore) return fromStore;
  if (typeof window === 'undefined') return '';
  try {
    return String(localStorage.getItem('token') || '').trim();
  } catch {
    return '';
  }
}

export default function AccountStatusView({ expected }: { expected: ExpectedStatus }) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const [hydrated, setHydrated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wait for zustand persist rehydration so a refresh does not false-redirect to login.
    const markHydrated = () => setHydrated(true);
    const unsub = useAuthStore.persist.onFinishHydration(markHydrated);
    if (useAuthStore.persist.hasHydrated()) {
      markHydrated();
    }
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    async function refresh() {
      const sessionToken = readSessionToken(token);
      if (!sessionToken) {
        router.replace('/login');
        return;
      }
      setChecking(true);
      setError(null);
      try {
        const { account_status } = await fetchProfileAccountStatus();
        if (cancelled) return;

        const destination = routeForAccountStatus(account_status);
        const expectedPath =
          expected === 'pending'
            ? '/account/pending'
            : expected === 'rejected'
              ? '/account/rejected'
              : '/account/restricted';

        // If status changed (e.g. approved while on pending), follow fresh routing.
        if (destination !== expectedPath) {
          router.replace(destination);
          return;
        }
      } catch {
        if (!cancelled) {
          setError('We could not verify your account status. Please try again or sign in again.');
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    refresh();
    return () => {
      cancelled = true;
    };
  }, [hydrated, token, router, expected]);

  const copy = COPY[expected];

  const handleLogout = () => {
    logout();
    router.push('/site');
  };

  if ((!hydrated || checking) && !error) {
    return (
      <CustomerAuthShell title="Checking account status" lead="Please wait while we confirm your access.">
        <div className="flex items-center justify-center py-6" role="status" aria-live="polite">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#BFA06A] border-t-transparent" />
          <span className="sr-only">Checking status</span>
        </div>
      </CustomerAuthShell>
    );
  }

  return (
    <CustomerAuthShell title={copy.title} lead={copy.lead}>
      <div className="space-y-4">
        {error && (
          <div className={customerAuthUi.errorBox} role="alert">
            {error}
          </div>
        )}
        {!error &&
          copy.body.map((paragraph) => (
            <p key={paragraph} className="text-sm text-[#A8A29A] leading-relaxed">
              {paragraph}
            </p>
          ))}
        {copy.notice && !error && (
          <p className={`${customerAuthUi.helper} border-t border-white/10 pt-3`}>{copy.notice}</p>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <Link href="/site" className={customerAuthUi.btnPrimary}>
            Browse the catalog
          </Link>
          <button type="button" onClick={handleLogout} className={`${customerAuthUi.btnGhost} py-2`}>
            Sign out
          </button>
        </div>
      </div>
    </CustomerAuthShell>
  );
}
