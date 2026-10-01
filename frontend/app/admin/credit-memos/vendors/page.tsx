'use client';

import { Suspense } from 'react';
import CreditMemosApp from '@/components/admin/CreditMemosApp';

export default function VendorCreditMemosPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-2 border-black border-t-transparent" /></div>}>
      <CreditMemosApp lockedType="VENDOR" />
    </Suspense>
  );
}
