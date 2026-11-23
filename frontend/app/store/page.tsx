'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ShoppingCart, LogOut, Package } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useCartStore } from '@/lib/store';
import toast from 'react-hot-toast';

interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
}

export default function StorePage() {
  const router = useRouter();
  const { user, token, logout } = useAuthStore();
  const { getItemCount } = useCartStore();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      router.push('/login');
      return;
    }

    fetchCategories();
  }, [token, router]);

  const fetchCategories = async () => {
    try {
      const response = await api.get('/categories');
      setCategories(response.data);
    } catch (error) {
      toast.error('Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/store" className="text-2xl font-bold text-primary-600">
            Express Distributors
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/store/cart"
              className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ShoppingCart className="w-6 h-6" />
              {getItemCount() > 0 && (
                <span className="absolute top-0 right-0 bg-primary-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {getItemCount()}
                </span>
              )}
            </Link>
            <Link
              href="/store/orders"
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Package className="w-6 h-6" />
            </Link>
            <button
              onClick={handleLogout}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <LogOut className="w-6 h-6" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold mb-8 text-gray-900">Browse Categories</h1>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/store/category/${category.slug}`}
              className="bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden group"
            >
              {category.image_url ? (
                <div className="relative h-48 bg-gray-200 overflow-hidden">
                  <Image
                    src={category.image_url}
                    alt={category.name}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover group-hover:scale-110 transition-transform duration-300"
                  />
                </div>
              ) : (
                <div className="h-48 bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
                  <span className="text-6xl text-white opacity-50">
                    {category.name.charAt(0)}
                  </span>
                </div>
              )}
              <div className="p-6">
                <h2 className="text-xl font-semibold mb-2 text-gray-900">
                  {category.name}
                </h2>
                {category.description && (
                  <p className="text-gray-600 text-sm">{category.description}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}




