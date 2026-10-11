'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Printer, Search, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { formatApiError } from '@/lib/format-api-error';
import { openPdfFromResponse } from '@/lib/download-pdf';
import toast from 'react-hot-toast';

type ProductRow = {
  id: string;
  name: string;
  sku?: string | null;
  product_id?: string | null;
};

type LabelRow = ProductRow & { quantity: number };

const MAX_QTY = 50;

function ProductLabelsInner() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ProductRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [rows, setRows] = useState<LabelRow[]>([]);
  const [printing, setPrinting] = useState(false);
  const [generatingSkuFor, setGeneratingSkuFor] = useState<string | null>(null);

  const totalLabels = useMemo(
    () => rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0),
    [rows]
  );

  useEffect(() => {
    const idsParam = searchParams?.get('ids') || '';
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded: LabelRow[] = [];
        for (const id of ids.slice(0, 50)) {
          const { data } = await adminApi.get(`/products/${id}`);
          if (!data?.id) continue;
          loaded.push({
            id: String(data.id),
            name: data.name || 'Unnamed product',
            sku: data.sku,
            product_id: data.product_id,
            quantity: 1,
          });
        }
        if (!cancelled && loaded.length) {
          setRows((prev) => {
            const map = new Map(prev.map((r) => [r.id, r]));
            for (const r of loaded) {
              if (!map.has(r.id)) map.set(r.id, r);
            }
            return Array.from(map.values());
          });
        }
      } catch {
        if (!cancelled) toast.error('Could not load selected products');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const runSearch = async () => {
    const q = search.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const { data } = await adminApi.get('/products', {
        params: { search: q, limit: 30, visibility: 'all' },
      });
      setResults(
        (data.products || []).map((p: ProductRow & { _id?: string }) => ({
          id: String(p.id || p._id),
          name: p.name,
          sku: p.sku,
          product_id: p.product_id,
        }))
      );
    } catch (err: unknown) {
      toast.error(formatApiError(err, 'Search failed'));
    } finally {
      setSearching(false);
    }
  };

  const addProduct = (p: ProductRow) => {
    setRows((prev) => {
      if (prev.some((r) => r.id === p.id)) return prev;
      return [...prev, { ...p, quantity: 1 }];
    });
  };

  const generateInternalSku = async (row: LabelRow) => {
    setGeneratingSkuFor(row.id);
    try {
      const { data } = await adminApi.post(`/products/${row.id}/generate-internal-sku`);
      const sku = String(data?.sku || '').trim();
      if (!sku) {
        toast.error('Server did not return a SKU');
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, sku, product_id: data?.product_id ? String(data.product_id) : r.product_id }
            : r
        )
      );
      toast.success(data?.created ? `Internal SKU assigned: ${sku}` : `SKU preserved: ${sku}`);
    } catch (err: unknown) {
      toast.error(formatApiError(err, 'Failed to generate internal SKU'));
    } finally {
      setGeneratingSkuFor(null);
    }
  };

  const printLabels = async () => {
    if (!rows.length) {
      toast.error('Add at least one product');
      return;
    }
    const missing = rows.filter((r) => !String(r.sku || '').trim());
    if (missing.length) {
      toast.error(`${missing.length} product(s) still need a SKU before printing`);
      return;
    }
    for (const r of rows) {
      const q = Number(r.quantity);
      if (!Number.isInteger(q) || q < 1 || q > MAX_QTY) {
        toast.error(`Quantity for "${r.name}" must be an integer 1–${MAX_QTY}`);
        return;
      }
    }
    setPrinting(true);
    try {
      const res = await adminApi.post(
        '/products/labels/pdf',
        {
          items: rows.map((r) => ({ product_id: r.id, quantity: Number(r.quantity) })),
        },
        { responseType: 'arraybuffer' }
      );
      const ok = await openPdfFromResponse(res.data, res.headers?.['content-type']);
      if (ok) toast.success(`Opened ${totalLabels} label(s) for printing`);
    } catch (err: unknown) {
      let message = formatApiError(err, 'Failed to generate labels');
      try {
        const ax = err as { response?: { data?: ArrayBuffer | string } };
        const data = ax.response?.data;
        if (data instanceof ArrayBuffer) {
          const text = new TextDecoder().decode(data);
          const parsed = JSON.parse(text) as { error?: string };
          if (parsed?.error) message = parsed.error;
        }
      } catch {
        /* keep formatApiError message */
      }
      toast.error(message);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-[28px] font-normal text-[#1A1A1A] tracking-tight">Print barcode labels</h1>
        <p className="text-sm text-[#6B6C72] mt-2 max-w-2xl">
          2×1&quot; warehouse labels with a Code 128 barcode of each product&apos;s stored SKU.
          Manufacturer/vendor SKUs are never replaced. Products without a SKU can use Generate internal SKU
          ({'EDI-<product ID>'}) first.
        </p>
      </div>

      <div className="bg-white border border-[#E3E5E8] rounded-md p-4 space-y-3">
        <label className="block text-xs font-medium text-[#6B6C72]">Find products</label>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8D9096]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runSearch();
                }
              }}
              placeholder="Search name, SKU, or product ID…"
              className="w-full pl-9 pr-3 py-2 border border-[#C7C7C7] rounded-md text-sm text-[#1A1A1A]"
            />
          </div>
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={searching}
            className="inline-flex items-center px-4 py-2 rounded-full bg-black text-white text-sm font-medium hover:bg-[#2C2C2C] disabled:opacity-50"
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
        {results.length > 0 && (
          <ul className="divide-y divide-[#E3E5E8] border border-[#E3E5E8] rounded-md max-h-56 overflow-y-auto">
            {results.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-[#1A1A1A] truncate">{p.name}</div>
                  <div className="text-xs text-[#6B6C72] font-mono truncate">
                    SKU: {p.sku?.trim() || '—'} · ID: {p.product_id || '—'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => addProduct(p)}
                  className="shrink-0 px-3 py-1.5 rounded-full border border-[#C7C7C7] text-xs font-medium hover:bg-[#F4F5F8]"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white border border-[#E3E5E8] rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E3E5E8] flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-[#1A1A1A]">Selected for print</h2>
            <p className="text-xs text-[#6B6C72]">{rows.length} product(s) · {totalLabels} label(s)</p>
          </div>
          <button
            type="button"
            disabled={!rows.length || printing}
            onClick={() => void printLabels()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black text-white text-sm font-medium hover:bg-[#2C2C2C] disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            {printing ? 'Generating…' : 'Print labels'}
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-[#6B6C72]">No products selected yet. Search above or open this page from a product selection.</p>
        ) : (
          <ul className="divide-y divide-[#E3E5E8]">
            {rows.map((r) => {
              const hasSku = Boolean(String(r.sku || '').trim());
              return (
                <li key={r.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[#1A1A1A] truncate">{r.name}</div>
                    <div className="text-xs text-[#6B6C72] font-mono mt-0.5">
                      SKU: {hasSku ? r.sku : '—'} · Product ID: {r.product_id || '—'}
                    </div>
                    {hasSku ? (
                      <p className="text-[11px] text-[#6B6C72] mt-1">
                        Existing manufacturer/vendor SKU is preserved and will be encoded as Code 128.
                      </p>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={generatingSkuFor === r.id}
                          onClick={() => void generateInternalSku(r)}
                          className="px-3 py-1.5 rounded-full bg-[#F4F5F8] text-xs font-medium text-[#1A1A1A] hover:bg-[#E8E9EB] disabled:opacity-50"
                        >
                          {generatingSkuFor === r.id ? 'Generating…' : 'Generate internal SKU'}
                        </button>
                        <span className="text-[11px] text-[#8D9096]">Required before printing</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="text-xs text-[#6B6C72]">Copies</label>
                    <input
                      type="number"
                      min={1}
                      max={MAX_QTY}
                      value={r.quantity}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setRows((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, quantity: v } : x))
                        );
                      }}
                      className="w-20 border border-[#C7C7C7] rounded-md px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
                      className="p-2 rounded-full text-[#6B6C72] hover:bg-[#F4F5F8]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-[#8D9096]">
        <Link href="/admin/products/active" className="underline hover:text-[#1A1A1A]">
          Back to products
        </Link>
        {' · '}
        Labels are PDF pages sized 2×1 inches. Use your printer&apos;s actual size / no-scale settings.
        Physical scanner verification is a separate check.
      </p>
    </div>
  );
}

export default function ProductLabelsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-[#6B6C72] p-6">Loading label printer…</div>}>
      <ProductLabelsInner />
    </Suspense>
  );
}
