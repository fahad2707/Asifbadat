'use client';

import { useState } from 'react';
import Link from 'next/link';
import { resolveApiBaseUrl } from '@/lib/api-base-url';
import { customerAuthUi } from '@/lib/customer-auth-ui';
import CustomerAuthShell from '@/components/auth/CustomerAuthShell';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setError('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Enter your email address');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === 'string' ? data.error : 'Request failed'
        );
      }
      setMessage(
        typeof data?.message === 'string' && data.message
          ? data.message
          : 'If an account exists for that email, a reset link was sent.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CustomerAuthShell
      title="Reset password"
      lead="Enter your account email. If an account exists, we will send a reset link when email delivery is configured."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {message && (
          <div className={customerAuthUi.successBox} role="status">
            {message}
          </div>
        )}
        {error && (
          <div className={customerAuthUi.errorBox} role="alert">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="forgot-email" className={customerAuthUi.label}>
            Email
          </label>
          <input
            id="forgot-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={customerAuthUi.field}
            placeholder="you@company.com"
            autoComplete="email"
            required
          />
        </div>

        <button type="submit" disabled={loading} className={customerAuthUi.btnPrimary}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>

        <p className={customerAuthUi.linkRow}>
          <Link href="/login" className={customerAuthUi.btnGhost}>
            Back to login
          </Link>
        </p>
      </form>
    </CustomerAuthShell>
  );
}
