'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import DamagedReturns from '@/components/admin/DamagedReturns';

export default function DamagedInventoryPage() {
  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/inventory"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0F172A] hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to inventory
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-[#0F172A] tracking-tight">Damaged returns</h1>
        <p className="mt-1 text-xs text-[#64748B]">
          Warehouse damage and customer returns. Select warehouse rows to draft a supplier credit memo.
        </p>
      </div>
      <DamagedReturns />
    </div>
  );
}
