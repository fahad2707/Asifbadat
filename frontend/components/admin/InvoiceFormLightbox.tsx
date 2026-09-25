'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { X, Trash2 } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { downloadPdfFromResponse, openPdfFromResponse } from '@/lib/download-pdf';
import { shareDocumentOnWhatsApp, composeEmailWithPdf } from '@/lib/share-document';
import SearchableProductDropdown, { type ProductOption } from './SearchableProductDropdown';

const LOCATION_OF_SALE = '511 W Germantown Pike, Plymouth Meeting, PA 19462-1303';
const INITIAL_LINES = 15;
/** Payment terms offered on invoices/quotations. Stored as plain text (no schema change). */
export const TERMS_OPTIONS = ['Due on receipt', 'Net 15', 'Net 30', 'Net 60'];

interface Customer {
  id: string;
  customer_code?: string;
  name: string;
  company?: string;
  phone: string;
  email?: string;
  address?: string;
  billing_address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
  cost_price?: number;
  category_name?: string;
  category_slug?: string;
  stock_quantity?: number;
  product_id?: string;
  sku?: string;
}

interface LineItem {
  product_id: string;
  product_name: string;
  category_name: string;
  quantity: number;
  price: number;
  subtotal: number;
  cost_price?: number;
  stock_quantity?: number;
}

export interface InvoiceInitialItem {
  product_id?: string;
  product_name: string;
  category_name?: string;
  quantity: number;
  /** Known selling price (e.g. captured on the RFQ). Used directly; admin can still edit. */
  price?: number;
  cost_price?: number;
}

interface InvoiceFormLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (savedId?: string) => void;
  editId?: string | null;
  initialCustomerId?: string | null;
  initialDocumentType?: 'invoice' | 'quotation';
  /** Prefill line items (e.g. when generating a quotation from an RFQ). */
  initialItems?: InvoiceInitialItem[];
}

export default function InvoiceFormLightbox({ isOpen, onClose, onSaved, editId, initialCustomerId, initialDocumentType, initialItems }: InvoiceFormLightboxProps) {
  const [dirty, setDirty] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const productSearchRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [documentType, setDocumentType] = useState<'invoice' | 'quotation'>('invoice');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [terms, setTerms] = useState('Due on receipt');
  const [taxAmount, setTaxAmount] = useState(0);
  const [selectedTaxTypeId, setSelectedTaxTypeId] = useState('');
  const [taxTypes, setTaxTypes] = useState<{ id: string; name: string; rate: number; rate_type: string }[]>([]);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [customerPrices, setCustomerPrices] = useState<Record<string, number>>({});

  const fetchCustomerPrices = useCallback(async (cid: string) => {
    if (!cid) { setCustomerPrices({}); return; }
    try {
      const res = await adminApi.get(`/invoices/customer-prices/${cid}`);
      setCustomerPrices(res.data || {});
    } catch { setCustomerPrices({}); }
  }, []);

  const fillCustomer = useCallback((c: Customer) => {
    const addr = c.billing_address || [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ');
    setCustomerAddress(addr);
    setCustomerName(c.name);
    setCustomerPhone(c.phone || '');
    setCustomerEmail(c.email || '');
    setDirty(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setDirty(false);
    adminApi.get('/customers', { params: { limit: 500 } }).then((r) => setCustomers(r.data.customers || [])).catch(() => {});
    adminApi.get('/products', { params: { limit: 500 } }).then((r) => setProducts(r.data.products || [])).catch(() => {});
    adminApi.get('/tax-types').then((r) => setTaxTypes(Array.isArray(r.data) ? r.data : [])).catch(() => []);
    if (initialCustomerId && !editId) {
      setCustomerId(initialCustomerId);
      adminApi.get(`/customers/${initialCustomerId}`).then((r) => {
        const c = r.data;
        if (c) {
          setCustomerId(c.id);
          fillCustomer(c);
        }
      }).catch(() => {});
    }
    if (editId) {
      setLoading(true);
      adminApi.get(`/invoices/${editId}`).then((r) => {
        const d = r.data;
        setDocumentType(d.invoice_type === 'quotation' ? 'quotation' : 'invoice');
        setInvoiceNumber(d.invoice_number);
        setInvoiceDate(d.invoice_date ? new Date(d.invoice_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
        setCustomerId(d.customer_id || '');
        setCustomerName(d.customer_name || '');
        setCustomerPhone(d.customer_phone || '');
        setCustomerEmail(d.customer_email || '');
        setCustomerAddress(d.customer_address || '');
        setTerms(d.terms || 'Due on receipt');
        setTaxAmount(Number(d.tax_amount) || 0);
        const items = (d.items || []).map((i: any) => ({
          product_id: i.product_id?.toString() || '',
          product_name: i.product_name || '',
          category_name: i.category_name || '',
          quantity: Number(i.quantity) || 0,
          price: Number(i.price) || 0,
          subtotal: Number(i.subtotal) || 0,
          cost_price: undefined,
        }));
        while (items.length < INITIAL_LINES) items.push({ product_id: '', product_name: '', category_name: '', quantity: 1, price: 0, subtotal: 0 });
        setLines(items.slice(0, INITIAL_LINES));
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      const docType = initialDocumentType || 'invoice';
      setDocumentType(docType);
      setInvoiceDate(new Date().toISOString().slice(0, 10));
      adminApi.get('/invoices/generate-number', { params: { type: docType } }).then((r) => {
        const num = r.data.invoice_number || '';
        setInvoiceNumber(/^INV#\d+|^QTN#\d+/.test(num) ? num : (docType === 'quotation' ? 'QTN#001' : 'INV#001'));
      }).catch(() => setInvoiceNumber(docType === 'quotation' ? 'QTN#001' : 'INV#001'));
      const empty: LineItem[] = Array.from({ length: INITIAL_LINES }, () => ({ product_id: '', product_name: '', category_name: '', quantity: 1, price: 0, subtotal: 0 }));
      // Pre-fill lines from initialItems (e.g. generated from an RFQ). Prices passed in
      // are used directly; anything missing is resolved once the /products fetch finishes.
      if (initialItems && initialItems.length > 0) {
        const prefilled: LineItem[] = initialItems.map((it) => {
          const qty = Math.max(1, Number(it.quantity) || 1);
          const price = Number(it.price) > 0 ? Number(it.price) : 0;
          return {
            product_id: it.product_id || '',
            product_name: it.product_name || '',
            category_name: it.category_name || '',
            quantity: qty,
            price,
            subtotal: qty * price,
            cost_price: Number(it.cost_price) > 0 ? Number(it.cost_price) : undefined,
          };
        });
        while (prefilled.length < INITIAL_LINES) prefilled.push({ product_id: '', product_name: '', category_name: '', quantity: 1, price: 0, subtotal: 0 });
        setLines(prefilled);
      } else {
        setLines(empty);
      }
      if (!initialCustomerId) {
        setCustomerId('');
        setCustomerName('');
        setCustomerPhone('');
        setCustomerEmail('');
        setCustomerAddress('');
      }
      setTerms('Due on receipt');
      setTaxAmount(0);
      setSelectedTaxTypeId('');
    }
  }, [isOpen, editId, initialDocumentType, initialItems, initialCustomerId]);

  /**
   * Once the products list loads, fill in price/cost for any prefilled lines
   * that came in with only a product_id (e.g. RFQ-based quotation). We don't
   * touch lines the user has already edited.
   */
  useEffect(() => {
    if (!isOpen || editId || products.length === 0) return;
    setLines((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        if (!l.product_id || l.price > 0) return l;
        const p = products.find((q) => q.id === l.product_id);
        if (!p) return l;
        const customerPrice = customerPrices[p.id];
        const usePrice = customerPrice ?? p.price ?? 0;
        changed = true;
        return {
          ...l,
          product_name: l.product_name || p.name,
          category_name: l.category_name || p.category_name || '',
          price: usePrice,
          subtotal: l.quantity * usePrice,
          cost_price: p.cost_price,
          stock_quantity: p.stock_quantity,
        };
      });
      return changed ? next : prev;
    });
  }, [isOpen, editId, products, customerPrices]);

  useEffect(() => {
    if (isOpen && customerId) fetchCustomerPrices(customerId);
    if (!customerId) setCustomerPrices({});
  }, [isOpen, customerId, fetchCustomerPrices]);

  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);

  useEffect(() => {
    if (!selectedTaxTypeId || selectedTaxTypeId === '__add_tax__') return;
    const tt = taxTypes.find((t) => t.id === selectedTaxTypeId);
    if (!tt) return;
    if (tt.rate_type === 'amount') setTaxAmount(tt.rate);
    else setTaxAmount(Math.round(subtotal * (tt.rate / 100) * 100) / 100);
    setDirty(true);
  }, [selectedTaxTypeId, subtotal, taxTypes]);
  const total = subtotal + taxAmount;


  /** Cost price (product cost) for display in Cost price column */
  const getLineCostPrice = (line: LineItem): number | undefined => {
    if (line.cost_price != null) return Number(line.cost_price);
    const pid = line.product_id ? String(line.product_id) : '';
    if (!pid) return undefined;
    const p = products.find((q) => String(q.id) === pid);
    return p?.cost_price != null ? Number(p.cost_price) : undefined;
  };

  const warnIfOverStock = (name: string, qty: number, stock: number | undefined) => {
    if (stock != null && qty > stock) {
      toast.error(`Warning: "${name}" has only ${stock} in stock but you're adding ${qty}.`, { duration: 5000 });
    }
  };

  const selectProductForLine = (index: number, product: Product) => {
    if (product.stock_quantity != null && product.stock_quantity <= 0) {
      toast.error(`"${product.name}" is out of stock (0 available). Please restock before invoicing.`, { duration: 5000 });
      return;
    }
    const newLines = [...lines];
    const line = newLines[index];
    if (!line) return;
    const existingIdx = newLines.findIndex((l, i) => i !== index && l.product_id === product.id);
    if (existingIdx !== -1) {
      const existing = newLines[existingIdx];
      existing.quantity += (line.quantity || 1);
      existing.subtotal = existing.quantity * existing.price;
      warnIfOverStock(product.name, existing.quantity, product.stock_quantity);
      newLines[index] = { product_id: '', product_name: '', category_name: '', quantity: 1, price: 0, subtotal: 0 };
    } else if (line.product_id === product.id) {
      line.quantity += 1;
      line.subtotal = line.quantity * line.price;
      warnIfOverStock(product.name, line.quantity, product.stock_quantity);
    } else {
      const customerPrice = customerPrices[product.id];
      const usePrice = customerPrice ?? product.price;
      newLines[index] = {
        product_id: product.id,
        product_name: product.name,
        category_name: product.category_name || '',
        quantity: 1,
        price: usePrice,
        subtotal: usePrice,
        cost_price: product.cost_price,
        stock_quantity: product.stock_quantity,
      };
      if (customerPrice != null && customerPrice !== product.price) {
        toast.success(`Using last price for ${product.name}: $${customerPrice.toFixed(2)} (default: $${product.price.toFixed(2)})`, { duration: 4000 });
      }
    }
    setLines(newLines);
    setDirty(true);
  };

  const addProductToLine = (product: Product) => {
    if (product.stock_quantity != null && product.stock_quantity <= 0) {
      toast.error(`"${product.name}" is out of stock (0 available). Please restock before invoicing.`, { duration: 5000 });
      return;
    }
    let newLines = [...lines];
    const existingIdx = newLines.findIndex((l) => l.product_id === product.id);
    if (existingIdx !== -1) {
      const existing = newLines[existingIdx];
      existing.quantity += 1;
      existing.subtotal = existing.quantity * existing.price;
      warnIfOverStock(product.name, existing.quantity, product.stock_quantity);
    } else {
      const customerPrice = customerPrices[product.id];
      const usePrice = customerPrice ?? product.price;
      const emptyIdx = newLines.findIndex((l) => !l.product_id && !l.product_name);
      let targetIdx = emptyIdx;
      if (targetIdx === -1) {
        newLines = [...newLines, ...Array.from({ length: 5 }, () => ({ product_id: '', product_name: '', category_name: '', quantity: 1, price: 0, subtotal: 0 }))];
        targetIdx = newLines.length - 5;
      }
      newLines[targetIdx] = {
        product_id: product.id,
        product_name: product.name,
        category_name: product.category_name || '',
        quantity: 1,
        price: usePrice,
        subtotal: usePrice,
        cost_price: product.cost_price,
        stock_quantity: product.stock_quantity,
      };
      if (customerPrice != null && customerPrice !== product.price) {
        toast.success(`Using last price for ${product.name}: $${customerPrice.toFixed(2)} (default: $${product.price.toFixed(2)})`, { duration: 4000 });
      }
    }
    setLines(newLines);
    setDirty(true);
    setProductSearch('');
  };

  const handleProductSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const code = productSearch.trim();
    if (!code) return;
    e.preventDefault();
    adminApi.get(`/products/barcode/${encodeURIComponent(code)}`)
      .then((r) => {
        const p = r.data;
        if (p && p.id) {
          addProductToLine({ id: p.id, name: p.name, price: p.price ?? 0, cost_price: p.cost_price, category_name: p.category_name });
        }
      })
      .catch(() => toast.error('Product not found for this barcode/ID'));
  };

  const updateLine = (index: number, field: keyof LineItem, value: number | string) => {
    const newLines = [...lines];
    const line = newLines[index];
    if (!line) return;
    if (field === 'quantity') {
      const newQty = Math.max(0, Number(value));
      line.quantity = newQty;
      line.subtotal = line.quantity * line.price;
      if (line.stock_quantity == null && line.product_id) {
        const p = products.find((x) => x.id === line.product_id);
        if (p) line.stock_quantity = p.stock_quantity;
      }
      if (line.stock_quantity != null && newQty > line.stock_quantity) {
        toast.error(`Warning: "${line.product_name}" has only ${line.stock_quantity} in stock but quantity is set to ${newQty}.`, { duration: 5000 });
      }
    } else if (field === 'price') {
      line.price = Number(value) || 0;
      line.subtotal = line.quantity * line.price;
    }
    setLines(newLines);
    setDirty(true);
  };

  const removeLine = (index: number) => {
    const newLines = [...lines];
    newLines[index] = { product_id: '', product_name: '', category_name: '', quantity: 1, price: 0, subtotal: 0 };
    setLines(newLines);
    setDirty(true);
  };

  const switchDocumentType = (type: 'invoice' | 'quotation') => {
    if (editId) return;
    setDocumentType(type);
    setDirty(true);
    adminApi.get('/invoices/generate-number', { params: { type } }).then((r) => {
      const num = r.data.invoice_number || '';
      setInvoiceNumber(/^INV#\d+|^QTN#\d+/.test(num) ? num : (type === 'quotation' ? 'QTN#001' : 'INV#001'));
    }).catch(() => setInvoiceNumber(type === 'quotation' ? 'QTN#001' : 'INV#001'));
  };


  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [savedInvoiceId, setSavedInvoiceId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: '', customer_code: '', phone: '', email: '', company: '', address: '', billing_address: '',
    city: '', state: '', zip: '', payment_terms: '', notes: '',
  });
  const [savingCustomer, setSavingCustomer] = useState(false);

  const handleClose = () => {
    if (dirty) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleCloseWithoutSaving = () => {
    setShowCloseConfirm(false);
    setDirty(false);
    onClose();
  };

  const handleSave = async (skipClose?: boolean): Promise<boolean> => {
    if (!customerId || !customerName?.trim()) {
      toast.error('Select or add a customer');
      return false;
    }
    const validLines = lines.filter((l) => l.product_id && l.quantity > 0);
    if (validLines.length === 0) {
      toast.error('Add at least one product');
      return false;
    }
    const overStockLines = validLines.filter((l) => {
      const stock = l.stock_quantity ?? products.find((p) => p.id === l.product_id)?.stock_quantity;
      return stock != null && l.quantity > stock;
    });
    if (overStockLines.length > 0) {
      const names = overStockLines.map((l) => {
        const stock = l.stock_quantity ?? products.find((p) => p.id === l.product_id)?.stock_quantity ?? 0;
        return `"${l.product_name}" (qty ${l.quantity}, only ${stock} in stock)`;
      }).join('\n');
      if (!confirm(`The following products exceed available stock:\n\n${names}\n\nDo you still want to save?`)) {
        return false;
      }
    }
    setSaving(true);
    const payload = {
      invoice_number: editId ? undefined : invoiceNumber,
      invoice_type: documentType,
      invoice_date: invoiceDate || new Date().toISOString().slice(0, 10),
      customer_id: customerId || undefined,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_email: customerEmail,
      customer_address: customerAddress,
      location_of_sale: LOCATION_OF_SALE,
      terms,
      tax_amount: taxAmount,
      items: validLines.map((l) => ({
        product_id: l.product_id,
        product_name: l.product_name,
        category_name: l.category_name,
        quantity: l.quantity,
        price: l.price,
        subtotal: l.subtotal,
      })),
    };
    try {
      let savedId: string;
      if (editId) {
        await adminApi.put(`/invoices/${editId}`, payload);
        toast.success('Invoice updated');
        savedId = editId;
      } else {
        const res = await adminApi.post('/invoices', payload);
        toast.success('Invoice created');
        savedId = res.data?.id ?? editId ?? '';
      }
      setDirty(false);
      onSaved(savedId);
      setSavedInvoiceId(savedId);
      setShowPdfModal(true);
      return true;
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const doSaveAndClose = async () => {
    setShowCloseConfirm(false);
    const ok = await handleSave(true);
    if (ok) onClose();
  };

  const generateCustomerCode = () => {
    adminApi.get('/customers/generate-id').then((r) => setNewCustomerForm((f) => ({ ...f, customer_code: r.data.customer_code || '' }))).catch(() => toast.error('Failed to generate ID'));
  };

  const handleAddCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerForm.name?.trim() || !newCustomerForm.phone?.trim()) {
      toast.error('Name and phone are required');
      return;
    }
    setSavingCustomer(true);
    try {
      const res = await adminApi.post('/customers', { ...newCustomerForm, email: newCustomerForm.email || undefined });
      const created = res.data;
      setCustomers((prev) => [...prev, { id: created.id, customer_code: created.customer_code, name: created.name, company: created.company, phone: created.phone, email: created.email, address: created.address, billing_address: created.billing_address, city: created.city, state: created.state, zip: created.zip }]);
      setCustomerId(created.id);
      fillCustomer({ id: created.id, name: created.name, company: created.company, phone: created.phone, email: created.email, address: created.address, billing_address: created.billing_address, city: created.city, state: created.state, zip: created.zip });
      const fileInput = document.getElementById('customer-docs-invoice') as HTMLInputElement;
      if (fileInput?.files?.length) {
        for (let i = 0; i < fileInput.files.length; i++) {
          const formData = new FormData();
          formData.append('file', fileInput.files[i]);
          await adminApi.post(`/customers/${created.id}/documents`, formData);
        }
      }
      setAddCustomerOpen(false);
      setNewCustomerForm({ name: '', customer_code: '', phone: '', email: '', company: '', address: '', billing_address: '', city: '', state: '', zip: '', payment_terms: '', notes: '' });
      if (fileInput) fileInput.value = '';
      toast.success('Customer added');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add customer');
    } finally {
      setSavingCustomer(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="admin-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={handleClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-gray-900">{editId ? (documentType === 'quotation' ? 'Edit Quotation' : 'Edit Invoice') : 'Create document'}</h2>
            {!editId && (
              <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                <button type="button" onClick={() => switchDocumentType('invoice')} className={`px-4 py-2 text-sm font-medium rounded-none ${documentType === 'invoice' ? 'bg-black text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>Create invoice</button>
                <button type="button" onClick={() => switchDocumentType('quotation')} className={`px-4 py-2 text-sm font-medium rounded-none ${documentType === 'quotation' ? 'bg-black text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>Create quotation</button>
              </div>
            )}
          </div>
          <button type="button" onClick={handleClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#0F9F8F] border-t-transparent" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer <span className="text-red-600">*</span></label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setAddCustomerOpen(true)} className="shrink-0 inline-flex items-center gap-1 px-3 py-2 border border-[#0F9F8F] text-[#0F9F8F] rounded-lg text-sm font-medium hover:bg-teal-50">
                      + Add customer
                    </button>
                    <select
                      value={customerId}
                      onChange={(e) => {
                        setCustomerId(e.target.value);
                        const c = customers.find((x) => x.id === e.target.value);
                        if (c) fillCustomer(c);
                      }}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      required
                    >
                      <option value="">Select customer</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}{c.customer_code ? ` – ${c.customer_code}` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Select a saved customer or add a new one. Customer is required.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{documentType === 'quotation' ? 'Quotation no.' : 'Invoice no.'}</label>
                  <input type="text" value={invoiceNumber} readOnly className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Invoice date</label>
                  <input type="date" value={invoiceDate} onChange={(e) => { setInvoiceDate(e.target.value); setDirty(true); }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bill to (customer address)</label>
                  <textarea value={customerAddress} onChange={(e) => { setCustomerAddress(e.target.value); setDirty(true); }} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Customer address" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Location of sale (our address)</label>
                  <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded-lg">{LOCATION_OF_SALE}</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due terms</label>
                  <select
                    value={terms}
                    onChange={(e) => { setTerms(e.target.value); setDirty(true); }}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-52 bg-white"
                  >
                    {/* Keep a legacy free-text value selectable when editing an older document. */}
                    {terms && !TERMS_OPTIONS.includes(terms) && <option value={terms}>{terms}</option>}
                    {TERMS_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <label className="block text-sm font-medium text-gray-700">Product or service</label>
                  <div className="flex-1 flex gap-2 items-center">
                    <input
                      ref={productSearchRef}
                      type="text"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      onKeyDown={handleProductSearchKeyDown}
                      placeholder="Scan barcode / item ID and press Enter"
                      className="flex-1 max-w-xs pl-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                    />
                    <Link href="/admin/products/active" className="text-sm text-[#0F9F8F] font-medium hover:underline">+ Add product</Link>
                  </div>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left py-3 px-4 w-10">#</th>
                        <th className="text-left py-3 px-4 min-w-[200px]">Product</th>
                        <th className="text-left py-3 px-4 min-w-[120px]">Category</th>
                        <th className="text-right py-3 px-4 w-24">Cost price</th>
                        <th className="text-right py-3 px-4 w-24">Selling price</th>
                        <th className="text-right py-3 px-4 w-20">Qty</th>
                        <th className="text-right py-3 px-4 w-28">Amount</th>
                        <th className="w-12 px-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, idx) => {
                        const hasProduct = !!(line.product_id || line.product_name);
                        const lineStock = line.stock_quantity ?? products.find((p) => p.id === line.product_id)?.stock_quantity;
                        const overStock = hasProduct && lineStock != null && line.quantity > lineStock;
                        return (
                          <tr key={idx} className={`border-t border-gray-100 hover:bg-gray-50/50 ${overStock ? 'bg-red-50' : ''}`}>
                            <td className="py-2 px-4">{idx + 1}</td>
                            <td className="py-2 px-4">
                              <SearchableProductDropdown
                                products={products}
                                value={line.product_id}
                                displayName={line.product_name || undefined}
                                onSelect={(p) => selectProductForLine(idx, { id: p.id, name: p.name, price: p.price ?? 0, cost_price: p.cost_price, category_name: p.category_name, stock_quantity: p.stock_quantity })}
                                onBarcodeScan={(code) => {
                                  adminApi.get(`/products/barcode/${encodeURIComponent(code)}`)
                                    .then((r) => {
                                      const prod = r.data;
                                      if (prod?.id) selectProductForLine(idx, { id: prod.id, name: prod.name, price: prod.price ?? 0, cost_price: prod.cost_price, category_name: prod.category_name, stock_quantity: prod.stock_quantity });
                                    })
                                    .catch(() => toast.error('Product not found for this barcode'));
                                }}
                                placeholder="Search product or scan barcode…"
                              />
                              {overStock && (
                                <p className="text-xs text-red-600 mt-0.5">Only {lineStock} in stock</p>
                              )}
                            </td>
                            <td className="py-2 px-4 text-gray-600">{line.category_name || ''}</td>
                            <td className="py-2 px-4 text-right text-gray-600">{hasProduct && (() => { const c = getLineCostPrice(line); return typeof c === 'number' ? `$${c.toFixed(2)}` : '—'; })()}</td>
                            <td className="py-2 px-4 text-right">
                              {hasProduct ? (
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    value={line.price}
                                    onChange={(e) => updateLine(idx, 'price', e.target.value)}
                                    className="w-20 text-right border border-gray-300 rounded px-2 py-1"
                                  />
                                  {(() => {
                                    const cost = getLineCostPrice(line);
                                    if (cost != null && line.price < cost * 1.05) {
                                      return (
                                        <span
                                          className="text-yellow-500 font-bold text-base cursor-help select-none"
                                          title={`Profit margin is below 5%. Minimum required selling price: $${(cost * 1.05).toFixed(2)}`}
                                        >
                                          ⚠️
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="py-2 px-4 text-right">
                              {hasProduct ? (
                                <input
                                  type="number"
                                  min={0}
                                  value={line.quantity}
                                  onChange={(e) => updateLine(idx, 'quantity', e.target.value)}
                                  className={`w-16 text-right border rounded px-2 py-1 ${overStock ? 'border-red-400 text-red-700 bg-red-50' : 'border-gray-300'}`}
                                />
                              ) : (
                                <span className="text-gray-400">{line.quantity || ''}</span>
                              )}
                            </td>
                            <td className="py-2 px-4 text-right font-medium">{hasProduct ? `$${line.subtotal.toFixed(2)}` : ''}</td>
                            <td className="py-2 px-4">
                              {hasProduct && (
                                <button type="button" onClick={() => removeLine(idx)} className="text-red-600 hover:bg-red-50 p-1 rounded">
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
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    Click any empty row to search or scan a barcode. Amount fills automatically.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setLines((prev) => [...prev, { product_id: '', product_name: '', category_name: '', quantity: 1, price: 0, subtotal: 0 }]);
                      setDirty(true);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    + Add line
                  </button>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <div className="flex flex-wrap items-start justify-end gap-8">
                  <div className="space-y-2 min-w-[200px]">
                    <p className="text-sm text-gray-600">Subtotal: <span className="font-medium text-gray-900">${subtotal.toFixed(2)}</span></p>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Select sales tax rate{documentType === 'quotation' ? ' (optional)' : ''}</label>
                      <select
                        value={selectedTaxTypeId}
                        onChange={(e) => { const v = e.target.value; setSelectedTaxTypeId(v); if (v === '') setTaxAmount(0); setDirty(true); }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="">No tax</option>
                        <option value="__add_tax__">+ Add new tax type</option>
                        {taxTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} {t.rate_type === 'percent' ? `(${t.rate}%)` : `($${t.rate.toFixed(2)})`}
                          </option>
                        ))}
                      </select>
                      {selectedTaxTypeId === '__add_tax__' && (
                        <p className="text-xs text-gray-500 mt-1">
                          <Link href="/admin/data" className="text-[#0F9F8F] hover:underline">Go to Master Data</Link> to add tax types, then return here.
                        </p>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">Tax: <span className="font-medium text-gray-900">${taxAmount.toFixed(2)}</span></p>
                    <p className="font-semibold text-gray-900 text-base">Total: ${total.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
          <button type="button" onClick={handleClose} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button type="button" onClick={() => handleSave(false)} disabled={saving} className="px-4 py-2 bg-black text-white rounded-lg hover:bg-[#2C2C2C] disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {addCustomerOpen && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl z-20 p-4" onClick={() => setAddCustomerOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Add customer</h3>
              <button type="button" onClick={() => setAddCustomerOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAddCustomerSubmit} className="p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer name *</label>
                <input type="text" value={newCustomerForm.name} onChange={(e) => setNewCustomerForm((f) => ({ ...f, name: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" required />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer ID</label>
                  <input type="text" value={newCustomerForm.customer_code} onChange={(e) => setNewCustomerForm((f) => ({ ...f, customer_code: e.target.value }))} placeholder="Auto-generated" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="pt-6">
                  <button type="button" onClick={generateCustomerCode} className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Generate</button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                <input type="text" value={newCustomerForm.phone} onChange={(e) => setNewCustomerForm((f) => ({ ...f, phone: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={newCustomerForm.email} onChange={(e) => setNewCustomerForm((f) => ({ ...f, email: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                <input type="text" value={newCustomerForm.company} onChange={(e) => setNewCustomerForm((f) => ({ ...f, company: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address / Bill to</label>
                <textarea value={newCustomerForm.address} onChange={(e) => setNewCustomerForm((f) => ({ ...f, address: e.target.value }))} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Street address" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input type="text" value={newCustomerForm.city} onChange={(e) => setNewCustomerForm((f) => ({ ...f, city: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <input type="text" value={newCustomerForm.state} onChange={(e) => setNewCustomerForm((f) => ({ ...f, state: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
                  <input type="text" value={newCustomerForm.zip} onChange={(e) => setNewCustomerForm((f) => ({ ...f, zip: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment terms</label>
                <select value={newCustomerForm.payment_terms} onChange={(e) => setNewCustomerForm((f) => ({ ...f, payment_terms: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select payment terms</option>
                  <option value="Due on receipt">Due on receipt</option>
                  <option value="Net 15">Net 15</option>
                  <option value="Net 30">Net 30</option>
                  <option value="Net 60">Net 60</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={newCustomerForm.notes} onChange={(e) => setNewCustomerForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Upload documents (PDF, JPG)</label>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple className="w-full text-sm text-gray-600 file:mr-2 file:py-2 file:px-3 file:rounded file:border-0 file:bg-gray-100 file:text-gray-700" id="customer-docs-invoice" />
                <p className="text-xs text-gray-500 mt-1">You can add more documents later on the Customer page.</p>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={savingCustomer} className="flex-1 py-2 bg-black text-white rounded-lg font-medium hover:bg-[#2C2C2C] disabled:opacity-50">
                  {savingCustomer ? 'Saving...' : 'Add customer'}
                </button>
                <button type="button" onClick={() => setAddCustomerOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCloseConfirm && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl z-10" onClick={() => setShowCloseConfirm(false)}>
          <div className="bg-white rounded-lg shadow-xl p-4 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-gray-900 font-medium mb-3">You have unsaved changes.</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={handleCloseWithoutSaving} className="px-3 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">Close without saving</button>
              <button type="button" onClick={doSaveAndClose} disabled={saving} className="px-3 py-2 bg-black text-white rounded-lg hover:bg-[#2C2C2C] disabled:opacity-50">Save and close</button>
            </div>
          </div>
        </div>
      )}

      {showPdfModal && savedInvoiceId && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl z-20" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Document saved</h3>
            <p className="text-gray-600 text-sm mb-4">
              Download the PDF first, then share it. On a computer, WhatsApp and email need you to attach the file from Downloads.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await adminApi.get(`/invoices/${savedInvoiceId}/pdf`, { responseType: 'blob', timeout: 60000 });
                    if (await downloadPdfFromResponse(res.data, `${documentType === 'quotation' ? 'quotation' : 'invoice'}-${invoiceNumber}.pdf`, res.headers['content-type'])) {
                      toast.success('PDF saved to your Downloads folder — you can attach it in WhatsApp or email below');
                    }
                  } catch {
                    toast.error('Failed to download PDF');
                  }
                }}
                className="w-full px-4 py-2.5 rounded-lg font-medium bg-black text-white hover:bg-[#2C2C2C]"
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await adminApi.get(`/invoices/${savedInvoiceId}/pdf`, { responseType: 'blob', timeout: 60000 });
                    if (await openPdfFromResponse(res.data, res.headers['content-type'])) {
                      toast.success('Opening PDF for print');
                    }
                  } catch {
                    toast.error('Failed to open PDF for printing');
                  }
                }}
                className="w-full px-4 py-2.5 rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Print PDF
              </button>
              <button
                type="button"
                disabled={sharing}
                onClick={async () => {
                  if (sharing) return;
                  setSharing(true);
                  try {
                    const outcome = await shareDocumentOnWhatsApp(
                      {
                        id: savedInvoiceId,
                        type: documentType,
                        number: invoiceNumber,
                        customerName,
                        customerPhone,
                        total,
                      },
                      async () => {
                        const res = await adminApi.get(`/invoices/${savedInvoiceId}/pdf`, { responseType: 'blob', timeout: 60000 });
                        return { data: res.data as BlobPart, contentType: res.headers['content-type'] as string | undefined };
                      },
                    );
                    if (outcome === 'whatsapp-opened') toast.success('WhatsApp opened — attach the downloaded PDF');
                    else if (outcome === 'shared') toast.success('Shared');
                    else if (outcome === 'failed') toast.error('Could not open WhatsApp');
                  } finally {
                    setSharing(false);
                  }
                }}
                className="w-full px-4 py-2.5 rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                title={customerPhone ? `WhatsApp ${customerPhone}` : 'Share on WhatsApp'}
              >
                Share on WhatsApp
              </button>
              <button
                type="button"
                disabled={sharing}
                onClick={async () => {
                  setSharing(true);
                  try {
                    const fetchSavedPdf = async () => {
                      const res = await adminApi.get(`/invoices/${savedInvoiceId}/pdf`, { responseType: 'blob', timeout: 60000 });
                      return { data: res.data as BlobPart, contentType: res.headers['content-type'] as string | undefined };
                    };
                    if (customerEmail) {
                      try {
                        await adminApi.post(`/invoices/${savedInvoiceId}/send-email`);
                        toast.success(`Emailed to ${customerEmail}`);
                        return;
                      } catch {
                        // SMTP not configured — fall through to the mail app.
                      }
                    }
                    const ok = await composeEmailWithPdf(
                      { id: savedInvoiceId, type: documentType, number: invoiceNumber, customerName, customerPhone, total },
                      fetchSavedPdf,
                      customerEmail,
                    );
                    if (ok) toast.success('Mail app opened — attach the downloaded PDF');
                  } catch (err: any) {
                    toast.error(err?.response?.data?.error || 'Failed to send email');
                  } finally {
                    setSharing(false);
                  }
                }}
                className="w-full px-4 py-2.5 rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                title={customerEmail ? `Send to ${customerEmail}` : 'No email on file — opens your mail app'}
              >
                {customerEmail ? `Email to ${customerEmail}` : 'Email…'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPdfModal(false);
                  setSavedInvoiceId(null);
                  onClose();
                }}
                className="w-full px-4 py-2.5 rounded-lg font-medium text-gray-600 hover:bg-gray-100"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
