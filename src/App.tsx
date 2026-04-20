import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import useStore from './store/useStore';
import Layout from './components/layout/Layout';
import TradePage from './pages/TradePage';
import MarketsPage from './pages/MarketsPage';
import WalletPage from './pages/WalletPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AdminPage from './pages/AdminPage';
import HomePage from './pages/HomePage';
import NoticePage from './pages/NoticePage';
import FeePage from './pages/FeePage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import SupportPage from './pages/SupportPage';

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
    <Routes>
      {/* Standalone pages (no Layout header/footer) */}
      <Route path="/home" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

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
        <Route path="wallet" element={<ProtectedRoute><WalletPage /></ProtectedRoute>} />
        <Route path="admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
      </Route>
    </Routes>
  );
}
