'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

export interface ProductOption {
  id: string;
  name: string;
  price?: number;
  cost_price?: number;
  product_id?: string;
  sku?: string;
  stock_quantity?: number;
  category_name?: string;
  category_slug?: string;
}

interface Props {
  products: ProductOption[];
  value: string;
  displayName?: string;
  onSelect: (product: ProductOption) => void;
  onBarcodeScan?: (code: string) => void;
  placeholder?: string;
  showPrice?: boolean;
}

export default function SearchableProductDropdown({
  products,
  value,
  displayName,
  onSelect,
  onBarcodeScan,
  placeholder = 'Search product or scan barcode…',
  showPrice = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = products.find((p) => p.id === value);
  const label = displayName || selected?.name;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          (p.product_id && p.product_id.toLowerCase().includes(q)) ||
          p.id.toLowerCase().includes(q),
      )
    : products;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = search.trim();
      if (!code) return;
      const exact = products.find(
        (p) =>
          p.sku === code ||
          p.product_id === code ||
          p.id === code ||
          p.name.toLowerCase() === code.toLowerCase(),
      );
      if (exact) {
        onSelect(exact);
        setSearch('');
        setOpen(false);
        return;
      }
      if (onBarcodeScan) {
        onBarcodeScan(code);
        setSearch('');
        setOpen(false);
        return;
      }
      if (filtered.length === 1) {
        onSelect(filtered[0]);
        setSearch('');
        setOpen(false);
      }
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
    }
  };

  const openDropdown = () => {
    setOpen(true);
    setSearch('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      {label && !open ? (
        <div
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm cursor-pointer hover:border-gray-400 bg-white flex items-center justify-between min-h-[30px]"
          onClick={openDropdown}
        >
          <span className="truncate">{label}</span>
          <svg className="w-3 h-3 text-gray-400 shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:border-[#0F9F8F] focus:ring-1 focus:ring-[#0F9F8F] outline-none"
          autoComplete="off"
        />
      )}
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          <Link
            href="/admin/products/new"
            className="flex items-center gap-2 px-3 py-2 text-sm text-[#0F9F8F] font-medium hover:bg-teal-50 border-b border-gray-100 sticky top-0 bg-white"
            onClick={() => setOpen(false)}
          >
            + Add a product
          </Link>
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-sm text-gray-400 text-center">No products found</div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onSelect(p);
                  setSearch('');
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2 ${
                  p.id === value ? 'bg-[#F1F5F9] text-[#0F172A] font-medium' : 'text-[#0F172A]'
                }${p.stock_quantity != null && p.stock_quantity <= 0 ? ' opacity-50' : ''}`}
              >
                <span className="truncate">
                  {p.name}
                  {p.product_id ? <span className="text-teal-600 text-xs ml-1 font-semibold">#{p.product_id}</span> : ''}
                  {p.sku ? <span className="text-gray-400 text-xs ml-1">({p.sku})</span> : ''}
                </span>
                <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">
                  {showPrice && p.price != null ? `$${Number(p.price).toFixed(2)}` : ''}
                  {p.stock_quantity != null && p.stock_quantity <= 0 ? ' · Out of stock' : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
