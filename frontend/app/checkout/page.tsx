'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingBag, CreditCard, Truck, ArrowLeft, Lock } from 'lucide-react';
import { useCartStore } from '@/lib/store';

const API = typeof window !== 'undefined' ? '/api' : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api');

// Website theme: black & golden (match landing)
const theme = {
  ink: '#0C0C0E',
  ink2: '#141416',
  ink3: '#1A1A1D',
  cream: '#F5F0E8',
  cream2: '#E8E0D0',
  gold: '#BFA06A',
  goldDk: '#8A7048',
  fog: '#7A7570',
  line: 'rgba(191,160,106,.14)',
  line2: 'rgba(255,255,255,.055)',
  serif: "'Playfair Display', Georgia, serif",
  body: "'Outfit', system-ui, sans-serif",
};

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  tax_rate?: number;
}

function toCheckoutItems(
  items: Array<{ product_id?: string; id?: string; name?: string; price?: number; quantity?: number; tax_rate?: number }>,
): CartItem[] {
  return items.map((it) => ({
    id: String(it.product_id || it.id || ''),
    name: String(it.name ?? '').replace(/&/g, 'and'),
    price: Number(it.price) || 0,
    quantity: Number(it.quantity) || 1,
    tax_rate: it.tax_rate,
  })).filter((it) => it.id);
}

export default function CheckoutPage() {
  const router = useRouter();
  const persistItems = useCartStore((s) => s.items);
  const clearPersistCart = useCartStore((s) => s.clearCart);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');

  const [payMethod, setPayMethod] = useState<'cod' | 'card'>('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [cardName, setCardName] = useState('');

  useEffect(() => {
    if (persistItems.length) {
      setCart(toCheckoutItems(persistItems));
      return;
    }
    try {
      const raw = localStorage.getItem('checkout_cart');
      if (raw) {
        const items = JSON.parse(raw) as CartItem[];
        if (items.length) {
          setCart(toCheckoutItems(items));
          return;
        }
      }
    } catch {}
    router.push('/');
  }, [persistItems, router]);

  const subtotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const taxTotal = cart.reduce((s, c) => {
    const rate = c.tax_rate || 0;
    return s + Math.round(c.price * c.quantity * (rate / 100) * 100) / 100;
  }, 0);
  const total = Math.round((subtotal + taxTotal) * 100) / 100;

  const canSubmit =
    name.trim() &&
    email.trim() &&
    phone.trim() &&
    line1.trim() &&
    city.trim() &&
    state.trim() &&
    zip.trim() &&
    (payMethod === 'cod' || (cardNumber.replace(/\s/g, '').length >= 15 && cardExpiry.length >= 4 && cardCvc.length >= 3 && cardName.trim()));

  const formatCard = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(.{4})/g, '$1 ').trim();
  };
  const formatExpiry = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 4);
    if (digits.length >= 3) return digits.slice(0, 2) + '/' + digits.slice(2);
    return digits;
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (!token) {
        router.push('/login?redirect=/checkout');
        return;
      }
      const res = await fetch(`${API}/online-orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          items: cart.map((c) => ({ product_id: c.id, quantity: c.quantity, price: c.price })),
          customer_name: name,
          customer_email: email,
          customer_phone: phone,
          address_line1: line1,
          address_line2: line2,
          city,
          state,
          zip,
          country: 'US',
          payment_method: payMethod,
          card_last4: payMethod === 'card' ? cardNumber.replace(/\s/g, '').slice(-4) : undefined,
          card_brand: payMethod === 'card' ? 'Visa' : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      localStorage.removeItem('checkout_cart');
      clearPersistCart();
      router.push(
        `/order-confirmation?order=${encodeURIComponent(data.order_number)}&email=${encodeURIComponent(email.trim().toLowerCase())}`
      );
    } catch (err: any) {
      alert(err.message || 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full bg-[#1A1A1D] border rounded-lg px-3 py-2.5 text-[#F5F0E8] placeholder-[#7A7570] focus:outline-none focus:ring-2 focus:ring-[#BFA06A] focus:border-[#BFA06A] border-[rgba(191,160,106,.14)]';
  const labelClass = 'block text-sm font-medium text-[#E8E0D0] mb-1';
  const sectionTitleClass = 'text-lg font-semibold mb-4 text-[#F5F0E8]';
  const cardClass = 'rounded-xl border p-6';
  const btnPrimary =
    'w-full py-3 font-medium rounded-lg transition-colors disabled:opacity-50 text-[#0C0C0E] bg-[#BFA06A] hover:bg-[#D4B88A] disabled:cursor-not-allowed';

  return (
    <div className="min-h-screen" style={{ background: theme.ink, color: theme.cream, fontFamily: theme.body }}>
      <header className="sticky top-0 z-10 border-b" style={{ background: theme.ink2, borderColor: theme.line2 }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 text-sm transition-colors hover:text-[#BFA06A]"
            style={{ color: theme.fog }}
          >
            <ArrowLeft className="w-4 h-4" /> Back to store
          </button>
          <span className="font-semibold" style={{ fontFamily: theme.serif, color: theme.cream }}>
            Express <span style={{ color: theme.gold }}>Distributors</span>
          </span>
          <Lock className="w-4 h-4" style={{ color: theme.fog }} />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold mb-2" style={{ fontFamily: theme.serif, color: theme.cream }}>
          Checkout
        </h1>
        <p className="mb-8" style={{ color: theme.fog, fontSize: '0.9375rem' }}>
          Customer, shipping, payment and order summary — all on one page.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: single form with all sections */}
          <div className="lg:col-span-2 space-y-6">
            {/* Order items */}
            <div className={cardClass} style={{ background: theme.ink2, borderColor: theme.line2 }}>
              <h2 className={sectionTitleClass} style={{ fontFamily: theme.serif }}>
                <ShoppingBag className="w-5 h-5 inline-block mr-2 align-middle" style={{ color: theme.gold }} />
                Order review
              </h2>
              {cart.length === 0 ? (
                <p style={{ color: theme.fog }}>Your cart is empty.</p>
              ) : (
                <div className="space-y-3">
                  {cart.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between py-3 border-b last:border-0"
                      style={{ borderColor: theme.line2 }}
                    >
                      <div>
                        <p className="font-medium" style={{ color: theme.cream }}>{item.name}</p>
                        <p className="text-sm" style={{ color: theme.fog }}>
                          Qty: {item.quantity} × ${item.price.toFixed(2)}
                        </p>
                        {(item.tax_rate || 0) > 0 && (
                          <p className="text-xs" style={{ color: theme.fog }}>Tax: {item.tax_rate}%</p>
                        )}
                      </div>
                      <p className="font-semibold" style={{ color: theme.gold }}>
                        ${(item.price * item.quantity).toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Customer & shipping */}
            <div className={cardClass} style={{ background: theme.ink2, borderColor: theme.line2 }}>
              <h2 className={sectionTitleClass} style={{ fontFamily: theme.serif }}>
                <Truck className="w-5 h-5 inline-block mr-2 align-middle" style={{ color: theme.gold }} />
                Customer & shipping
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelClass}>Full name *</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="John Doe" />
                </div>
                <div>
                  <label className={labelClass}>Email *</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="john@example.com" />
                </div>
                <div>
                  <label className={labelClass}>Phone *</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="(555) 123-4567" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Street address *</label>
                  <input value={line1} onChange={(e) => setLine1(e.target.value)} className={inputClass} placeholder="123 Main Street" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Apt / Suite / Unit</label>
                  <input value={line2} onChange={(e) => setLine2(e.target.value)} className={inputClass} placeholder="Apt 4B" />
                </div>
                <div>
                  <label className={labelClass}>City *</label>
                  <input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} placeholder="New York" />
                </div>
                <div>
                  <label className={labelClass}>State *</label>
                  <input
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className={inputClass}
                    placeholder="e.g. New York"
                  />
                </div>
                <div>
                  <label className={labelClass}>ZIP code *</label>
                  <input
                    value={zip}
                    onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    className={inputClass}
                    placeholder="10001"
                  />
                </div>
              </div>
            </div>

            {/* Payment */}
            <div className={cardClass} style={{ background: theme.ink2, borderColor: theme.line2 }}>
              <h2 className={sectionTitleClass} style={{ fontFamily: theme.serif }}>
                <CreditCard className="w-5 h-5 inline-block mr-2 align-middle" style={{ color: theme.gold }} />
                Payment method
              </h2>
              <div className="flex gap-3 mb-6">
                <button
                  onClick={() => setPayMethod('card')}
                  className="flex-1 py-3 border-2 rounded-lg font-medium text-sm transition-colors"
                  style={
                    payMethod === 'card'
                      ? { borderColor: theme.gold, background: 'rgba(191,160,106,.1)', color: theme.gold }
                      : { borderColor: theme.line2, color: theme.fog }
                  }
                >
                  <CreditCard className="w-5 h-5 mx-auto mb-1" /> Credit / Debit Card
                </button>
                <button
                  onClick={() => setPayMethod('cod')}
                  className="flex-1 py-3 border-2 rounded-lg font-medium text-sm transition-colors"
                  style={
                    payMethod === 'cod'
                      ? { borderColor: theme.gold, background: 'rgba(191,160,106,.1)', color: theme.gold }
                      : { borderColor: theme.line2, color: theme.fog }
                  }
                >
                  <Truck className="w-5 h-5 mx-auto mb-1" /> Cash on Delivery
                </button>
              </div>

              {payMethod === 'card' && (
                <div className="space-y-4">
                  <div>
                    <label className={labelClass}>Name on card *</label>
                    <input value={cardName} onChange={(e) => setCardName(e.target.value)} className={inputClass} placeholder="John Doe" />
                  </div>
                  <div>
                    <label className={labelClass}>Card number *</label>
                    <input
                      value={cardNumber}
                      onChange={(e) => setCardNumber(formatCard(e.target.value))}
                      className={inputClass + ' font-mono tracking-wider'}
                      placeholder="4242 4242 4242 4242"
                      maxLength={19}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Expiry *</label>
                      <input
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                        className={inputClass + ' font-mono'}
                        placeholder="MM/YY"
                        maxLength={5}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>CVC *</label>
                      <input
                        value={cardCvc}
                        onChange={(e) => setCardCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        className={inputClass + ' font-mono'}
                        placeholder="123"
                        maxLength={4}
                      />
                    </div>
                  </div>
                  <p
                    style={{
                      color: theme.fog,
                      fontSize: '0.82rem',
                      marginTop: '0.25rem',
                    }}
                  >
                    Note: We are currently accepting COD.
                  </p>
                </div>
              )}

              {payMethod === 'cod' && (
                <div
                  className="rounded-lg p-4 text-sm"
                  style={{ background: 'rgba(191,160,106,.08)', border: `1px solid ${theme.line}`, color: theme.cream2 }}
                >
                  Pay with cash when your order is delivered. Please have the exact amount ready.
                </div>
              )}
            </div>
          </div>

          {/* Right: order summary + confirm */}
          <div className="lg:col-span-1">
            <div
              className={`${cardClass} sticky top-20`}
              style={{ background: theme.ink2, borderColor: theme.line2 }}
            >
              <h3 className="font-semibold mb-4" style={{ fontFamily: theme.serif, color: theme.cream }}>
                Order summary
              </h3>
              <div className="space-y-2 text-sm mb-4">
                {cart.map((c) => (
                  <div key={c.id} className="flex justify-between">
                    <span className="truncate mr-2" style={{ color: theme.fog }}>
                      {c.name} × {c.quantity}
                    </span>
                    <span className="font-medium shrink-0" style={{ color: theme.gold }}>
                      ${(c.price * c.quantity).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="border-t pt-3 space-y-2 text-sm" style={{ borderColor: theme.line2 }}>
                <div className="flex justify-between">
                  <span style={{ color: theme.fog }}>Subtotal</span>
                  <span style={{ color: theme.cream2 }}>${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: theme.fog }}>Tax</span>
                  <span style={{ color: theme.cream2 }}>${taxTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: theme.fog }}>Shipping</span>
                  <span style={{ color: theme.gold }}>Free</span>
                </div>
              </div>
              <div
                className="border-t mt-3 pt-3 flex justify-between font-semibold text-lg"
                style={{ borderColor: theme.line2 }}
              >
                <span style={{ color: theme.cream }}>Total</span>
                <span style={{ color: theme.gold }}>${total.toFixed(2)}</span>
              </div>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className={btnPrimary + ' mt-6'}
              >
                {submitting ? 'Placing order…' : `Confirm order — $${total.toFixed(2)}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
