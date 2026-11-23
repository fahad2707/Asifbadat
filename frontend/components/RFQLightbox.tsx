'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, MessageSquare, X } from 'lucide-react';
import api from '@/lib/api';
import { formatApiError } from '@/lib/format-api-error';

export interface RFQLightboxItem {
  product_id?: string;
  product_name: string;
  category_name?: string;
  image_url?: string;
  quantity: number;
}

interface RFQLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  items: RFQLightboxItem[];
  onSubmitted?: (rfqNumber: string) => void;
  source?: 'website' | 'store' | 'manual';
}

export default function RFQLightbox({
  isOpen,
  onClose,
  items,
  onSubmitted,
  source = 'store',
}: RFQLightboxProps) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successRef, setSuccessRef] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const token = typeof window !== 'undefined' ? String(localStorage.getItem('token') || '').trim() : '';
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/user/profile');
        if (cancelled) return;
        const contact = res.data?.contact || {};
        setName((current) => current || contact.name || res.data?.name || '');
        setCompany((current) => current || contact.company || '');
        setPhone((current) => current || contact.phone || '');
        setEmail((current) => current || contact.email || res.data?.email || '');
      } catch {
        /* Quote form still works if the profile cannot be loaded. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessRef(null);
      // Focus the first input after the modal mounts so the user sees a
      // blinking text caret and can start typing immediately. A short delay
      // lets the modal transition finish so the focus call doesn't get
      // pre-empted by scroll-into-view / animation logic.
      const t = setTimeout(() => {
        nameInputRef.current?.focus();
      }, 120);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Prevent the page underneath from scrolling while the modal is open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Force a visible text caret on every input. The marketing site CSS sets
  // cursor:none on every element to support a custom gold cursor; when the
  // modal is rendered inside that context the native I-beam disappears.
  // `caret-color: auto` keeps the blinking caret visible regardless.
  const inputBase =
    'w-full bg-black/50 border border-amber-200/20 rounded-md px-3 py-2.5 text-sm text-slate-100 focus:border-amber-200 focus:outline-none [caret-color:auto] [cursor:text]';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (items.length === 0) {
      setError('Please add at least one product first.');
      return;
    }
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!phone.trim() || phone.trim().length < 4) {
      setError('Please enter a valid phone number.');
      return;
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Please enter a valid email or leave blank.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/rfq', {
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        customer_email: email.trim() || undefined,
        customer_company: company.trim() || undefined,
        customer_comments: comments.trim() || undefined,
        source,
        items: items.map((it) => ({
          product_id: it.product_id,
          product_name: it.product_name,
          category_name: it.category_name,
          image_url: it.image_url,
          quantity: Math.max(1, Math.floor(it.quantity || 1)),
        })),
      });
      const ref = res.data?.rfq_number || '';
      setSuccessRef(ref);
      onSubmitted?.(ref);
      setName('');
      setCompany('');
      setPhone('');
      setEmail('');
      setComments('');
    } catch (err: any) {
      setError(formatApiError(err, 'Failed to submit. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10500] flex items-start justify-center p-4 bg-black/75 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-[#141416] text-slate-100 rounded-2xl shadow-2xl border border-amber-200/20 w-full max-w-xl my-8 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 w-10 h-10 rounded-full border border-amber-200/30 bg-black/40 text-amber-200 hover:border-amber-200 transition-colors flex items-center justify-center"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {successRef ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/15 border border-emerald-500/50 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-300" />
            </div>
            <h3 className="text-2xl font-semibold text-amber-200 mb-2">Request received</h3>
            <p className="text-slate-300 text-sm mb-4 max-w-md mx-auto">
              Thanks! Our team will reach out shortly on WhatsApp / email with pricing.
            </p>
            {successRef && (
              <p className="text-[11px] tracking-widest uppercase text-amber-200">
                Ref: {successRef}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-6 px-6 py-3 bg-amber-200 text-black font-semibold tracking-wider text-xs uppercase rounded-md hover:bg-amber-100 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 sm:p-8">
            <div className="flex items-start gap-3 mb-2">
              <MessageSquare className="w-5 h-5 text-amber-300 mt-0.5" />
              <h3 className="text-2xl font-semibold text-amber-200" id="rfqTitle">
                Request a Quote
              </h3>
            </div>
            <p className="text-slate-400 text-sm mb-5 leading-relaxed">
              Tell us how to reach you and our team will share competitive pricing on WhatsApp /
              email — usually within a few hours.
            </p>

            {items.length > 0 && (
              <div className="bg-amber-200/5 border border-amber-200/20 rounded-lg p-3 mb-5 max-h-40 overflow-y-auto">
                <p className="text-[10.5px] tracking-widest uppercase text-amber-200 font-semibold mb-2">
                  Your selected items
                </p>
                <ul className="space-y-1">
                  {items.map((it, idx) => (
                    <li
                      key={`${it.product_id || it.product_name}-${idx}`}
                      className="flex justify-between text-sm text-slate-200 border-b border-amber-200/10 last:border-0 py-1"
                    >
                      <span className="flex-1 pr-2 truncate">{it.product_name}</span>
                      <span className="text-amber-200 tabular-nums">×{it.quantity}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10.5px] uppercase tracking-widest text-slate-300 mb-1.5">
                  Full name <span className="text-amber-300">*</span>
                </label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={200}
                  autoComplete="name"
                  autoFocus
                  className={inputBase}
                />
              </div>
              <div>
                <label className="block text-[10.5px] uppercase tracking-widest text-slate-300 mb-1.5">
                  Company name
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  maxLength={200}
                  autoComplete="organization"
                  className={inputBase}
                />
              </div>
              <div>
                <label className="block text-[10.5px] uppercase tracking-widest text-slate-300 mb-1.5">
                  Phone (WhatsApp) <span className="text-amber-300">*</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  maxLength={40}
                  autoComplete="tel"
                  inputMode="tel"
                  className={inputBase}
                />
              </div>
              <div>
                <label className="block text-[10.5px] uppercase tracking-widest text-slate-300 mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={320}
                  autoComplete="email"
                  className={inputBase}
                />
              </div>
            </div>

            <label className="block mt-3 text-[10.5px] uppercase tracking-widest text-slate-300 mb-1.5">
              Comments <span className="lowercase tracking-normal text-slate-500">(optional)</span>
            </label>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Quantity needs, target price, delivery timeline…"
              className={`${inputBase} resize-y`}
            />

            {error && (
              <p className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-amber-200 text-black font-semibold tracking-widest uppercase text-xs py-3.5 rounded-md hover:bg-amber-100 transition-colors disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'Submit Quote Request'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full border border-amber-200/30 text-slate-200 tracking-widest uppercase text-xs py-3 rounded-md hover:border-amber-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
