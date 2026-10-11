'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { resolveApiBaseUrl } from '@/lib/api-base-url';
import { customerAuthTheme, customerAuthUi } from '@/lib/customer-auth-ui';
import CustomerAuthShell from '@/components/auth/CustomerAuthShell';
import PasswordField from '@/components/auth/PasswordField';

function ResetContent() {
  const params = useSearchParams();
  const token = params.get('token')?.trim() || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (!token) {
      setError('Invalid reset link');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Reset failed');
      }
      setMessage(typeof data?.message === 'string' && data.message ? data.message : 'Password updated.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <CustomerAuthShell title="Invalid reset link" lead="This password reset link is missing or incomplete.">
        <p className={customerAuthUi.linkRow}>
          <Link href="/login" className={customerAuthUi.btnGhost}>
            Back to login
          </Link>
        </p>
      </CustomerAuthShell>
    );
  }

  if (message) {
    return (
      <CustomerAuthShell title="Password updated" lead="You can now sign in with your new password.">
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
    <CustomerAuthShell title="Set a new password" lead="Choose a strong password of at least 8 characters.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <div className={customerAuthUi.errorBox} role="alert">
            {error}
          </div>
        )}

        <PasswordField
          id="reset-password"
          label="New password"
          value={password}
          onChange={setPassword}
          placeholder="At least 8 characters"
          required
          autoComplete="new-password"
          minLength={8}
        />

        <PasswordField
          id="reset-confirm"
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          placeholder="Repeat password"
          required
          autoComplete="new-password"
          minLength={8}
        />

        <button type="submit" disabled={loading} className={customerAuthUi.btnPrimary}>
          {loading ? 'Saving…' : 'Update password'}
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthLoadingFallback />}>
      <ResetContent />
    </Suspense>
  );
}
