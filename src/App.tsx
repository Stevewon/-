import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, Suspense, lazy, memo } from 'react';
import useStore from './store/useStore';
import Layout from './components/layout/Layout';
import ToastContainer from './components/common/Toast';
import ErrorBoundary from './components/common/ErrorBoundary';

// Eagerly loaded (critical path)
import TradePage from './pages/TradePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

// Lazy loaded (secondary pages)
const MarketsPage = lazy(() => import('./pages/MarketsPage'));
const WalletPage = lazy(() => import('./pages/WalletPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const NoticePage = lazy(() => import('./pages/NoticePage'));
const FeePage = lazy(() => import('./pages/FeePage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const SupportPage = lazy(() => import('./pages/SupportPage'));
const OrderHistoryPage = lazy(() => import('./pages/OrderHistoryPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const KycPage = lazy(() => import('./pages/KycPage'));
const SecurityPage = lazy(() => import('./pages/SecurityPage'));
const ApiKeysPage = lazy(() => import('./pages/ApiKeysPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const NotificationSettingsPage = lazy(() => import('./pages/NotificationSettingsPage'));
const PriceAlertsPage = lazy(() => import('./pages/PriceAlertsPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const FuturesPage = lazy(() => import('./pages/FuturesPage'));
const MarginPage = lazy(() => import('./pages/MarginPage'));

// Loading fallback
function PageLoader() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-exchange-yellow/30 border-t-exchange-yellow rounded-full animate-spin" />
        <span className="text-xs text-exchange-text-third">Loading...</span>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const loadAuth = useStore((s) => s.loadAuth);
  const fetchMarkets = useStore((s) => s.fetchMarkets);

  useEffect(() => {
    loadAuth();
    fetchMarkets();
    const interval = setInterval(fetchMarkets, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <ErrorBoundary>
    <Suspense fallback={<PageLoader />}>
      <ToastContainer />
      <Routes>
        {/* Standalone pages (no Layout header/footer) */}
        <Route path="/home" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        {/* Pages with Layout (header + ticker + footer) */}
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/trade/BTC-USDT" replace />} />
          <Route path="trade/:symbol" element={<TradePage />} />
          <Route path="markets" element={<MarketsPage />} />
          <Route path="notice" element={<NoticePage />} />
          <Route path="fee" element={<FeePage />} />
          <Route path="terms" element={<TermsPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="support" element={<SupportPage />} />
          <Route path="orders" element={<ProtectedRoute><OrderHistoryPage /></ProtectedRoute>} />
          <Route path="profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="profile/kyc" element={<ProtectedRoute><KycPage /></ProtectedRoute>} />
          <Route path="profile/security" element={<ProtectedRoute><SecurityPage /></ProtectedRoute>} />
          <Route path="profile/api-keys" element={<ProtectedRoute><ApiKeysPage /></ProtectedRoute>} />
          <Route path="notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
          <Route path="profile/notifications" element={<ProtectedRoute><NotificationSettingsPage /></ProtectedRoute>} />
          <Route path="profile/price-alerts" element={<ProtectedRoute><PriceAlertsPage /></ProtectedRoute>} />
          <Route path="wallet" element={<ProtectedRoute><WalletPage /></ProtectedRoute>} />
          <Route path="futures" element={<ProtectedRoute><FuturesPage /></ProtectedRoute>} />
          <Route path="margin" element={<ProtectedRoute><MarginPage /></ProtectedRoute>} />
          <Route path="admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
