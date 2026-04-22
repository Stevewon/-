import axios from 'axios';

// In production, API is served from the same domain via Cloudflare Pages Functions
// or from a separate Workers domain (api.quantaex.io)
const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const data = err.response?.data || {};
      // Do NOT force-logout on auth challenges that are part of normal flows:
      //   - 2FA required on login
      //   - 2FA required on withdrawal / whitelist add
      //   - bad current-password (change-password form should show inline error)
      const url = err.config?.url || '';
      const isLoginCall = url.includes('/auth/login');
      const isPasswordChange = url.includes('/profile/password');
      const isWithdrawFlow = url.includes('/wallet/withdraw');
      const isChallenge = data.requires_2fa === true || data.code === 'KYC_REQUIRED';
      if (isLoginCall || isPasswordChange || isWithdrawFlow || isChallenge) {
        return Promise.reject(err);
      }
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
