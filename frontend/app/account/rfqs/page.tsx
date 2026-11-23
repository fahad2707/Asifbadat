'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { customerAuthTheme, customerAuthUi } from '@/lib/customer-auth-ui';
import toast from 'react-hot-toast';

type RfqRow = {
  id: string;
  rfq_number: string;
  status: string;
  created_at: string;
  customer_comments?: string;
  items: { product_name: string; quantity: number }[];
};

function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function PreviousRfqsPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RfqRow[]>([]);

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
        const res = await api.get('/user/rfqs');
        if (cancelled) return;
        setRows(Array.isArray(res.data?.rfqs) ? res.data.rfqs : []);
      } catch {
        if (!cancelled) toast.error('Failed to load quote requests');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, token, router]);

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
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Link href="/site" className={customerAuthUi.btnGhost}>
          ← Store
        </Link>
        <div
          className="rounded-2xl border px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          style={{
            background: customerAuthTheme.panel,
            borderColor: customerAuthTheme.panelBorder,
          }}
        >
          <h1 className="text-2xl text-[#F5F1E8] mb-2" style={{ fontFamily: customerAuthTheme.serif }}>
            Previous RFQ
          </h1>
          <p className="text-sm text-[#A8A29A] mb-6">Quote requests sent from your account, newest first.</p>
          {!hydrated || loading ? (
            <div className="flex justify-center py-10" role="status">
              <div className="animate-spin rounded-full h-9 w-9 border-2 border-[#BFA06A] border-t-transparent" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-[#A8A29A]">No quote requests yet.</p>
          ) : (
            <ul className="space-y-4">
              {rows.map((row) => (
                <li key={row.id} className="rounded-xl border border-white/10 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-[#F5F1E8]">{row.rfq_number}</p>
                      <p className="text-sm text-[#BFA06A] mt-1">{when(row.created_at)}</p>
                    </div>
                    <span className="text-xs uppercase tracking-wider text-[#A8A29A]">{row.status}</span>
                  </div>
                  <ul className="mt-3 space-y-1 text-sm text-[#E7E5E4]">
                    {row.items.map((item, index) => (
                      <li key={`${row.id}-${index}`}>
                        {item.product_name} × {item.quantity}
                      </li>
                    ))}
                  </ul>
                  {row.customer_comments ? (
                    <p className="mt-3 text-sm text-[#A8A29A]">{row.customer_comments}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
