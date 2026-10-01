'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Package, 
  Star, 
  DollarSign, 
  Gift, 
  Settings, 
  ShoppingBag,
  TrendingUp,
  Award,
  ArrowRight,
  Clock,
  CheckCircle
} from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import toast from 'react-hot-toast';
import NumberInput from '@/components/admin/NumberInput';

interface UserProfile {
  id: string;
  name?: string;
  phone: string;
  email?: string;
  loyalty_points: number;
  points_value: number;
  total_spent: number;
}

interface Order {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  created_at: string;
}

interface DashboardData {
  user: UserProfile;
  stats: {
    total_orders: number;
    recent_orders: Order[];
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const { token } = useAuthStore();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [redeemPoints, setRedeemPoints] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    if (!token) {
      router.push('/login');
      return;
    }
    fetchDashboard();
  }, [token, router]);

  const fetchDashboard = async () => {
    try {
      const response = await api.get('/user/dashboard');
      setDashboardData(response.data);
    } catch (error) {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleRedeemPoints = async () => {
    const points = parseInt(redeemPoints);
    if (!points || points <= 0) {
      toast.error('Please enter valid points');
      return;
    }

    if (!dashboardData || !dashboardData.user || (dashboardData.user.loyalty_points || 0) < points) {
      toast.error('Insufficient loyalty points');
      return;
    }

    setRedeeming(true);
    try {
      await api.post('/user/redeem-points', { points });
      toast.success(`Redeemed ${points} points! Discount: $${(points * 0.01).toFixed(2)}`);
      setRedeemPoints('');
      fetchDashboard(); // Refresh data
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to redeem points');
    } finally {
      setRedeeming(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!dashboardData || !dashboardData.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Failed to load dashboard</p>
          <button
            onClick={fetchDashboard}
            className="bg-primary-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-primary-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    placed: 'bg-blue-100 text-blue-700',
    packed: 'bg-yellow-100 text-yellow-700',
    ready_for_pickup: 'bg-green-100 text-green-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Welcome back{dashboardData.user?.name ? `, ${dashboardData.user.name}` : ''}!
          </h1>
          <p className="text-gray-600">Manage your account, orders, and rewards</p>
        </div>

        {/* Stats Cards */}
        <div className="grid md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-primary-100 rounded-xl">
                <ShoppingBag className="w-6 h-6 text-primary-600" />
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-1">Total Orders</p>
            <p className="text-3xl font-bold text-gray-900">{dashboardData.stats?.total_orders || 0}</p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-yellow-100 rounded-xl">
                <Star className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-1">Loyalty Points</p>
            <p className="text-3xl font-bold text-gray-900">{(dashboardData.user.loyalty_points || 0).toLocaleString()}</p>
            <p className="text-sm text-gray-500 mt-1">≈ ${(dashboardData.user.points_value || 0).toFixed(2)} value</p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-green-100 rounded-xl">
                <DollarSign className="w-6 h-6 text-green-600" />
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-1">Total Spent</p>
            <p className="text-3xl font-bold text-gray-900">${(dashboardData.user.total_spent || 0).toFixed(2)}</p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-purple-100 rounded-xl">
                <Award className="w-6 h-6 text-purple-600" />
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-1">Points Value</p>
            <p className="text-3xl font-bold text-gray-900">${(dashboardData.user.points_value || 0).toFixed(2)}</p>
            <p className="text-sm text-gray-500 mt-1">Available to redeem</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Loyalty Points Card */}
          <div className="lg:col-span-1">
            <div className="bg-gradient-to-br from-primary-600 to-primary-800 rounded-2xl shadow-xl p-6 text-white">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                  <Gift className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Loyalty Rewards</h2>
                  <p className="text-primary-100 text-sm">Earn 1 point per $1 spent</p>
                </div>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-5xl font-bold">{(dashboardData.user.loyalty_points || 0).toLocaleString()}</span>
                  <span className="text-primary-200">points</span>
                </div>
                <p className="text-primary-100">Worth ${(dashboardData.user.points_value || 0).toFixed(2)}</p>
              </div>

              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 mb-4">
                <p className="text-sm text-primary-100 mb-2">Redeem Points</p>
                <div className="flex flex-col sm:flex-row gap-2 w-full">
                  <NumberInput
                    value={redeemPoints}
                    onValueChange={(n) => setRedeemPoints(n === '' ? '' : String(n))}
                    placeholder="Points"
                    className="flex-1 min-w-0 px-4 py-2 rounded-lg bg-white/20 backdrop-blur-sm text-white placeholder-white/50 border border-white/30 focus:outline-none focus:ring-2 focus:ring-white/50"
                  />
                  <button
                    onClick={handleRedeemPoints}
                    disabled={redeeming || !redeemPoints}
                    className="px-6 py-2 bg-white text-primary-600 rounded-lg font-semibold hover:bg-primary-50 transition-colors disabled:opacity-50 whitespace-nowrap flex-shrink-0 w-full sm:w-auto"
                  >
                    {redeeming ? '...' : 'Redeem'}
                  </button>
                </div>
                <p className="text-xs text-primary-200 mt-2">1 point = $0.01 discount</p>
              </div>

              <Link
                href="/"
                className="flex items-center justify-center gap-2 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-lg py-3 transition-colors"
              >
                <span>Shop to Earn More</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Recent Orders */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Recent Orders</h2>
                <Link
                  href="/store/orders"
                  className="text-primary-600 hover:text-primary-700 font-semibold flex items-center gap-2"
                >
                  View All
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {dashboardData.stats?.recent_orders && dashboardData.stats.recent_orders.length > 0 ? (
                <div className="space-y-4">
                  {dashboardData.stats.recent_orders.map((order) => (
                    <Link
                      key={order.id}
                      href={`/store/orders`}
                      className="block p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors border border-gray-100"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <Package className="w-5 h-5 text-gray-400" />
                            <span className="font-semibold text-gray-900">Order #{order.order_number}</span>
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[order.status] || 'bg-gray-100 text-gray-700'}`}>
                              {order.status.replace('_', ' ').toUpperCase()}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            <span className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              {new Date(order.created_at).toLocaleDateString()}
                            </span>
                            <span className="flex items-center gap-1">
                              <DollarSign className="w-4 h-4" />
                              ${order.total_amount.toFixed(2)}
                            </span>
                          </div>
                        </div>
                        <ArrowRight className="w-5 h-5 text-gray-400" />
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <ShoppingBag className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600 mb-4">No orders yet</p>
                  <Link
                    href="/"
                    className="inline-flex items-center gap-2 bg-primary-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-primary-700 transition-colors"
                  >
                    Start Shopping
                  </Link>
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="mt-6 grid md:grid-cols-2 gap-4">
              <Link
                href="/store/orders"
                className="bg-white rounded-xl shadow-md p-6 border border-gray-100 hover:shadow-lg transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary-100 rounded-xl group-hover:bg-primary-200 transition-colors">
                    <Package className="w-6 h-6 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">All Orders</h3>
                    <p className="text-sm text-gray-600">View order history</p>
                  </div>
                </div>
              </Link>

              <Link
                href="/dashboard/settings"
                className="bg-white rounded-xl shadow-md p-6 border border-gray-100 hover:shadow-lg transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-gray-100 rounded-xl group-hover:bg-gray-200 transition-colors">
                    <Settings className="w-6 h-6 text-gray-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">Account Settings</h3>
                    <p className="text-sm text-gray-600">Manage your profile</p>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

