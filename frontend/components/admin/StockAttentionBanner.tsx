'use client';

import { AlertTriangle } from 'lucide-react';

interface StockAttentionBannerProps {
  outOfStockCount: number;
  lowStockCount: number;
  onSeeOutOfStock: () => void;
  onSeeLowStock: () => void;
}

export function StockAttentionBanner({
  outOfStockCount,
  lowStockCount,
  onSeeOutOfStock,
  onSeeLowStock,
}: StockAttentionBannerProps) {
  if (outOfStockCount <= 0 && lowStockCount <= 0) return null;

  return (
    <div
      role="alert"
      className="mb-6 rounded-lg border-2 border-[#C81916] bg-[#FDECEC] px-5 sm:px-6 py-5 shadow-[0_0_0_4px_rgba(200,25,22,0.12)]"
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 flex h-14 w-14 items-center justify-center rounded-full bg-[#C81916] text-white">
          <AlertTriangle className="h-8 w-8" strokeWidth={2.25} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-2xl sm:text-[28px] font-semibold leading-tight text-[#8A100E] tracking-tight">
            Some items need your attention
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
            {outOfStockCount > 0 && (
              <button
                type="button"
                onClick={onSeeOutOfStock}
                className="inline-flex items-center justify-between gap-3 rounded-md border border-[#C81916] bg-white px-4 py-3 text-left hover:bg-[#FDECEC]"
              >
                <span className="text-sm font-medium text-[#8A100E]">
                  {outOfStockCount} item{outOfStockCount !== 1 ? 's are' : ' is'} out of stock
                </span>
                <span className="text-sm font-semibold text-[#0077C5] whitespace-nowrap">See all</span>
              </button>
            )}
            {lowStockCount > 0 && (
              <button
                type="button"
                onClick={onSeeLowStock}
                className="inline-flex items-center justify-between gap-3 rounded-md border border-[#D97008] bg-white px-4 py-3 text-left hover:bg-[#FFF4E5]"
              >
                <span className="text-sm font-medium text-[#8A4500]">
                  {lowStockCount} item{lowStockCount !== 1 ? 's are' : ' is'} running low on stock
                </span>
                <span className="text-sm font-semibold text-[#0077C5] whitespace-nowrap">See all</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
