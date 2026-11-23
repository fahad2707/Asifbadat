'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Users,
  ClipboardList,
  Landmark,
  ChevronDown,
  ShoppingCart,
  Menu,
  X,
  HelpCircle,
  FileText,
  Truck,
  RotateCcw,
  Package,
  FolderTree,
  Percent,
  CreditCard,
  Settings,
  Plus,
  LayoutDashboard,
  UserPlus,
  Boxes,
  BarChart3,
  Database,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { adminCreateTagClass, adminNavItemClass, adminNavUtilityClass, adminUi } from '@/lib/admin-ui';
import { AdminDeskSearch } from '@/components/admin/AdminDeskSearch';
import { AdminNoticeCenter, InboxBadge, useDeskInbox } from '@/components/admin/AdminNotices';

function pathMatches(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  if (href === '/admin/dashboard') return pathname === '/admin/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function catalogTabIs(searchParams: { get: (key: string) => string | null }, tab: 'categories' | 'tax' | 'bank' | 'payment'): boolean {
  const t = searchParams.get('tab');
  if (tab === 'categories') return t === 'categories' || t === 'subcategories' || !t;
  return t === tab;
}

function navGroupForRoute(
  pathname: string | null | undefined,
  searchParams: { get: (key: string) => string | null },
  creatingInvoice: boolean,
  receivingPayment: boolean,
  countingStock: boolean
): string {
  if (!pathname) return 'sales';
  if (creatingInvoice || pathname.startsWith('/admin/returns')) return 'inventory';
  if (receivingPayment) return 'sales';
  if (countingStock || pathname.startsWith('/admin/inventory')) return 'inventory';
  if (pathname.startsWith('/admin/customers') || pathname.startsWith('/admin/invoices') || pathname.startsWith('/admin/payments') || pathname.startsWith('/admin/rfq') || pathname.startsWith('/admin/orders') || pathname.startsWith('/admin/website-signups') || pathname.startsWith('/admin/shipments') || pathname.includes('/admin/credit-memos/customers') || pathname === '/admin/credit-memos') {
    return 'sales';
  }
  if (pathname.startsWith('/admin/products')) return 'catalog';
  if (pathname.startsWith('/admin/catalog')) {
    if (catalogTabIs(searchParams, 'tax') || catalogTabIs(searchParams, 'bank') || catalogTabIs(searchParams, 'payment')) return 'banking';
    return 'catalog';
  }
  if (pathname.startsWith('/admin/vendors') || pathname.startsWith('/admin/purchase-orders') || pathname.startsWith('/admin/expenses') || pathname.includes('/admin/credit-memos/vendors')) {
    return 'purchases';
  }
  if (pathname.startsWith('/admin/receipts')) return 'banking';
  if (pathname.startsWith('/admin/analytics')) return 'reports';
  return 'sales';
}

function createHrefIsActive(pathname: string | null | undefined, searchParams: { get: (key: string) => string | null }, href: string): boolean {
  if (!pathname) return false;
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  if (path === '/admin/products/new') {
    return pathname === '/admin/products/new' || pathname.startsWith('/admin/products/new/');
  }
  if (pathname !== path) return false;
  if (![...params.keys()].length) return false;
  return [...params.entries()].every(([key, value]) => searchParams.get(key) === value);
}

type NavLinkDef = {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  badge?: number;
};

function SidebarLink({ href, label, icon: Icon, active, badge }: NavLinkDef) {
  return (
    <Link href={href} className={adminNavItemClass(active)}>
      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#1A1A1A]' : 'text-[#8D9096]'}`} />
      <span className="truncate">{label}</span>
      <InboxBadge count={badge || 0} />
    </Link>
  );
}

function headerContextLabel(pathname: string | null | undefined, creatingInvoice = false, catalogTab = '', receivingPayment = false, adjustingStock = false, countingStock = false): string {
  if (!pathname) return 'Express Distributors';
  if (pathname === '/admin/dashboard' || pathname.startsWith('/admin/dashboard/')) return 'Overview';
  if (pathname === '/admin/payments' || pathname.startsWith('/admin/payments/')) return 'Receive payments';
  if ((pathname === '/admin/invoices' || pathname.startsWith('/admin/invoices/')) && receivingPayment) return 'Receive payments';
  if ((pathname === '/admin/invoices' || pathname.startsWith('/admin/invoices/')) && creatingInvoice) return 'Offline sales';
  if (pathname === '/admin/invoices' || pathname.startsWith('/admin/invoices/')) return 'Invoices & quotations';
  if (pathname === '/admin/customers' || pathname.startsWith('/admin/customers/')) return 'Customers';
  if (pathname === '/admin/website-signups' || pathname.startsWith('/admin/website-signups/')) return 'Website signups';
  if (pathname === '/admin/orders' || pathname.startsWith('/admin/orders/')) return 'Online sales';
  if (pathname === '/admin/products/new') return 'Product';
  if (pathname === '/admin/products' || pathname.startsWith('/admin/products/')) return 'Products';
  if (pathname === '/admin/receipts/paid' || pathname.startsWith('/admin/receipts/paid')) return 'Money paid';
  if (pathname === '/admin/receipts' || pathname.startsWith('/admin/receipts/')) return 'Money received';
  if (pathname === '/admin/inventory/damaged') return 'Damaged returns';
  if ((pathname === '/admin/inventory' || pathname.startsWith('/admin/inventory/')) && countingStock) return 'Physical count';
  if ((pathname === '/admin/inventory' || pathname.startsWith('/admin/inventory/')) && adjustingStock) return 'Stock adjustments';
  if (pathname === '/admin/inventory' || pathname.startsWith('/admin/inventory/')) return 'Inventory';
  if (pathname === '/admin/purchase-orders' || pathname.startsWith('/admin/purchase-orders/')) return 'Purchase order';
  if (pathname === '/admin/vendors' || pathname.startsWith('/admin/vendors/')) return 'Vendors / suppliers';
  if (pathname === '/admin/expenses' || pathname.startsWith('/admin/expenses/')) return 'Pay bill';
  if (pathname.includes('/admin/credit-memos/vendors')) return 'Credit memo for vendors';
  if (pathname.includes('/admin/credit-memos/customers') || pathname === '/admin/credit-memos' || pathname.startsWith('/admin/credit-memos/')) return 'Credit memo for customers';
  if (pathname === '/admin/analytics' || pathname.startsWith('/admin/analytics/')) return 'Profit & loss';
  if (pathname === '/admin/rfq' || pathname.startsWith('/admin/rfq/')) return 'RFQ';
  if (pathname === '/admin/shipments' || pathname.startsWith('/admin/shipments/')) return 'Shipments';
  if (pathname === '/admin/settings' || pathname.startsWith('/admin/settings/')) return 'Settings';
  if (pathname === '/admin/catalog' || pathname.startsWith('/admin/catalog/')) {
    if (catalogTab === 'tax') return 'Tax types';
    if (catalogTab === 'bank') return 'Bank accounts';
    if (catalogTab === 'payment') return 'Payment methods';
    return 'Categories';
  }
  if (pathname === '/admin/data' || pathname.startsWith('/admin/data/')) return 'More';
  return 'Express Distributors';
}

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const creatingInvoice = searchParams.get('create') === 'invoice';
  const receivingPayment = searchParams.get('receive') === '1';
  const adjustingStock = searchParams.get('adjust') === '1';
  const countingStock = searchParams.get('count') === '1';
  const routeGroup = navGroupForRoute(pathname, searchParams, creatingInvoice, receivingPayment, countingStock);
  const [hasToken, setHasToken] = useState<boolean>(true);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({
    [routeGroup]: true,
  }));

  // Search & Command Palette States
  const [globalSearch, setGlobalSearch] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const inbox = useDeskInbox(pathname !== '/admin/login');

  const searchRef = useRef<HTMLDivElement>(null);
  const closeMobileNav = () => setMobileNavOpen(false);

  // Hotkeys: Ctrl + K or Cmd + K toggles palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
        setCreateOpen(false);
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setSearchFocused(false);
        setMobileNavOpen(false);
        setCreateOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
    setCreateOpen(false);
  }, [pathname]);

  useEffect(() => {
    setOpenGroups({ [routeGroup]: true });
  }, [routeGroup]);

  // Handle outside click for search dropdown
  useEffect(() => {
    const clickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-desk-search-panel]')) return;
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', clickOutside);
    return () => document.removeEventListener('mousedown', clickOutside);
  }, []);

  // Auth checking hooks
  useEffect(() => {
    if (pathname === '/admin/login') {
      setHasToken(true);
      return;
    }
    const check = () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('adminToken') : null;
      setHasToken(!!token);
      if (!token) {
        const target = `/admin/login?next=${encodeURIComponent(pathname || '/admin')}`;
        router.replace(target);
      }
    };
    check();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'adminToken') check();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [pathname, router]);

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminLoginAt');
    router.push('/admin/login');
  };

  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  if (!hasToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-400 text-sm">
        Redirecting to login…
      </div>
    );
  }

  const toggleGroup = (slug: string) => {
    setOpenGroups((prev) => (prev[slug] ? {} : { [slug]: true }));
  };

  const go = (href: string) => {
    router.push(href);
    setMobileNavOpen(false);
    setPaletteOpen(false);
  };

  const createActions = [
    { label: 'Invoice', short: 'c i', icon: ShoppingCart, href: '/admin/invoices?create=invoice' },
    { label: 'Quotation', short: 'c q', icon: FileText, href: '/admin/invoices?create=quotation' },
    { label: 'Customer', short: 'c c', icon: Users, href: '/admin/customers?create=1' },
    { label: 'Vendor', short: 'c v', icon: Truck, href: '/admin/vendors?create=1' },
    { label: 'Purchase order', short: 'c p', icon: ClipboardList, href: '/admin/purchase-orders?create=1' },
    { label: 'Credit memo (customer)', short: 'c m', icon: RotateCcw, href: '/admin/credit-memos/customers?new=1' },
    { label: 'Credit memo (vendor)', short: 'c n', icon: RotateCcw, href: '/admin/credit-memos/vendors?new=1' },
    { label: 'Bank transaction', short: 'c b', icon: Landmark, href: '/admin/receipts?create=1' },
    { label: 'Product', short: 'c r', icon: Package, href: '/admin/products/new' },
    { label: 'Category', short: 'c g', icon: FolderTree, href: '/admin/catalog?tab=categories&create=1' },
    { label: 'Tax type', short: 'c t', icon: Percent, href: '/admin/catalog?tab=tax&create=1' },
    { label: 'Bank account', short: 'c a', icon: Landmark, href: '/admin/catalog?tab=bank&create=1' },
    { label: 'Payment method', short: 'c y', icon: CreditCard, href: '/admin/catalog?tab=payment&create=1' },
  ];
  const paletteActions = createActions.map((a) => ({ ...a, action: () => go(a.href) }));

  const navGroups: { slug: string; label: string; items: NavLinkDef[] }[] = [
    {
      slug: 'sales',
      label: 'Sales',
      items: [
        { href: '/admin/customers', label: 'Customers', icon: Users, active: pathMatches(pathname, '/admin/customers') },
        { href: '/admin/invoices', label: 'Invoices & quotations', icon: FileText, active: pathMatches(pathname, '/admin/invoices') && !creatingInvoice && !receivingPayment },
        { href: '/admin/rfq', label: 'RFQ', icon: ClipboardList, active: pathMatches(pathname, '/admin/rfq'), badge: inbox.rfq },
        { href: '/admin/orders', label: 'Online sales', icon: ShoppingCart, active: pathMatches(pathname, '/admin/orders'), badge: inbox.online_orders },
        { href: '/admin/website-signups', label: 'Website signups', icon: UserPlus, active: pathMatches(pathname, '/admin/website-signups'), badge: inbox.website_signups },
        { href: '/admin/payments', label: 'Receive payments', icon: CreditCard, active: pathMatches(pathname, '/admin/payments') },
        { href: '/admin/credit-memos/customers', label: 'Customer credit memos', icon: RotateCcw, active: !!pathname?.includes('/admin/credit-memos/customers') || pathname === '/admin/credit-memos' },
        { href: '/admin/shipments', label: 'Shipments', icon: Truck, active: pathMatches(pathname, '/admin/shipments') },
      ],
    },
    {
      slug: 'catalog',
      label: 'Catalog',
      items: [
        { href: '/admin/products', label: 'Products', icon: Package, active: pathMatches(pathname, '/admin/products') && pathname !== '/admin/products/new' },
        { href: '/admin/catalog?tab=categories', label: 'Categories', icon: FolderTree, active: pathMatches(pathname, '/admin/catalog') && catalogTabIs(searchParams, 'categories') },
      ],
    },
    {
      slug: 'purchases',
      label: 'Purchases',
      items: [
        { href: '/admin/vendors', label: 'Vendors', icon: Truck, active: pathMatches(pathname, '/admin/vendors') },
        { href: '/admin/purchase-orders', label: 'Purchase orders', icon: ClipboardList, active: pathMatches(pathname, '/admin/purchase-orders') },
        { href: '/admin/credit-memos/vendors', label: 'Vendor credit memos', icon: RotateCcw, active: !!pathname?.includes('/admin/credit-memos/vendors') },
        { href: '/admin/expenses', label: 'Pay bills', icon: Landmark, active: pathMatches(pathname, '/admin/expenses') },
      ],
    },
    {
      slug: 'inventory',
      label: 'Inventory',
      items: [
        { href: '/admin/inventory', label: 'Stock on hand', icon: Boxes, active: pathname === '/admin/inventory' && !adjustingStock && !countingStock },
        { href: '/admin/inventory/damaged', label: 'Damaged returns', icon: RotateCcw, active: pathname === '/admin/inventory/damaged' },
        { href: '/admin/inventory?count=1', label: 'Physical count', icon: ClipboardList, active: countingStock },
        { href: '/admin/invoices?create=invoice', label: 'Offline sales', icon: ShoppingCart, active: creatingInvoice },
        { href: '/admin/returns', label: 'POS returns', icon: RotateCcw, active: pathMatches(pathname, '/admin/returns') },
      ],
    },
    {
      slug: 'banking',
      label: 'Banking',
      items: [
        { href: '/admin/receipts', label: 'Money received', icon: Landmark, active: pathname === '/admin/receipts' || (pathMatches(pathname, '/admin/receipts') && pathname !== '/admin/receipts/paid') },
        { href: '/admin/receipts/paid', label: 'Money paid', icon: Landmark, active: pathname === '/admin/receipts/paid' },
        { href: '/admin/catalog?tab=tax', label: 'Tax types', icon: Percent, active: pathMatches(pathname, '/admin/catalog') && catalogTabIs(searchParams, 'tax') },
        { href: '/admin/catalog?tab=bank', label: 'Bank accounts', icon: Landmark, active: pathMatches(pathname, '/admin/catalog') && catalogTabIs(searchParams, 'bank') },
        { href: '/admin/catalog?tab=payment', label: 'Payment methods', icon: CreditCard, active: pathMatches(pathname, '/admin/catalog') && catalogTabIs(searchParams, 'payment') },
      ],
    },
    {
      slug: 'reports',
      label: 'Reports',
      items: [
        { href: '/admin/analytics', label: 'Profit & loss', icon: BarChart3, active: pathMatches(pathname, '/admin/analytics') },
        { href: '/admin/compliance', label: 'Compliance', icon: FileText, active: pathname === '/admin/compliance' },
        { href: '/admin/compliance/sales-tax', label: 'Sales tax', icon: Percent, active: pathMatches(pathname, '/admin/compliance/sales-tax') },
        { href: '/admin/compliance/tobacco', label: 'Tobacco compliance', icon: Package, active: pathMatches(pathname, '/admin/compliance/tobacco') },
        { href: '/admin/compliance/reports', label: 'Compliance reports', icon: ClipboardList, active: pathMatches(pathname, '/admin/compliance/reports') },
        { href: '/admin/compliance/settings', label: 'Compliance settings', icon: Settings, active: pathMatches(pathname, '/admin/compliance/settings') },
      ],
    },
  ];

  return (
    <div className={`h-dvh min-h-0 overflow-hidden flex font-sans ${adminUi.app}`}>
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15dvh] px-4 bg-[rgba(26,26,26,0.45)]">
          <div className={`w-full max-w-lg overflow-visible ${adminUi.overlay}`}>
            <div className="p-3 border-b border-[#E3E5E8] flex items-center gap-3">
              <AdminDeskSearch
                value={globalSearch}
                onChange={setGlobalSearch}
                focused
                onFocus={() => setSearchFocused(true)}
                onNavigate={() => { setPaletteOpen(false); setSearchFocused(false); }}
              />
              <span className={`${adminUi.badge} font-mono shrink-0`}>ESC</span>
            </div>
            <div className="max-h-[350px] overflow-y-auto p-2 space-y-1">
              {globalSearch.trim() ? null : (
                <>
                  <p className={`${adminUi.navSection} px-2 py-1`}>Create</p>
                  {paletteActions.map((act) => {
                    const ActIcon = act.icon;
                    return (
                      <button
                        key={act.label}
                        onClick={act.action}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-[#F4F5F8] text-left"
                      >
                        <div className="flex items-center gap-3">
                          <ActIcon className="w-4 h-4 text-[#6B6C72]" />
                          <span className="text-sm font-medium text-[#1A1A1A]">{act.label}</span>
                        </div>
                        <kbd className={`${adminUi.badge} font-mono`}>{act.short}</kbd>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {mobileNavOpen && (
        <button type="button" className="fixed inset-0 z-30 bg-[rgba(26,26,26,0.2)] lg:hidden" aria-label="Close navigation" onClick={closeMobileNav} />
      )}

      <aside
        className={`w-[248px] shrink-0 h-full min-h-0 flex flex-col z-40 ${adminUi.sidebar} fixed inset-y-0 left-0 transform transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-3.5 border-b border-[#E3E5E8] flex items-center justify-between gap-2">
          <Link href="/admin/dashboard" className="flex items-center gap-2.5 min-w-0" onClick={closeMobileNav}>
            <span className="w-8 h-8 rounded-lg bg-black text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
              ED
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[#1A1A1A] leading-tight truncate">Express</span>
              <span className="block text-[11px] text-[#8D9096] leading-tight">Admin</span>
            </span>
          </Link>
          <button type="button" onClick={closeMobileNav} className={`${adminUi.btnIcon} lg:hidden`} aria-label="Close navigation">
            <X className="w-4 h-4" />
          </button>
        </div>
        <nav
          className="flex-1 min-h-0 px-3 py-3 space-y-4 overflow-y-auto"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a')) closeMobileNav();
          }}
        >
          <button
            type="button"
            onClick={() => setCreateOpen((v) => !v)}
            className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-full bg-black text-white text-sm font-medium hover:bg-[#2C2C2C]"
            aria-expanded={createOpen}
            aria-controls="admin-create-panel"
          >
            <Plus className="w-4 h-4" />
            Create
          </button>

          <Link href="/admin/dashboard" className={adminNavItemClass(pathMatches(pathname, '/admin/dashboard'))}>
            <LayoutDashboard className={`w-4 h-4 shrink-0 ${pathMatches(pathname, '/admin/dashboard') ? 'text-[#1A1A1A]' : 'text-[#8D9096]'}`} />
            <span>Overview</span>
          </Link>

          {navGroups.map((group) => {
            const open = !!openGroups[group.slug];
            const hasActive = group.items.some((item) => item.active);
            return (
              <div key={group.slug}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.slug)}
                  className="w-full flex items-center justify-between px-2 py-1 rounded-md hover:bg-[#F4F5F8] text-left"
                  aria-expanded={open}
                >
                  <span className={`${adminUi.navGroup} ${hasActive ? 'text-[#1A1A1A]' : ''}`}>{group.label}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-[#8D9096] transition-transform ${open ? '' : '-rotate-90'}`} />
                </button>
                {open && (
                  <div className="mt-0.5 space-y-0.5">
                    {group.items.map((item) => (
                      <SidebarLink key={item.href} {...item} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="p-3 border-t border-[#E3E5E8] space-y-0.5">
          <Link href="/admin/data" className={adminNavUtilityClass(pathMatches(pathname, '/admin/data'))}>
            <Database className="w-4 h-4 shrink-0 text-[#8D9096]" />
            Data
          </Link>
          <Link href="/admin/settings" className={adminNavUtilityClass(pathMatches(pathname, '/admin/settings'))}>
            <Settings className="w-4 h-4 shrink-0 text-[#8D9096]" />
            Settings
          </Link>
          <button type="button" onClick={handleLogout} className={`${adminNavUtilityClass(false)} w-full`}>
            <LogOut className="w-4 h-4 shrink-0 text-[#8D9096]" />
            Logout
          </button>
        </div>
      </aside>

      {createOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[45] bg-[rgba(26,26,26,0.35)] backdrop-blur-sm"
            aria-label="Close create menu"
            onClick={() => setCreateOpen(false)}
          />
          <div
            id="admin-create-panel"
            data-admin-menu
            role="dialog"
            aria-label="Create"
            className="fixed z-[46] left-3 right-3 top-[4.5rem] lg:left-72 lg:right-auto lg:top-20 lg:w-[min(520px,calc(100vw-20rem))] rounded-xl border border-[#E3E5E8] bg-white/95 shadow-xl p-4 text-[#1A1A1A]"
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-sm font-semibold text-[#1A1A1A]">Create</p>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className={adminUi.btnIcon}
                aria-label="Collapse create menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {createActions.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className={adminCreateTagClass(createHrefIsActive(pathname, searchParams, a.href))}
                  onClick={() => {
                    setCreateOpen(false);
                    setMobileNavOpen(false);
                  }}
                >
                  {a.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className={`z-20 flex items-center gap-3 px-4 h-14 shrink-0 ${adminUi.header}`}>
          <button
            type="button"
            className={`${adminUi.btnIcon} lg:hidden`}
            aria-label="Open navigation"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="w-4 h-4" />
          </button>

          <p className="hidden sm:block text-[13px] font-medium text-[#6B6C72] tracking-wide uppercase shrink-0">
            Express Distributors Inc
          </p>

          <div className="relative z-40 flex-1 min-w-0 max-w-2xl mx-auto">
            <AdminDeskSearch
              value={globalSearch}
              onChange={setGlobalSearch}
              focused={searchFocused}
              onFocus={() => setSearchFocused(true)}
              onNavigate={() => setSearchFocused(false)}
              onBlurContainer={(node) => {
                searchRef.current = node;
              }}
            />
          </div>

          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button type="button" className={adminUi.btnIcon} aria-label="Help">
              <HelpCircle className="w-4 h-4" />
            </button>
            <AdminNoticeCenter />
            <Link href="/admin/settings" className={adminUi.btnIcon} aria-label="Settings">
              <Settings className="w-4 h-4" />
            </Link>
            <div className="w-8 h-8 rounded-full bg-[#F4F5F8] border border-[#E3E5E8] flex items-center justify-center text-[#393A3D] text-xs font-medium ml-1">
              ED
            </div>
          </div>
        </header>

        <main className={`flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-8 py-6 ${adminUi.workspace}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
