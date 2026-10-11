'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { resolveApiBaseUrl } from '@/lib/api-base-url';
import { customerAuthTheme, customerAuthUi } from '@/lib/customer-auth-ui';
import CustomerAuthShell from '@/components/auth/CustomerAuthShell';

function VerifyContent() {
  const params = useSearchParams();
  const token = params.get('token');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token?.trim()) {
      setError('Invalid verification link.');
      setDone(true);
      return;
    }
    // Token is sent as a query parameter to the existing verify endpoint only.
    // It is not logged or rendered into the page body.
    fetch(`${resolveApiBaseUrl()}/auth/verify-email?token=${encodeURIComponent(token.trim())}`)
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.message === 'string' && d.message) setMessage(d.message);
        else setError(typeof d?.error === 'string' ? d.error : 'Verification failed');
      })
      .catch(() => setError('Verification failed'))
      .finally(() => setDone(true));
  }, [token]);

  if (!done) {
    return (
      <CustomerAuthShell title="Verifying email" lead="Please wait while we confirm your address.">
        <div className="flex items-center justify-center py-6" role="status" aria-live="polite">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#BFA06A] border-t-transparent" />
          <span className="sr-only">Verifying</span>
        </div>
      </CustomerAuthShell>
    );
  }

  if (message) {
    return (
      <CustomerAuthShell title="Email verified" lead="Your email address has been confirmed.">
        <div className={customerAuthUi.successBox} role="status">
          {message}
        </div>
        <p className={`${customerAuthUi.linkRow} mt-6`}>
          <Link href="/login" className={customerAuthUi.btnGhost}>
            Sign in
          </Link>
        </p>
      </CustomerAuthShell>
    );
  }

  return (
    <CustomerAuthShell title="Verification failed" lead="This link may be expired or already used.">
      <div className={customerAuthUi.errorBox} role="alert">
        {error}
      </div>
      <p className={`${customerAuthUi.linkRow} mt-6`}>
        <Link href="/login" className={customerAuthUi.btnGhost}>
          Back to login
        </Link>
      </p>
    </CustomerAuthShell>
  );
}

function AuthLoadingFallback() {
  return (
    <div
      className="min-h-screen flex items-center justify-center text-[#A8A29A] text-sm"
      style={{ background: customerAuthTheme.bg, fontFamily: customerAuthTheme.body }}
      role="status"
    >
      Loading…
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthLoadingFallback />}>
      <VerifyContent />
    </Suspense>
  );
}
