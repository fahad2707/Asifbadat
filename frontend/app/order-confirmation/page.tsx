'use client';

import { useEffect, useState, Suspense, type CSSProperties } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, Package, Truck, MapPin, Clock } from 'lucide-react';
import { customerAuthTheme, customerAuthUi } from '@/lib/customer-auth-ui';

const API =
  typeof window !== 'undefined'
    ? '/api'
    : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';

interface OrderData {
  order_number: string;
  customer_name: string;
  items: { product_name: string; quantity: number; price: number; subtotal: number }[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: string;
  payment_method: string;
  payment_status: string;
  status_history: { status: string; timestamp: string }[];
  created_at: string;
}

const STATUS_STEPS = ['confirmed', 'packed', 'dispatched', 'delivered'];

const pageShell: CSSProperties = {
  background: `
    radial-gradient(ellipse 80% 50% at 50% -10%, rgba(191,160,106,0.16), transparent 55%),
    radial-gradient(ellipse 60% 40% at 100% 100%, rgba(191,160,106,0.06), transparent 50%),
    ${customerAuthTheme.bg}
  `,
  fontFamily: customerAuthTheme.body,
  color: customerAuthTheme.text,
};

const panelStyle: CSSProperties = {
  background: customerAuthTheme.panel,
  borderColor: customerAuthTheme.panelBorder,
};

function OrderConfirmationContent() {
  const params = useSearchParams();
  const router = useRouter();
  const orderNum = params.get('order');
  const emailParam = params.get('email')?.trim().toLowerCase() || '';
  const [emailGate, setEmailGate] = useState(emailParam);
  const [emailDraft, setEmailDraft] = useState(params.get('email') || '');
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const e = params.get('email')?.trim().toLowerCase() || '';
    setEmailGate(e);
    setEmailDraft(params.get('email') || '');
  }, [params]);

  useEffect(() => {
    if (!orderNum) {
      setLoading(false);
      return;
    }
    if (!emailGate) {
      setLoading(false);
      setOrder(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(
      `${API}/online-orders/track/${encodeURIComponent(orderNum)}?email=${encodeURIComponent(emailGate)}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.order_number) setOrder(d);
        else setOrder(null);
      })
      .catch(() => {
        if (!cancelled) setOrder(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderNum, emailGate]);

  if (!orderNum) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4" style={pageShell}>
        <p className="text-sm text-[#A8A29A] text-center mb-4">
          Missing order reference. Return to the store to place an order.
        </p>
        <Link href="/site" className={customerAuthUi.btnGhost}>
          Back to store
        </Link>
      </div>
    );
  }

  if (!emailGate) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={pageShell}>
        <div className="max-w-md w-full rounded-2xl border px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.45)]" style={panelStyle}>
          <Link href="/site" className="inline-block mb-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#BFA06A] rounded-sm">
            <h1 className={customerAuthUi.brandTitle} style={{ fontFamily: customerAuthTheme.serif }}>
              Express <span className={customerAuthUi.brandAccent}>Distributors</span>
            </h1>
          </Link>
          <h2 className="text-xl text-[#F5F1E8] mb-2" style={{ fontFamily: customerAuthTheme.serif }}>
            Track your order
          </h2>
          <p className="text-sm text-[#A8A29A] mb-5 leading-relaxed">
            Enter the email address used at checkout. This keeps your order details private.
          </p>
          <label htmlFor="track-email" className={customerAuthUi.label}>
            Email
          </label>
          <input
            id="track-email"
            type="email"
            value={emailDraft}
            onChange={(e) => setEmailDraft(e.target.value)}
            className={`${customerAuthUi.field} mb-4`}
            placeholder="you@example.com"
            autoComplete="email"
          />
          <button
            type="button"
            onClick={() => setEmailGate(emailDraft.trim().toLowerCase())}
            className={customerAuthUi.btnPrimary}
          >
            Load order
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={pageShell} role="status">
        <div className="animate-spin rounded-full h-9 w-9 border-2 border-[#BFA06A] border-t-transparent" />
        <p className="text-sm text-[#A8A29A]">Loading order…</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 gap-4" style={pageShell}>
        <p className="text-sm text-[#A8A29A] text-center">
          We couldn&apos;t find that order, or the email doesn&apos;t match.
        </p>
        <button
          type="button"
          className={customerAuthUi.btnGhost}
          onClick={() => {
            setEmailGate('');
            setOrder(null);
          }}
        >
          Try a different email
        </button>
        <Link href="/site" className={customerAuthUi.btnGhost}>
          Back to store
        </Link>
      </div>
    );
  }

  const currentIdx = STATUS_STEPS.indexOf(order.status);
  const isCancelled = order.status === 'cancelled';

  return (
    <div className="min-h-screen px-4 py-10 sm:py-14" style={pageShell}>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          <Link
            href="/site"
            className="inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#BFA06A] rounded-sm"
          >
            <h1 className={customerAuthUi.brandTitle} style={{ fontFamily: customerAuthTheme.serif }}>
              Express <span className={customerAuthUi.brandAccent}>Distributors</span>
            </h1>
          </Link>
        </div>

        <div className="text-center mb-2">
          <div
            className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center border ${
              isCancelled
                ? 'bg-[rgba(248,113,113,0.12)] border-[#F87171]/40'
                : 'bg-[#BFA06A]/15 border-[#BFA06A]/40'
            }`}
          >
            <CheckCircle className={`w-8 h-8 ${isCancelled ? 'text-[#F87171]' : 'text-[#BFA06A]'}`} />
          </div>
          <h2
            className="text-2xl text-[#F5F1E8] mb-2"
            style={{ fontFamily: customerAuthTheme.serif }}
          >
            {isCancelled ? 'Order cancelled' : 'Thank you for your order'}
          </h2>
          <p className="text-sm text-[#A8A29A]">
            Order <span className="text-[#D4B88A] font-semibold">{order.order_number}</span>
            {' · '}
            {new Date(order.created_at).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>

        {!isCancelled && (
          <div className="rounded-2xl border px-5 py-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]" style={panelStyle}>
            <h3 className="text-sm font-semibold tracking-wide uppercase text-[#BFA06A] mb-5">
              Order status
            </h3>
            <div className="flex items-center justify-between">
              {STATUS_STEPS.map((s, i) => {
                const done = i <= currentIdx;
                const icons = [Package, Package, Truck, MapPin];
                const Icon = icons[i];
                return (
                  <div key={s} className="flex flex-col items-center flex-1 relative">
                    {i > 0 && (
                      <div
                        className={`absolute top-4 right-1/2 w-full h-0.5 -z-0 ${
                          i <= currentIdx ? 'bg-[#BFA06A]' : 'bg-white/10'
                        }`}
                      />
                    )}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center z-10 border ${
                        done
                          ? 'bg-[#BFA06A] border-[#BFA06A] text-[#0C0C0E]'
                          : 'bg-white/[0.04] border-white/15 text-[#78716C]'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] mt-2 text-center capitalize text-[#A8A29A] tracking-wide">
                      {s.replace(/_/g, ' ')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="rounded-2xl border px-5 py-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]" style={panelStyle}>
          <h3 className="text-sm font-semibold tracking-wide uppercase text-[#BFA06A] mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Timeline
          </h3>
          {(order.status_history || []).length === 0 ? (
            <p className="text-sm text-[#A8A29A]">No status updates yet.</p>
          ) : (
            <ul className="space-y-3">
              {(order.status_history || []).map((h, idx) => (
                <li
                  key={idx}
                  className="text-sm text-[#E7E5E4] border-l-2 border-[#BFA06A]/70 pl-3"
                >
                  <span className="font-medium capitalize text-[#F5F1E8]">
                    {h.status.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[#78716C] ml-2">
                    {h.timestamp ? new Date(h.timestamp).toLocaleString() : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border px-5 py-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]" style={panelStyle}>
          <h3 className="text-sm font-semibold tracking-wide uppercase text-[#BFA06A] mb-4">
            Items
          </h3>
          <ul className="divide-y divide-white/10">
            {order.items.map((it, i) => (
              <li key={i} className="py-3 flex justify-between gap-3 text-sm">
                <span className="text-[#E7E5E4]">
                  {it.product_name}{' '}
                  <span className="text-[#A8A29A]">× {it.quantity}</span>
                </span>
                <span className="font-semibold text-[#D4B88A] tabular-nums">
                  ${Number(it.subtotal).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-4 border-t border-white/10 space-y-2 text-sm">
            <div className="flex justify-between text-[#A8A29A]">
              <span>Subtotal</span>
              <span className="tabular-nums">${Number(order.subtotal).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[#A8A29A]">
              <span>Tax</span>
              <span className="tabular-nums">${Number(order.tax_amount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold text-[#F5F1E8] pt-2">
              <span>Total</span>
              <span className="text-[#BFA06A] tabular-nums">
                ${Number(order.total_amount).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
          <button
            type="button"
            onClick={() => router.push('/site')}
            className={customerAuthUi.btnPrimary}
          >
            Continue shopping
          </button>
          <Link href="/account/orders" className={`${customerAuthUi.btnGhost} text-center py-3`}>
            My orders
          </Link>
        </div>
      </div>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={pageShell} role="status">
      <div className="animate-spin rounded-full h-9 w-9 border-2 border-[#BFA06A] border-t-transparent" />
      <p className="text-sm text-[#A8A29A]">Loading…</p>
    </div>
  );
}

export default function OrderConfirmationPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <OrderConfirmationContent />
    </Suspense>
  );
}
