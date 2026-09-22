'use client';

import { useEffect, useState } from 'react';
import adminApi, { markAdminLoggedInNow } from '@/lib/admin-api';
import { formatApiError } from '@/lib/format-api-error';
import toast from 'react-hot-toast';

function readNextFromUrl(): string {
  if (typeof window === 'undefined') return '/admin/dashboard';
  try {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next') || '';
    if (next && next.startsWith('/admin')) return next;
  } catch {
    /* ignore */
  }
  return '/admin/dashboard';
}

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('adminToken');
    if (token) {
      window.location.replace(readNextFromUrl());
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await adminApi.post('/auth/admin/login', { email, password });
      const token = response.data?.token as string | undefined;
      if (!token) {
        toast.error('Login response missing token. Try again.');
        setLoading(false);
        return;
      }
      localStorage.setItem('adminToken', token);
      markAdminLoggedInNow();
      toast.success('Login successful!');
      window.location.replace(readNextFromUrl());
    } catch (error: unknown) {
      const ax = error as { code?: string; message?: string; response?: unknown };
      if (ax.code === 'ECONNREFUSED' || ax.message?.includes('Network Error') || !ax.response) {
        toast.error('Cannot reach server. Is the backend running? Start it with: npm run dev (from project root)');
      } else {
        toast.error(formatApiError(error, 'Login failed'));
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4 relative overflow-hidden">
      {/* Background Refraction Mesh Gradients */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[20%] left-[20%] w-[350px] h-[350px] rounded-full bg-teal-500/10 blur-[130px] animate-pulse" />
        <div className="absolute bottom-[20%] right-[20%] w-[450px] h-[450px] rounded-full bg-blue-500/10 blur-[150px] animate-pulse" />
      </div>

      <div className="relative z-10 bg-slate-900/40 backdrop-blur-xl border border-white/[0.08] border-t-white/[0.18] shadow-[0_24px_60px_rgba(0,0,0,0.35)] rounded-3xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-extrabold text-center mb-1 text-white tracking-tight">
          Admin Portal
        </h1>
        <p className="text-center text-slate-400 mb-8 text-xs font-semibold tracking-wider uppercase">Express Distributors Inc</p>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@expressdistributors.com"
              className="w-full px-4 py-3 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              Sign-In Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border border-white/10 text-white py-3 rounded-xl font-bold text-sm shadow-sm transition-all disabled:opacity-40"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-500 font-medium">
          Default: <span className="font-mono text-slate-400">admin@edinc.com</span> / <span className="font-mono text-slate-400">Admin1234</span>
        </p>
        <p className="mt-1.5 text-center text-[10px] text-slate-650 font-medium">
          Production: configure <span className="font-mono text-slate-600">BACKEND_URL</span> on Vercel deployment variables.
        </p>
      </div>
    </div>
  );
}
