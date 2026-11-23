'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, Package, Search, Trash2, X } from 'lucide-react';
import adminApi, { uploadApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { StockAttentionBanner } from '@/components/admin/StockAttentionBanner';
import SearchableProductDropdown, { type ProductOption } from '@/components/admin/SearchableProductDropdown';
import NumberInput from '@/components/admin/NumberInput';
import { sellingBelowMin, minSellingPrice } from '@/lib/min-selling-price';
import { formatStockDifference, physicalCountPreview } from '@/lib/physical-count';
import { toastBarcodeNotFound, toastProductAdded } from '@/lib/barcode-feedback';
import InventoryStatement, { type InventoryStatementData } from '@/components/admin/InventoryStatement';

interface InventoryItem {
  id: string;
  product_id?: string;
  sku?: string;
  name: string;
  image_url?: string;
  category_name?: string;
  sub_category_name?: string;
  stock_quantity: number;
  damaged_quantity?: number;
  low_stock_threshold: number;
  category_id?: string;
  sub_category_id?: string;
  cost_price?: number;
  price?: number;
  best_vendor_id?: string;
  best_vendor_name?: string;
  best_unit_cost?: number;
}

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function lineValue(unit: number | undefined, qty: number): string {
  if (unit == null || !Number.isFinite(unit)) return '—';
  return money(unit * qty);
}

interface Category {
  id: string;
  name: string;
}

interface SubCategory {
  id: string;
  name: string;
  category_id: string;
}

interface PriceGroupOption {
  id: string;
  name: string;
  product_count?: number;
}

interface AdjustLine {
  product_id: string;
  product_name: string;
  sku?: string;
  current_stock: number;
  quantity_change: number;
  cost_price: number | '';
  selling_price: number | '';
  line_notes: string;
}

interface CountLine {
  product_id: string;
  product_name: string;
  sku?: string;
  current_stock: number;
  counted_quantity: number | '';
  line_notes: string;
}

interface StockSheetLine {
  product_id: string;
  product_name: string;
  sku?: string | null;
  quantity_before: number;
  quantity_change: number;
  quantity_after: number;
  counted_quantity?: number | null;
  notes?: string | null;
  cost_before?: number | null;
  cost_after?: number | null;
  price_before?: number | null;
  price_after?: number | null;
}

interface StockSheet {
  id: string;
  kind: 'adjustment' | 'physical_count';
  number: string;
  barcode: string;
  notes?: string | null;
  created_at?: string;
  line_count?: number;
  lines: StockSheetLine[];
  barcode_png?: string | null;
}

interface MovementRow {
  id: string;
  movement_type_label?: string;
  movement_type?: string;
  movement_type_canonical?: string;
  quantity_before?: number | null;
  quantity_change: number;
  quantity_after?: number | null;
  reference_type?: string | null;
  reference_number?: string | null;
  reason?: string | null;
  notes?: string | null;
  performed_by?: string | null;
  created_at?: string;
}

const MOVEMENT_TYPE_FALLBACK: Record<string, string> = {
  PURCHASE: 'Purchase',
  SALE: 'Sale',
  RETURN_IN: 'Return in',
  RETURN_OUT: 'Return out',
  CREDIT_MEMO: 'Credit memo',
  SHIPMENT_IN: 'Shipment in',
  SHIPMENT_OUT: 'Shipment out',
  PHYSICAL_COUNT: 'Physical count',
  ADJUSTMENT: 'Adjustment',
};

function movementTypeLabel(row: MovementRow): string {
  // Opening stock is recorded as ADJUSTMENT + reference_type "opening" (see openingStockMovement.ts).
  if (String(row.reference_type || '').toLowerCase() === 'opening') return 'Opening';
  if (row.movement_type_label) return row.movement_type_label;
  const key = String(row.movement_type_canonical || row.movement_type || '');
  if (MOVEMENT_TYPE_FALLBACK[key]) return MOVEMENT_TYPE_FALLBACK[key];
  if (!key) return '—';
  return key.replace(/_/g, ' ');
}

function movementReferenceLabel(row: MovementRow): string {
  const num = row.reference_number?.trim();
  const type = row.reference_type?.trim();
  const typeLabel = type
    ? type
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase())
    : '';
  if (num && typeLabel) return `${typeLabel} · ${num}`;
  if (num) return num;
  if (typeLabel) return typeLabel;
  return '—';
}

const ADJUST_LINES = 12;
const COUNT_LINES = 12;

function emptyAdjustLine(): AdjustLine {
  return {
    product_id: '',
    product_name: '',
    sku: '',
    current_stock: 0,
    quantity_change: 0,
    cost_price: '',
    selling_price: '',
    line_notes: '',
  };
}

function emptyCountLine(): CountLine {
  return {
    product_id: '',
    product_name: '',
    sku: '',
    current_stock: 0,
    counted_quantity: '',
    line_notes: '',
  };
}

function pricesFromProduct(product: { cost_price?: number; price?: number }): Pick<AdjustLine, 'cost_price' | 'selling_price'> {
  const cost = Number(product.cost_price);
  const sell = Number(product.price);
  return {
    cost_price: Number.isFinite(cost) && cost !== 0 ? cost : '',
    selling_price: Number.isFinite(sell) && sell !== 0 ? sell : '',
  };
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="flex justify-center h-64 items-center"><div className="animate-spin rounded-full h-10 w-10 border-2 border-teal-500 border-t-transparent" /></div>}>
      <InventoryPageInner />
    </Suspense>
  );
}

function InventoryPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [subCategoryFilter, setSubCategoryFilter] = useState('');
  const [reorderFilter, setReorderFilter] = useState<'all' | 'required' | 'good'>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'low_stock' | 'out_of_stock'>('all');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [selectedReorderIds, setSelectedReorderIds] = useState<Set<string>>(new Set());
  const [vendors, setVendors] = useState<Array<{ id: string; name: string }>>([]);
  const [damageTarget, setDamageTarget] = useState<InventoryItem | null>(null);
  const [damageQty, setDamageQty] = useState('1');
  const [damageVendorId, setDamageVendorId] = useState('');
  const [damageSaving, setDamageSaving] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showSubcategoryModal, setShowSubcategoryModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustLines, setAdjustLines] = useState<AdjustLine[]>(() => Array.from({ length: ADJUST_LINES }, emptyAdjustLine));
  const [adjustScan, setAdjustScan] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [priceGroups, setPriceGroups] = useState<PriceGroupOption[]>([]);
  const [selectedPriceGroupId, setSelectedPriceGroupId] = useState('');
  const [showNewPriceGroupModal, setShowNewPriceGroupModal] = useState(false);
  const [newPriceGroupName, setNewPriceGroupName] = useState('');
  const [priceGroupLoading, setPriceGroupLoading] = useState(false);
  const adjustSavingRef = useRef(false);
  const adjustScanRef = useRef<HTMLInputElement>(null);
  const [showCountModal, setShowCountModal] = useState(false);
  const [countLines, setCountLines] = useState<CountLine[]>(() => Array.from({ length: COUNT_LINES }, emptyCountLine));
  const [countScan, setCountScan] = useState('');
  const [countNotes, setCountNotes] = useState('');
  const [countSaving, setCountSaving] = useState(false);
  const countSavingRef = useRef(false);
  const countScanRef = useRef<HTMLInputElement>(null);
  const trackScanRef = useRef<HTMLInputElement>(null);
  const [sheetMenu, setSheetMenu] = useState<null | 'adjustment' | 'physical_count'>(null);
  const [previousKind, setPreviousKind] = useState<null | 'adjustment' | 'physical_count'>(null);
  const [previousSheets, setPreviousSheets] = useState<StockSheet[]>([]);
  const [selectedSheetIds, setSelectedSheetIds] = useState<Set<string>>(new Set());
  const [printSheets, setPrintSheets] = useState<StockSheet[] | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [previousLoading, setPreviousLoading] = useState(false);
  const [invoiceSheet, setInvoiceSheet] = useState<StockSheet | null>(null);
  const [trackOpen, setTrackOpen] = useState(false);
  const [trackCode, setTrackCode] = useState('');
  const [statementMenuOpen, setStatementMenuOpen] = useState(false);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statement, setStatement] = useState<InventoryStatementData | null>(null);
  const [historyProduct, setHistoryProduct] = useState<InventoryItem | null>(null);
  const [historyRows, setHistoryRows] = useState<MovementRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyTypeFilter, setHistoryTypeFilter] = useState('');
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    item_category: '',
    item_subcategory: '',
    reorder_level: '10',
    physical_count: '' as number | '',
    selling_price: '' as number | '',
    cost_price: '' as number | '',
    image_url: '',
  });

  const fetchProducts = async () => {
    try {
      const [res, ratesRes] = await Promise.all([
        adminApi.get('/products', { params: { limit: 5000, visibility: 'all' } }),
        adminApi.get('/vendors/best-rates').catch(() => ({ data: { rates: [] } })),
      ]);
      const rates = new Map<string, { vendor_id: string; vendor_name: string; unit_cost: number }>();
      for (const row of ratesRes.data?.rates || []) {
        rates.set(String(row.product_id), {
          vendor_id: row.vendor_id,
          vendor_name: row.vendor_name,
          unit_cost: Number(row.unit_cost) || 0,
        });
      }
      const list = (res.data.products || []).map((p: any) => {
        const best = rates.get(String(p.id));
        return {
          id: p.id,
          product_id: p.product_id ? String(p.product_id) : undefined,
          sku: p.sku,
          name: p.name,
          image_url: p.image_url || undefined,
          category_name: p.category_name,
          sub_category_name: p.sub_category_name,
          stock_quantity: p.stock_quantity ?? 0,
          damaged_quantity: p.damaged_quantity ?? 0,
          low_stock_threshold: p.low_stock_threshold ?? 10,
          category_id: p.category_id,
          sub_category_id: p.sub_category_id,
          cost_price: p.cost_price != null ? Number(p.cost_price) : undefined,
          price: p.price != null ? Number(p.price) : undefined,
          best_vendor_id: best?.vendor_id,
          best_vendor_name: best?.vendor_name,
          best_unit_cost: best?.unit_cost,
        };
      });
      setItems(list);
    } catch {
      toast.error('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  };

  const fetchVendors = async () => {
    try {
      const res = await adminApi.get('/vendors', { params: { limit: 5000 } });
      const list = (res.data.vendors || []).map((v: { id: string; name: string }) => ({
        id: String(v.id),
        name: v.name || 'Supplier',
      }));
      setVendors(list.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)));
    } catch {
      setVendors([]);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await adminApi.get('/categories');
      setCategories(Array.isArray(res.data) ? res.data : []);
    } catch {
      setCategories([]);
    }
  };

  const fetchSubCategories = async () => {
    try {
      const res = await adminApi.get('/sub-categories');
      setSubCategories(Array.isArray(res.data) ? res.data : []);
    } catch {
      setSubCategories([]);
    }
  };

  const fetchPriceGroups = async () => {
    try {
      const res = await adminApi.get('/price-groups');
      const groups = Array.isArray(res.data) ? res.data : [];
      setPriceGroups(
        groups.map((g: PriceGroupOption) => ({
          id: String(g.id),
          name: g.name || '',
          product_count: g.product_count,
        }))
      );
    } catch {
      setPriceGroups([]);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchProducts(), fetchVendors(), fetchCategories(), fetchSubCategories()]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (showItemModal || showCategoryModal || showSubcategoryModal) {
      fetchCategories();
      fetchSubCategories();
    }
  }, [showItemModal, showCategoryModal, showSubcategoryModal]);

  const clearSheetQuery = () => {
    if (searchParams.get('count') === '1' || searchParams.get('adjust') === '1') {
      router.replace('/admin/inventory');
    }
  };

  const openAdjust = () => {
    setAdjustLines(Array.from({ length: ADJUST_LINES }, emptyAdjustLine));
    setAdjustScan('');
    setAdjustNotes('');
    setSelectedPriceGroupId('');
    setShowAdjustModal(true);
    setSheetMenu(null);
    clearSheetQuery();
    void fetchPriceGroups();
    window.setTimeout(() => adjustScanRef.current?.focus(), 50);
  };

  const closeAdjust = () => {
    if (adjustSaving) return;
    setShowAdjustModal(false);
    setSelectedPriceGroupId('');
    if (searchParams.get('adjust') === '1') router.replace('/admin/inventory');
  };

  const loadPriceGroupIntoAdjust = async (groupId: string) => {
    if (!groupId) return;
    setPriceGroupLoading(true);
    try {
      const { data } = await adminApi.get<{
        id: string;
        name: string;
        products: Array<{
          id: string;
          name: string;
          sku?: string;
          stock_quantity?: number;
          cost_price?: number;
          price?: number;
        }>;
      }>(`/price-groups/${groupId}`);
      const products = data.products || [];
      if (products.length === 0) {
        toast.error(`"${data.name}" has no products yet. Add products from the Products page.`);
        setAdjustLines(Array.from({ length: ADJUST_LINES }, emptyAdjustLine));
        return;
      }
      const lines: AdjustLine[] = products.map((p) => ({
        product_id: p.id,
        product_name: p.name,
        sku: p.sku || '',
        current_stock: p.stock_quantity ?? 0,
        quantity_change: 0,
        line_notes: '',
        ...pricesFromProduct(p),
      }));
      // Keep at least one empty row for manual adds
      lines.push(emptyAdjustLine());
      setAdjustLines(lines);
      toast.success(`Loaded ${products.length} product(s) from "${data.name}"`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load price group');
    } finally {
      setPriceGroupLoading(false);
    }
  };

  const handlePriceGroupSelect = (value: string) => {
    if (value === '__new__') {
      setNewPriceGroupName('');
      setShowNewPriceGroupModal(true);
      return;
    }
    setSelectedPriceGroupId(value);
    if (value) void loadPriceGroupIntoAdjust(value);
  };

  const createPriceGroupFromAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newPriceGroupName.trim();
    if (!name) {
      toast.error('Enter a price group name');
      return;
    }
    try {
      const { data } = await adminApi.post<PriceGroupOption>('/price-groups', { name });
      setPriceGroups((prev) => [...prev, { id: data.id, name: data.name, product_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedPriceGroupId(data.id);
      setShowNewPriceGroupModal(false);
      setNewPriceGroupName('');
      toast.success(`Created price group "${data.name}"`);
      setAdjustLines(Array.from({ length: ADJUST_LINES }, emptyAdjustLine));
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create price group');
    }
  };

  const fillDownCostPrice = () => {
    const first = adjustLines.find((l) => l.product_id);
    if (!first || first.cost_price === '') {
      toast.error('Set a cost price on the first product first');
      return;
    }
    const value = first.cost_price;
    setAdjustLines((prev) => prev.map((l) => (l.product_id ? { ...l, cost_price: value } : l)));
  };

  const fillDownSellingPrice = () => {
    const first = adjustLines.find((l) => l.product_id);
    if (!first || first.selling_price === '') {
      toast.error('Set a selling price on the first product first');
      return;
    }
    const value = first.selling_price;
    setAdjustLines((prev) => prev.map((l) => (l.product_id ? { ...l, selling_price: value } : l)));
  };

  const openCount = () => {
    setCountLines(Array.from({ length: COUNT_LINES }, emptyCountLine));
    setCountScan('');
    setCountNotes('');
    setShowCountModal(true);
    setSheetMenu(null);
    clearSheetQuery();
    window.setTimeout(() => countScanRef.current?.focus(), 50);
  };

  const closeCount = () => {
    if (countSaving) return;
    setShowCountModal(false);
    if (searchParams.get('count') === '1') router.replace('/admin/inventory');
  };

  const openCountMenu = () => setSheetMenu('physical_count');
  const openAdjustMenu = () => setSheetMenu('adjustment');

  const loadPrevious = async (kind: 'adjustment' | 'physical_count') => {
    setPreviousKind(kind);
    setPreviousLoading(true);
    setSelectedSheetIds(new Set());
    setSheetMenu(null);
    clearSheetQuery();
    try {
      const { data } = await adminApi.get<{ sheets: StockSheet[] }>('/inventory/adjustment-sheets', { params: { kind } });
      setPreviousSheets(data.sheets || []);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load saved documents');
      setPreviousSheets([]);
    } finally {
      setPreviousLoading(false);
    }
  };

  const openInvoice = async (id: string) => {
    try {
      const { data } = await adminApi.get<StockSheet>(`/inventory/adjustment-sheets/${id}`);
      setInvoiceSheet(data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to open adjustment');
    }
  };

  const deleteSheet = async (sheet: StockSheet) => {
    if (!confirm(`Delete ${sheet.number}? Stock changed by this document will be reversed. It cannot be edited.`)) return;
    try {
      await adminApi.delete(`/inventory/adjustment-sheets/${sheet.id}`);
      toast.success(`${sheet.number} deleted`);
      if (invoiceSheet?.id === sheet.id) setInvoiceSheet(null);
      if (previousKind) await loadPrevious(previousKind);
      fetchProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete adjustment');
    }
  };

  const deleteSelectedSheets = async () => {
    const chosen = previousSheets.filter((sheet) => selectedSheetIds.has(sheet.id));
    if (chosen.length === 0) return;
    const ordered = [...chosen].sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
    if (
      !confirm(
        `Delete ${ordered.length} ${ordered.length === 1 ? 'document' : 'documents'}? Stock changed by them will be reversed.\n\n${ordered.map((sheet) => sheet.number).join('\n')}`
      )
    ) {
      return;
    }
    const removed: string[] = [];
    let stopped: string | null = null;
    for (const sheet of ordered) {
      try {
        await adminApi.delete(`/inventory/adjustment-sheets/${sheet.id}`);
        removed.push(sheet.number);
      } catch (err: any) {
        stopped = `${sheet.number}: ${err.response?.data?.error || 'Could not delete'}`;
        break;
      }
    }
    if (removed.length) toast.success(`Deleted ${removed.join(', ')}`);
    if (stopped) toast.error(stopped);
    if (previousKind) await loadPrevious(previousKind);
    fetchProducts();
  };

  const printSelectedSheets = async () => {
    const chosen = previousSheets.filter((sheet) => selectedSheetIds.has(sheet.id));
    if (chosen.length === 0) return;
    setPrintLoading(true);
    try {
      const details = await Promise.all(
        chosen.map((sheet) => adminApi.get<StockSheet>(`/inventory/adjustment-sheets/${sheet.id}`).then((res) => res.data))
      );
      setPrintSheets(details);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to prepare the print');
    } finally {
      setPrintLoading(false);
    }
  };

  const openStatement = async (period: 'day' | 'week' | 'twoweeks' | 'month' | 'year') => {
    setStatementMenuOpen(false);
    const to = new Date();
    const from = new Date(to);
    if (period === 'day') from.setDate(from.getDate() - 1);
    else if (period === 'week') from.setDate(from.getDate() - 7);
    else if (period === 'twoweeks') from.setDate(from.getDate() - 14);
    else if (period === 'month') from.setMonth(from.getMonth() - 1);
    else from.setFullYear(from.getFullYear() - 1);
    setStatementLoading(true);
    try {
      const { data } = await adminApi.get<InventoryStatementData>('/inventory/statement', {
        params: { from: from.toISOString(), to: to.toISOString() },
      });
      setStatement(data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to build the inventory statement');
    } finally {
      setStatementLoading(false);
    }
  };

  const lookupAdjustmentBarcode = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    try {
      const { data } = await adminApi.get<StockSheet>(`/inventory/adjustment-sheets/barcode/${encodeURIComponent(trimmed)}`);
      setInvoiceSheet(data);
      setTrackOpen(false);
      setTrackCode('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'No adjustment matches that barcode');
    }
  };

  useEffect(() => {
    if (searchParams.get('count') === '1') openCountMenu();
    else if (searchParams.get('adjust') === '1') openAdjustMenu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const outOfStockCount = items.filter((p) => (p.stock_quantity ?? 0) <= 0).length;
  const lowStockCount = items.filter((p) => {
    const qty = p.stock_quantity ?? 0;
    return qty > 0 && qty <= (p.low_stock_threshold || 10);
  }).length;

  const needsReorder = (p: InventoryItem) => (p.stock_quantity ?? 0) <= (p.low_stock_threshold || 10);

  const filtered = items
    .filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.product_id && p.product_id.toLowerCase().includes(q))
      );
    })
    .filter((p) => {
      if (stockFilter === 'out_of_stock') return (p.stock_quantity ?? 0) <= 0;
      if (stockFilter === 'low_stock') {
        const qty = p.stock_quantity ?? 0;
        return qty > 0 && qty <= (p.low_stock_threshold || 10);
      }
      return true;
    })
    .filter((p) => !categoryFilter || p.category_id === categoryFilter)
    .filter((p) => !subCategoryFilter || p.sub_category_id === subCategoryFilter)
    .filter((p) => {
      if (reorderFilter === 'required') return needsReorder(p);
      if (reorderFilter === 'good') return !needsReorder(p);
      return true;
    })
    .filter((p) => !supplierFilter || p.best_vendor_id === supplierFilter);

  const supplierOptions = Array.from(
    new Map(
      [
        ...vendors.map((v) => [v.id, v.name] as [string, string]),
        ...items
          .filter((p) => p.best_vendor_id && p.best_vendor_name)
          .map((p) => [p.best_vendor_id as string, p.best_vendor_name as string] as [string, string]),
      ]
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const createPoFromSelection = () => {
    const selected = filtered.filter((p) => selectedReorderIds.has(p.id));
    if (!selected.length) {
      toast.error('Select products to reorder');
      return;
    }
    const vendorIds = [...new Set(selected.map((p) => p.best_vendor_id).filter(Boolean))];
    const vendorId = supplierFilter || (vendorIds.length === 1 ? String(vendorIds[0]) : '');
    if (!vendorId) {
      toast.error('Filter to one supplier, then select products');
      return;
    }
    if (vendorIds.length > 1 && !supplierFilter) {
      toast.error('Filter to one supplier, or select products that share the same best supplier');
      return;
    }
    const lines = selected.map((p) => ({
      product_id: p.id,
      product_name: p.name,
      qty: Math.max(1, (p.low_stock_threshold || 10) - (p.stock_quantity || 0)),
      unit_cost: p.best_unit_cost ?? p.cost_price ?? 0,
    }));
    const params = new URLSearchParams({
      create: '1',
      vendor_id: vendorId,
      lines: JSON.stringify(lines),
    });
    router.push(`/admin/purchase-orders?${params.toString()}`);
  };

  const clearItemForm = () => {
    setForm({
      item_category: '',
      item_subcategory: '',
      reorder_level: '10',
      physical_count: '',
      selling_price: '',
      cost_price: '',
      image_url: '',
    });
  };

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size must be less than 5MB');
      return;
    }
    setImageUploading(true);
    try {
      const body = new FormData();
      body.append('image', file);
      const response = await uploadApi.post('/upload/image', body);
      const imageUrl = response.data?.url;
      if (!imageUrl) {
        toast.error('Upload failed');
        return;
      }
      setForm((f) => ({ ...f, image_url: imageUrl }));
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setImageUploading(false);
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const selling = form.selling_price === '' ? undefined : Number(form.selling_price);
    const cost = form.cost_price === '' ? undefined : Number(form.cost_price);
    if (selling != null && (!Number.isFinite(selling) || selling < 0)) {
      toast.error('Selling price must be 0 or greater');
      return;
    }
    if (cost != null && (!Number.isFinite(cost) || cost < 0)) {
      toast.error('Cost price must be 0 or greater');
      return;
    }
    if (selling != null && cost != null && sellingBelowMin(selling, cost)) {
      toast.error(`Selling price must be at least 5% above cost. Minimum is $${minSellingPrice(cost).toFixed(2)}.`);
      return;
    }
    let counted: number | null = null;
    if (form.physical_count !== '') {
      counted = Math.trunc(Number(form.physical_count));
      if (!Number.isFinite(counted) || counted < 0) {
        toast.error('Physical count must be a whole number 0 or greater');
        return;
      }
    }
    try {
      await adminApi.put(`/products/${editing.id}`, {
        category_id: form.item_category || null,
        sub_category_id: form.item_subcategory || null,
        low_stock_threshold: parseInt(form.reorder_level, 10) || 10,
        ...(selling != null ? { price: selling } : {}),
        ...(cost != null ? { cost_price: cost } : {}),
        image_url: form.image_url || '',
      });

      if (counted != null) {
        const current = editing.stock_quantity ?? 0;
        if (counted !== current) {
          await adminApi.post('/inventory/physical-count', {
            lines: [
              {
                product_id: editing.id,
                counted_quantity: counted,
                expected_current_quantity: current,
              },
            ],
            reason: 'PHYSICAL_COUNT',
          });
        }
      }

      toast.success('Item updated');
      setShowItemModal(false);
      setEditing(null);
      clearItemForm();
      fetchProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    }
  };

  const openEdit = (item: InventoryItem) => {
    setEditing(item);
    setForm({
      item_category: item.category_id || '',
      item_subcategory: item.sub_category_id || '',
      reorder_level: String(item.low_stock_threshold ?? 10),
      physical_count: '',
      selling_price: item.price != null ? item.price : '',
      cost_price: item.cost_price != null ? item.cost_price : '',
      image_url: item.image_url || '',
    });
    setShowItemModal(true);
  };

  const productOptions: ProductOption[] = items.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    stock_quantity: p.stock_quantity,
    category_name: p.category_name,
    cost_price: p.cost_price,
    price: p.price,
  }));

  const addAdjustProduct = (product: {
    id: string;
    name: string;
    sku?: string;
    stock_quantity?: number;
    cost_price?: number;
    price?: number;
  }) => {
    let addedNew = false;
    setAdjustLines((prev) => {
      const existingIdx = prev.findIndex((l) => l.product_id === product.id);
      if (existingIdx !== -1) return prev;
      addedNew = true;
      const emptyIdx = prev.findIndex((l) => !l.product_id);
      const line: AdjustLine = {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        current_stock: product.stock_quantity ?? 0,
        quantity_change: 0,
        line_notes: '',
        ...pricesFromProduct(product),
      };
      if (emptyIdx === -1) return [...prev, line];
      const next = [...prev];
      next[emptyIdx] = line;
      return next;
    });
    if (addedNew) toastProductAdded(product.name);
    setAdjustScan('');
    window.setTimeout(() => adjustScanRef.current?.focus(), 0);
  };

  const selectAdjustLine = (index: number, product: ProductOption) => {
    setAdjustLines((prev) => {
      const existingIdx = prev.findIndex((l, i) => i !== index && l.product_id === product.id);
      const next = [...prev];
      if (existingIdx !== -1) {
        next[existingIdx] = {
          ...next[existingIdx],
          quantity_change: next[existingIdx].quantity_change || next[index].quantity_change || 0,
        };
        next[index] = emptyAdjustLine();
        return next;
      }
      next[index] = {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        current_stock: product.stock_quantity ?? 0,
        quantity_change: 0,
        line_notes: next[index].line_notes || '',
        ...pricesFromProduct(product),
      };
      return next;
    });
  };

  const addCountProduct = (product: { id: string; name: string; sku?: string; stock_quantity?: number }) => {
    const outcome = { kind: 'added' as 'duplicate' | 'added' };
    setCountLines((prev) => {
      if (prev.some((l) => l.product_id === product.id)) {
        outcome.kind = 'duplicate';
        return prev;
      }
      const emptyIdx = prev.findIndex((l) => !l.product_id);
      const line: CountLine = {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        current_stock: product.stock_quantity ?? 0,
        counted_quantity: '',
        line_notes: '',
      };
      if (emptyIdx === -1) return [...prev, line];
      const next = [...prev];
      next[emptyIdx] = line;
      return next;
    });
    if (outcome.kind === 'duplicate') toast.error('That product is already on this count');
    else toastProductAdded(product.name);
    setCountScan('');
    window.setTimeout(() => countScanRef.current?.focus(), 0);
  };

  const selectCountLine = (index: number, product: ProductOption) => {
    setCountLines((prev) => {
      if (prev.some((l, i) => i !== index && l.product_id === product.id)) {
        toast.error('That product is already on this count');
        return prev;
      }
      const next = [...prev];
      next[index] = {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        current_stock: product.stock_quantity ?? 0,
        counted_quantity: next[index].counted_quantity,
        line_notes: next[index].line_notes || '',
      };
      return next;
    });
  };

  const scanCountBarcode = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const listed = items.find(
      (p) => p.sku === trimmed || p.id === trimmed || p.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (listed) {
      addCountProduct(listed);
      return;
    }
    adminApi
      .get(`/products/barcode/${encodeURIComponent(trimmed)}`)
      .then((r) => {
        const p = r.data;
        if (p?.id) addCountProduct({ id: p.id, name: p.name, sku: p.sku, stock_quantity: p.stock_quantity });
      })
      .catch(() => toastBarcodeNotFound());
  };

  const savePhysicalCount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (countSavingRef.current) return;
    const valid = countLines.filter((l) => l.product_id && l.counted_quantity !== '');
    if (valid.length === 0) {
      toast.error('Enter a physical count for at least one product');
      return;
    }
    for (const line of valid) {
      const counted = Number(line.counted_quantity);
      if (!Number.isInteger(counted) || counted < 0) {
        toast.error(`"${line.product_name}" physical count must be a whole number 0 or greater`);
        return;
      }
    }
    const previewLines = valid.map((line) => {
      const counted = Number(line.counted_quantity);
      const current = Number(line.current_stock) || 0;
      const preview = physicalCountPreview(current, counted);
      const adjustment = preview.difference ?? 0;
      return { name: line.product_name, current, counted, adjustment, newStock: preview.newQty ?? counted };
    });
    const changing = previewLines.filter((l) => l.adjustment !== 0);
    const summary = previewLines
      .slice(0, 8)
      .map(
        (l) =>
          `${l.name}: Current: ${l.current} · Counted: ${l.counted} · Adjustment: ${formatStockDifference(l.adjustment)} · New stock: ${l.newStock}`
      )
      .join('\n');
    const more = previewLines.length > 8 ? `\n…and ${previewLines.length - 8} more line(s)` : '';
    const outcomeNote =
      changing.length === 0
        ? 'All counted quantities match current stock. No stock quantity will change.'
        : 'This will change stock for lines where counted differs from current.';
    if (!confirm(`Confirm physical count?\n\n${summary}${more}\n\n${outcomeNote}`)) {
      return;
    }
    countSavingRef.current = true;
    setCountSaving(true);
    try {
      const res = await adminApi.post('/inventory/physical-count', {
        lines: valid.map((l) => ({
          product_id: l.product_id,
          counted_quantity: Math.trunc(Number(l.counted_quantity)),
          expected_current_quantity: l.current_stock,
          line_notes: l.line_notes.trim() || undefined,
        })),
        reason: 'PHYSICAL_COUNT',
        notes: countNotes || undefined,
      });
      const changed = (res.data.lines || []).filter((row: { changed?: boolean }) => row.changed).length;
      const ref = res.data.reference_number;
      toast.success(
        changed
          ? `Physical count saved${ref ? ` · ${ref}` : ''} · ${changed} ${changed === 1 ? 'item' : 'items'} updated`
          : `Physical count saved${ref ? ` · ${ref}` : ''}. No stock change.`
      );
      if (res.data?.id) void openInvoice(res.data.id);
      fetchProducts();
      setShowCountModal(false);
      if (searchParams.get('count') === '1') router.replace('/admin/inventory');
    } catch (err: any) {
      const data = err.response?.data;
      if (err.response?.status === 409 && data?.code === 'STOCK_CONFLICT') {
        toast.error(
          data.product_name
            ? `"${data.product_name}" is now ${data.actual_current_quantity} on hand (was ${data.expected_current_quantity}). Recount that line.`
            : data.error || 'Stock changed since this count started.'
        );
      } else if (data?.code === 'MONGO_REPLICA_SET_REQUIRED') {
        toast.error(data.error || 'MongoDB must run as a replica set for physical count.');
      } else {
        toast.error(data?.error || 'Failed to save physical count');
      }
    } finally {
      countSavingRef.current = false;
      setCountSaving(false);
    }
  };

  const openHistory = async (item: InventoryItem) => {
    setHistoryProduct(item);
    setHistoryLoading(true);
    setHistoryRows([]);
    setHistoryTypeFilter('');
    try {
      const res = await adminApi.get(`/inventory/movements/${item.id}`, { params: { limit: 50 } });
      setHistoryRows(res.data.movements || []);
    } catch {
      toast.error('Failed to load stock history');
    } finally {
      setHistoryLoading(false);
    }
  };

  const scanAdjustBarcode = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const listed = items.find(
      (p) => p.sku === trimmed || p.id === trimmed || p.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (listed) {
      addAdjustProduct(listed);
      return;
    }
    adminApi
      .get(`/products/barcode/${encodeURIComponent(trimmed)}`)
      .then((r) => {
        const p = r.data;
        if (p?.id) {
          addAdjustProduct({
            id: p.id,
            name: p.name,
            sku: p.sku,
            stock_quantity: p.stock_quantity,
            cost_price: p.cost_price,
            price: p.price,
          });
        }
      })
      .catch(() => toastBarcodeNotFound());
  };

  const saveAdjustments = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adjustSavingRef.current) return;
    const valid = adjustLines.filter(
      (l) => l.product_id && (l.quantity_change !== 0 || l.cost_price !== '' || l.selling_price !== '')
    );
    if (valid.length === 0) {
      toast.error('Add at least one product to adjust stock or prices');
      return;
    }
    for (const line of valid) {
      const cost = line.cost_price === '' ? null : Number(line.cost_price);
      const sell = line.selling_price === '' ? null : Number(line.selling_price);
      if (sell != null && cost != null && sellingBelowMin(sell, cost)) {
        toast.error(
          `"${line.product_name}" selling price must be at least $${minSellingPrice(cost).toFixed(2)} (5% above cost).`
        );
        return;
      }
    }
    const stockLines = valid.filter((l) => Math.trunc(Number(l.quantity_change) || 0) !== 0);
    if (stockLines.length > 0) {
      const summary = stockLines
        .slice(0, 8)
        .map((l) => {
          const delta = Math.trunc(Number(l.quantity_change) || 0);
          const current = Number(l.current_stock) || 0;
          const next = current + delta;
          return `${l.product_name}: Current: ${current} · Adjustment: ${formatStockDifference(delta)} · New stock: ${next}`;
        })
        .join('\n');
      const more = stockLines.length > 8 ? `\n…and ${stockLines.length - 8} more line(s)` : '';
      const reason = adjustNotes.trim() ? `\nReason: ${adjustNotes.trim()}` : '';
      if (
        !confirm(
          `Confirm stock adjustment?\n\n${summary}${more}${reason}\n\nThis will change inventory.`
        )
      ) {
        return;
      }
    }
    adjustSavingRef.current = true;
    setAdjustSaving(true);
    try {
      const { data } = await adminApi.post<StockSheet>('/inventory/adjustment-sheets', {
        notes: adjustNotes.trim() || undefined,
        lines: valid.map((line) => {
          const payload: {
            product_id: string;
            quantity_change: number;
            line_notes?: string;
            cost_price?: number;
            price?: number;
          } = {
            product_id: line.product_id,
            quantity_change: Math.trunc(Number(line.quantity_change) || 0),
            line_notes: line.line_notes.trim() || undefined,
          };
          if (line.cost_price !== '') payload.cost_price = Number(line.cost_price);
          if (line.selling_price !== '') payload.price = Number(line.selling_price);
          return payload;
        }),
      });
      toast.success(`Adjustment saved · ${data.number}`);
      setInvoiceSheet(data);
      fetchProducts();
      setShowAdjustModal(false);
      if (searchParams.get('adjust') === '1') router.replace('/admin/inventory');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save adjustment');
    } finally {
      adjustSavingRef.current = false;
      setAdjustSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this item? It can be reactivated later.')) return;
    try {
      await adminApi.delete(`/products/${id}`);
      toast.success('Item deactivated');
      fetchProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col items-start gap-2">
          <h1 className="text-2xl font-semibold text-[#0F172A] tracking-tight">Inventory management</h1>
          <Link
            href="/admin/inventory/damaged"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[#334155] border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] font-semibold text-xs"
          >
            Damaged products
          </Link>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap justify-end ml-auto">
          <button
            type="button"
            onClick={openCountMenu}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[#0F9F8F] border border-[#0F9F8F]/30 bg-[#0F9F8F]/5 hover:bg-[#0F9F8F]/10 font-bold text-xs transition-all"
          >
            <Package className="w-4 h-4" />
            Physical count
          </button>
          <button
            type="button"
            onClick={openAdjustMenu}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[#334155] border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] font-bold text-xs transition-all"
          >
            Stock adjustments
          </button>
          <button
            type="button"
            onClick={() => {
              setTrackCode('');
              setTrackOpen(true);
              window.setTimeout(() => trackScanRef.current?.focus(), 50);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[#334155] border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] font-bold text-xs transition-all"
          >
            Track adjustment
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setStatementMenuOpen((open) => !open)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[#334155] border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] font-bold text-xs transition-all"
            >
              Inventory statement
            </button>
            {statementMenuOpen && (
              <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-[#E2E8F0] bg-white py-1 shadow-lg">
                {(
                  [
                    ['day', 'Last day'],
                    ['week', 'Last week'],
                    ['twoweeks', 'Last 2 weeks'],
                    ['month', 'Last month'],
                    ['year', 'Last year'],
                  ] as const
                ).map(([period, label]) => (
                  <button
                    key={period}
                    type="button"
                    onClick={() => void openStatement(period)}
                    className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC]"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <StockAttentionBanner
        outOfStockCount={outOfStockCount}
        lowStockCount={lowStockCount}
        onSeeOutOfStock={() => setStockFilter('out_of_stock')}
        onSeeLowStock={() => setStockFilter('low_stock')}
      />
      {stockFilter !== 'all' && (
        <p className="text-sm text-[#6B6C72] -mt-3">
          Showing {stockFilter === 'low_stock' ? 'low stock' : 'out of stock'} items.{' '}
          <button type="button" onClick={() => setStockFilter('all')} className="text-[#0077C5] hover:underline font-medium">
            Show all
          </button>
        </p>
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name, product ID, or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-[#E2E8F0] rounded-lg text-xs text-[#0F172A] placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0F9F8F] focus:border-[#0F9F8F]"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => {
            const next = e.target.value;
            setCategoryFilter(next);
            setSubCategoryFilter((current) => {
              if (!current) return '';
              const stillValid = subCategories.some((s) => s.id === current && (!next || s.category_id === next));
              return stillValid ? current : '';
            });
          }}
          className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-xs text-[#0F172A] bg-white"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={subCategoryFilter}
          onChange={(e) => setSubCategoryFilter(e.target.value)}
          className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-xs text-[#0F172A] bg-white"
        >
          <option value="">All subcategories</option>
          {subCategories
            .filter((s) => !categoryFilter || s.category_id === categoryFilter)
            .map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
        </select>
        <select
          value={reorderFilter}
          onChange={(e) => setReorderFilter(e.target.value as 'all' | 'required' | 'good')}
          className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-xs text-[#0F172A] bg-white"
        >
          <option value="all">All reorder statuses</option>
          <option value="required">Reorder required</option>
          <option value="good">Stock good</option>
        </select>
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-xs text-[#0F172A] bg-white"
        >
          <option value="">All suppliers</option>
          {supplierOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        {supplierFilter && (
          <button
            type="button"
            onClick={createPoFromSelection}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white bg-[#0F9F8F] hover:bg-[#0B8275] font-bold text-xs"
          >
            Create new purchase order{selectedReorderIds.size > 0 ? ` (${selectedReorderIds.size})` : ''}
          </button>
        )}
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
        <div className="flex flex-wrap gap-8 border-b border-[#E2E8F0] px-4 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Whole inventory purchase value</p>
            <p className="mt-1 text-xl font-semibold text-[#0F172A]">{money(items.reduce((sum, item) => sum + (item.cost_price != null && Number.isFinite(item.cost_price) ? item.cost_price * (item.stock_quantity || 0) : 0), 0))}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Whole inventory estimated sales</p>
            <p className="mt-1 text-xl font-semibold text-[#0F172A]">{money(items.reduce((sum, item) => sum + (item.price != null && Number.isFinite(item.price) ? item.price * (item.stock_quantity || 0) : 0), 0))}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Products</p>
            <p className="mt-1 text-xl font-semibold text-[#0F172A]">{items.length}</p>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[1280px]">
              <thead className="bg-[#F8FAFC] text-[#64748B] border-b border-[#E2E8F0]">
                <tr>
                  <th className="w-10 px-4 py-3.5" />
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Product ID</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Name</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">SKU</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Category</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Subcategory</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Remaining stock</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Damaged</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Buffer level</th>
                  <th className="text-center py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Reorder status</th>
                  <th className="text-left py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Best supplier</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Purchase value</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Estimated sale value</th>
                  <th className="text-right py-3.5 px-4 text-[10px] font-bold uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="py-16 text-center text-slate-500 text-xs font-semibold">
                      No inventory logs detected.
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const reorderRequired = needsReorder(p);
                    return (
                      <tr key={p.id} className={`border-b border-[#E2E8F0] transition-colors hover:bg-[#F8FAFC] ${reorderRequired ? 'bg-rose-50/60' : ''}`}>
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            aria-label={`Select ${p.name}`}
                            checked={selectedReorderIds.has(p.id)}
                            onChange={() => {
                              setSelectedReorderIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.id)) next.delete(p.id);
                                else next.add(p.id);
                                return next;
                              });
                            }}
                            className="h-4 w-4 rounded border-[#C7C7C7] accent-black cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-xs font-mono font-semibold text-[#0F172A]">{p.product_id || '—'}</td>
                        <td className="py-3 px-4 text-xs font-semibold text-[#0F172A]">{p.name}</td>
                        <td className="py-3 px-4 text-xs font-mono text-[#475569]">{p.sku || '—'}</td>
                        <td className="py-3 px-4 text-xs text-[#475569]">{p.category_name || '—'}</td>
                        <td className="py-3 px-4 text-xs text-[#475569]">{p.sub_category_name || '—'}</td>
                        <td className={`py-3 px-4 text-xs text-right font-extrabold font-mono ${reorderRequired ? 'text-rose-600' : 'text-[#0F172A]'}`}>{p.stock_quantity}</td>
                        <td className={`py-3 px-4 text-xs text-right font-extrabold font-mono ${(p.damaged_quantity || 0) > 0 ? 'text-red-600' : 'text-[#94A3B8]'}`}>
                          {(p.damaged_quantity || 0) > 0 ? p.damaged_quantity : '—'}
                        </td>
                        <td className="py-3 px-4 text-xs text-right font-mono text-[#475569]">{p.low_stock_threshold ?? 10}</td>
                        <td className="py-3 px-4 text-center text-xs">
                          {reorderRequired ? (
                            <span className="inline-flex px-2 py-0.5 rounded text-[9px] font-bold border bg-rose-50 text-rose-700 border-rose-200 uppercase tracking-wider">Required</span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 rounded text-[9px] font-bold border border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] uppercase tracking-wider">Stock Good</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-[#0F172A]">
                          {p.best_vendor_id && p.best_vendor_name ? (
                            <button
                              type="button"
                              onClick={() => setSupplierFilter(p.best_vendor_id || '')}
                              className="text-left text-[#0F9F8F] hover:underline font-semibold"
                            >
                              {p.best_vendor_name}
                              {p.best_unit_cost != null ? (
                                <span className="block text-[10px] text-[#64748B] font-mono font-normal">${Number(p.best_unit_cost).toFixed(2)}</span>
                              ) : null}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-right font-mono text-[#0F172A]">{lineValue(p.cost_price, p.stock_quantity)}</td>
                        <td className="py-3 px-4 text-xs text-right font-mono text-[#0F172A]">{lineValue(p.price, p.stock_quantity)}</td>
                        <td className="py-3 px-4 text-right text-xs">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                setDamageTarget(p);
                                setDamageQty('1');
                                setDamageVendorId(p.best_vendor_id || '');
                              }}
                              className="text-red-600 hover:underline font-semibold"
                            >
                              Damage
                            </button>
                            <button type="button" onClick={() => openHistory(p)} className="text-[#64748B] hover:text-[#0F9F8F] hover:underline font-semibold">
                              History
                            </button>
                            <button type="button" onClick={() => openEdit(p)} className="text-[#0F9F8F] hover:underline font-semibold">
                              Edit
                            </button>
                            <button type="button" onClick={() => handleDelete(p.id)} className="text-[#64748B] hover:text-rose-600 hover:underline font-semibold">
                              Deactivate
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdjustModal && (
        <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={closeAdjust}>
          <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Stock adjustment</h2>
              <button type="button" onClick={closeAdjust} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={saveAdjustments} className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  This screen <span className="font-semibold">adds or subtracts</span> units (delta). To enter a warehouse total, use{' '}
                  <button
                    type="button"
                    className="font-semibold text-[#0F9F8F] hover:underline"
                    onClick={() => {
                      closeAdjust();
                      openCount();
                    }}
                  >
                    Physical count
                  </button>
                  . Columns: current stock, adjustment qty (the change), new stock.
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[220px]">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Price group</label>
                    <select
                      value={selectedPriceGroupId}
                      onChange={(e) => handlePriceGroupSelect(e.target.value)}
                      disabled={priceGroupLoading}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white disabled:opacity-50"
                    >
                      <option value="">Select price group…</option>
                      <option value="__new__">+ Add price group</option>
                      {priceGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}{g.product_count != null ? ` (${g.product_count})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 flex items-center gap-2 min-w-[280px]">
                    <label className="block text-sm font-medium text-gray-700 shrink-0">Product or service</label>
                    <input
                      ref={adjustScanRef}
                      type="text"
                      value={adjustScan}
                      onChange={(e) => setAdjustScan(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        scanAdjustBarcode(adjustScan);
                      }}
                      placeholder="Scan barcode / item ID and press Enter"
                      className="flex-1 max-w-xs pl-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                    />
                    <Link href="/admin/products/new" className="text-sm text-[#0F9F8F] font-medium hover:underline whitespace-nowrap">+ Add product</Link>
                  </div>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[920px]">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left py-3 px-4 w-10">#</th>
                        <th className="text-left py-3 px-4 min-w-[240px]">Product</th>
                        <th className="text-left py-3 px-4 min-w-[120px]">SKU</th>
                        <th className="text-right py-3 px-4 w-28">Current stock</th>
                        <th className="text-right py-3 px-4 w-32">Adjustment qty</th>
                        <th className="text-right py-3 px-4 w-28">New stock</th>
                        <th className="text-right py-3 px-4 w-36">
                          <span className="inline-flex items-center justify-end gap-1 w-full">
                            Cost price
                            <button
                              type="button"
                              title="Apply first cost price to all rows"
                              onClick={fillDownCostPrice}
                              className="p-0.5 rounded hover:bg-gray-200 text-gray-600"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        </th>
                        <th className="text-right py-3 px-4 w-36">
                          <span className="inline-flex items-center justify-end gap-1 w-full">
                            Selling price
                            <button
                              type="button"
                              title="Apply first selling price to all rows"
                              onClick={fillDownSellingPrice}
                              className="p-0.5 rounded hover:bg-gray-200 text-gray-600"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        </th>
                        <th className="text-left py-3 px-4 min-w-[160px]">Notes</th>
                        <th className="w-12 px-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {adjustLines.map((line, idx) => {
                        const hasProduct = !!line.product_id;
                        const newStock = line.current_stock + (Number(line.quantity_change) || 0);
                        return (
                          <tr key={idx} className={`border-t border-gray-100 hover:bg-gray-50/50 ${hasProduct && newStock < 0 ? 'bg-red-50' : ''}`}>
                            <td className="py-2 px-4">{idx + 1}</td>
                            <td className="py-2 px-4">
                              <SearchableProductDropdown
                                products={productOptions}
                                value={line.product_id}
                                displayName={line.product_name || undefined}
                                showPrice={false}
                                onSelect={(p) => selectAdjustLine(idx, p)}
                                onBarcodeScan={scanAdjustBarcode}
                                placeholder="Search product or scan barcode…"
                              />
                            </td>
                            <td className="py-2 px-4 text-gray-600">{hasProduct ? (line.sku || '—') : ''}</td>
                            <td className="py-2 px-4 text-right text-gray-600">{hasProduct ? line.current_stock : ''}</td>
                            <td className="py-2 px-4 text-right">
                              {hasProduct ? (
                                <NumberInput
                                  step={1}
                                  showZero
                                  value={line.quantity_change}
                                  onValueChange={(n) => {
                                    setAdjustLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], quantity_change: n === '' ? 0 : n };
                                      return next;
                                    });
                                  }}
                                  className={`w-24 text-right border rounded px-2 py-1 ${newStock < 0 ? 'border-red-400 text-red-700 bg-red-50' : 'border-gray-300'}`}
                                />
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className={`py-2 px-4 text-right font-medium ${newStock < 0 ? 'text-red-700' : ''}`}>
                              {hasProduct ? newStock : ''}
                            </td>
                            <td className="py-2 px-4 text-right">
                              {hasProduct ? (
                                <NumberInput
                                  value={line.cost_price}
                                  onValueChange={(n) => {
                                    setAdjustLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], cost_price: n };
                                      return next;
                                    });
                                  }}
                                  className="w-24 text-right border border-gray-300 rounded px-2 py-1"
                                />
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="py-2 px-4 text-right">
                              {hasProduct ? (
                                <NumberInput
                                  value={line.selling_price}
                                  onValueChange={(n) => {
                                    setAdjustLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], selling_price: n };
                                      return next;
                                    });
                                  }}
                                  className={`w-24 text-right border rounded px-2 py-1 ${
                                    line.cost_price !== '' &&
                                    line.selling_price !== '' &&
                                    sellingBelowMin(Number(line.selling_price), Number(line.cost_price))
                                      ? 'border-red-400 text-red-700 bg-red-50'
                                      : 'border-gray-300'
                                  }`}
                                />
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="py-2 px-4">
                              {hasProduct ? (
                                <input
                                  type="text"
                                  value={line.line_notes}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setAdjustLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], line_notes: value };
                                      return next;
                                    });
                                  }}
                                  placeholder="Optional"
                                  className="w-full min-w-[140px] border border-gray-300 rounded px-2 py-1 text-sm"
                                />
                              ) : null}
                            </td>
                            <td className="py-2 px-4">
                              {hasProduct && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAdjustLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = emptyAdjustLine();
                                      return next;
                                    });
                                  }}
                                  className="text-red-600 hover:bg-red-50 p-1 rounded"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">Scan or search a product. Adjustment qty starts at 0. Positive qty adds stock, negative qty deducts. Cost and selling prices stay as listed unless you change them. Line notes are optional.</p>
                  <button
                    type="button"
                    onClick={() => setAdjustLines((prev) => [...prev, emptyAdjustLine()])}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    + Add line
                  </button>
                </div>
                <div className="max-w-md">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                  <input
                    type="text"
                    value={adjustNotes}
                    onChange={(e) => setAdjustNotes(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Reason for this adjustment"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
                <button type="button" onClick={closeAdjust} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={adjustSaving} className="px-4 py-2 bg-black text-white rounded-lg hover:bg-[#2C2C2C] disabled:opacity-50">
                  {adjustSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCountModal && (
        <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={closeCount}>
          <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Physical count</h2>
                <p className="text-sm text-gray-500 mt-0.5">Enter the total units on the shelf. The system calculates the difference from current stock.</p>
              </div>
              <button type="button" onClick={closeCount} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={savePhysicalCount} className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <label className="block text-sm font-medium text-gray-700">Product</label>
                  <div className="flex-1 flex gap-2 items-center">
                    <input
                      ref={countScanRef}
                      type="text"
                      value={countScan}
                      onChange={(e) => setCountScan(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        scanCountBarcode(countScan);
                      }}
                      placeholder="Scan barcode / item ID and press Enter"
                      className="flex-1 max-w-xs pl-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                    />
                    <Link href="/admin/products/new" className="text-sm text-[#0F9F8F] font-medium hover:underline">+ Add product</Link>
                  </div>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[920px]">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left py-3 px-4 w-10">#</th>
                        <th className="text-left py-3 px-4 min-w-[240px]">Product</th>
                        <th className="text-left py-3 px-4 min-w-[120px]">SKU</th>
                        <th className="text-right py-3 px-4 w-36">Current system qty</th>
                        <th className="text-right py-3 px-4 w-36">Physical count</th>
                        <th className="text-right py-3 px-4 w-28">Difference</th>
                        <th className="text-right py-3 px-4 w-36">New system qty</th>
                        <th className="text-left py-3 px-4 min-w-[160px]">Notes</th>
                        <th className="w-12 px-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {countLines.map((line, idx) => {
                        const hasProduct = !!line.product_id;
                        const preview = physicalCountPreview(line.current_stock, line.counted_quantity);
                        return (
                          <tr key={idx} className={`border-t border-gray-100 hover:bg-gray-50/50 ${hasProduct && preview.difference != null && preview.difference !== 0 ? 'bg-teal-50/40' : ''}`}>
                            <td className="py-2 px-4">{idx + 1}</td>
                            <td className="py-2 px-4">
                              <SearchableProductDropdown
                                products={productOptions}
                                value={line.product_id}
                                displayName={line.product_name || undefined}
                                showPrice={false}
                                onSelect={(p) => selectCountLine(idx, p)}
                                onBarcodeScan={scanCountBarcode}
                                placeholder="Search product or scan barcode…"
                              />
                            </td>
                            <td className="py-2 px-4 text-gray-600">{hasProduct ? (line.sku || '—') : ''}</td>
                            <td className="py-2 px-4 text-right text-gray-600 font-mono">{hasProduct ? line.current_stock : ''}</td>
                            <td className="py-2 px-4 text-right">
                              {hasProduct ? (
                                <NumberInput
                                  step={1}
                                  showZero
                                  min={0}
                                  value={line.counted_quantity}
                                  onValueChange={(n) => {
                                    setCountLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], counted_quantity: n === '' ? '' : Math.trunc(n) };
                                      return next;
                                    });
                                  }}
                                  className="w-24 text-right border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                                  placeholder="Count"
                                />
                              ) : null}
                            </td>
                            <td className={`py-2 px-4 text-right font-mono font-semibold ${preview.difference == null ? 'text-gray-300' : preview.difference > 0 ? 'text-emerald-700' : preview.difference < 0 ? 'text-rose-600' : 'text-gray-500'}`}>
                              {hasProduct && preview.difference != null ? formatStockDifference(preview.difference) : ''}
                            </td>
                            <td className="py-2 px-4 text-right font-mono font-semibold text-gray-900">
                              {hasProduct && preview.newQty != null ? preview.newQty : ''}
                            </td>
                            <td className="py-2 px-4">
                              {hasProduct ? (
                                <input
                                  type="text"
                                  value={line.line_notes}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setCountLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], line_notes: value };
                                      return next;
                                    });
                                  }}
                                  placeholder="Optional"
                                  className="w-full min-w-[140px] border border-gray-300 rounded px-2 py-1 text-sm"
                                />
                              ) : null}
                            </td>
                            <td className="py-2 px-4">
                              {hasProduct && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCountLines((prev) => {
                                      const next = [...prev];
                                      next[idx] = emptyCountLine();
                                      return next;
                                    });
                                  }}
                                  className="text-red-600 hover:bg-red-50 p-1 rounded"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">Physical count is the total on hand, not a plus/minus. Difference and new qty are previews; the server recalculates on save. All lines save together or none do.</p>
                  <button
                    type="button"
                    onClick={() => setCountLines((prev) => [...prev, emptyCountLine()])}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    + Add line
                  </button>
                </div>
                <div className="max-w-md">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                  <input
                    type="text"
                    value={countNotes}
                    onChange={(e) => setCountNotes(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Warehouse recount"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
                <button type="button" onClick={closeCount} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={countSaving} className="px-4 py-2 bg-black text-white rounded-lg hover:bg-[#2C2C2C] disabled:opacity-50">
                  {countSaving ? 'Saving…' : 'Save physical count'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyProduct && (
        <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setHistoryProduct(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Stock history</h2>
                <p className="text-sm text-gray-500 mt-0.5">{historyProduct.name}{historyProduct.sku ? ` · ${historyProduct.sku}` : ''}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Positive change increases stock; negative decreases it. Labels come from recorded movement types.
                </p>
              </div>
              <button type="button" onClick={() => setHistoryProduct(null)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!historyLoading && historyRows.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-medium text-gray-600">Filter type</label>
                  <select
                    value={historyTypeFilter}
                    onChange={(e) => setHistoryTypeFilter(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="">All types</option>
                    {Array.from(
                      new Set(
                        historyRows.map((r) => movementTypeLabel(r)).filter((l) => l && l !== '—')
                      )
                    )
                      .sort()
                      .map((label) => (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              {historyLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-500 border-t-transparent" />
                </div>
              ) : historyRows.length === 0 ? (
                <div className="py-10 text-center space-y-1">
                  <p className="text-sm font-medium text-gray-700">No stock movements yet</p>
                  <p className="text-sm text-gray-500">
                    Purchases, sales, returns, counts, and adjustments for this product will appear here once recorded.
                  </p>
                </div>
              ) : (
                (() => {
                  const filteredHistory = historyTypeFilter
                    ? historyRows.filter((row) => movementTypeLabel(row) === historyTypeFilter)
                    : historyRows;
                  if (filteredHistory.length === 0) {
                    return (
                      <p className="text-sm text-gray-500 py-8 text-center">
                        No movements match this type filter.
                      </p>
                    );
                  }
                  return (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-2 px-3">Date/time</th>
                      <th className="text-left py-2 px-3">Type</th>
                      <th className="text-right py-2 px-3">Before</th>
                      <th className="text-right py-2 px-3">Change</th>
                      <th className="text-right py-2 px-3">After</th>
                      <th className="text-left py-2 px-3">Reference</th>
                      <th className="text-left py-2 px-3">Notes</th>
                      <th className="text-left py-2 px-3">User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map((row) => {
                      const delta = Number(row.quantity_change) || 0;
                      return (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="py-2 px-3 whitespace-nowrap text-gray-600">
                          {row.created_at
                            ? new Date(row.created_at).toLocaleString(undefined, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td className="py-2 px-3">{movementTypeLabel(row)}</td>
                        <td className="py-2 px-3 text-right font-mono">{row.quantity_before ?? '—'}</td>
                        <td
                          className={`py-2 px-3 text-right font-mono font-semibold ${
                            delta > 0 ? 'text-emerald-700' : delta < 0 ? 'text-rose-700' : 'text-gray-700'
                          }`}
                        >
                          {formatStockDifference(delta)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{row.quantity_after ?? '—'}</td>
                        <td className="py-2 px-3 text-xs">{movementReferenceLabel(row)}</td>
                        <td className="py-2 px-3 text-gray-600">{row.notes?.trim() || '—'}</td>
                        <td className="py-2 px-3">{row.performed_by || '—'}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                  );
                })()
              )}
            </div>
          </div>
        </div>
      )}

      {showItemModal && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowItemModal(false)}>
          <div className="bg-white border border-[#E2E8F0] rounded-xl text-[#0F172A] max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSaveItem} className="p-5 space-y-5">
              <div className="flex items-start gap-4">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]"
                  aria-label="Change product picture"
                >
                  {form.image_url ? (
                    <img src={form.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center px-2 text-center text-[10px] font-semibold text-[#64748B]">Add picture</span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-[9px] font-semibold text-white">
                    {imageUploading ? 'Uploading…' : 'Edit'}
                  </span>
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImageUpload(file);
                    e.target.value = '';
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-bold text-[#0F172A]">{editing.name}</h2>
                    <button type="button" onClick={() => setShowItemModal(false)} className="p-1.5 rounded-lg text-[#64748B] hover:bg-[#F1F5F9]" aria-label="Close">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-[#64748B]">
                    Product ID {editing.product_id || '—'} · SKU {editing.sku || '—'}
                  </p>
                  <p className="mt-0.5 text-xs text-[#64748B]">
                    Best supplier: {editing.best_vendor_name || '—'}
                  </p>
                </div>
              </div>

              {(() => {
                const preview = physicalCountPreview(editing.stock_quantity ?? 0, form.physical_count);
                const differenceClass =
                  preview.difference == null
                    ? 'text-[#64748B]'
                    : preview.difference > 0
                      ? 'text-emerald-700'
                      : preview.difference < 0
                        ? 'text-rose-600'
                        : 'text-[#0F172A]';
                return (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Current system count</label>
                      <div className="w-full border border-[#E2E8F0] bg-[#F8FAFC] rounded-lg px-3 py-2 text-sm font-mono text-[#0F172A]">
                        {editing.stock_quantity ?? 0}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Physical count</label>
                      <NumberInput
                        min={0}
                        step={1}
                        value={form.physical_count}
                        onValueChange={(n) => setForm((f) => ({ ...f, physical_count: n === '' ? '' : Math.trunc(n) }))}
                        placeholder="Enter count"
                        className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Difference</label>
                      <div className={`w-full border border-[#E2E8F0] bg-[#F8FAFC] rounded-lg px-3 py-2 text-sm font-mono font-semibold ${differenceClass}`}>
                        {preview.difference == null ? '—' : formatStockDifference(preview.difference)}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Selling price</label>
                  <NumberInput
                    min={0}
                    step={0.01}
                    showZero
                    value={form.selling_price}
                    onValueChange={(n) => setForm((f) => ({ ...f, selling_price: n }))}
                    className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Cost price</label>
                  <NumberInput
                    min={0}
                    step={0.01}
                    showZero
                    value={form.cost_price}
                    onValueChange={(n) => setForm((f) => ({ ...f, cost_price: n }))}
                    className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Buffer level</label>
                <NumberInput
                  min={0}
                  value={form.reorder_level}
                  onValueChange={(n) => setForm((f) => ({ ...f, reorder_level: n === '' ? '' : String(Math.trunc(n)) }))}
                  className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Category</label>
                  <select
                    value={form.item_category}
                    onChange={(e) => {
                      const categoryId = e.target.value;
                      setForm((f) => ({
                        ...f,
                        item_category: categoryId,
                        item_subcategory: subCategories.some((s) => s.id === f.item_subcategory && s.category_id === categoryId)
                          ? f.item_subcategory
                          : '',
                      }));
                    }}
                    className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A] bg-white"
                  >
                    <option value="">Select category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Subcategory</label>
                  <select
                    value={form.item_subcategory}
                    onChange={(e) => setForm((f) => ({ ...f, item_subcategory: e.target.value }))}
                    className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A] bg-white"
                  >
                    <option value="">Select subcategory</option>
                    {subCategories
                      .filter((s) => !form.item_category || s.category_id === form.item_category)
                      .map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                  </select>
                </div>
              </div>

              {(() => {
                const qtyLeft = editing.stock_quantity ?? 0;
                const costUnit = form.cost_price === '' ? undefined : Number(form.cost_price);
                const sellUnit = form.selling_price === '' ? undefined : Number(form.selling_price);
                return (
                  <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Purchase value</p>
                      <p className="mt-1 text-lg font-semibold text-[#0F172A]">{lineValue(costUnit, qtyLeft)}</p>
                      <p className="text-[11px] text-[#64748B]">Cost × qty left ({qtyLeft})</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Estimated sales</p>
                      <p className="mt-1 text-lg font-semibold text-[#0F172A]">{lineValue(sellUnit, qtyLeft)}</p>
                      <p className="text-[11px] text-[#64748B]">Selling price × qty left ({qtyLeft})</p>
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end gap-2.5 pt-1">
                <button type="button" onClick={() => setShowItemModal(false)} className="px-4 py-2.5 border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC] rounded-lg text-xs font-semibold">
                  Close
                </button>
                <button type="submit" disabled={imageUploading} className="px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] text-white rounded-lg text-xs font-bold disabled:opacity-50">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewPriceGroupModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowNewPriceGroupModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Add price group</h3>
            <p className="text-sm text-gray-500 mb-4">Name the group, then add products from the Products page.</p>
            <form onSubmit={createPriceGroupFromAdjust}>
              <input
                type="text"
                value={newPriceGroupName}
                onChange={(e) => setNewPriceGroupName(e.target.value)}
                placeholder="Price group name…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowNewPriceGroupModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg text-sm">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-black text-white rounded-lg text-sm hover:bg-[#2C2C2C]">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTypeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-955/80 backdrop-blur-sm p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] max-w-sm w-full p-6">
            <h3 className="text-sm font-bold text-white mb-3 uppercase tracking-wider text-slate-400 text-[10px]">Add Item Type</h3>
            <p className="text-slate-450 text-xs mb-5">Create a parent category type list to associate inventory assets.</p>
            <button type="button" onClick={() => { setShowTypeModal(false); setShowCategoryModal(true); }} className="w-full px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] text-white rounded-xl text-xs font-bold shadow-sm transition-all">
              Go to Category Registry
            </button>
            <button type="button" onClick={() => setShowTypeModal(false)} className="w-full mt-2 px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold transition-all">
              Cancel
            </button>
          </div>
        </div>
      )}

      {showCategoryModal && (
        <AddCategoryModal
          onClose={() => setShowCategoryModal(false)}
          onSaved={() => {
            fetchCategories();
            setShowCategoryModal(false);
            toast.success('Category added');
          }}
        />
      )}

      {showSubcategoryModal && (
        <AddSubcategoryModal
          categories={categories}
          onClose={() => setShowSubcategoryModal(false)}
          onSaved={() => {
            fetchSubCategories();
            setShowSubcategoryModal(false);
            toast.success('Subcategory added');
          }}
        />
      )}

      {sheetMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setSheetMenu(null); clearSheetQuery(); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900">
              {sheetMenu === 'physical_count' ? 'Physical count' : 'Stock adjustment'}
            </h2>
            <p className="mt-1 text-sm text-gray-500">Open a saved document or start a new one. Saved documents can be viewed or deleted.</p>
            <div className="mt-5 grid grid-cols-2 items-stretch gap-3">
              <button
                type="button"
                onClick={() => void loadPrevious(sheetMenu)}
                className="flex h-11 items-center justify-center rounded-lg border border-gray-300 px-3 text-center text-sm font-semibold leading-tight text-gray-800 hover:bg-gray-50"
              >
                {sheetMenu === 'physical_count' ? 'Show previous count changes' : 'Show previous adjustments'}
              </button>
              <button
                type="button"
                onClick={() => (sheetMenu === 'physical_count' ? openCount() : openAdjust())}
                className="flex h-11 items-center justify-center rounded-lg border border-black bg-black px-3 text-center text-sm font-semibold leading-tight text-white hover:bg-[#2C2C2C]"
              >
                {sheetMenu === 'physical_count' ? 'Create new physical count' : 'Create new stock adjustment'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setSheetMenu(null); clearSheetQuery(); }}
              className="mt-3 w-full py-1.5 text-sm text-gray-500 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {previousKind && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPreviousKind(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {previousKind === 'physical_count' ? 'Previous count changes' : 'Previous adjustment changes'}
              </h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void printSelectedSheets()}
                  disabled={selectedSheetIds.size === 0 || printLoading}
                  className="text-sm font-semibold text-[#0F172A] disabled:text-gray-300"
                >
                  {printLoading ? 'Preparing…' : `Print selected${selectedSheetIds.size > 0 ? ` (${selectedSheetIds.size})` : ''}`}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteSelectedSheets()}
                  disabled={selectedSheetIds.size === 0}
                  className="text-sm font-semibold text-red-600 disabled:text-gray-300"
                >
                  Delete selected{selectedSheetIds.size > 0 ? ` (${selectedSheetIds.size})` : ''}
                </button>
                <button type="button" onClick={() => setPreviousKind(null)} className="text-sm text-gray-500 hover:text-gray-800">Close</button>
              </div>
            </div>
            {previousLoading ? (
              <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
            ) : previousSheets.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">No saved documents yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-10 py-2 px-3">
                      <input
                        type="checkbox"
                        aria-label="Select all documents"
                        checked={previousSheets.length > 0 && previousSheets.every((sheet) => selectedSheetIds.has(sheet.id))}
                        onChange={() => {
                          setSelectedSheetIds((current) => {
                            if (previousSheets.every((sheet) => current.has(sheet.id))) return new Set();
                            return new Set(previousSheets.map((sheet) => sheet.id));
                          });
                        }}
                        className="h-4 w-4 rounded border-gray-300 accent-black"
                      />
                    </th>
                    <th className="text-left py-2 px-3">Number</th>
                    <th className="text-left py-2 px-3">Date</th>
                    <th className="text-right py-2 px-3">Lines</th>
                    <th className="text-left py-2 px-3">Notes</th>
                    <th className="text-right py-2 px-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {previousSheets.map((sheet) => (
                    <tr key={sheet.id} className="border-t border-gray-100">
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${sheet.number}`}
                          checked={selectedSheetIds.has(sheet.id)}
                          onChange={() => {
                            setSelectedSheetIds((current) => {
                              const next = new Set(current);
                              if (next.has(sheet.id)) next.delete(sheet.id);
                              else next.add(sheet.id);
                              return next;
                            });
                          }}
                          className="h-4 w-4 rounded border-gray-300 accent-black"
                        />
                      </td>
                      <td className="py-2 px-3 font-mono font-semibold">{sheet.number}</td>
                      <td className="py-2 px-3 whitespace-nowrap text-gray-600">
                        {sheet.created_at ? new Date(sheet.created_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-2 px-3 text-right">{sheet.line_count ?? sheet.lines?.length ?? 0}</td>
                      <td className="py-2 px-3 text-gray-600">{sheet.notes?.trim() || '—'}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <button type="button" onClick={() => void openInvoice(sheet.id)} className="text-[#0F9F8F] font-semibold mr-3">View</button>
                        <button type="button" onClick={() => void deleteSheet(sheet)} className="text-red-600 font-semibold">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {printSheets && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#E7E5E4] print:static print:bg-white print:overflow-visible">
          <style>{`
            @media print {
              body * { visibility: hidden; }
              .adjustment-print-root, .adjustment-print-root * { visibility: visible; }
              .adjustment-print-root { position: absolute; left: 0; top: 0; width: 100%; background: white; }
              .adjustment-print-toolbar { display: none !important; }
              .adjustment-print-page { break-after: page; page-break-after: always; }
              .adjustment-print-page:last-child { break-after: auto; page-break-after: auto; }
            }
          `}</style>
          <div className="adjustment-print-toolbar sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-stone-300 bg-white px-4 py-3">
            <p className="text-sm font-semibold text-stone-800">{printSheets.length} {printSheets.length === 1 ? 'document' : 'documents'} ready to print</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => window.print()} className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white">
                Print
              </button>
              <button type="button" onClick={() => setPrintSheets(null)} className="rounded-lg px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-100">
                Close
              </button>
            </div>
          </div>
          <div className="adjustment-print-root mx-auto my-6 max-w-3xl space-y-6 print:my-0 print:max-w-none print:space-y-0">
            {printSheets.map((sheet) => (
              <article key={sheet.id} className="adjustment-print-page bg-white px-8 py-8 text-stone-900 shadow-sm print:shadow-none">
                <div className="flex flex-col items-center border-b border-stone-900 pb-4 text-center">
                  {sheet.barcode_png ? (
                    <img src={sheet.barcode_png} alt={`Barcode ${sheet.number}`} className="h-24 w-auto" />
                  ) : null}
                  <p className="mt-2 font-mono text-xl font-bold tracking-wide">{sheet.number}</p>
                  <p className="text-xs text-stone-500">
                    {sheet.kind === 'physical_count' ? 'Physical count' : 'Stock adjustment'}
                    {sheet.created_at ? ` · ${new Date(sheet.created_at).toLocaleString()}` : ''}
                  </p>
                </div>
                <table className="mt-4 w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-300 text-left text-[10px] uppercase tracking-wider text-stone-500">
                      <th className="py-2 pr-2">Product</th>
                      <th className="py-2 pr-2">SKU</th>
                      <th className="py-2 pr-2 text-right">Before</th>
                      <th className="py-2 pr-2 text-right">{sheet.kind === 'physical_count' ? 'Counted' : 'Change'}</th>
                      <th className="py-2 pr-2 text-right">After</th>
                      <th className="py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sheet.lines || []).map((line, idx) => (
                      <tr key={`${sheet.id}-${idx}`} className="border-b border-stone-100">
                        <td className="py-1.5 pr-2">{line.product_name}</td>
                        <td className="py-1.5 pr-2">{line.sku || '—'}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{line.quantity_before}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">
                          {sheet.kind === 'physical_count' ? (line.counted_quantity ?? '—') : formatStockDifference(line.quantity_change)}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono">{line.quantity_after}</td>
                        <td className="py-1.5">{line.notes?.trim() || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-4 text-sm">
                  <span className="font-semibold">Notes: </span>
                  {sheet.notes?.trim() || '—'}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}

      {invoiceSheet && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setInvoiceSheet(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col items-center text-center border-b border-gray-200 pb-4 mb-4">
              {invoiceSheet.barcode_png ? (
                <img src={invoiceSheet.barcode_png} alt="" className="h-16 w-auto" />
              ) : null}
              <p className="mt-2 font-mono text-lg font-bold tracking-wide">{invoiceSheet.number}</p>
              <p className="text-xs text-gray-500">
                {invoiceSheet.kind === 'physical_count' ? 'Physical count' : 'Stock adjustment'}
                {invoiceSheet.created_at ? ` · ${new Date(invoiceSheet.created_at).toLocaleString()}` : ''}
              </p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-3">Product</th>
                  <th className="text-left py-2 px-3">SKU</th>
                  <th className="text-right py-2 px-3">Before</th>
                  <th className="text-right py-2 px-3">{invoiceSheet.kind === 'physical_count' ? 'Counted' : 'Change'}</th>
                  <th className="text-right py-2 px-3">After</th>
                  <th className="text-left py-2 px-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {(invoiceSheet.lines || []).map((line, idx) => (
                  <tr key={`${line.product_id}-${idx}`} className="border-t border-gray-100">
                    <td className="py-2 px-3">{line.product_name}</td>
                    <td className="py-2 px-3 text-gray-600">{line.sku || '—'}</td>
                    <td className="py-2 px-3 text-right font-mono">{line.quantity_before}</td>
                    <td className="py-2 px-3 text-right font-mono">
                      {invoiceSheet.kind === 'physical_count'
                        ? (line.counted_quantity ?? '—')
                        : formatStockDifference(line.quantity_change)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{line.quantity_after}</td>
                    <td className="py-2 px-3 text-gray-600">{line.notes?.trim() || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-sm text-gray-700">
              <span className="font-semibold">Notes: </span>
              {invoiceSheet.notes?.trim() || '—'}
            </p>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setInvoiceSheet(null)} className="px-4 py-2 text-sm font-semibold bg-black text-white rounded-lg">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {statementLoading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
          <p className="rounded-xl bg-white px-6 py-4 text-sm font-medium text-gray-800">Preparing the inventory statement…</p>
        </div>
      )}
      {statement && <InventoryStatement statement={statement} onClose={() => setStatement(null)} />}

      {damageTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDamageTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Mark as damaged</h2>
            <p className="text-sm text-gray-500 mb-4">{damageTarget.name} · {damageTarget.stock_quantity} on hand</p>
            <label className="block text-xs font-semibold mb-1">Quantity</label>
            <input type="number" min={1} value={damageQty} onChange={(e) => setDamageQty(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3" />
            <label className="block text-xs font-semibold mb-1">Supplier</label>
            <select value={damageVendorId} onChange={(e) => setDamageVendorId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4">
              <option value="">Choose supplier</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDamageTarget(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                type="button"
                disabled={damageSaving}
                className="px-4 py-2 text-sm font-semibold bg-black text-white rounded-lg disabled:opacity-40"
                onClick={async () => {
                  if (!damageVendorId) {
                    toast.error('Choose a supplier');
                    return;
                  }
                  setDamageSaving(true);
                  try {
                    await adminApi.post('/inventory/mark-damaged', {
                      product_id: damageTarget.id,
                      quantity: Number(damageQty),
                      vendor_id: damageVendorId,
                    });
                    toast.success('Moved to damaged stock');
                    setDamageTarget(null);
                    fetchProducts();
                  } catch (err: any) {
                    toast.error(err.response?.data?.error || 'Failed to mark damaged');
                  } finally {
                    setDamageSaving(false);
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {trackOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTrackOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Track adjustment</h2>
            <p className="text-sm text-gray-500 mb-4">Scan the barcode on the adjustment invoice, or type the number and press Enter.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void lookupAdjustmentBarcode(trackCode);
              }}
            >
              <input
                ref={trackScanRef}
                type="text"
                value={trackCode}
                onChange={(e) => setTrackCode(e.target.value)}
                placeholder="Scan ADJ barcode"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setTrackOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-semibold bg-black text-white rounded-lg">
                  Open
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function AddCategoryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await adminApi.post('/categories', { name: name.trim() });
      onSaved();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add category');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-955/80 backdrop-blur-sm p-4">
      <div className="bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] max-w-sm w-full p-6">
        <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider text-slate-400 text-[10px]">+ Create Item Category</h3>
        <form onSubmit={handleSubmit}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Category title..." className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-205 focus:outline-none mb-4" autoFocus />
          <div className="flex justify-end gap-2.5">
            <button type="button" onClick={onClose} className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] text-white rounded-xl text-xs font-bold shadow-sm disabled:opacity-40">Save Category</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddSubcategoryModal({ categories, onClose, onSaved }: { categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !categoryId) {
      toast.error('Name and category required');
      return;
    }
    setLoading(true);
    try {
      await adminApi.post('/sub-categories', { name: name.trim(), category_id: categoryId });
      onSaved();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add subcategory');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-955/80 backdrop-blur-sm p-4">
      <div className="bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] max-w-sm w-full p-6">
        <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider text-slate-400 text-[10px]">+ Create Item Subcategory</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wider mb-2">Category *</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full bg-slate-955/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-250 focus:outline-none font-semibold" required>
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wider mb-2">Subcategory name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none" required />
          </div>
          <div className="flex justify-end gap-2.5">
            <button type="button" onClick={onClose} className="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2.5 bg-[#0F9F8F] hover:bg-[#0B8275] text-white rounded-xl text-xs font-bold shadow-sm disabled:opacity-40">Save Subcategory</button>
          </div>
        </form>
      </div>
    </div>
  );
}
