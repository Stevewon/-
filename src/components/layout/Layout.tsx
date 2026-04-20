import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { BarChart3, Wallet, LayoutGrid, Shield, LogIn, LogOut, User, ClipboardList } from 'lucide-react';
import useStore from '../../store/useStore';
import { useI18n } from '../../i18n';
import QuantaLogo from '../common/QuantaLogo';
import LangSwitch from '../common/LangSwitch';
import TickerBar from '../common/TickerBar';
import Footer from '../common/Footer';

export default function Layout() {
  const { user, logout } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();

  const navItems = [
    { path: '/trade/BTC-USDT', label: t('nav.trade'), icon: BarChart3 },
    { path: '/markets', label: t('nav.markets'), icon: LayoutGrid },
    ...(user ? [
      { path: '/orders', label: t('nav.orders'), icon: ClipboardList },
      { path: '/wallet', label: t('nav.wallet'), icon: Wallet },
    ] : []),
    ...(user?.role === 'admin' ? [
      { path: '/admin', label: t('nav.admin'), icon: Shield },
    ] : []),
  ];

  const isActive = (path: string) => {
    if (path.startsWith('/trade')) return location.pathname.startsWith('/trade');
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen flex flex-col bg-exchange-bg">
      {/* Top Ticker Bar */}
      <TickerBar />

      {/* Header */}
      <header className="bg-exchange-card border-b border-exchange-border px-4 py-2 flex items-center justify-between z-50 sticky top-0">
        <div className="flex items-center gap-6">
          <Link to="/" className="shrink-0">
            <QuantaLogo size={30} showText={true} />
          </Link>

          <nav className="hidden sm:flex items-center gap-0.5">
            {navItems.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  isActive(path)
                    ? 'text-exchange-yellow bg-exchange-yellow/10'
                    : 'text-exchange-text-secondary hover:text-exchange-text hover:bg-exchange-hover/50'
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <LangSwitch />

          {user ? (
            <div className="flex items-center gap-2">
              <Link
                to="/profile"
                className="hidden sm:flex items-center gap-1.5 text-sm text-exchange-text-secondary bg-exchange-hover/30 px-2.5 py-1.5 rounded-md hover:bg-exchange-hover transition-colors"
              >
                <div className="w-5 h-5 bg-exchange-yellow/20 rounded-full flex items-center justify-center">
                  <User size={12} className="text-exchange-yellow" />
                </div>
                <span className="max-w-[100px] truncate">{user.nickname}</span>
              </Link>
              <button
                onClick={() => { logout(); navigate('/login'); }}
                className="flex items-center gap-1 text-xs text-exchange-text-secondary hover:text-exchange-sell transition-colors px-2 py-1.5 rounded-md hover:bg-exchange-sell/10"
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">{t('nav.logout')}</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link to="/login" className="flex items-center gap-1 text-sm text-exchange-text-secondary hover:text-exchange-text px-2 py-1.5 transition-colors">
                <LogIn size={14} />
                <span>{t('nav.login')}</span>
              </Link>
              <Link to="/register" className="btn-primary text-xs !py-1.5 !px-3 rounded-md">
                {t('nav.register')}
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <Footer />

      {/* Mobile Bottom Nav */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-exchange-card border-t border-exchange-border flex z-50 safe-area-bottom">
        {navItems.slice(0, 4).map(({ path, label, icon: Icon }) => (
          <Link
            key={path}
            to={path}
            className={`flex-1 flex flex-col items-center py-2 text-[10px] transition-colors ${
              isActive(path) ? 'text-exchange-yellow' : 'text-exchange-text-third'
            }`}
          >
            <Icon size={20} />
            <span className="mt-0.5">{label}</span>
          </Link>
        ))}
        {!user && (
          <Link
            to="/login"
            className="flex-1 flex flex-col items-center py-2 text-[10px] text-exchange-text-third"
          >
            <LogIn size={20} />
            <span className="mt-0.5">{t('nav.login')}</span>
          </Link>
        )}
      </nav>
    </div>
  );
}
