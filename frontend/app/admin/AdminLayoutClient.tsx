'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  FileText,
  BarChart3,
  LogOut,
  Users,
  Truck,
  ClipboardList,
  Warehouse,
  Settings,
  Bell,
  FileSignature,
  PackageCheck,
  FolderTree,
  Wallet,
  Landmark,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Search,
  Cpu,
  CornerRightDown,
  Sparkles,
} from 'lucide-react';
import adminApi from '@/lib/admin-api';

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
    inventory: false,
    purchases: false,
    finance: false,
  });

  // Search & Command Palette States
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);

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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Set default group open state based on current path on mount
  useEffect(() => {
    if (pathname) {
      const isSales = ['/admin/orders', '/admin/rfq', '/admin/invoices'].some((p) => pathname.startsWith(p));
      const isInventory = ['/admin/inventory', '/admin/shipments'].some((p) => pathname.startsWith(p));
      const isPurchases = ['/admin/vendors', '/admin/purchase-orders'].some((p) => pathname.startsWith(p));
      const isFinance = ['/admin/invoices', '/admin/receipts', '/admin/expenses', '/admin/credit-memos'].some((p) => pathname.startsWith(p));

      setOpenGroups({
        sales: isSales,
        inventory: isInventory,
        purchases: isPurchases,
        finance: isFinance,
      });
    }
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
    <div className="h-dvh min-h-0 overflow-hidden bg-[#0a0f1d] text-slate-100 flex flex-col font-sans">
      
      {/* Universal Command Palette (iOS Glass Modal Overlay) */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15dvh] px-4 backdrop-blur-md bg-black/40 transition-all duration-300">
          <div className="w-full max-w-lg rounded-2xl bg-slate-950/75 border border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.5)] overflow-hidden backdrop-filter backdrop-blur-xl">
            <div className="p-4 border-b border-white/5 flex items-center gap-3">
              <Search className="w-5 h-5 text-teal-400" />
              <input
                type="text"
                placeholder="Type command or search items..."
                className="bg-transparent text-white border-0 focus:ring-0 outline-none w-full text-base placeholder-slate-500"
                autoFocus
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
              <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">ESC</span>
            </div>
            
            <div className="max-h-[350px] overflow-y-auto p-2 space-y-1">
              {globalSearch.trim() ? (
                <>
                  <p className="text-[10px] font-bold text-slate-500 px-2 py-1 tracking-wider uppercase">Search Results</p>
                  {searching ? (
                    <div className="py-8 text-center text-sm text-slate-400">Searching active databases...</div>
                  ) : searchResults.length > 0 ? (
                    searchResults.map((r, idx) => (
                      <button
                        key={idx}
                        onClick={() => { router.push(r.url); setPaletteOpen(false); setGlobalSearch(''); }}
                        className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left"
                      >
                        <div>
                          <p className="text-sm font-semibold text-white">{r.title}</p>
                          <p className="text-xs text-slate-400">{r.subtitle}</p>
                        </div>
                        <span className="text-[10px] bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded-lg border border-teal-500/30 font-semibold">{r.type}</span>
                      </button>
                    ))
                  ) : (
                    <div className="py-8 text-center text-sm text-slate-500">No matches found. Try again.</div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-[10px] font-bold text-slate-500 px-2 py-1 tracking-wider uppercase">Quick Actions</p>
                  {paletteActions.map((act) => {
                    const ActIcon = act.icon;
                    return (
                      <button
                        key={act.label}
                        onClick={act.action}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/10 transition-colors text-left group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400 group-hover:bg-teal-500 group-hover:text-white transition-all">
                            <ActIcon className="w-4 h-4" />
                          </div>
                          <span className="text-sm font-medium text-slate-200">{act.label}</span>
                        </div>
                        <kbd className="text-[10px] bg-slate-900 border border-white/5 text-slate-400 px-2 py-1 rounded font-mono">{act.short}</kbd>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Framework Wrapper */}
      <div className="flex flex-1 min-h-0">
        
        {/* iOS-Style Sidebar (Glassmorphic dark layout) */}
        <aside className="w-64 bg-slate-950/70 border-r border-white/5 flex flex-col shrink-0 h-full min-h-0 backdrop-filter backdrop-blur-xl">
          <div className="p-5 flex items-center gap-3 border-b border-white/5 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-base tracking-wide text-white block leading-tight">Express ERP</span>
              <span className="text-[10px] text-teal-400 font-semibold tracking-wider uppercase mt-px block">Enterprise 2.0</span>
            </div>
          </div>

          <nav className="flex-1 min-h-0 p-4 space-y-1 overflow-y-auto overscroll-contain">
            
            {/* 1. Dashboard */}
            <Link
              href="/admin/dashboard"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                pathname === '/admin/dashboard'
                  ? 'bg-gradient-to-tr from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/15 border border-white/10'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span className="text-xs font-semibold">Dashboard</span>
            </Link>

            {/* 2. Sales Group */}
            <div>
              <button
                type="button"
                onClick={() => toggleGroup('sales')}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/5 text-slate-400 hover:text-white transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <ShoppingCart className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-semibold">Sales</span>
                </div>
                {openGroups.sales ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {openGroups.sales && (
                <div className="pl-6 pr-2 mt-1 space-y-1 border-l border-white/5 ml-5">
                  <Link href="/admin/orders" className={`block px-3 py-2 text-[11px] font-semibold rounded-lg ${pathname === '/admin/orders' ? 'text-teal-400' : 'text-slate-500 hover:text-slate-200'}`}>Orders</Link>
                  <Link href="/admin/rfq" className={`block px-3 py-2 text-[11px] font-semibold rounded-lg ${pathname === '/admin/rfq' ? 'text-teal-400' : 'text-slate-500 hover:text-slate-200'}`}>Quotations (RFQ)</Link>
                  <Link href="/admin/invoices" className={`block px-3 py-2 text-[11px] font-semibold rounded-lg ${pathname === '/admin/invoices' ? 'text-teal-400' : 'text-slate-500 hover:text-slate-200'}`}>Invoices</Link>
                </div>
              )}
            </div>

            {/* 3. Customers */}
            <Link
              href="/admin/customers"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                pathname?.startsWith('/admin/customers')
                  ? 'bg-gradient-to-tr from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/15 border border-white/10'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span className="text-xs font-semibold">Customers</span>
            </Link>

            {/* 4. Products */}
            <Link
              href="/admin/products/active"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                pathname?.startsWith('/admin/products')
                  ? 'bg-gradient-to-tr from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/15 border border-white/10'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Package className="w-4 h-4 shrink-0" />
              <span className="text-xs font-semibold">Products</span>
            </Link>

            {/* 5. Inventory Group */}
            <div>
              <button
                type="button"
                onClick={() => toggleGroup('inventory')}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/5 text-slate-400 hover:text-white transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <Warehouse className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-semibold">Inventory</span>
                </div>
                {openGroups.inventory ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {openGroups.inventory && (
                <div className="pl-6 pr-2 mt-1 space-y-1 border-l border-white/5 ml-5">
                  <Link href="/admin/inventory" className={`block px-3 py-2 text-[11px] font-semibold rounded-lg ${pathname === '/admin/inventory' ? 'text-teal-400' : 'text-slate-500 hover:text-slate-200'}`}>Stock Levels</Link>
                  <Link href="/admin/shipments" className={`block px-3 py-2 text-[11px] font-semibold rounded-lg ${pathname === '/admin/shipments' ? 'text-teal-400' : 'text-slate-500 hover:text-slate-200'}`}>Shipments</Link>
                  <Link href="/admin/catalog" className={`block px-3 py-2 text-[11px] font-semibold rounded-lg ${pathname === '/admin/catalog' ? 'text-teal-400' : 'text-slate-500 hover:text-slate-200'}`}>Categories &amp; Tax</Link>
                </div>
              )}
            </div>

            {/* 6. Purchases Group */}
            <div>
              <button
                type="button"
                onClick={() => toggleGroup('purchases')}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/5 text-slate-400 hover:text-white transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <Truck className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-semibold">Purchases</span>
                </div>
                {openGroups.purchases ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {openGroups.purchases && (
                <div className="pl-6 pr-2 mt-1 space-y-1 border-l border-white/5 ml-5">
                  <Link href="/admin/purchase-orders" className={`block px-3 py-2 text-[11px] font-semibold rounded-lg ${pathname === '/admin/purchase-orders' ? 'text-teal-400' : 'text-slate-500 hover:text-slate-200'}`}>PO purchase orders</Link>
                  <Link href="/admin/vendors" className={`block px-3 py-2 text-[11px] font-semibold rounded-lg ${pathname === '/admin/vendors' ? 'text-teal-400' : 'text-slate-500 hover:text-slate-200'}`}>Suppliers</Link>
                </div>
              )}
            </div>

            {/* 7. Finance Group */}
            <div>
              <button
                type="button"
                onClick={() => toggleGroup('finance')}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/5 text-slate-400 hover:text-white transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <Wallet className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-semibold">Finance</span>
                </div>
                {openGroups.finance ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {openGroups.finance && (
                <div className="pl-6 pr-2 mt-1 space-y-1 border-l border-white/5 ml-5">
                  <Link href="/admin/invoices" className={`block px-3 py-2 text-[11px] font-semibold rounded-lg ${pathname === '/admin/invoices' ? 'text-teal-400' : 'text-slate-500 hover:text-slate-200'}`}>Invoices</Link>
                  <Link href="/admin/receipts" className={`block px-3 py-2 text-[11px] font-semibold rounded-lg ${pathname === '/admin/receipts' ? 'text-teal-400' : 'text-slate-500 hover:text-slate-200'}`}>Payments In (Receipts)</Link>
                  <Link href="/admin/expenses" className={`block px-3 py-2 text-[11px] font-semibold rounded-lg ${pathname === '/admin/expenses' ? 'text-teal-400' : 'text-slate-500 hover:text-slate-200'}`}>Expenses</Link>
                  <Link href="/admin/credit-memos" className={`block px-3 py-2 text-[11px] font-semibold rounded-lg ${pathname === '/admin/credit-memos' ? 'text-teal-400' : 'text-slate-500 hover:text-slate-200'}`}>Credit Notes</Link>
                </div>
              )}
            </div>

            {/* 8. Reports */}
            <Link
              href="/admin/analytics"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                pathname === '/admin/analytics'
                  ? 'bg-gradient-to-tr from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/15 border border-white/10'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <BarChart3 className="w-4 h-4 shrink-0" />
              <span className="text-xs font-semibold">Reports</span>
            </Link>

            {/* 9. Automation */}
            <Link
              href="/admin/automation"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                pathname === '/admin/automation'
                  ? 'bg-gradient-to-tr from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/15 border border-white/10'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Cpu className="w-4 h-4 shrink-0" />
              <span className="text-xs font-semibold">Automation</span>
            </Link>

            {/* 10. Settings */}
            <Link
              href="/admin/settings"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                pathname === '/admin/settings'
                  ? 'bg-gradient-to-tr from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/15 border border-white/10'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span className="text-xs font-semibold">Settings</span>
            </Link>
          </nav>

          <div className="p-4 border-t border-white/5 shrink-0">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 w-full transition-all"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-xs font-semibold">Logout</span>
            </button>
          </div>
        </aside>

        {/* Unified Application View Port */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          
          {/* Header containing search matching metrics */}
          <header className="h-16 bg-slate-950/40 border-b border-white/5 flex items-center justify-between px-6 shrink-0 backdrop-filter backdrop-blur-xl">
            
            {/* Header Universal Search Input */}
            <div ref={searchRef} className="relative w-96 z-40">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-teal-400 transition-colors" />
                <input
                  type="text"
                  placeholder="Ctrl + K search databases..."
                  value={globalSearch}
                  onFocus={() => setSearchFocused(true)}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  className="w-full bg-slate-900/60 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 focus:bg-slate-950/80 transition-all font-semibold"
                />
                
                {/* Visual hotkey indicator */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pointer-events-none">
                  <span className="text-[10px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded font-mono tracking-tighter">⌘</span>
                  <span className="text-[10px] bg-slate-800 text-slate-500 px-1 py-0.5 rounded font-mono">K</span>
                </div>
              </div>

              {/* Dynamic search results overlay panel */}
              {searchFocused && (globalSearch.trim() || searchResults.length > 0) && (
                <div className="absolute top-full left-0 right-0 mt-2 p-2 bg-slate-950/90 border border-white/10 rounded-xl shadow-[0_15px_30px_rgba(0,0,0,0.6)] backdrop-filter backdrop-blur-xl max-h-[300px] overflow-y-auto space-y-1">
                  {searching ? (
                    <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
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
                        className="w-full p-2 hover:bg-white/5 rounded-lg flex items-center justify-between text-left transition-colors"
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-200">{r.title}</p>
                          <p className="text-[10px] text-slate-500">{r.subtitle}</p>
                        </div>
                        <span className="text-[9px] bg-teal-500/10 text-teal-400 border border-teal-500/25 px-1.5 py-0.5 rounded font-bold uppercase">{r.type}</span>
                      </button>
                    ))
                  ) : (
                    <p className="text-center py-4 text-xs text-slate-500">No results found for &ldquo;{globalSearch}&rdquo;</p>
                  )}
                </div>
              )}
            </div>

            {/* Notification & profile layout actions */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotificationsOpen(!notificationsOpen)}
                  className="p-2.5 rounded-xl bg-slate-900 border border-white/5 hover:bg-slate-800 text-slate-400 hover:text-white transition-all relative"
                  aria-label="Alerts"
                >
                  <Bell className="w-4 h-4" />
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-teal-400 rounded-full animate-pulse" />
                </button>

                {/* Notifications Drawer */}
                {notificationsOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setNotificationsOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-72 p-3 bg-slate-950/95 border border-white/10 rounded-xl shadow-2xl z-50 backdrop-filter backdrop-blur-xl space-y-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Alerts &amp; Updates</p>
                      <div className="space-y-1.5 divide-y divide-white/5 text-[11px]">
                        <div className="pt-1.5">
                          <p className="font-semibold text-slate-200">System Alert: Low Stock</p>
                          <p className="text-slate-500 text-[10px]">3 products fell below safety thresholds.</p>
                        </div>
                        <div className="pt-1.5">
                          <p className="font-semibold text-slate-200">New RFQ Received</p>
                          <p className="text-slate-500 text-[10px]">Received a wholesale request from ABC Traders.</p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="h-8 w-px bg-white/10 mx-1" />

              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400 font-bold text-xs uppercase shadow-sm">
                  AD
                </div>
                <div className="hidden md:block leading-none text-left">
                  <span className="text-xs font-semibold text-slate-200 block">Admin Office</span>
                  <span className="text-[9px] text-slate-500 font-medium">Headquarters</span>
                </div>
              </div>
            </div>
          </header>

          {/* Main Inner Content Body */}
          <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[#080d19] p-6 text-slate-200">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
