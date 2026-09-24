'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart3,
  LogOut,
  Users,
  ClipboardList,
  Warehouse,
  Settings,
  Bell,
  Landmark,
  ChevronDown,
  ChevronRight,
  Search,
  ShoppingCart,
  Menu,
  X,
} from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { adminNavItemClass, adminNavUtilityClass, adminUi } from '@/lib/admin-ui';

function pathMatches(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  if (href === '/admin/dashboard') return pathname === '/admin/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function headerContextLabel(pathname: string | null | undefined): string {
  if (!pathname) return 'Express Distributors';
  if (pathname === '/admin/dashboard' || pathname.startsWith('/admin/dashboard/')) return 'Overview';
  if (pathname === '/admin/invoices' || pathname.startsWith('/admin/invoices/')) return 'Invoices';
  if (pathname === '/admin/customers' || pathname.startsWith('/admin/customers/')) return 'Customers';
  if (pathname === '/admin/products' || pathname.startsWith('/admin/products/')) return 'Products';
  if (pathname === '/admin/orders' || pathname.startsWith('/admin/orders/')) return 'Online sales';
  if (pathname === '/admin/pos' || pathname.startsWith('/admin/pos/')) return 'Offline sales';
  if (pathname === '/admin/inventory' || pathname.startsWith('/admin/inventory/')) return 'Inventory management';
  if (pathname === '/admin/purchase-orders' || pathname.startsWith('/admin/purchase-orders/')) return 'Purchase order';
  if (pathname === '/admin/vendors' || pathname.startsWith('/admin/vendors/')) return 'Vendors';
  if (pathname === '/admin/expenses' || pathname.startsWith('/admin/expenses/')) return 'Expenses';
  if (pathname === '/admin/credit-memos' || pathname.startsWith('/admin/credit-memos/')) return 'Credit memo';
  if (pathname === '/admin/analytics' || pathname.startsWith('/admin/analytics/')) return 'Reports';
  if (pathname === '/admin/rfq' || pathname.startsWith('/admin/rfq/')) return 'Quote requests';
  if (pathname === '/admin/shipments' || pathname.startsWith('/admin/shipments/')) return 'Shipments';
  if (pathname === '/admin/settings' || pathname.startsWith('/admin/settings/')) return 'Settings';
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
  const [hasToken, setHasToken] = useState<boolean>(true);

  // Collapsible navigational groups
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    sales: false,
    expenses: false,
    customers: false,
    inventory: false,
    more: false,
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

  // Set default group open state based on current path on mount
  useEffect(() => {
    if (pathname) {
      const isSales = ['/admin/dashboard', '/admin/invoices', '/admin/products'].some((p) =>
        pathname === p || pathname.startsWith(`${p}/`)
      );
      const isExpenses = ['/admin/expenses', '/admin/vendors'].some((p) =>
        pathname === p || pathname.startsWith(`${p}/`)
      );
      const isCustomers = pathname === '/admin/customers' || pathname.startsWith('/admin/customers/');
      const isInventory = [
        '/admin/orders',
        '/admin/pos',
        '/admin/inventory',
        '/admin/purchase-orders',
        '/admin/credit-memos',
      ].some((p) => pathname === p || pathname.startsWith(`${p}/`));
      const isMore = ['/admin/rfq', '/admin/shipments'].some((p) =>
        pathname === p || pathname.startsWith(`${p}/`)
      );

      setOpenGroups({
        sales: isSales,
        expenses: isExpenses,
        customers: isCustomers,
        inventory: isInventory,
        more: isMore,
      });
    }
  }, [pathname]);

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

  const paletteActions = [
    { label: 'Create New Customer', short: 'n c', icon: Users, action: () => { router.push('/admin/customers'); setPaletteOpen(false); } },
    { label: 'Open POS Terminal', short: 'p o s', icon: ShoppingCart, action: () => { router.push('/admin/pos'); setPaletteOpen(false); } },
    { label: 'Raise Purchase Order', short: 'p o', icon: ClipboardList, action: () => { router.push('/admin/purchase-orders'); setPaletteOpen(false); } },
    { label: 'Record Client Payment', short: 'r p', icon: Landmark, action: () => { router.push('/admin/receipts'); setPaletteOpen(false); } },
    { label: 'Adjust Warehouse Stock', short: 'i a', icon: Warehouse, action: () => { router.push('/admin/inventory'); setPaletteOpen(false); } },
    { label: 'Quick Settings Edit', short: 's e', icon: Settings, action: () => { router.push('/admin/settings'); setPaletteOpen(false); } },
  ];

  return (
    <div className={`h-dvh min-h-0 overflow-hidden flex flex-col font-sans ${adminUi.app}`}>
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15dvh] px-4 bg-black/50">
          <div className={`w-full max-w-lg overflow-hidden ${adminUi.overlay}`}>
            <div className="p-3 border-b border-slate-800 flex items-center gap-3">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Type command or search items..."
                className="bg-transparent text-white border-0 focus:ring-0 outline-none w-full text-sm placeholder-slate-500"
                autoFocus
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
              <span className={`${adminUi.badge} font-mono`}>ESC</span>
            </div>
            
            <div className="max-h-[350px] overflow-y-auto p-2 space-y-1">
              {globalSearch.trim() ? (
                <>
                  <p className={`${adminUi.navGroup} px-2 py-1`}>Search results</p>
                  {searching ? (
                    <div className={`py-8 text-center ${adminUi.meta}`}>Searching active databases...</div>
                  ) : searchResults.length > 0 ? (
                    searchResults.map((r, idx) => (
                      <button
                        key={idx}
                        onClick={() => { router.push(r.url); setPaletteOpen(false); setGlobalSearch(''); }}
                        className="w-full flex items-center justify-between p-2 rounded-md hover:bg-slate-900 text-left"
                      >
                        <div>
                          <p className="text-sm font-medium text-white">{r.title}</p>
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
                  <p className={`${adminUi.navGroup} px-2 py-1`}>Quick actions</p>
                  {paletteActions.map((act) => {
                    const ActIcon = act.icon;
                    return (
                      <button
                        key={act.label}
                        onClick={act.action}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-slate-900 text-left"
                      >
                        <div className="flex items-center gap-3">
                          <ActIcon className="w-4 h-4 text-slate-400" />
                          <span className="text-sm font-medium text-slate-200">{act.label}</span>
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

      <div className="flex flex-1 min-h-0 relative">
        {mobileNavOpen && (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            aria-label="Close navigation"
            onClick={closeMobileNav}
          />
        )}

        <aside
          className={`w-64 flex flex-col shrink-0 h-full min-h-0 ${adminUi.sidebar} fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 lg:static lg:translate-x-0 lg:z-auto ${
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="px-4 py-4 border-b border-slate-800 shrink-0 flex items-center justify-between gap-2">
            <span className="font-semibold text-sm text-white block leading-tight">Express Distributors</span>
            <button
              type="button"
              onClick={closeMobileNav}
              className={`${adminUi.btnIcon} lg:hidden`}
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav
            className="flex-1 min-h-0 p-3 space-y-3 overflow-y-auto overscroll-contain"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a')) closeMobileNav();
            }}
          >
            <div>
              <button
                type="button"
                onClick={() => toggleGroup('sales')}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-slate-900 text-left"
              >
                <span className={adminUi.navGroup}>Sales and get paid</span>
                {openGroups.sales ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
              </button>
              {openGroups.sales && (
                <div className="pl-2 mt-0.5 space-y-0.5">
                  <Link href="/admin/dashboard" className={adminNavItemClass(pathMatches(pathname, '/admin/dashboard'))}>Overview</Link>
                  <Link href="/admin/invoices" className={adminNavItemClass(pathMatches(pathname, '/admin/invoices'))}>Invoices</Link>
                  <Link href="/admin/products" className={adminNavItemClass(pathMatches(pathname, '/admin/products'))}>Products</Link>
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => toggleGroup('expenses')}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-slate-900 text-left"
              >
                <span className={adminUi.navGroup}>Expenses</span>
                {openGroups.expenses ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
              </button>
              {openGroups.expenses && (
                <div className="pl-2 mt-0.5 space-y-0.5">
                  <Link href="/admin/expenses" className={adminNavItemClass(pathMatches(pathname, '/admin/expenses'))}>Overview</Link>
                  <Link href="/admin/vendors" className={adminNavItemClass(pathMatches(pathname, '/admin/vendors'))}>Vendors</Link>
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => toggleGroup('customers')}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-slate-900 text-left"
              >
                <span className={adminUi.navGroup}>Customer hub</span>
                {openGroups.customers ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
              </button>
              {openGroups.customers && (
                <div className="pl-2 mt-0.5 space-y-0.5">
                  <Link href="/admin/customers" className={adminNavItemClass(pathMatches(pathname, '/admin/customers'))}>Customers</Link>
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => toggleGroup('inventory')}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-slate-900 text-left"
              >
                <span className={adminUi.navGroup}>Inventory</span>
                {openGroups.inventory ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
              </button>
              {openGroups.inventory && (
                <div className="pl-2 mt-0.5 space-y-0.5">
                  <Link href="/admin/orders" className={adminNavItemClass(pathMatches(pathname, '/admin/orders'))}>Online sales</Link>
                  <Link href="/admin/pos" className={adminNavItemClass(pathMatches(pathname, '/admin/pos'))}>Offline sales</Link>
                  <Link href="/admin/inventory" className={adminNavItemClass(pathMatches(pathname, '/admin/inventory'))}>Inventory management</Link>
                  <Link href="/admin/purchase-orders" className={adminNavItemClass(pathMatches(pathname, '/admin/purchase-orders'))}>Purchase order</Link>
                  <Link href="/admin/credit-memos" className={adminNavItemClass(pathMatches(pathname, '/admin/credit-memos'))}>Credit memo</Link>
                </div>
              )}
            </div>

            <div>
              <Link href="/admin/analytics" className={adminNavUtilityClass(pathMatches(pathname, '/admin/analytics'))}>
                <BarChart3 className="w-4 h-4 shrink-0" />
                <span>Reports</span>
              </Link>
            </div>

            <div>
              <button
                type="button"
                onClick={() => toggleGroup('more')}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-slate-900 text-left"
              >
                <span className={adminUi.navGroup}>More</span>
                {openGroups.more ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
              </button>
              {openGroups.more && (
                <div className="pl-2 mt-0.5 space-y-0.5">
                  <Link href="/admin/rfq" className={adminNavItemClass(pathMatches(pathname, '/admin/rfq'))}>Quote requests / RFQ</Link>
                  <Link href="/admin/shipments" className={adminNavItemClass(pathMatches(pathname, '/admin/shipments'))}>Shipments</Link>
                </div>
              )}
            </div>

            <div className="pt-1">
              <Link href="/admin/settings" className={adminNavUtilityClass(pathMatches(pathname, '/admin/settings'))}>
                <Settings className="w-4 h-4 shrink-0" />
                <span>Settings</span>
              </Link>
            </div>
          </nav>

          <div className="p-3 border-t border-slate-800 shrink-0">
            <button
              type="button"
              onClick={handleLogout}
              className={`${adminUi.btnGhost} w-full justify-start`}
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
        </aside>

        {/* Unified Application View Port */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          
          <header className={`z-20 flex flex-wrap items-center gap-3 px-3 py-2 min-h-14 lg:h-14 lg:flex-nowrap lg:gap-6 lg:px-6 lg:py-0 shrink-0 ${adminUi.header}`}>
            <button
              type="button"
              className={`${adminUi.btnIcon} lg:hidden`}
              aria-label="Open navigation"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="min-w-0 flex-1 lg:w-44 lg:flex-none">
              <p className="text-sm font-semibold text-white truncate">{headerContextLabel(pathname)}</p>
            </div>

            <div ref={searchRef} className="relative z-40 w-full min-w-0 order-last lg:order-none lg:flex-1 lg:max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search"
                  value={globalSearch}
                  onFocus={() => setSearchFocused(true)}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  className={`${adminUi.input} pl-9 pr-16`}
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-0.5 pointer-events-none">
                  <span className={`${adminUi.badge} font-mono`}>⌘</span>
                  <span className={`${adminUi.badge} font-mono`}>K</span>
                </div>
              </div>

              {searchFocused && (globalSearch.trim() || searchResults.length > 0) && (
                <div className={`absolute top-full left-0 right-0 mt-2 p-2 max-h-[300px] overflow-y-auto space-y-1 ${adminUi.overlay}`}>
                  {searching ? (
                    <div className={`p-4 text-center ${adminUi.meta} flex items-center justify-center gap-2`}>
                      <div className="w-4 h-4 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
                      Searching...
                    </div>
                  ) : searchResults.length > 0 ? (
                    searchResults.map((r, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          router.push(r.url);
                          setSearchFocused(false);
                          setGlobalSearch('');
                        }}
                        className="w-full p-2 hover:bg-slate-900 rounded-md flex items-center justify-between text-left"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-200">{r.title}</p>
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

            <div className="ml-auto flex items-center gap-3 shrink-0">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotificationsOpen(!notificationsOpen)}
                  className={adminUi.btnIcon}
                  aria-label="Notifications"
                >
                  <Bell className="w-4 h-4" />
                </button>

                {notificationsOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setNotificationsOpen(false)} />
                    <div className={`absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] p-3 z-50 space-y-2 ${adminUi.overlay}`}>
                      <p className={adminUi.navGroup}>Notifications</p>
                      <p className={adminUi.helper}>No notifications</p>
                    </div>
                  </>
                )}
              </div>

              <div className="h-6 w-px bg-slate-800" />

              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 text-xs font-medium">
                  ED
                </div>
                <div className="hidden md:block leading-tight text-left">
                  <span className="text-xs font-medium text-slate-200 block">Account</span>
                  <span className={`${adminUi.helper} block`}>Express Distributors</span>
                </div>
              </div>
            </div>
          </header>

          <main className={`flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-4 lg:p-6 ${adminUi.workspace}`}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
