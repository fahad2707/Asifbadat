'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Barcode, Search } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import { HighlightMatch } from '@/lib/highlightMatch';

export type DeskHit = {
  type: string;
  title: string;
  subtitle: string;
  href: string;
  exact: boolean;
};

type SearchResponse = { query: string; hits: DeskHit[]; barcode: DeskHit | null };

export function AdminDeskSearch({
  value,
  onChange,
  focused,
  onFocus,
  compact,
  onNavigate,
}: {
  value: string;
  onChange: (next: string) => void;
  focused: boolean;
  onFocus: () => void;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [hits, setHits] = useState<DeskHit[]>([]);
  const [searching, setSearching] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const boxNode = useRef<{ el: HTMLDivElement | null }>({ el: null });
  const [panelBox, setPanelBox] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await adminApi.get<SearchResponse>('/desk/search', { params: { q } });
        setHits(data.hits || []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(t);
  }, [value]);

  const go = (href: string) => {
    router.push(href);
    onChange('');
    setHits([]);
    onNavigate?.();
  };

  const submitScan = async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    try {
      const { data } = await adminApi.get<SearchResponse>('/desk/search', { params: { q } });
      const target = data.barcode || data.hits?.[0];
      if (target?.href) go(target.href);
      else onChange(q);
    } catch {
      onChange(q);
    }
  };

  const showPanel = focused && (value.trim() || hits.length > 0 || searching);

  useEffect(() => {
    if (!showPanel) {
      setPanelBox(null);
      return;
    }
    const place = () => {
      const el = boxNode.current.el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPanelBox({ top: r.bottom + 8, left: r.left, width: r.width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [showPanel, value, hits.length, searching]);

  const setRoot = (node: HTMLDivElement | null) => {
    boxNode.current.el = node;
  };

  const panel = showPanel && panelBox && typeof document !== 'undefined' ? createPortal(
    <div
      data-desk-search-panel="1"
      className={`fixed z-[80] p-2 ${compact ? 'max-h-[280px]' : 'max-h-[360px]'} overflow-y-auto space-y-1 ${adminUi.overlay}`}
      style={{ top: panelBox.top, left: panelBox.left, width: panelBox.width }}
    >
      {searching ? (
        <div className={`p-4 text-center ${adminUi.meta}`}>Searching…</div>
      ) : hits.length > 0 ? (
        hits.map((hit) => (
          <button
            key={`${hit.type}-${hit.href}`}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => go(hit.href)}
            className="w-full p-2 hover:bg-[#F4F5F8] rounded-md flex items-center justify-between gap-3 text-left"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#1A1A1A] truncate">
                <HighlightMatch text={hit.title} query={value} />
              </p>
              {hit.subtitle ? (
                <p className={`${adminUi.helper} truncate`}>
                  <HighlightMatch text={hit.subtitle} query={value} />
                </p>
              ) : null}
            </div>
            <span className={adminUi.badge}>{hit.type}</span>
          </button>
        ))
      ) : value.trim() ? (
        <p className={`text-center py-4 ${adminUi.helper}`}>No matches for “{value.trim()}”</p>
      ) : null}
    </div>,
    document.body
  ) : null;

  return (
    <div ref={setRoot} data-desk-search="1" className="relative z-40 flex-1 min-w-0">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8D9096]" />
        <input
          type="text"
          placeholder="Search customers, invoices, RFQs, shipments, TRX, SKU, product ID…"
          value={value}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]?.href) {
              e.preventDefault();
              go(hits[0].href);
            }
          }}
          className={`${adminUi.input} pl-9 pr-10`}
          aria-label="Search the POS"
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#6B6C72] hover:text-[#1A1A1A] hover:bg-[#E8E9EB]"
          aria-label="Scan barcode"
          title="Scan a POS barcode"
          onClick={() => scanRef.current?.focus()}
        >
          <Barcode className="w-4 h-4" />
        </button>
        <input
          ref={scanRef}
          type="text"
          inputMode="none"
          aria-label="Barcode scanner"
          className="sr-only"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const el = e.currentTarget;
              void submitScan(el.value);
              el.value = '';
            }
          }}
        />
      </div>
      {panel}
    </div>
  );
}
