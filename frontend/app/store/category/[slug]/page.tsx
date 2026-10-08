'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ShoppingCart, Star, Package } from 'lucide-react';
import api from '@/lib/api';
import { useCartStore } from '@/lib/store';
import toast from 'react-hot-toast';

interface Product {
  id: number | string;
  name: string;
  price?: number;
  tax_rate?: number;
  image_url?: string;
  description?: string;
  stock_quantity: number;
  sku?: string;
}

export default function CategoryPage() {
  const params = useParams();
  const { addItem } = useCartStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [categoryName, setCategoryName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProducts();
  }, [params.slug]);

  const fetchProducts = async () => {
    try {
      const response = await api.get(`/products?category=${params.slug}`);
      setProducts(response.data.products || []);

      try {
        const catResponse = await api.get(`/categories/${params.slug}`);
        setCategoryName(catResponse.data.name);
      } catch {
        setCategoryName(params.slug?.toString().replace(/-/g, ' ') || '');
      }
    } catch (error) {
      toast.error('Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = (product: Product) => {
    const hasPrice = typeof product.price === 'number' && Number.isFinite(product.price);
    addItem({
      product_id: product.id.toString(),
      name: product.name,
      ...(hasPrice ? { price: product.price } : {}),
      tax_rate: product.tax_rate,
      image_url: product.image_url,
    });
    toast.success('Added to cart');
  };

  const hasCatalogPrice = (product: Product) =>
    typeof product.price === 'number' && Number.isFinite(product.price);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto px-4 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-primary-600 hover:text-primary-700 mb-6 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Home
        </Link>

        <div className="mb-8">
          <h1 className="text-4xl md:text-5xl font-bold mb-2 text-gray-900 capitalize">
            {categoryName || params.slug?.toString().replace(/-/g, ' ')}
          </h1>
          <p className="text-gray-600 text-lg">
            {products.length} {products.length === 1 ? 'product' : 'products'} available
          </p>
        </div>

        {products.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
            <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">No products found</h2>
            <p className="text-gray-600 mb-6">This category doesn&apos;t have any products yet.</p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-primary-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-primary-700 transition-colors"
            >
              Browse Other Categories
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {products.map((product) => (
              <div
                key={product.id}
                className="group bg-white rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden transform hover:-translate-y-2"
              >
                {product.image_url ? (
                  <div className="h-64 bg-gray-200 overflow-hidden relative">
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                    {product.sku && (
                      <span
                        className="absolute top-3 right-3 bg-amber-300 text-slate-900 text-[10px] font-extrabold tracking-[0.18em] uppercase px-2.5 py-1 rounded-full shadow-md"
                        aria-label={`Product ID ${product.sku}`}
                      >
                        #{product.sku}
                      </span>
                    )}
                    {product.stock_quantity <= 10 && product.stock_quantity > 0 && (
                      <div className="absolute top-3 left-3 bg-yellow-500 text-white px-3 py-1 rounded-full text-xs font-semibold">
                        Low Stock
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-64 bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center relative">
                    {product.sku && (
                      <span
                        className="absolute top-3 right-3 bg-amber-300 text-slate-900 text-[10px] font-extrabold tracking-[0.18em] uppercase px-2.5 py-1 rounded-full shadow-md"
                        aria-label={`Product ID ${product.sku}`}
                      >
                        #{product.sku}
                      </span>
                    )}
                    <span className="text-6xl text-white opacity-50 font-bold">
                      {product.name.charAt(0)}
                    </span>
                  </div>
                )}
                <div className="p-6">
                  <h3 className="font-semibold text-lg mb-2 text-gray-900 line-clamp-2 min-h-[3.5rem]">
                    {product.name}
                  </h3>
                  {product.description && (
                    <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                      {product.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between mb-4">
                    {hasCatalogPrice(product) ? (
                      <span className="text-lg font-semibold text-gray-900">
                        ${Number(product.price).toFixed(2)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold tracking-widest uppercase text-primary-700 bg-primary-50 border border-primary-100 px-2.5 py-1 rounded-full">
                        Quote on request
                      </span>
                    )}
                    <div className="flex items-center gap-1 text-yellow-500">
                      <Star className="w-4 h-4 fill-yellow-500" />
                      <span className="text-sm font-semibold">4.5</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleAddToCart(product)}
                    className="w-full bg-primary-600 text-white py-3 rounded-lg font-semibold hover:bg-primary-700 transition-all transform hover:scale-105 flex items-center justify-center gap-2"
                  >
                    <ShoppingCart className="w-5 h-5" />
                    Add to Cart
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
