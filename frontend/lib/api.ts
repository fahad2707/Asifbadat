import axios from 'axios';
import { resolveApiBaseUrl } from './api-base-url';
import { useAuthStore } from './store';

const api = axios.create({
  headers: {
    'Content-Type': 'application/json',
  },
});

function isCredentialAuthRequest(url: string | undefined): boolean {
  const path = String(url || '');
  return (
    path.includes('/auth/login') ||
    path.includes('/auth/register') ||
    path.includes('/auth/forgot-password') ||
    path.includes('/auth/reset-password') ||
    path.includes('/auth/verify-email') ||
    path.includes('/auth/admin/login')
  );
}

api.interceptors.request.use((config) => {
  config.baseURL = resolveApiBaseUrl();
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors — never steal credential-attempt failures (login shows its own message).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      const reqUrl = error.config?.url;
      if (!isCredentialAuthRequest(reqUrl)) {
        useAuthStore.getState().logout();
        const path = window.location.pathname || '';
        if (!path.startsWith('/login') && !path.startsWith('/admin/login')) {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
