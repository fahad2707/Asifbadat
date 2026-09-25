'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Users,
  ClipboardList,
  Bell,
  Landmark,
  ChevronDown,
  ChevronRight,
  Search,
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
} from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { adminNavItemClass, adminNavUtilityClass, adminUi } from '@/lib/admin-ui';

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

function headerContextLabel(pathname: string | null | undefined, creatingInvoice = false, catalogTab = ''): string {
  if (!pathname) return 'Express Distributors';
  if (pathname === '/admin/dashboard' || pathname.startsWith('/admin/dashboard/')) return 'Overview';
  if ((pathname === '/admin/invoices' || pathname.startsWith('/admin/invoices/')) && creatingInvoice) return 'Offline sales';
  if (pathname === '/admin/invoices' || pathname.startsWith('/admin/invoices/')) return 'Invoices & quotations';
  if (pathname === '/admin/customers' || pathname.startsWith('/admin/customers/')) return 'Customers';
  if (pathname === '/admin/products/new') return 'Product';
  if (pathname === '/admin/products' || pathname.startsWith('/admin/products/')) return 'Products';
  if (pathname === '/admin/receipts' || pathname.startsWith('/admin/receipts/')) return 'Bank transactions';
  if (pathname === '/admin/inventory' || pathname.startsWith('/admin/inventory/')) return 'Inventory';
  if (pathname === '/admin/purchase-orders' || pathname.startsWith('/admin/purchase-orders/')) return 'Purchase order';
  if (pathname === '/admin/vendors' || pathname.startsWith('/admin/vendors/')) return 'Vendors / suppliers';
  if (pathname === '/admin/expenses' || pathname.startsWith('/admin/expenses/')) return 'Expense overview';
  if (pathname === '/admin/credit-memos' || pathname.startsWith('/admin/credit-memos/')) return 'Credit memo';
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

interface SearchResult {
  type: 'Customer' | 'Product' | 'Invoice' | 'Order';
  title: string;
  subtitle: string;
  url: string;
}

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const creatingInvoice = searchParams.get('create') === 'invoice';
  const [hasToken, setHasToken] = useState<boolean>(true);

  // Collapsible navigational groups
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    create: true,
    sales: true,
    banking: true,
    customers: true,
    inventory: true,
    reports: true,
    more: true,
  });

  // Search & Command Palette States
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const closeMobileNav = () => setMobileNavOpen(false);

  // Hotkeys: Ctrl + K or Cmd + K toggles palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setSearchFocused(false);
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!pathname) return;
    const creating = searchParams.get('create') || searchParams.get('new');
    const catalogTab = searchParams.get('tab') || '';
    const isCatalog = pathname === '/admin/catalog' || pathname.startsWith('/admin/catalog/');
    const isCreate =
      Boolean(creating) ||
      pathname === '/admin/products/new' ||
      pathname.startsWith('/admin/products/new/');
    const isSales =
      !creatingInvoice &&
      (['/admin/invoices', '/admin/rfq', '/admin/products'].some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
        (isCatalog && (catalogTab === 'categories' || catalogTab === 'subcategories' || !catalogTab)));
    const isBanking =
      ['/admin/expenses', '/admin/vendors', '/admin/receipts'].some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
      (isCatalog && (catalogTab === 'tax' || catalogTab === 'bank' || catalogTab === 'payment'));
    const isCustomers = pathname === '/admin/customers' || pathname.startsWith('/admin/customers/');
    const isInventory =
      creatingInvoice ||
      ['/admin/inventory', '/admin/purchase-orders', '/admin/credit-memos'].some((p) => pathname === p || pathname.startsWith(`${p}/`));
    const isReports = pathname === '/admin/analytics' || pathname.startsWith('/admin/analytics/');
    const isMore = isCatalog || pathname === '/admin/data' || pathname.startsWith('/admin/data/');
    const isHome = pathname === '/admin' || pathname === '/admin/dashboard' || pathname.startsWith('/admin/dashboard/');

    setOpenGroups({
      create: isCreate || isHome,
      sales: (isSales && !isCreate) || isHome,
      banking: (isBanking && !isCreate) || isHome,
      customers: (isCustomers && !isCreate) || isHome,
      inventory: (isInventory && !isCreate) || isHome,
      reports: isReports || isHome,
      more: (isMore && !isCreate) || isHome,
    });
  }, [pathname, creatingInvoice, searchParams]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Handle outside click for search dropdown
  useEffect(() => {
    const clickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', clickOutside);
    return () => document.removeEventListener('mousedown', clickOutside);
  }, []);

  // Global search implementation
  useEffect(() => {
    if (!globalSearch.trim()) {
      setSearchResults([]);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      setSearching(true);
      try {
        const query = globalSearch.trim();
        const results: SearchResult[] = [];

        // Dynamic parallel fetches
        const [custRes, prodRes, invRes] = await Promise.allSettled([
          adminApi.get('/customers', { params: { search: query, limit: 3 } }),
          adminApi.get('/products', { params: { search: query, limit: 3 } }),
          adminApi.get('/invoices', { params: { search: query, limit: 3 } }),
        ]);

        if (custRes.status === 'fulfilled' && Array.isArray(custRes.value.data)) {
          custRes.value.data.forEach((c: any) => {
            results.push({
              type: 'Customer',
              title: c.name,
              subtitle: c.company || c.phone,
              url: `/admin/customers/${c.id}`,
            });
          });
        }

        if (prodRes.status === 'fulfilled' && Array.isArray(prodRes.value.data?.products)) {
          prodRes.value.data.products.forEach((p: any) => {
            results.push({
              type: 'Product',
              title: p.name,
              subtitle: `SKU: ${p.sku || 'N/A'} | Stock: ${p.stock_quantity}`,
              url: `/admin/products/active?search=${encodeURIComponent(p.name)}`,
            });
          });
        }

        if (invRes.status === 'fulfilled' && Array.isArray(invRes.value.data)) {
          invRes.value.data.forEach((i: any) => {
            results.push({
              type: 'Invoice',
              title: `Inv: ${i.invoice_number}`,
              subtitle: `${i.customer_name} | Total: $${i.total_amount}`,
              url: `/admin/invoices?search=${encodeURIComponent(i.invoice_number)}`,
            });
          });
        }

        setSearchResults(results);
      } catch (err) {
        console.error('Universal Search Error:', err);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [globalSearch]);

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
    setOpenGroups((prev) => ({ ...prev, [slug]: !prev[slug] }));
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
    { label: 'Credit memo', short: 'c m', icon: RotateCcw, href: '/admin/credit-memos?new=1' },
    { label: 'Bank transaction', short: 'c b', icon: Landmark, href: '/admin/receipts?create=1' },
    { label: 'Product', short: 'c r', icon: Package, href: '/admin/products/new' },
    { label: 'Category', short: 'c g', icon: FolderTree, href: '/admin/catalog?tab=categories&create=1' },
    { label: 'Tax type', short: 'c t', icon: Percent, href: '/admin/catalog?tab=tax&create=1' },
    { label: 'Bank account', short: 'c a', icon: Landmark, href: '/admin/catalog?tab=bank&create=1' },
    { label: 'Payment method', short: 'c y', icon: CreditCard, href: '/admin/catalog?tab=payment&create=1' },
  ];
  const paletteActions = createActions.map((a) => ({ ...a, action: () => go(a.href) }));

  return (
    <div className={`h-dvh min-h-0 overflow-hidden flex font-sans ${adminUi.app}`}>
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15dvh] px-4 bg-[rgba(26,26,26,0.45)]">
          <div className={`w-full max-w-lg overflow-hidden ${adminUi.overlay}`}>
            <div className="p-3 border-b border-[#E3E5E8] flex items-center gap-3">
              <Search className="w-4 h-4 text-[#8D9096]" />
              <input
                type="text"
                placeholder="Navigate. Find transactions, contacts, help, reports, and more."
                className="bg-transparent text-[#1A1A1A] border-0 focus:ring-0 outline-none w-full text-sm placeholder-[#8D9096]"
                autoFocus
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
              <span className={`${adminUi.badge} font-mono`}>ESC</span>
            </div>
            <div className="max-h-[350px] overflow-y-auto p-2 space-y-1">
              {globalSearch.trim() ? (
                <>
                  <p className={`${adminUi.navSection} px-2 py-1`}>Search results</p>
                  {searching ? (
                    <div className={`py-8 text-center ${adminUi.meta}`}>Searching…</div>
                  ) : searchResults.length > 0 ? (
                    searchResults.map((r, idx) => (
                      <button
                        key={idx}
                        onClick={() => { router.push(r.url); setPaletteOpen(false); setGlobalSearch(''); }}
                        className="w-full flex items-center justify-between p-2 rounded-md hover:bg-[#F4F5F8] text-left"
                      >
                        <div>
                          <p className="text-sm font-medium text-[#1A1A1A]">{r.title}</p>
                          <p className={adminUi.helper}>{r.subtitle}</p>
                        </div>
                        <span className={adminUi.badge}>{r.type}</span>
                      </button>
                    ))
                  ) : (
                    <div className={`py-8 text-center ${adminUi.helper}`}>No matches found. Try again.</div>
                  )}
                </>
              ) : (
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
        className={`w-56 shrink-0 h-full min-h-0 flex flex-col z-40 ${adminUi.sidebar} fixed inset-y-0 left-0 transform transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-4 border-b border-[#E3E5E8] flex items-center justify-between">
          <Link href="/admin/dashboard" className="text-sm font-medium text-[#1A1A1A]" onClick={closeMobileNav}>
            Express Distributors
          </Link>
          <button type="button" onClick={closeMobileNav} className={`${adminUi.btnIcon} lg:hidden`} aria-label="Close navigation">
            <X className="w-4 h-4" />
          </button>
        </div>
        <nav
          className="flex-1 min-h-0 p-3 space-y-3 overflow-y-auto"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a')) closeMobileNav();
          }}
        >
          <div>
            <button type="button" onClick={() => toggleGroup('create')} className="w-full flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-[#F4F5F8] text-left">
              <span className={adminUi.navGroup}>Create</span>
              {openGroups.create ? <ChevronDown className="w-3.5 h-3.5 text-[#8D9096]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#8D9096]" />}
            </button>
            {openGroups.create && (
              <div className="pl-2 mt-0.5 space-y-0.5">
                {createActions.map((a) => (
                  <Link key={a.href} href={a.href} className={adminNavItemClass(false)} onClick={() => setMobileNavOpen(false)}>
                    {a.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div>
            <button type="button" onClick={() => toggleGroup('sales')} className="w-full flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-[#F4F5F8] text-left">
              <span className={adminUi.navGroup}>Sales and get paid</span>
              {openGroups.sales ? <ChevronDown className="w-3.5 h-3.5 text-[#8D9096]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#8D9096]" />}
            </button>
            {openGroups.sales && (
              <div className="pl-2 mt-0.5 space-y-0.5">
                <Link href="/admin/invoices" className={adminNavItemClass(pathMatches(pathname, '/admin/invoices') && !creatingInvoice)}>Invoices &amp; quotations</Link>
                <Link href="/admin/rfq" className={adminNavItemClass(pathMatches(pathname, '/admin/rfq'))}>RFQ</Link>
                <Link href="/admin/products/active" className={adminNavItemClass(pathMatches(pathname, '/admin/products') && pathname !== '/admin/products/new')}>Products</Link>
                <Link href="/admin/catalog?tab=categories" className={adminNavItemClass(pathMatches(pathname, '/admin/catalog') && catalogTabIs(searchParams, 'categories'))}>Categories</Link>
              </div>
            )}
          </div>
          <div>
            <button type="button" onClick={() => toggleGroup('banking')} className="w-full flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-[#F4F5F8] text-left">
              <span className={adminUi.navGroup}>Banking and accounting</span>
              {openGroups.banking ? <ChevronDown className="w-3.5 h-3.5 text-[#8D9096]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#8D9096]" />}
            </button>
            {openGroups.banking && (
              <div className="pl-2 mt-0.5 space-y-0.5">
                <Link href="/admin/expenses" className={adminNavItemClass(pathMatches(pathname, '/admin/expenses'))}>Expense overview</Link>
                <Link href="/admin/vendors" className={adminNavItemClass(pathMatches(pathname, '/admin/vendors'))}>Vendors / suppliers</Link>
                <Link href="/admin/receipts" className={adminNavItemClass(pathMatches(pathname, '/admin/receipts'))}>Bank transactions</Link>
                <Link href="/admin/catalog?tab=tax" className={adminNavItemClass(pathMatches(pathname, '/admin/catalog') && catalogTabIs(searchParams, 'tax'))}>Tax types</Link>
                <Link href="/admin/catalog?tab=bank" className={adminNavItemClass(pathMatches(pathname, '/admin/catalog') && catalogTabIs(searchParams, 'bank'))}>Bank accounts</Link>
                <Link href="/admin/catalog?tab=payment" className={adminNavItemClass(pathMatches(pathname, '/admin/catalog') && catalogTabIs(searchParams, 'payment'))}>Payment methods</Link>
              </div>
            )}
          </div>
          <div>
            <button type="button" onClick={() => toggleGroup('customers')} className="w-full flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-[#F4F5F8] text-left">
              <span className={adminUi.navGroup}>Customers hub</span>
              {openGroups.customers ? <ChevronDown className="w-3.5 h-3.5 text-[#8D9096]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#8D9096]" />}
            </button>
            {openGroups.customers && (
              <div className="pl-2 mt-0.5 space-y-0.5">
                <Link href="/admin/customers" className={adminNavItemClass(pathMatches(pathname, '/admin/customers'))}>Customer</Link>
              </div>
            )}
          </div>
          <div>
            <button type="button" onClick={() => toggleGroup('inventory')} className="w-full flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-[#F4F5F8] text-left">
              <span className={adminUi.navGroup}>Inventory</span>
              {openGroups.inventory ? <ChevronDown className="w-3.5 h-3.5 text-[#8D9096]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#8D9096]" />}
            </button>
            {openGroups.inventory && (
              <div className="pl-2 mt-0.5 space-y-0.5">
                <Link href="/admin/invoices?create=invoice" className={adminNavItemClass(creatingInvoice)}>Offline sales</Link>
                <Link href="/admin/inventory" className={adminNavItemClass(pathMatches(pathname, '/admin/inventory'))}>Inventory</Link>
                <Link href="/admin/purchase-orders" className={adminNavItemClass(pathMatches(pathname, '/admin/purchase-orders'))}>Purchase order</Link>
                <Link href="/admin/credit-memos" className={adminNavItemClass(pathMatches(pathname, '/admin/credit-memos'))}>Credit memo</Link>
              </div>
            )}
          </div>
          <div>
            <button type="button" onClick={() => toggleGroup('reports')} className="w-full flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-[#F4F5F8] text-left">
              <span className={adminUi.navGroup}>Reports</span>
              {openGroups.reports ? <ChevronDown className="w-3.5 h-3.5 text-[#8D9096]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#8D9096]" />}
            </button>
            {openGroups.reports && (
              <div className="pl-2 mt-0.5 space-y-0.5">
                <Link href="/admin/analytics" className={adminNavItemClass(pathMatches(pathname, '/admin/analytics'))}>Profit &amp; loss</Link>
              </div>
            )}
          </div>
          <div>
            <button type="button" onClick={() => toggleGroup('more')} className="w-full flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-[#F4F5F8] text-left">
              <span className={adminUi.navGroup}>More</span>
              {openGroups.more ? <ChevronDown className="w-3.5 h-3.5 text-[#8D9096]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#8D9096]" />}
            </button>
            {openGroups.more && (
              <div className="pl-2 mt-0.5 space-y-0.5">
                <Link href="/admin/catalog?tab=categories" className={adminNavItemClass(pathMatches(pathname, '/admin/catalog') && catalogTabIs(searchParams, 'categories'))}>
                  Categories
                </Link>
                <Link href="/admin/catalog?tab=tax" className={adminNavItemClass(pathMatches(pathname, '/admin/catalog') && catalogTabIs(searchParams, 'tax'))}>
                  Tax types
                </Link>
                <Link href="/admin/catalog?tab=bank" className={adminNavItemClass(pathMatches(pathname, '/admin/catalog') && catalogTabIs(searchParams, 'bank'))}>
                  Bank accounts
                </Link>
                <Link href="/admin/catalog?tab=payment" className={adminNavItemClass(pathMatches(pathname, '/admin/catalog') && catalogTabIs(searchParams, 'payment'))}>
                  Payment methods
                </Link>
              </div>
            )}
          </div>
          <Link href="/admin/settings" className={adminNavUtilityClass(pathMatches(pathname, '/admin/settings'))}>
            Settings
          </Link>
        </nav>
        <div className="p-3 border-t border-[#E3E5E8]">
          <button type="button" onClick={handleLogout} className={`${adminUi.btnGhost} w-full justify-start`}>
            Logout
          </button>
        </div>
      </aside>

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

          <div ref={searchRef} className="relative z-40 flex-1 min-w-0 max-w-2xl mx-auto">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8D9096]" />
              <input
                type="text"
                placeholder="Navigate. Find transactions, contacts, help, reports, and more."
                value={globalSearch}
                onFocus={() => setSearchFocused(true)}
                onChange={(e) => setGlobalSearch(e.target.value)}
                className={`${adminUi.input} pl-9 pr-4`}
              />
            </div>
            {searchFocused && (globalSearch.trim() || searchResults.length > 0) && (
              <div className={`absolute top-full left-0 right-0 mt-2 p-2 max-h-[300px] overflow-y-auto space-y-1 ${adminUi.overlay}`}>
                {searching ? (
                  <div className={`p-4 text-center ${adminUi.meta}`}>Searching...</div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { router.push(r.url); setSearchFocused(false); setGlobalSearch(''); }}
                      className="w-full p-2 hover:bg-[#F4F5F8] rounded-md flex items-center justify-between text-left"
                    >
                      <div>
                        <p className="text-sm font-medium text-[#1A1A1A]">{r.title}</p>
                        <p className={adminUi.helper}>{r.subtitle}</p>
                      </div>
                      <span className={adminUi.badge}>{r.type}</span>
                    </button>
                  ))
                ) : (
                  <p className={`text-center py-4 ${adminUi.helper}`}>No results found for &ldquo;{globalSearch}&rdquo;</p>
                )}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button type="button" className={adminUi.btnIcon} aria-label="Help">
              <HelpCircle className="w-4 h-4" />
            </button>
            <div className="relative">
              <button type="button" onClick={() => setNotificationsOpen(!notificationsOpen)} className={adminUi.btnIcon} aria-label="Notifications">
                <Bell className="w-4 h-4" />
              </button>
              {notificationsOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotificationsOpen(false)} />
                  <div className={`absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] p-3 z-50 space-y-2 ${adminUi.overlay}`}>
                    <p className={adminUi.navSection}>Notifications</p>
                    <p className={adminUi.helper}>No notifications</p>
                  </div>
                </>
              )}
            </div>
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
