'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  fetchProfileAccountStatus,
  type ParsedAccountStatus,
} from '@/lib/account-status';
import { customerAuthUi } from '@/lib/customer-auth-ui';

type GateState =
  | { kind: 'loading' }
  | { kind: 'approved' }
  | { kind: 'blocked'; status: ParsedAccountStatus; hasToken: boolean }
  | { kind: 'error'; message: string };

function blockedCopy(status: ParsedAccountStatus): {
  title: string;
  body: string;
  primaryHref: string;
  primaryLabel: string;
} {
  switch (status) {
    case 'pending':
      return {
        title: 'Account awaiting review',
        body: 'Online ordering is not available until your wholesale account is approved. Your cart is saved. You can keep browsing the catalog or check your application status.',
        primaryHref: '/account/pending',
        primaryLabel: 'View application status',
      };
    case 'rejected':
      return {
        title: 'Online ordering unavailable',
        body: 'This account is not approved for online ordering. Your cart is saved. You can continue browsing the public catalog.',
        primaryHref: '/account/rejected',
        primaryLabel: 'View account status',
      };
    case null:
      return {
        title: 'Approved account required',
        body: 'Online ordering requires an approved wholesale account. Sign in or create an account to continue. Signup does not grant ordering access until approval. Your cart is saved.',
        primaryHref: '/login?redirect=/checkout',
        primaryLabel: 'Sign in or create account',
      };
    default:
      return {
        title: 'Account status could not be verified',
        body: 'We could not confirm that this account is approved for online ordering. Your cart is saved. Please retry, or return to a safe account page.',
        primaryHref: '/account/restricted',
        primaryLabel: 'Account status',
      };
  }
}

/**
 * Usability gate for the checkout UI only.
 * Server-side online-order authorization remains authoritative.
 */
export default function CheckoutAccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'loading' });

  const verify = useCallback(async () => {
    setState({ kind: 'loading' });
    const token =
      typeof window !== 'undefined' ? String(localStorage.getItem('token') || '').trim() : '';
    if (!token) {
      setState({ kind: 'blocked', status: null, hasToken: false });
      return;
    }
    try {
      const { account_approved, account_status } = await fetchProfileAccountStatus();
      if (account_approved && account_status === 'approved') {
        setState({ kind: 'approved' });
        return;
      }
      setState({ kind: 'blocked', status: account_status, hasToken: true });
    } catch {
      setState({
        kind: 'error',
        message: 'Account status could not be verified. Online ordering is not available until verification succeeds.',
      });
    }
  }, []);

  useEffect(() => {
    verify();
  }, [verify]);

  if (state.kind === 'loading') {
    return (
      <div
        className="min-h-[50vh] flex flex-col items-center justify-center gap-3 px-4"
        role="status"
        aria-live="polite"
      >
        <div className="animate-spin rounded-full h-9 w-9 border-2 border-[#BFA06A] border-t-transparent" />
        <p className="text-sm text-[#A8A29A]">Verifying account access…</p>
      </div>
    );
  }

  if (state.kind === 'approved') {
    return <>{children}</>;
  }

  const copy =
    state.kind === 'error'
      ? {
          title: 'Account status could not be verified',
          body: state.message,
          primaryHref: '/account/restricted',
          primaryLabel: 'Account status',
        }
      : blockedCopy(state.status);

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <div
        className="rounded-2xl border px-6 py-8 space-y-4"
        style={{
          background: 'rgba(18,18,22,0.92)',
          borderColor: 'rgba(191,160,106,0.28)',
        }}
        role="region"
        aria-labelledby="checkout-access-title"
      >
        <h2
          id="checkout-access-title"
          className="text-xl text-[#F5F1E8]"
          style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
        >
          {copy.title}
        </h2>
        <p className="text-sm text-[#A8A29A] leading-relaxed">{copy.body}</p>
        <p className={customerAuthUi.helper}>
          Your cart items are kept. Public catalog browsing and quote requests remain available where
          offered on the storefront.
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Link href={copy.primaryHref} className={customerAuthUi.btnPrimary}>
            {copy.primaryLabel}
          </Link>
          {(state.kind === 'error' || (state.kind === 'blocked' && state.hasToken)) && (
            <button type="button" onClick={verify} className={`${customerAuthUi.btnGhost} py-2`}>
              Retry status check
            </button>
          )}
          <Link href="/site" className={`${customerAuthUi.btnGhost} text-center py-2`}>
            Continue browsing
          </Link>
          {state.kind === 'blocked' && state.status !== 'rejected' && (
            <p className={`${customerAuthUi.helper} text-center`}>
              Quote requests remain available from the storefront cart for guests and accounts awaiting
              review.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
