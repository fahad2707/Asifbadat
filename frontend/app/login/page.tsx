'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { formatApiError } from '@/lib/format-api-error';
import { customerAuthUi } from '@/lib/customer-auth-ui';
import {
  fetchProfileAccountStatus,
  routeForAccountStatus,
} from '@/lib/account-status';
import CustomerAuthShell from '@/components/auth/CustomerAuthShell';
import PasswordField from '@/components/auth/PasswordField';
import toast from 'react-hot-toast';

const LOGIN_CREDENTIALS_ERROR = 'Email id or password is incorrect';

async function navigateAfterAuth(
  push: (href: string) => void,
  options?: { preferredRedirect?: string | null }
) {
  try {
    const { account_status, account_approved } = await fetchProfileAccountStatus();
    const preferred = (options?.preferredRedirect || '').trim();
    // Only honor an explicit checkout return path for verified approved accounts.
    if (
      preferred === '/checkout' &&
      account_approved &&
      account_status === 'approved'
    ) {
      push('/checkout');
      return;
    }
    push(routeForAccountStatus(account_status));
  } catch {
    // Fail closed: never send users to approved storefront without a verified status.
    toast.error('Signed in, but account status could not be verified.');
    push('/account/restricted');
  }
}

type Mode = 'login' | 'signup';

function axiosStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preferredRedirect = searchParams.get('redirect');
  const requestedMode: Mode = searchParams.get('mode') === 'signup' ? 'signup' : 'login';
  const { setAuth } = useAuthStore();
  const [mode, setMode] = useState<Mode>(requestedMode);

  useEffect(() => {
    setMode(requestedMode);
  }, [requestedMode]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setFieldError(null);
    setPassword('');
    setConfirmPassword('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    if (!email.trim()) {
      setFieldError('Email is required');
      return;
    }
    if (!password) {
      setFieldError('Password is required');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/login', {
        email: email.trim(),
        password,
      });
      setAuth(response.data.user, response.data.token);
      toast.success('Login successful!');
      await navigateAfterAuth((href) => router.push(href), {
        preferredRedirect,
      });
    } catch (error: unknown) {
      if (axiosStatus(error) === 401) {
        setFieldError(LOGIN_CREDENTIALS_ERROR);
        toast.error(LOGIN_CREDENTIALS_ERROR);
      } else {
        const message = formatApiError(error, 'Login failed');
        setFieldError(message);
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    if (!email.trim()) {
      setFieldError('Email is required');
      return;
    }
    if (!password) {
      setFieldError('Password is required');
      return;
    }
    if (password !== confirmPassword) {
      setFieldError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/register', {
        name: name.trim() || undefined,
        email: email.trim(),
        password,
      });
      if (response.data.requiresVerification) {
        toast.success(response.data.message || 'Check your email to verify your account.');
        switchMode('login');
        return;
      }
      setAuth(response.data.user, response.data.token);
      toast.success('Account created!');
      await navigateAfterAuth((href) => router.push(href), {
        preferredRedirect,
      });
    } catch (error: unknown) {
      const message = formatApiError(error, 'Signup failed');
      setFieldError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const isLogin = mode === 'login';

  return (
    <CustomerAuthShell
      title={isLogin ? 'Sign in' : 'Create your account'}
      lead={
        isLogin
          ? 'Access your wholesale account to view pricing and place orders once approved.'
          : 'Register for a wholesale account. Pricing and ordering require admin approval after signup.'
      }
    >
      <div className={customerAuthUi.tabRow} role="tablist" aria-label="Authentication mode">
        <button
          type="button"
          role="tab"
          aria-selected={isLogin}
          onClick={() => switchMode('login')}
          className={`${customerAuthUi.tab} ${isLogin ? customerAuthUi.tabActive : customerAuthUi.tabIdle}`}
        >
          Login
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isLogin}
          onClick={() => switchMode('signup')}
          className={`${customerAuthUi.tab} ${!isLogin ? customerAuthUi.tabActive : customerAuthUi.tabIdle}`}
        >
          Sign up
        </button>
      </div>

      <form onSubmit={isLogin ? handleLogin : handleSignup} className="space-y-4" noValidate>
        {fieldError && (
          <div className={customerAuthUi.errorBox} role="alert">
            {fieldError}
          </div>
        )}

        {!isLogin && (
          <div>
            <label htmlFor="signup-name" className={customerAuthUi.label}>
              Name
            </label>
            <input
              id="signup-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={customerAuthUi.field}
              placeholder="Business or contact name"
              autoComplete="name"
            />
          </div>
        )}

        <div>
          <label htmlFor="auth-email" className={customerAuthUi.label}>
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={customerAuthUi.field}
            placeholder="you@company.com"
            autoComplete="email"
            required
          />
        </div>

        <PasswordField
          id="auth-password"
          label="Password"
          value={password}
          onChange={setPassword}
          placeholder={isLogin ? 'Your password' : 'Create a password'}
          required
          autoComplete={isLogin ? 'current-password' : 'new-password'}
        />

        {!isLogin && (
          <PasswordField
            id="auth-confirm-password"
            label="Confirm password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Repeat password"
            required
            autoComplete="new-password"
            minLength={8}
          />
        )}

        <button type="submit" disabled={loading} className={customerAuthUi.btnPrimary}>
          {loading
            ? isLogin
              ? 'Signing in…'
              : 'Creating account…'
            : isLogin
              ? 'Sign in'
              : 'Create account'}
        </button>

        {isLogin ? (
          <p className={customerAuthUi.linkRow}>
            <Link href="/forgot-password" className={customerAuthUi.btnGhost}>
              Forgot password?
            </Link>
          </p>
        ) : (
          <p className={customerAuthUi.linkRow}>
            Already have an account?{' '}
            <button type="button" onClick={() => switchMode('login')} className={customerAuthUi.btnGhost}>
              Sign in
            </button>
          </p>
        )}
      </form>
    </CustomerAuthShell>
  );
}
