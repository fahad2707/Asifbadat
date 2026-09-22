'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function ProductsSectionLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isInactive = pathname?.includes('/admin/products/inactive');

  const tabClass = (active: boolean) =>
    `inline-flex items-center rounded-xl px-4 py-2.5 text-xs font-bold transition-all border ${
      active
        ? 'bg-gradient-to-tr from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 border-white/10 text-white shadow-sm'
        : 'bg-slate-905/60 border-white/10 text-slate-400 hover:bg-slate-900 hover:text-white'
    }`;

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2.5 border-b border-white/5 pb-4" aria-label="Product lists">
        <Link href="/admin/products/active" className={tabClass(!isInactive)}>
          Active Products Index
        </Link>
        <Link href="/admin/products/inactive" className={tabClass(isInactive)}>
          Inactive / Archived Products
        </Link>
      </nav>
      {children}
    </div>
  );
}
