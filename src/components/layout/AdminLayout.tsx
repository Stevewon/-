import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, Users, ShieldCheck, ArrowDownToLine, ArrowUpFromLine,
  BarChart3, Coins, Megaphone, Receipt, FileText, Server,
  RefreshCw, Bell, ExternalLink, LogOut, Menu, X, Monitor,
  Wallet as WalletIcon, ListChecks, Link2, ShieldAlert, Repeat,
  TrendingUp, Layers, Zap, Percent, KeyRound,
} from 'lucide-react';
import useStore from '../../store/useStore';
import { useI18n } from '../../i18n';
import QuantaLogo from '../common/QuantaLogo';

export type AdminTab =
  | 'overview' | 'users' | 'kyc' | 'deposits' | 'withdrawals'
  | 'trades' | 'coins' | 'broadcast' | 'fees' | 'audit' | 'system'
  // Sprint 4 Phase C — QTA chain admin
  | 'chainWallets' | 'chainQueue' | 'chainHealth' | 'risk'
  // Sprint 4 Phase G — QTA <-> ETH bridge
  | 'bridge'
  // Sprint 4 Phase H1 — Futures + Margin
  | 'futuresMarkets' | 'futuresPositions' | 'liquidations' | 'fundingHistory'
  | 'marginAccounts'
  // Sprint 4 Phase H2 — PQ API keys
  | 'pqApiKeys';

interface Props {
  active: AdminTab;
  onChange: (tab: AdminTab) => void;
  badges?: Partial<Record<AdminTab, number>>;
  onRefresh?: () => void;
  refreshing?: boolean;
  onPriceAlertCheck?: () => void;
  alertChecking?: boolean;
  children: React.ReactNode;
}

/**
 * Desktop-first admin layout. A fixed 240px sidebar on the left, a wide
 * content area filling the rest. Mobile gets a collapsible drawer + a
 * "use desktop" hint banner because the data tables are not optimised for
 * narrow viewports.
 */
export default function AdminLayout({
  active, onChange, badges = {}, onRefresh, refreshing,
  onPriceAlertCheck, alertChecking, children,
}: Props) {
  const { user, logout } = useStore();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const groups: { title: string; items: { key: AdminTab; label: string; icon: any }[] }[] = [
    {
      title: t('admin.groupOverview'),
      items: [
        { key: 'overview', label: t('admin.overview'), icon: Activity },
      ],
    },
    {
      title: t('admin.groupOps'),
      items: [
        { key: 'users',       label: t('admin.users'),       icon: Users },
        { key: 'kyc',         label: t('admin.kyc'),         icon: ShieldCheck },
        { key: 'deposits',    label: t('admin.deposits'),    icon: ArrowDownToLine },
        { key: 'withdrawals', label: t('admin.withdrawals'), icon: ArrowUpFromLine },
      ],
    },
    {
      title: t('admin.groupMarket'),
      items: [
        { key: 'trades',    label: t('admin.tradesTab'), icon: BarChart3 },
        { key: 'coins',     label: t('admin.coins'),     icon: Coins },
        { key: 'broadcast', label: t('admin.broadcast'), icon: Megaphone },
      ],
    },
    {
      title: t('admin.groupChain'),
      items: [
        { key: 'chainWallets', label: t('admin.chainWallets'), icon: WalletIcon },
        { key: 'chainQueue',   label: t('admin.chainQueue'),   icon: ListChecks },
        { key: 'chainHealth',  label: t('admin.chainHealth'),  icon: Link2 },
        { key: 'bridge',       label: t('admin.bridge'),       icon: Repeat },
        { key: 'risk',         label: t('admin.risk'),         icon: ShieldAlert },
      ],
    },
    {
      title: t('admin.groupDerivatives'),
      items: [
        { key: 'futuresMarkets',   label: t('admin.futuresMarkets'),   icon: TrendingUp },
        { key: 'futuresPositions', label: t('admin.futuresPositions'), icon: Layers },
        { key: 'liquidations',     label: t('admin.liquidations'),     icon: Zap },
        { key: 'fundingHistory',   label: t('admin.fundingHistory'),   icon: Percent },
        { key: 'marginAccounts',   label: t('admin.marginAccounts'),   icon: WalletIcon },
      ],
    },
    {
      title: t('admin.groupSecurity'),
      items: [
        { key: 'pqApiKeys', label: t('admin.pqApiKeys'), icon: KeyRound },
      ],
    },
    {
      title: t('admin.groupSystem'),
      items: [
        { key: 'fees',   label: t('admin.fees'),   icon: Receipt },
        { key: 'audit',  label: t('admin.audit'),  icon: FileText },
        { key: 'system', label: t('admin.system'), icon: Server },
      ],
    },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const Sidebar = (
    <aside className="w-60 shrink-0 bg-exchange-card border-r border-exchange-border flex flex-col h-screen sticky top-0">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-exchange-border flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <QuantaLogo size={24} showText={false} />
          <div>
            <div className="text-[11px] font-bold text-exchange-text leading-none">QuantaEX</div>
            <div className="text-[9px] text-exchange-yellow font-semibold uppercase tracking-wider mt-0.5">
              {t('admin.console')}
            </div>
          </div>
        </Link>
        <button
          onClick={() => setDrawerOpen(false)}
          className="lg:hidden p-1 text-exchange-text-third hover:text-exchange-text"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-exchange-text-third">
              {group.title}
            </div>
            <div className="space-y-0.5">
              {group.items.map(({ key, label, icon: Icon }) => {
                const isActive = active === key;
                const badge = badges[key];
                return (
                  <button
                    key={key}
                    onClick={() => { onChange(key); setDrawerOpen(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-exchange-yellow/10 text-exchange-yellow border-l-2 border-exchange-yellow pl-[10px]'
                        : 'text-exchange-text-secondary hover:text-exchange-text hover:bg-exchange-hover/40'
                    }`}
                  >
                    <Icon size={16} className={isActive ? 'text-exchange-yellow' : ''} />
                    <span className="flex-1 text-left">{label}</span>
                    {badge && badge > 0 ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-exchange-sell/20 text-exchange-sell">
                        {badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer — user info + actions */}
      <div className="px-3 py-3 border-t border-exchange-border space-y-2">
        <div className="flex items-center gap-2 px-2">
          <div className="w-8 h-8 rounded-full bg-exchange-yellow/20 flex items-center justify-center text-exchange-yellow text-xs font-bold">
            {(user?.email || '?')[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold truncate">{user?.nickname || user?.email}</div>
            <div className="text-[10px] text-exchange-text-third uppercase tracking-wide">{user?.role}</div>
          </div>
        </div>
        <Link
          to="/"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-exchange-text-secondary hover:text-exchange-text hover:bg-exchange-hover/40 transition-colors"
        >
          <ExternalLink size={12} />
          <span>{t('admin.backToSite')}</span>
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-exchange-sell hover:bg-exchange-sell/10 transition-colors"
        >
          <LogOut size={12} />
          <span>{t('common.logout')}</span>
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-exchange-bg flex">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">{Sidebar}</div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/50 z-40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="lg:hidden fixed inset-y-0 left-0 z-50">{Sidebar}</div>
        </>
      )}

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="bg-exchange-card/40 border-b border-exchange-border px-4 lg:px-8 py-3 flex items-center justify-between sticky top-0 z-30 backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden p-1.5 text-exchange-text-third hover:text-exchange-text"
              aria-label="Menu"
            >
              <Menu size={18} />
            </button>
            <h1 className="text-lg font-bold tracking-tight">
              {t(`admin.${active}` as any) || t('admin.dashboard')}
            </h1>
            <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-exchange-yellow/10 text-exchange-yellow text-[10px] font-semibold uppercase tracking-wider">
              {t('admin.live')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {onPriceAlertCheck && (
              <button
                onClick={onPriceAlertCheck}
                disabled={alertChecking}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-exchange-text-secondary hover:text-exchange-yellow rounded-lg hover:bg-exchange-hover/50 transition-colors disabled:opacity-50"
                title={t('admin.runPriceAlertCheck')}
              >
                <Bell size={13} className={alertChecking ? 'animate-pulse' : ''} />
                <span className="hidden md:inline">{t('admin.runPriceAlertCheck')}</span>
              </button>
            )}
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={refreshing}
                className="p-1.5 text-exchange-text-third hover:text-exchange-text rounded-lg hover:bg-exchange-hover/50 transition-colors"
                aria-label="Refresh"
              >
                <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
              </button>
            )}
          </div>
        </header>

        {/* Mobile-only hint — admin tables are not great on phones */}
        <div className="lg:hidden bg-exchange-yellow/5 border-b border-exchange-yellow/20 px-4 py-2 flex items-center gap-2 text-[11px] text-exchange-yellow">
          <Monitor size={12} className="shrink-0" />
          <span>{t('admin.useDesktopHint')}</span>
        </div>

        {/* Page body */}
        <main className="flex-1 px-4 lg:px-8 py-6 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
