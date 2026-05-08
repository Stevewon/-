import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import { formatPrice, formatAmount, timeAgo } from '../utils/format';
import CoinIcon from '../components/common/CoinIcon';
import SkeletonLoader from '../components/common/SkeletonLoader';
import DesktopPageLayout from '../components/common/DesktopPageLayout';
import DepositModal from '../components/wallet/DepositModal';
import WithdrawModal from '../components/wallet/WithdrawModal';
import TransactionDetailModal from '../components/wallet/TransactionDetailModal';
import api from '../utils/api';
import {
  Wallet, Eye, EyeOff, RefreshCw, ArrowDownLeft, ArrowUpRight,
  TrendingUp, TrendingDown, Search, ChevronDown, ChevronUp,
  Clock, CheckCircle2, XCircle, AlertCircle, PieChart,
  History,
} from 'lucide-react';

type Tab = 'assets' | 'deposits' | 'withdrawals';

export default function WalletPage() {
  const { t } = useI18n();
  const { user, wallets, fetchWallets } = useStore();
  const [hideBalance, setHideBalance] = useState(false);
  const [hideZero, setHideZero] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('assets');
  const [sortField, setSortField] = useState<'value' | 'name' | 'change'>('value');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modals
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [selectedCoinForModal, setSelectedCoinForModal] = useState('USDT');
  const [txModal, setTxModal] = useState<{ open: boolean; tx: any; type: 'deposit' | 'withdrawal' }>({
    open: false, tx: null, type: 'deposit',
  });

  // History
  const [deposits, setDeposits] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchWallets().finally(() => setLoading(false));
  }, [user]);

  const refreshHistory = () => {
    if (!user) return;
    if (tab === 'deposits') {
      setHistoryLoading(true);
      api.get('/wallet/history/deposits').then(r => setDeposits(r.data)).finally(() => setHistoryLoading(false));
    } else if (tab === 'withdrawals') {
      setHistoryLoading(true);
      api.get('/wallet/history/withdrawals').then(r => setWithdrawals(r.data)).finally(() => setHistoryLoading(false));
    }
  };

  useEffect(() => { refreshHistory(); }, [user, tab]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchWallets();
    refreshHistory();
    setRefreshing(false);
  };

  const totalUSD = useMemo(() =>
    wallets.reduce((sum, w) => sum + (w.available + w.locked) * (w.price_usd || 0), 0),
    [wallets]
  );
  const btcPrice = wallets.find(w => w.coin_symbol === 'BTC')?.price_usd || 0;
  const totalBTC = btcPrice > 0 ? totalUSD / btcPrice : 0;

  const portfolio = useMemo(() => {
    const items = wallets
      .map(w => ({
        symbol: w.coin_symbol,
        value: (w.available + w.locked) * (w.price_usd || 0),
      }))
      .filter(p => p.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = items.reduce((s, i) => s + i.value, 0);
    return items.map(i => ({ ...i, pct: total > 0 ? (i.value / total) * 100 : 0 }));
  }, [wallets]);

  const topAssets = portfolio.slice(0, 5);
  const otherPct = portfolio.slice(5).reduce((s, p) => s + p.pct, 0);

  const filteredWallets = useMemo(() => {
    let list = [...wallets];
    if (hideZero) list = list.filter(w => (w.available + w.locked) > 0);
    if (search) {
      const s = search.toUpperCase();
      list = list.filter(w => w.coin_symbol.includes(s) || (w.coin_name || '').toUpperCase().includes(s));
    }
    list.sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortField === 'value') {
        return dir * ((a.available + a.locked) * (a.price_usd || 0) - (b.available + b.locked) * (b.price_usd || 0));
      }
      if (sortField === 'name') return dir * a.coin_symbol.localeCompare(b.coin_symbol);
      if (sortField === 'change') return dir * ((a.change_24h || 0) - (b.change_24h || 0));
      return 0;
    });
    return list;
  }, [wallets, hideZero, search, sortField, sortDir]);

  const openDeposit = (coin: string = 'USDT') => {
    setSelectedCoinForModal(coin);
    setDepositOpen(true);
  };
  const openWithdraw = (coin: string = 'USDT') => {
    setSelectedCoinForModal(coin);
    setWithdrawOpen(true);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 size={14} className="text-exchange-buy" />;
      case 'pending': return <Clock size={14} className="text-exchange-yellow" />;
      case 'failed':
      case 'rejected':
        return <XCircle size={14} className="text-exchange-sell" />;
      default: return <AlertCircle size={14} className="text-exchange-text-third" />;
    }
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      completed: t('status.completed'),
      pending: t('status.processing'),
      failed: t('status.failed'),
      rejected: t('status.rejected'),
    };
    return map[status] || status;
  };

  const COLORS = ['#F0B90B', '#0ECB81', '#3B82F6', '#8B5CF6', '#F6465D', '#6B7280'];

  if (!user) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <Wallet size={48} className="text-exchange-text-third mb-4" />
        <p className="text-exchange-text-secondary mb-4">{t('wallet.loginRequired')}</p>
        <Link to="/login" className="btn-primary px-6 py-2 rounded-lg">{t('nav.login')}</Link>
      </div>
    );
  }

  /**
   * RESPONSIVE LAYOUT SPEC (hard-coded values, do NOT modify):
   *  - Mobile (<768px): single column stack
   *  - Tablet (768–1279px): existing layout
   *  - Desktop (>=1280px): full-width 1600px wrapper, summary 2-col, table full-width
   *
   * Desktop wrapper:
   *  - max-width: 1600px, mx-auto, padding: 16px 24px
   * Summary grid (xl:):
   *  - grid-template-columns: minmax(0, 1.6fr) minmax(320px, 420px)
   *  - gap: 24px, align-items: start
   * Table section: width 100%, single column (no left/right split below summary)
   */

  return (
    <DesktopPageLayout>
      {/* ========== SUMMARY GRID (Desktop 2-col, Mobile 1-col) ========== */}
      <div
        className="grid"
        style={{
          gap: '24px',
          alignItems: 'start',
          gridTemplateColumns: '1fr',
          marginBottom: '24px',
        }}
      >
        <style>{`
          @media (min-width: 1280px) {
            .wallet-summary-grid {
              grid-template-columns: minmax(0, 1.6fr) minmax(320px, 420px) !important;
            }
            .wallet-tabs-row {
              display: flex !important;
              align-items: center !important;
              gap: 16px !important;
            }
            .wallet-tabs-row > .wallet-tabs-group {
              margin-right: auto;
            }
            .wallet-search-input-xl {
              flex: 1 1 0% !important;
              min-width: 320px !important;
              max-width: 480px !important;
            }
            .wallet-asset-table {
              width: 100% !important;
            }
          }
          @media (max-width: 1279px) {
            .wallet-summary-grid {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
      </div>

      {/* Summary 2-col grid */}
      <div
        className="wallet-summary-grid grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '24px',
          alignItems: 'start',
          marginBottom: '24px',
        }}
      >
        {/* LEFT — Balance Block */}
        <div
          className="bg-gradient-to-br from-exchange-card to-exchange-bg border border-exchange-border"
          style={{ borderRadius: '16px', padding: '24px' }}
        >
          <div className="flex items-center" style={{ gap: '8px', marginBottom: '12px' }}>
            <Wallet size={18} className="text-exchange-yellow" />
            <span className="text-sm text-exchange-text-secondary">{t('wallet.totalAssets')}</span>
            <button
              onClick={() => setHideBalance(!hideBalance)}
              className="text-exchange-text-third hover:text-exchange-text transition-colors"
            >
              {hideBalance ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button
              onClick={handleRefresh}
              className={`text-exchange-text-third hover:text-exchange-text transition-colors ${refreshing ? 'animate-spin' : ''}`}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div
            className="font-bold text-exchange-text tabular-nums"
            style={{ fontSize: '36px', lineHeight: 1.1, marginBottom: '8px' }}
          >
            {hideBalance ? '••••••••' : `$${formatPrice(totalUSD)}`}
          </div>
          <div
            className="text-exchange-text-secondary tabular-nums"
            style={{ fontSize: '14px', lineHeight: 1.5, marginBottom: '20px' }}
          >
            {hideBalance ? '••••••••' : `≈ ${totalBTC.toFixed(8)} BTC`}
          </div>

          {/* Action tabs */}
          <div className="inline-flex flex-wrap" style={{ gap: '12px' }}>
            <button
              onClick={() => openDeposit()}
              className="inline-flex items-center bg-exchange-buy/10 text-exchange-buy hover:bg-exchange-buy/20 transition-colors font-medium"
              style={{ gap: '6px', padding: '10px 16px', borderRadius: '10px', fontSize: '14px' }}
            >
              <ArrowDownLeft size={16} /> {t('wallet.deposit')}
            </button>
            <button
              onClick={() => openWithdraw()}
              className="inline-flex items-center bg-exchange-sell/10 text-exchange-sell hover:bg-exchange-sell/20 transition-colors font-medium"
              style={{ gap: '6px', padding: '10px 16px', borderRadius: '10px', fontSize: '14px' }}
            >
              <ArrowUpRight size={16} /> {t('wallet.withdraw')}
            </button>
            <Link
              to="/trade/BTC-USDT"
              className="inline-flex items-center bg-exchange-yellow/10 text-exchange-yellow hover:bg-exchange-yellow/20 transition-colors font-medium"
              style={{ gap: '6px', padding: '10px 16px', borderRadius: '10px', fontSize: '14px' }}
            >
              <TrendingUp size={16} /> {t('wallet.trade')}
            </Link>
          </div>
        </div>

        {/* RIGHT — Portfolio Card */}
        <div
          className="bg-exchange-card border border-exchange-border"
          style={{ borderRadius: '12px', padding: '20px', width: '100%' }}
        >
          <div className="flex items-center" style={{ gap: '8px', marginBottom: '16px' }}>
            <PieChart size={16} className="text-exchange-yellow" />
            <span className="text-sm font-semibold text-exchange-text">{t('wallet.portfolio')}</span>
          </div>
          {portfolio.length === 0 ? (
            <p className="text-exchange-text-third text-center" style={{ fontSize: '13px', padding: '24px 0' }}>
              {t('wallet.noAssets')}
            </p>
          ) : (
            <div>
              <div
                className="rounded-full overflow-hidden flex bg-exchange-hover/30"
                style={{ height: '12px', marginBottom: '16px' }}
              >
                {topAssets.map((a, i) => (
                  <div
                    key={a.symbol}
                    className="h-full transition-all"
                    style={{ width: `${a.pct}%`, backgroundColor: COLORS[i] }}
                    title={`${a.symbol}: ${a.pct.toFixed(1)}%`}
                  />
                ))}
                {otherPct > 0 && (
                  <div className="h-full" style={{ width: `${otherPct}%`, backgroundColor: COLORS[5] }} />
                )}
              </div>
              <div className="grid grid-cols-2" style={{ gap: '8px' }}>
                {topAssets.map((a, i) => (
                  <div key={a.symbol} className="flex items-center" style={{ gap: '8px', fontSize: '12px' }}>
                    <div
                      className="rounded-full shrink-0"
                      style={{ width: '8px', height: '8px', backgroundColor: COLORS[i] }}
                    />
                    <span className="text-exchange-text-secondary truncate">{a.symbol}</span>
                    <span className="text-exchange-text-third ml-auto tabular-nums">{a.pct.toFixed(1)}%</span>
                  </div>
                ))}
                {otherPct > 0 && (
                  <div className="flex items-center" style={{ gap: '8px', fontSize: '12px' }}>
                    <div
                      className="rounded-full shrink-0"
                      style={{ width: '8px', height: '8px', backgroundColor: COLORS[5] }}
                    />
                    <span className="text-exchange-text-secondary">{t('wallet.other')}</span>
                    <span className="text-exchange-text-third ml-auto tabular-nums">{otherPct.toFixed(1)}%</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ========== TABS (full-width row) ========== */}
      <div
        className="flex items-center border-b border-exchange-border"
        style={{ gap: '4px', marginBottom: '16px' }}
      >
        {([
          { key: 'assets' as Tab, label: t('wallet.assetList'), icon: Wallet },
          { key: 'deposits' as Tab, label: t('wallet.depositHistory'), icon: ArrowDownLeft },
          { key: 'withdrawals' as Tab, label: t('wallet.withdrawHistory'), icon: ArrowUpRight },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-exchange-yellow text-exchange-yellow'
                : 'border-transparent text-exchange-text-secondary hover:text-exchange-text'
            }`}
            style={{ gap: '6px', padding: '10px 16px', fontSize: '14px' }}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* ========== TAB CONTENT ========== */}
      {tab === 'assets' ? (
        <>
          {/* Filters: 1-row on desktop, 2-row on mobile */}
          <div
            className="wallet-tabs-row flex flex-wrap items-center"
            style={{ gap: '12px', marginBottom: '16px' }}
          >
            <div className="wallet-tabs-group" />
            <div
              className="wallet-search-input-xl relative"
              style={{ flex: '1 1 240px', minWidth: '240px', maxWidth: '480px' }}
            >
              <Search
                size={14}
                className="absolute text-exchange-text-third pointer-events-none"
                style={{ left: '12px', top: '50%', transform: 'translateY(-50%)' }}
              />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('wallet.searchCoin')}
                className="w-full bg-exchange-card border border-exchange-border text-exchange-text focus:outline-none focus:border-exchange-yellow/60 transition-colors"
                style={{
                  height: '40px',
                  paddingLeft: '36px',
                  paddingRight: '12px',
                  borderRadius: '10px',
                  fontSize: '13px',
                }}
              />
            </div>
            <label
              className="inline-flex items-center text-exchange-text-secondary cursor-pointer select-none"
              style={{ gap: '8px', fontSize: '13px' }}
            >
              <input
                type="checkbox"
                checked={hideZero}
                onChange={e => setHideZero(e.target.checked)}
                className="accent-exchange-yellow"
                style={{ width: '14px', height: '14px' }}
              />
              {t('wallet.hideZero')}
            </label>
          </div>

          {loading ? (
            <div
              className="bg-exchange-card border border-exchange-border"
              style={{ borderRadius: '12px' }}
            >
              <SkeletonLoader type="table" rows={8} />
            </div>
          ) : (
            <>
              {/* Desktop Table — full width */}
              <div
                className="wallet-asset-table hidden md:block bg-exchange-card border border-exchange-border overflow-hidden"
                style={{ borderRadius: '12px', width: '100%' }}
              >
                {/* Header row */}
                <div
                  className="flex items-center text-exchange-text-third font-medium border-b border-exchange-border bg-exchange-bg/50"
                  style={{ padding: '12px 20px', fontSize: '12px' }}
                >
                  <span style={{ width: '24%' }}>{t('wallet.coin')}</span>
                  <span style={{ width: '14%', textAlign: 'right' }}>{t('wallet.availableBalance')}</span>
                  <span style={{ width: '14%', textAlign: 'right' }}>{t('wallet.frozenQty')}</span>
                  <span style={{ width: '14%', textAlign: 'right' }}>{t('wallet.currentPrice')}</span>
                  <button
                    onClick={() => { if (sortField === 'change') setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortField('change'); setSortDir('desc'); }}}
                    className="flex items-center justify-end hover:text-exchange-text"
                    style={{ width: '12%', gap: '4px' }}
                  >
                    {t('wallet.change24h')} {sortField === 'change' ? (sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />) : null}
                  </button>
                  <button
                    onClick={() => { if (sortField === 'value') setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortField('value'); setSortDir('desc'); }}}
                    className="flex items-center justify-end hover:text-exchange-text"
                    style={{ width: '14%', gap: '4px' }}
                  >
                    {t('wallet.valuation')} {sortField === 'value' ? (sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />) : null}
                  </button>
                  <span style={{ width: '8%', textAlign: 'right' }}>{t('wallet.actions')}</span>
                </div>

                {filteredWallets.length === 0 ? (
                  <div
                    className="text-center text-exchange-text-third"
                    style={{ padding: '48px 0', fontSize: '14px' }}
                  >
                    {t('wallet.noResults')}
                  </div>
                ) : (
                  filteredWallets.map(w => {
                    const value = (w.available + w.locked) * (w.price_usd || 0);
                    const change = w.change_24h || 0;
                    const isUp = change >= 0;
                    return (
                      <div
                        key={w.coin_symbol}
                        className="flex items-center hover:bg-exchange-hover/30 border-b border-exchange-border/30 transition-colors"
                        style={{ padding: '14px 20px' }}
                      >
                        <div className="flex items-center" style={{ width: '24%', gap: '10px' }}>
                          <CoinIcon symbol={w.coin_symbol} size={28} />
                          <div>
                            <span className="font-medium text-exchange-text" style={{ fontSize: '14px' }}>
                              {w.coin_symbol}
                            </span>
                            <span
                              className="text-exchange-text-third"
                              style={{ fontSize: '11px', marginLeft: '6px' }}
                            >
                              {w.coin_name}
                            </span>
                          </div>
                        </div>
                        <span
                          className="tabular-nums text-exchange-text"
                          style={{ width: '14%', textAlign: 'right', fontSize: '14px' }}
                        >
                          {hideBalance ? '••••' : formatAmount(w.available)}
                        </span>
                        <span
                          className="tabular-nums text-exchange-text-secondary"
                          style={{ width: '14%', textAlign: 'right', fontSize: '14px' }}
                        >
                          {hideBalance ? '••••' : (w.locked > 0 ? formatAmount(w.locked) : '-')}
                        </span>
                        <span
                          className="tabular-nums text-exchange-text"
                          style={{ width: '14%', textAlign: 'right', fontSize: '14px' }}
                        >
                          ${formatPrice(w.price_usd || 0)}
                        </span>
                        <span
                          className={`tabular-nums flex items-center justify-end ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}
                          style={{ width: '12%', gap: '2px', fontSize: '13px' }}
                        >
                          {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                        </span>
                        <span
                          className="tabular-nums font-medium text-exchange-text"
                          style={{ width: '14%', textAlign: 'right', fontSize: '14px' }}
                        >
                          {hideBalance ? '••••' : `$${formatPrice(value)}`}
                        </span>
                        <div
                          className="flex justify-end"
                          style={{ width: '8%', gap: '6px' }}
                        >
                          <button
                            onClick={() => openDeposit(w.coin_symbol)}
                            className="rounded bg-exchange-buy/10 text-exchange-buy hover:bg-exchange-buy/20 font-medium"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                          >
                            {t('wallet.deposit')}
                          </button>
                          <button
                            onClick={() => openWithdraw(w.coin_symbol)}
                            disabled={w.available <= 0}
                            className="rounded bg-exchange-sell/10 text-exchange-sell hover:bg-exchange-sell/20 disabled:opacity-30 disabled:cursor-not-allowed font-medium"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                          >
                            {t('wallet.withdraw')}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-2">
                {filteredWallets.map(w => {
                  const value = (w.available + w.locked) * (w.price_usd || 0);
                  const change = w.change_24h || 0;
                  const isUp = change >= 0;
                  return (
                    <div key={w.coin_symbol} className="bg-exchange-card rounded-xl border border-exchange-border p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <CoinIcon symbol={w.coin_symbol} size={28} />
                          <div>
                            <span className="text-sm font-semibold text-exchange-text">{w.coin_symbol}</span>
                            <span className="text-[11px] text-exchange-text-third ml-1">{w.coin_name}</span>
                          </div>
                        </div>
                        <span className={`text-xs tabular-nums px-2 py-0.5 rounded-full ${isUp ? 'bg-exchange-buy/10 text-exchange-buy' : 'bg-exchange-sell/10 text-exchange-sell'}`}>
                          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs mb-2.5">
                        <div>
                          <span className="text-exchange-text-third">{t('wallet.holdings')}</span>
                          <p className="text-exchange-text tabular-nums font-medium">{hideBalance ? '••••' : formatAmount(w.available)}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-exchange-text-third">{t('wallet.valuation')}</span>
                          <p className="text-exchange-text tabular-nums font-medium">{hideBalance ? '••••' : `$${formatPrice(value)}`}</p>
                        </div>
                        {w.locked > 0 && (
                          <div>
                            <span className="text-exchange-text-third">{t('wallet.frozenQty')}</span>
                            <p className="text-exchange-text-secondary tabular-nums">{hideBalance ? '••••' : formatAmount(w.locked)}</p>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5 pt-2 border-t border-exchange-border/30">
                        <button
                          onClick={() => openDeposit(w.coin_symbol)}
                          className="flex-1 text-[11px] py-1.5 rounded bg-exchange-buy/10 text-exchange-buy font-medium"
                        >
                          {t('wallet.deposit')}
                        </button>
                        <button
                          onClick={() => openWithdraw(w.coin_symbol)}
                          disabled={w.available <= 0}
                          className="flex-1 text-[11px] py-1.5 rounded bg-exchange-sell/10 text-exchange-sell font-medium disabled:opacity-30"
                        >
                          {t('wallet.withdraw')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : (
        /* Deposit/Withdrawal History — full-width table */
        <div
          className="bg-exchange-card border border-exchange-border overflow-hidden"
          style={{ borderRadius: '12px', width: '100%' }}
        >
          {historyLoading ? (
            <SkeletonLoader type="table" rows={6} />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block">
                <div
                  className="flex items-center text-exchange-text-third font-medium border-b border-exchange-border bg-exchange-bg/50"
                  style={{ padding: '12px 20px', fontSize: '12px' }}
                >
                  <span style={{ width: '15%' }}>{t('wallet.coin')}</span>
                  <span style={{ width: '20%', textAlign: 'right' }}>{t('wallet.qty')}</span>
                  {tab === 'withdrawals' && <span style={{ width: '15%', textAlign: 'right' }}>{t('wallet.feeLbl')}</span>}
                  {tab === 'withdrawals' && <span style={{ width: '20%' }}>{t('wallet.address')}</span>}
                  <span style={{ width: '15%', textAlign: 'center' }}>{t('admin.status')}</span>
                  <span style={{ width: '15%', textAlign: 'right' }}>{t('trade.time')}</span>
                </div>

                {(tab === 'deposits' ? deposits : withdrawals).length === 0 ? (
                  <div className="py-16 text-center">
                    <History size={36} className="mx-auto text-exchange-text-third mb-3 opacity-40" />
                    <p className="text-exchange-text-secondary text-sm">{t('wallet.noHistory', { type: tab === 'deposits' ? t('wallet.deposit') : t('wallet.withdraw') })}</p>
                  </div>
                ) : (
                  (tab === 'deposits' ? deposits : withdrawals).map((item: any) => (
                    <button
                      key={item.id}
                      onClick={() => setTxModal({ open: true, tx: item, type: tab === 'deposits' ? 'deposit' : 'withdrawal' })}
                      className="w-full flex items-center hover:bg-exchange-hover/30 border-b border-exchange-border/30 transition-colors text-left"
                      style={{ padding: '14px 20px', fontSize: '13px' }}
                    >
                      <span className="flex items-center" style={{ width: '15%', gap: '8px' }}>
                        <CoinIcon symbol={item.coin_symbol} size={20} />
                        <span className="text-exchange-text font-medium">{item.coin_symbol}</span>
                      </span>
                      <span className="tabular-nums text-exchange-text" style={{ width: '20%', textAlign: 'right' }}>
                        {formatAmount(item.amount)}
                      </span>
                      {tab === 'withdrawals' && (
                        <span className="tabular-nums text-exchange-text-secondary" style={{ width: '15%', textAlign: 'right' }}>
                          {item.fee ? formatAmount(item.fee) : '-'}
                        </span>
                      )}
                      {tab === 'withdrawals' && (
                        <span className="font-mono text-exchange-text-third truncate" style={{ width: '20%', fontSize: '11px' }} title={item.address}>
                          {item.address ? `${item.address.slice(0, 8)}...${item.address.slice(-6)}` : '-'}
                        </span>
                      )}
                      <span className="flex justify-center items-center" style={{ width: '15%', gap: '4px' }}>
                        {statusIcon(item.status)}
                        <span className="text-exchange-text-secondary">{statusLabel(item.status)}</span>
                      </span>
                      <span className="text-exchange-text-third" style={{ width: '15%', textAlign: 'right' }}>
                        {timeAgo(item.created_at, t)}
                      </span>
                    </button>
                  ))
                )}
              </div>

              {/* Mobile */}
              <div className="md:hidden">
                {(tab === 'deposits' ? deposits : withdrawals).length === 0 ? (
                  <div className="py-12 text-center">
                    <History size={32} className="mx-auto text-exchange-text-third mb-2 opacity-40" />
                    <p className="text-exchange-text-secondary text-sm">{t('wallet.noHistory', { type: tab === 'deposits' ? t('wallet.deposit') : t('wallet.withdraw') })}</p>
                  </div>
                ) : (
                  (tab === 'deposits' ? deposits : withdrawals).map((item: any) => (
                    <button
                      key={item.id}
                      onClick={() => setTxModal({ open: true, tx: item, type: tab === 'deposits' ? 'deposit' : 'withdrawal' })}
                      className="w-full p-3 border-b border-exchange-border/30 text-left hover:bg-exchange-hover/20"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <CoinIcon symbol={item.coin_symbol} size={22} />
                          <span className="text-sm font-medium text-exchange-text">{item.coin_symbol}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {statusIcon(item.status)}
                          <span className="text-xs text-exchange-text-secondary">{statusLabel(item.status)}</span>
                        </div>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-exchange-text-third">{t('wallet.qty')}</span>
                        <span className="tabular-nums text-exchange-text">{formatAmount(item.amount)}</span>
                      </div>
                      {tab === 'withdrawals' && item.fee && (
                        <div className="flex justify-between text-xs mt-0.5">
                          <span className="text-exchange-text-third">{t('wallet.feeLbl')}</span>
                          <span className="tabular-nums text-exchange-text-secondary">{formatAmount(item.fee)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs mt-0.5">
                        <span className="text-exchange-text-third">{t('trade.time')}</span>
                        <span className="text-exchange-text-third">{timeAgo(item.created_at, t)}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Modals */}
      <DepositModal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        initialCoin={selectedCoinForModal}
      />
      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        initialCoin={selectedCoinForModal}
      />
      <TransactionDetailModal
        open={txModal.open}
        onClose={() => setTxModal({ ...txModal, open: false })}
        transaction={txModal.tx}
        type={txModal.type}
      />
    </DesktopPageLayout>
  );
}
