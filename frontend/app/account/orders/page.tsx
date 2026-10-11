'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { customerAuthTheme, customerAuthUi } from '@/lib/customer-auth-ui';
import toast from 'react-hot-toast';

type OrderItem = {
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
};

type OnlineOrder = {
  id: string;
  order_number: string;
  customer_email?: string;
  status: string;
  total_amount: number;
  created_at: string;
  items: OrderItem[];
};

const statusLabel: Record<string, string> = {
  confirmed: 'Confirmed',
  packed: 'Packed',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export default function AccountOrdersPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OnlineOrder[]>([]);

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
        const response = await api.get('/online-orders/my-orders');
        if (!cancelled) setOrders(Array.isArray(response.data) ? response.data : []);
      } catch {
        if (!cancelled) toast.error('Failed to load orders');
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
        <div className="flex items-center justify-between gap-3">
          <Link href="/account" className={customerAuthUi.btnGhost}>
            ← Account
          </Link>
          <Link href="/site#shop" className={customerAuthUi.btnGhost}>
            Shop
          </Link>
        </div>

        <div
          className="rounded-2xl border px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          style={{
            background: customerAuthTheme.panel,
            borderColor: customerAuthTheme.panelBorder,
          }}
        >
          <h1
            className="text-2xl text-[#F5F1E8] mb-2"
            style={{ fontFamily: customerAuthTheme.serif }}
          >
            My orders
          </h1>
          <p className="text-sm text-[#A8A29A] mb-6">
            Online orders placed with your approved wholesale account.
          </p>

          {!hydrated || loading ? (
            <div className="flex justify-center py-10" role="status">
              <div className="animate-spin rounded-full h-9 w-9 border-2 border-[#BFA06A] border-t-transparent" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-8 space-y-4">
              <p className="text-[#F5F1E8] font-medium">No orders yet</p>
              <p className="text-sm text-[#A8A29A]">
                When you place an online order, it will appear here.
              </p>
              <Link href="/site#shop" className={customerAuthUi.btnPrimary}>
                Start shopping
              </Link>
            </div>
          ) : (
            <ul className="space-y-4">
              {orders.map((order) => {
                const trackHref = order.customer_email
                  ? `/order-confirmation?order=${encodeURIComponent(order.order_number)}&email=${encodeURIComponent(order.customer_email)}`
                  : `/order-confirmation?order=${encodeURIComponent(order.order_number)}`;
                return (
                  <li
                    key={order.id}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-[#F5F1E8]">
                          Order #{order.order_number}
                        </p>
                        <p className="text-xs text-[#A8A29A] mt-1">
                          {new Date(order.created_at).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-xs tracking-wide uppercase text-[#D4B88A] border border-[#BFA06A]/30 rounded-full px-2.5 py-1">
                        {statusLabel[order.status] || order.status}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-[#E7E5E4]">
                      Total{' '}
                      <span className="text-[#BFA06A] font-semibold">
                        ${Number(order.total_amount || 0).toFixed(2)}
                      </span>
                      {' · '}
                      {order.items?.length || 0} line
                      {(order.items?.length || 0) === 1 ? '' : 's'}
                    </p>
                    <Link href={trackHref} className={`${customerAuthUi.btnGhost} mt-3 inline-flex`}>
                      Track order →
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
