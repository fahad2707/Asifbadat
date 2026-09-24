'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Search, Plus, Minus, ShoppingCart, X, Barcode, 
  DollarSign, Percent, User, Phone, Mail, 
  CreditCard, Wallet, Smartphone, Printer, Download,
  AlertCircle, CheckCircle2
} from 'lucide-react';
import adminApi, { posApi } from '@/lib/admin-api';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import { formatApiError } from '@/lib/format-api-error';
import toast from 'react-hot-toast';

interface Product {
  id: string;
  name: string;
  price: number;
  cost_price?: number;
  stock_quantity?: number | null;
  product_id?: string;
  sku?: string;
  tax_rate?: number;
  image_url?: string;
}

interface CartItem {
  product: Product;
  quantity: number;
  discount: number; // Line-level discount
}

interface PaymentSplit {
  cash: number;
  card: number;
  digital: number;
}

function AddCustomerModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string, name: string, phone: string, email: string) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      toast.error('Name and phone required');
      return;
    }
    setLoading(true);
    try {
      const { data } = await adminApi.post('/customers', { name: name.trim(), phone: phone.trim(), email: email.trim() || undefined });
      onSaved(data.id, data.name, data.phone, data.email || '');
      onClose();
      toast.success('Customer added');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add customer');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">+ Add new customer</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *" className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone *" className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">Add</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function POSPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState<'all' | 'sku' | 'product_id' | 'name'>('all');
  const [skuInput, setSkuInput] = useState('');
  
  // Customer info
  const [posCustomerId, setPosCustomerId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string; phone: string; email?: string }[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  
  // Payment
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'digital' | 'split'>('cash');
  const [paymentSplit, setPaymentSplit] = useState<PaymentSplit>({ cash: 0, card: 0, digital: 0 });
  
  // Discounts & Tax
  const [billDiscount, setBillDiscount] = useState(0);
  const [billDiscountType, setBillDiscountType] = useState<'amount' | 'percent'>('amount');
  
  // Sale type
  const [saleType, setSaleType] = useState<'pos' | 'website' | 'store_pickup'>('pos');
  
  const [loading, setLoading] = useState(false);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const skuInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProducts();
    skuInputRef.current?.focus();
  }, []);

  const fetchCustomers = async () => {
    try {
      const res = await adminApi.get('/customers');
      setCustomers(res.data.customers || []);
    } catch (err) {
      // The auth-redirect rejection is thrown when no admin token is present;
      // the layout will redirect to login. Don't show a noisy toast.
      if (isAdminAuthRedirectError(err)) return;
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchProducts = async () => {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const response = await adminApi.get('/products', { params: { limit: 500 } });
      const list = response.data?.products;
      setProducts(Array.isArray(list) ? list : []);
    } catch (error) {
      if (isAdminAuthRedirectError(error)) return;
      const msg = formatApiError(error, 'Failed to load products');
      setProductsError(msg);
      toast.error(msg);
    } finally {
      setProductsLoading(false);
    }
  };

  const searchProduct = async (query: string, type: string) => {
    if (!query.trim()) return;

    setSearchLoading(true);
    try {
      const response = await posApi.searchProducts(query, type);
      const foundProducts = response.data?.products || [];
      
      if (foundProducts.length === 0) {
        toast.error('Product not found');
      } else if (foundProducts.length === 1) {
        addToCart(foundProducts[0]);
        setSkuInput('');
        skuInputRef.current?.focus();
      } else {
        // Multiple results - show first or let user choose
        addToCart(foundProducts[0]);
        toast.success(`Added ${foundProducts[0].name}`);
        setSkuInput('');
        skuInputRef.current?.focus();
      }
    } catch (error) {
      toast.error('Product not found');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSkuScan = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && skuInput.trim()) {
      searchProduct(skuInput, 'sku');
    }
  };

  const addToCart = (product: Product) => {
    const stock = product.stock_quantity ?? null;
    if (stock !== null && stock <= 0) {
      toast.error(`${product.name} is out of stock`);
      return;
    }

    const existingItem = cart.find((item) => item.product.id === product.id);
    if (existingItem) {
      const maxQty = stock === null ? 999999 : stock;
      if (existingItem.quantity >= maxQty) {
        toast.error('Insufficient stock');
        return;
      }
      setCart(
        cart.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      setCart([...cart, { product, quantity: 1, discount: 0 }]);
    }
    toast.success(`Added ${product.name}`);
  };

  const updateQuantity = (productId: string, quantity: number) => {
    const item = cart.find((i) => i.product.id === productId);
    if (!item) return;

    const maxQty = item.product.stock_quantity ?? 999999;
    if (quantity > maxQty) {
      toast.error('Insufficient stock');
      return;
    }

    if (quantity <= 0) {
      setCart(cart.filter((item) => item.product.id !== productId));
    } else {
      setCart(
        cart.map((item) =>
          item.product.id === productId ? { ...item, quantity } : item
        )
      );
    }
  };

  const updateLineDiscount = (productId: string, discount: number) => {
    setCart(
      cart.map((item) =>
        item.product.id === productId ? { ...item, discount: Math.max(0, discount) } : item
      )
    );
  };

  const calculateTotals = () => {
    let subtotal = 0;
    let totalTax = 0;
    let totalDiscount = 0;

    cart.forEach((item) => {
      const lineSubtotal = item.product.price * item.quantity;
      const lineDiscount = item.discount || 0;
      const lineAfterDiscount = lineSubtotal - lineDiscount;
      const lineTax = (lineAfterDiscount * (item.product.tax_rate || 0)) / 100;
      
      subtotal += lineSubtotal;
      totalDiscount += lineDiscount;
      totalTax += lineTax;
    });

    // Apply bill-level discount
    const billDiscountAmount = billDiscountType === 'percent' 
      ? (subtotal * billDiscount) / 100 
      : billDiscount;
    
    const finalSubtotal = subtotal - totalDiscount - billDiscountAmount;
    const finalTax = totalTax; // Tax already calculated on discounted amounts
    const total = finalSubtotal + finalTax;

    return {
      subtotal,
      lineDiscount: totalDiscount,
      billDiscount: billDiscountAmount,
      totalDiscount: totalDiscount + billDiscountAmount,
      tax: finalTax,
      total,
    };
  };

  const handleCheckout = async () => {
    const idempotencyKey = crypto.randomUUID();
    if (cart.length === 0) {
      toast.error('Cart is empty');
      return;
    }

    const totals = calculateTotals();

    // Validate split payment
    if (paymentMethod === 'split') {
      const splitTotal = paymentSplit.cash + paymentSplit.card + paymentSplit.digital;
      if (Math.abs(splitTotal - totals.total) > 0.01) {
        toast.error('Split payment amounts must equal total');
        return;
      }
    }

    setLoading(true);
    try {
      const response = await posApi.createSale({
        items: cart.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
          discount: item.discount,
        })),
        pos_customer_id: posCustomerId || undefined,
        customer_name: customerName || undefined,
        customer_phone: customerPhone || undefined,
        customer_email: customerEmail || undefined,
        payment_method: paymentMethod,
        payment_split:
          paymentMethod === 'split'
            ? paymentSplit
            : { [paymentMethod]: totals.total },
        discount_amount: totals.billDiscount,
        sale_type: saleType,
        idempotency_key: idempotencyKey,
      });

      toast.success('Sale completed successfully!');
      
      // Reset form
      setCart([]);
      setPosCustomerId(null);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerEmail('');
      setBillDiscount(0);
      setPaymentMethod('cash');
      setPaymentSplit({ cash: 0, card: 0, digital: 0 });
      setSkuInput('');
      skuInputRef.current?.focus();

      // Optionally print/download invoice
      if (response.data?.invoice) {
        // You can trigger print/download here
        console.log('Invoice created:', response.data.invoice);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to complete sale');
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      p.product_id?.toLowerCase().includes(term) ||
      p.sku?.toLowerCase().includes(term)
    );
  });

  const totals = calculateTotals();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-4xl font-bold text-gray-900">POS System</h1>
          <div className="flex items-center gap-4">
            <select
              value={saleType}
              onChange={(e) => setSaleType(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 rounded-lg bg-white font-semibold"
            >
              <option value="pos">POS Sale</option>
              <option value="store_pickup">Store Pickup</option>
              <option value="website">Website Order</option>
            </select>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left Panel - Product Search & Selection */}
          <div className="lg:col-span-2 space-y-6">
            {/* Quick Input - SKU / Product ID */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="mb-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                  <Barcode className="w-4 h-4" />
                  Scan SKU / Barcode or enter Product ID
                </label>
                <input
                  ref={skuInputRef}
                  type="text"
                  value={skuInput}
                  onChange={(e) => setSkuInput(e.target.value)}
                  onKeyPress={handleSkuScan}
                  placeholder="Scan UPC or type 5-digit Product ID"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-lg font-mono"
                  disabled={searchLoading}
                />
              </div>

              {/* Product Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, Product ID, or SKU..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>

            {/* Products Grid */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Products</h2>
                {!productsLoading && (
                  <button
                    type="button"
                    onClick={fetchProducts}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700"
                  >
                    Refresh
                  </button>
                )}
              </div>
              {productsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                  <span className="ml-3 text-gray-500">Loading products…</span>
                </div>
              ) : productsError ? (
                <div className="py-12 text-center">
                  <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-900 mb-1">Couldn&apos;t load products</p>
                  <p className="text-xs text-gray-600 mb-4 max-w-md mx-auto">{productsError}</p>
                  <button
                    type="button"
                    onClick={fetchProducts}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
                  >
                    Try again
                  </button>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  <p className="text-sm font-medium mb-1">No products found</p>
                  <p className="text-xs">Add products from the Products page to get started.</p>
                </div>
              ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[500px] overflow-y-auto">
                {filteredProducts.map((product) => {
                  const sq = product.stock_quantity ?? null;
                  const outOfStock = sq !== null && sq <= 0;
                  return (
                  <button
                    key={product.id}
                    onClick={() => addToCart(product)}
                    disabled={outOfStock}
                    className={`p-4 border-2 rounded-xl hover:border-primary-500 hover:shadow-md text-left transition-all ${
                      outOfStock
                        ? 'opacity-50 cursor-not-allowed border-gray-200'
                        : 'border-gray-200 cursor-pointer'
                    }`}
                  >
                    {product.image_url && (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-24 object-cover rounded-lg mb-2"
                      />
                    )}
                    <p className="font-semibold text-sm mb-1 line-clamp-2">{product.name}</p>
                    <p className="text-primary-600 font-bold text-lg">${product.price.toFixed(2)}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-gray-500">
                        {product.product_id && `ID: ${product.product_id}`}
                        {product.sku && ` | SKU: ${product.sku}`}
                      </p>
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          sq === null
                            ? 'bg-gray-100 text-gray-600'
                            : sq > 10
                            ? 'bg-green-100 text-green-700'
                            : sq > 0
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {sq === null ? '—' : `${sq} in stock`}
                      </span>
                    </div>
                  </button>
                );})}
              </div>
              )}
            </div>
          </div>

          {/* Right Panel - Cart & Checkout */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-lg p-6 sticky top-4">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <ShoppingCart className="w-6 h-6" />
                Cart ({cart.length})
              </h2>

              {/* Cart Items */}
              <div className="space-y-3 mb-6 max-h-64 overflow-y-auto">
                {cart.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">Cart is empty</p>
                ) : (
                  cart.map((item) => {
                    const lineSubtotal = item.product.price * item.quantity;
                    const lineAfterDiscount = lineSubtotal - item.discount;
                    const lineTax = (lineAfterDiscount * (item.product.tax_rate || 0)) / 100;
                    const lineTotal = lineAfterDiscount + lineTax;

                    return (
                      <div key={item.product.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <p className="font-semibold text-sm">{item.product.name}</p>
                            <p className="text-xs text-gray-600">
                              ${item.product.price.toFixed(2)} × {item.quantity}
                            </p>
                          </div>
                          <button
                            onClick={() => updateQuantity(item.product.id, 0)}
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        
                        {/* Quantity Controls */}
                        <div className="flex items-center gap-2 mb-2">
                          <button
                            onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                            className="p-1 hover:bg-gray-200 rounded"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="w-12 text-center font-semibold">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                            className="p-1 hover:bg-gray-200 rounded"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Line Discount */}
                        <div className="flex items-center gap-2 mb-1">
                          <Percent className="w-3 h-3 text-gray-400" />
                          <input
                            type="number"
                            value={item.discount || 0}
                            onChange={(e) => updateLineDiscount(item.product.id, parseFloat(e.target.value) || 0)}
                            placeholder="Discount"
                            className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
                            min="0"
                            step="0.01"
                          />
                        </div>

                        <div className="text-right flex items-center justify-end gap-1">
                          {(() => {
                            const effectivePrice = item.product.price - (item.discount / item.quantity);
                            const cost = item.product.cost_price;
                            if (cost != null && effectivePrice < cost * 1.05) {
                              return (
                                <span
                                  className="text-yellow-500 font-bold text-sm cursor-help select-none"
                                  title={`Profit margin is below 5%. Minimum required effective price: $${(cost * 1.05).toFixed(2)}`}
                                >
                                  ⚠️
                                </span>
                              );
                            }
                            return null;
                          })()}
                          <p className="text-sm font-bold text-primary-600">
                            ${lineTotal.toFixed(2)}
                            {item.discount > 0 && (
                              <span className="text-xs text-gray-500 line-through ml-1">
                                ${lineSubtotal.toFixed(2)}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Totals */}
              <div className="border-t pt-4 space-y-2 mb-6">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>${totals.subtotal.toFixed(2)}</span>
                </div>
                {totals.lineDiscount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Line Discounts</span>
                    <span>-${totals.lineDiscount.toFixed(2)}</span>
                  </div>
                )}
                {totals.billDiscount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Bill Discount</span>
                    <span>-${totals.billDiscount.toFixed(2)}</span>
                  </div>
                )}
                {totals.tax > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Tax</span>
                    <span>${totals.tax.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xl font-bold border-t pt-2">
                  <span>Total</span>
                  <span className="text-primary-600">${totals.total.toFixed(2)}</span>
                </div>
              </div>

              {/* Bill Discount */}
              <div className="mb-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Bill Discount
                </label>
                <div className="flex gap-2">
                  <select
                    value={billDiscountType}
                    onChange={(e) => {
                      setBillDiscountType(e.target.value as any);
                      setBillDiscount(0);
                    }}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="amount">$ Amount</option>
                    <option value="percent">% Percent</option>
                  </select>
                  <input
                    type="number"
                    value={billDiscount}
                    onChange={(e) => setBillDiscount(parseFloat(e.target.value) || 0)}
                    placeholder={billDiscountType === 'percent' ? '%' : '$'}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              {/* Customer Info */}
              <div className="mb-4 space-y-3">
                <div>
                  <label className="flex items-center gap-1 text-sm font-semibold text-gray-700 mb-1">
                    <User className="w-4 h-4" />
                    Select Customer
                  </label>
                  <select
                    value={posCustomerId || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__add_customer__') {
                        setShowAddCustomer(true);
                        return;
                      }
                      const id = val || null;
                      setPosCustomerId(id);
                      if (id) {
                        const c = customers.find((x) => x.id === id);
                        if (c) {
                          setCustomerName(c.name);
                          setCustomerPhone(c.phone);
                          setCustomerEmail(c.email || '');
                        }
                      } else {
                        setCustomerName('');
                        setCustomerPhone('');
                        setCustomerEmail('');
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">Walk-in (no customer)</option>
                    <option value="__add_customer__">+ Add new customer</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.phone}
                      </option>
                    ))}
                  </select>
                  {showAddCustomer && (
                    <AddCustomerModal
                      onClose={() => setShowAddCustomer(false)}
                      onSaved={(id, name, phone, email) => {
                        fetchCustomers();
                        setPosCustomerId(id);
                        setCustomerName(name);
                        setCustomerPhone(phone);
                        setCustomerEmail(email || '');
                        setShowAddCustomer(false);
                      }}
                    />
                  )}
                </div>
                <div>
                  <label className="flex items-center gap-1 text-sm font-semibold text-gray-700 mb-1">
                    Customer Name
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1 text-sm font-semibold text-gray-700 mb-1">
                    <Phone className="w-4 h-4" />
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1 text-sm font-semibold text-gray-700 mb-1">
                    <Mail className="w-4 h-4" />
                    Email
                  </label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              {/* Payment Method */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPaymentMethod('cash')}
                    className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 ${
                      paymentMethod === 'cash'
                        ? 'border-primary-600 bg-primary-50 text-primary-700'
                        : 'border-gray-300'
                    }`}
                  >
                    <Wallet className="w-5 h-5" />
                    Cash
                  </button>
                  <button
                    onClick={() => setPaymentMethod('card')}
                    className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 ${
                      paymentMethod === 'card'
                        ? 'border-primary-600 bg-primary-50 text-primary-700'
                        : 'border-gray-300'
                    }`}
                  >
                    <CreditCard className="w-5 h-5" />
                    Card
                  </button>
                  <button
                    onClick={() => setPaymentMethod('digital')}
                    className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 ${
                      paymentMethod === 'digital'
                        ? 'border-primary-600 bg-primary-50 text-primary-700'
                        : 'border-gray-300'
                    }`}
                  >
                    <Smartphone className="w-5 h-5" />
                    Digital
                  </button>
                  <button
                    onClick={() => setPaymentMethod('split')}
                    className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 ${
                      paymentMethod === 'split'
                        ? 'border-primary-600 bg-primary-50 text-primary-700'
                        : 'border-gray-300'
                    }`}
                  >
                    <DollarSign className="w-5 h-5" />
                    Split
                  </button>
                </div>
              </div>

              {/* Split Payment */}
              {paymentMethod === 'split' && (
                <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Split Payment</label>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-gray-600">Cash</label>
                      <input
                        type="number"
                        value={paymentSplit.cash || 0}
                        onChange={(e) =>
                          setPaymentSplit({ ...paymentSplit, cash: parseFloat(e.target.value) || 0 })
                        }
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600">Card</label>
                      <input
                        type="number"
                        value={paymentSplit.card || 0}
                        onChange={(e) =>
                          setPaymentSplit({ ...paymentSplit, card: parseFloat(e.target.value) || 0 })
                        }
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600">Digital</label>
                      <input
                        type="number"
                        value={paymentSplit.digital || 0}
                        onChange={(e) =>
                          setPaymentSplit({ ...paymentSplit, digital: parseFloat(e.target.value) || 0 })
                        }
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        step="0.01"
                      />
                    </div>
                    <div className="text-xs text-gray-600 pt-2 border-t">
                      Total: ${(paymentSplit.cash + paymentSplit.card + paymentSplit.digital).toFixed(2)} / ${totals.total.toFixed(2)}
                    </div>
                  </div>
                </div>
              )}

              {/* Checkout Button */}
              <button
                onClick={handleCheckout}
                disabled={cart.length === 0 || loading || (paymentMethod === 'split' && Math.abs((paymentSplit.cash + paymentSplit.card + paymentSplit.digital) - totals.total) > 0.01)}
                className="w-full bg-primary-600 text-white py-4 rounded-lg font-bold text-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    Complete Sale (${totals.total.toFixed(2)})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
