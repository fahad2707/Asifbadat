'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function ProductsSectionLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isInactive = pathname?.includes('/admin/products/inactive');

  const tabClass = (active: boolean) =>
    `inline-flex items-center rounded-md px-3 py-2 text-sm font-medium border ${
      active
        ? 'bg-[#0F9F8F] border-transparent text-white'
        : 'bg-white border-[#CBD5E1] text-[#334155] hover:bg-[#F1F5F9]'
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
