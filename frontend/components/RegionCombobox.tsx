'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { STATE_PROVINCE_OPTIONS } from '@/lib/regions';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Defaults to US states + Canadian provinces. */
  options?: string[];
  placeholder?: string;
  className?: string;
  listClassName?: string;
  required?: boolean;
  id?: string;
  name?: string;
  disabled?: boolean;
  /** Keep a typed value that is not in the list (default true). */
  allowCustom?: boolean;
  emptyHint?: string;
}

/**
 * Searchable state/province (or city) field: filter the list, pick a suggestion,
 * or keep a manually typed value.
 */
export default function RegionCombobox({
  value,
  onChange,
  options = STATE_PROVINCE_OPTIONS,
  placeholder = 'Search or type…',
  className = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black',
  listClassName = 'absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white border border-[#E3E5E8] rounded-lg shadow-lg text-sm text-[#1A1A1A]',
  required,
  id,
  name,
  disabled,
  allowCustom = true,
  emptyHint = 'No matches — keep typing to enter manually',
}: Props) {
  const autoId = useId();
  const inputId = id || autoId;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || '');

  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value || '');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const exactMatch = options.some((o) => o.toLowerCase() === query.trim().toLowerCase());
  const showCustomRow = allowCustom && query.trim() && !exactMatch;

  const commit = (next: string) => {
    const trimmed = next.trim();
    onChange(trimmed);
    setQuery(trimmed);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={inputId}
        name={name}
        type="text"
        autoComplete="address-level1"
        disabled={disabled}
        required={required}
        value={query}
        placeholder={placeholder}
        className={className}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          if (allowCustom) onChange(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered.length === 1) commit(filtered[0]);
            else if (allowCustom) commit(query);
            else if (filtered[0]) commit(filtered[0]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery(value || '');
          }
        }}
        onBlur={() => {
          // Defer so option click can commit first.
          window.setTimeout(() => {
            if (!wrapRef.current?.contains(document.activeElement)) {
              if (allowCustom) onChange(query.trim());
              else {
                const match = options.find((o) => o.toLowerCase() === query.trim().toLowerCase());
                if (match) onChange(match);
                else setQuery(value || '');
              }
            }
          }, 0);
        }}
      />
      {open && (
        <div role="listbox" className={listClassName}>
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              role="option"
              aria-selected={opt === value}
              className={`w-full text-left px-3 py-2 hover:bg-black/5 ${
                opt === value ? 'bg-black/5 font-medium' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(opt);
              }}
            >
              {opt}
            </button>
          ))}
          {showCustomRow && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 border-t border-current/15 hover:bg-black/5"
              onMouseDown={(e) => {
                e.preventDefault();
                commit(query);
              }}
            >
              Use “{query.trim()}”
            </button>
          )}
          {filtered.length === 0 && !showCustomRow && (
            <div className="px-3 py-2 opacity-70">{emptyHint}</div>
          )}
        </div>
      )}
    </div>
  );
}
