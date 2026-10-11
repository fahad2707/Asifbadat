'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Minus, Trash2, ShoppingCart, FileSignature, MessageSquare, Truck } from 'lucide-react';
import {
  fetchProfileAccountStatus,
  type ParsedAccountStatus,
} from '@/lib/account-status';
import { useAuthStore, useCartStore } from '@/lib/store';
import toast from 'react-hot-toast';
import RFQLightbox, { type RFQLightboxItem } from '@/components/RFQLightbox';

export default function CartPage() {
  const router = useRouter();
  const { items, updateQuantity, removeItem, clearCart } = useCartStore();
  const token = useAuthStore((s) => s.token);
  const [rfqOpen, setRfqOpen] = useState(false);
  const [accountApproved, setAccountApproved] = useState(false);
  const [accountStatus, setAccountStatus] = useState<ParsedAccountStatus>(null);
  const [statusChecked, setStatusChecked] = useState(false);

  useEffect(() => {
    if (!token) {
      setAccountApproved(false);
      setAccountStatus(null);
      setStatusChecked(true);
      return;
    }
    let cancelled = false;
    setStatusChecked(false);
    fetchProfileAccountStatus()
      .then(({ account_approved, account_status }) => {
        if (cancelled) return;
        setAccountApproved(account_approved && account_status === 'approved');
        setAccountStatus(account_status);
      })
      .catch(() => {
        if (cancelled) return;
        // Fail closed for Place Order; RFQ remains available.
        setAccountApproved(false);
        setAccountStatus('invalid');
      })
      .finally(() => {
        if (!cancelled) setStatusChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmitRFQ = () => {
    if (items.length === 0) {
      toast.error('Your cart is empty');
      return;
    }
    setRfqOpen(true);
  };

  const handlePlaceOrder = async () => {
    if (items.length === 0) {
      toast.error('Your cart is empty');
      return;
    }
    try {
      const { account_approved, account_status } = await fetchProfileAccountStatus();
      if (!(account_approved && account_status === 'approved')) {
        toast.error('Online ordering requires an approved wholesale account.');
        setAccountApproved(false);
        setAccountStatus(account_status);
        return;
      }
    } catch {
      toast.error('Account status could not be verified. Try again or request a quote.');
      setAccountApproved(false);
      setAccountStatus('invalid');
      return;
    }
    const payload = items.map((item) => ({
      id: item.product_id,
      name: item.name,
      price: Number(item.price) || 0,
      quantity: item.quantity,
      tax_rate: item.tax_rate,
    }));
    localStorage.setItem('checkout_cart', JSON.stringify(payload));
    router.push('/checkout');
  };

  const statusNote = (() => {
    if (!statusChecked || accountApproved) return null;
    if (!token) {
      return 'Online ordering requires an approved wholesale account. You can still request a quote as a guest — your cart is kept.';
    }
    if (accountStatus === 'pending') {
      return 'Your account is awaiting review, so online ordering is not available yet. Quote requests remain open — your cart is kept.';
    }
    if (accountStatus === 'rejected') {
      return 'Online ordering is unavailable for this account. You can still browse the catalog — your cart is kept.';
    }
    return 'Account status could not be verified for online ordering. You can retry later or request a quote — your cart is kept.';
  })();

  const rfqItems: RFQLightboxItem[] = items.map((item) => ({
    product_id: item.product_id,
    product_name: item.name,
    image_url: item.image_url,
    quantity: item.quantity,
  }));

  return (
    <div className="min-h-screen bg-[#0f1115] text-slate-50">
      <div className="container mx-auto px-4 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-slate-300 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Continue Shopping
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <ShoppingCart className="w-8 h-8 text-[#7c5cff]" />
          <h1 className="text-4xl font-bold text-slate-50 tracking-[0.04em]">Your Cart</h1>
        </div>

        {items.length === 0 ? (
          <div className="glass-panel p-12 text-center">
            <ShoppingCart className="w-20 h-20 text-slate-500 mx-auto mb-4" />
            <h2 className="text-2xl font-semibold text-slate-50 mb-2">Your cart is empty</h2>
            <p className="text-slate-300 mb-6">
              Browse our products and add items to request a quote.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 glass-button glass-button-gradient px-6 py-3 rounded-lg font-semibold transition-all hover:scale-[1.03]"
            >
              Start Shopping
            </Link>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              {items.map((item) => (
                <div
                  key={item.product_id}
                  className="glass-panel transition-shadow p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4"
                >
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name.replace(/&/g, 'and')}
                      className="w-24 h-24 sm:w-32 sm:h-32 object-cover rounded-xl"
                    />
                  ) : (
                    <div className="w-24 h-24 sm:w-32 sm:h-32 bg-gradient-to-br from-[#7c5cff] to-[#4f8cff] rounded-xl flex items-center justify-center">
                      <span className="text-3xl text-white font-bold">
                        {item.name.replace(/&/g, 'and').charAt(0)}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg text-slate-50 mb-1 truncate">
                      {item.name.replace(/&/g, 'and')}
                    </h3>
                    {accountApproved && typeof item.price === 'number' ? (
                      <p className="text-sm text-[#c7d2ff] mb-3">
                        ${Number(item.price).toFixed(2)}
                      </p>
                    ) : (
                      <p className="text-xs tracking-widest uppercase text-[#c7d2ff] mb-3">
                        Pricing on request
                      </p>
                    )}
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 border-2 border-white/15 rounded-lg">
                        <button
                          onClick={() => updateQuantity(item.product_id, item.quantity - 1)}
                          className="p-2 hover:bg-white/10 transition-colors"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="px-4 py-2 font-semibold min-w-[3rem] text-center text-slate-50">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.product_id, item.quantity + 1)}
                          className="p-2 hover:bg-white/10 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => removeItem(item.product_id)}
                    className="p-3 text-red-400 hover:bg-red-950/40 rounded-lg transition-colors self-start sm:self-center"
                    aria-label="Remove from cart"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="lg:col-span-1">
              <div className="glass-panel p-6 sticky top-4">
                {accountApproved ? (
                  <>
                    <h2 className="text-2xl font-bold mb-2 text-slate-50">Checkout</h2>
                    <p className="text-sm text-slate-300 mb-4 leading-relaxed">
                      Place an online order. Final prices and tax are confirmed by the server.
                    </p>
                    <p className="text-lg font-semibold text-slate-50 mb-4">
                      ${items.reduce((s, it) => s + (Number(it.price) || 0) * it.quantity, 0).toFixed(2)}
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="text-2xl font-bold mb-2 text-slate-50">Request a Quote</h2>
                    <p className="text-sm text-slate-300 mb-4 leading-relaxed">
                      Submit your details and our team will share competitive pricing on WhatsApp /
                      email — usually within a few hours.
                    </p>

                    <div className="flex items-start gap-3 p-3 bg-[#c7d2ff]/5 border border-[#c7d2ff]/20 rounded-lg mb-4">
                      <MessageSquare className="w-5 h-5 text-[#c7d2ff] mt-0.5 flex-shrink-0" />
                      <div className="text-xs text-slate-200 leading-relaxed">
                        <p className="font-semibold mb-1 uppercase tracking-widest text-[10px] text-[#c7d2ff]">
                          Quote by WhatsApp
                        </p>
                        <p className="text-slate-300">
                          We do not display prices online so competitors cannot compare. Submit a
                          request and we will respond with pricing for your selected items.
                        </p>
                      </div>
                    </div>
                  </>
                )}

                {statusNote && (
                  <p className="text-xs text-amber-200/90 mb-4 leading-relaxed" role="status">
                    {statusNote}
                    {accountStatus === 'pending' && (
                      <>
                        {' '}
                        <Link href="/account/pending" className="underline hover:text-amber-100">
                          View application status
                        </Link>
                      </>
                    )}
                    {accountStatus === 'rejected' && (
                      <>
                        {' '}
                        <Link href="/account/rejected" className="underline hover:text-amber-100">
                          View account status
                        </Link>
                      </>
                    )}
                    {!token && (
                      <>
                        {' '}
                        <Link href="/login?redirect=/checkout" className="underline hover:text-amber-100">
                          Sign in
                        </Link>
                      </>
                    )}
                  </p>
                )}

                <p className="text-xs text-slate-400 mb-4">
                  {items.reduce((s, it) => s + it.quantity, 0)} unit
                  {items.reduce((s, it) => s + it.quantity, 0) === 1 ? '' : 's'} across{' '}
                  {items.length} product{items.length === 1 ? '' : 's'}.
                </p>

                {accountApproved ? (
                  <button
                    type="button"
                    onClick={handlePlaceOrder}
                    className="w-full glass-button glass-button-gradient text-white py-4 rounded-lg font-semibold transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2 mb-3 shadow-lg"
                  >
                    <ShoppingCart className="w-5 h-5" />
                    Place Order
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmitRFQ}
                    className="w-full glass-button glass-button-gradient text-white py-4 rounded-lg font-semibold transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2 mb-3 shadow-lg"
                  >
                    <FileSignature className="w-5 h-5" />
                    Submit Quote Request
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Clear your cart?')) clearCart();
                  }}
                  className="w-full text-xs text-slate-400 hover:text-slate-200 py-2 transition-colors"
                >
                  Clear cart
                </button>

                <div className="mt-6 pt-6 border-t border-white/10 flex items-start gap-3">
                  <Truck className="w-5 h-5 text-slate-300 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-slate-300">
                    <p className="font-semibold mb-1 text-slate-100">Pickup or Delivery</p>
                    <p>Our team will arrange pickup at our PA warehouse or delivery as needed.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <RFQLightbox
        isOpen={rfqOpen}
        onClose={() => setRfqOpen(false)}
        items={rfqItems}
        onSubmitted={() => {
          clearCart();
        }}
        source="store"
      />
    </div>
  );
}
