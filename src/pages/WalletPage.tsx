import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import { formatPrice, formatAmount, timeAgo } from '../utils/format';
import CoinIcon from '../components/common/CoinIcon';
import SkeletonLoader from '../components/common/SkeletonLoader';
import api from '../utils/api';
import {
  Wallet, Eye, EyeOff, RefreshCw, ArrowDownLeft, ArrowUpRight,
  TrendingUp, TrendingDown, Search, ChevronDown, ChevronUp,
  Clock, CheckCircle2, XCircle, AlertCircle, PieChart,
  Copy, ExternalLink, History,
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

  // Deposit/Withdraw panel state
  const [showPanel, setShowPanel] = useState<'deposit' | 'withdraw' | null>(null);
  const [selectedCoin, setSelectedCoin] = useState('USDT');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [panelMsg, setPanelMsg] = useState('');
  const [panelLoading, setPanelLoading] = useState(false);

  // History
  const [deposits, setDeposits] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchWallets().finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (tab === 'deposits') {
      setHistoryLoading(true);
      api.get('/wallet/history/deposits').then(r => setDeposits(r.data)).finally(() => setHistoryLoading(false));
    } else if (tab === 'withdrawals') {
      setHistoryLoading(true);
      api.get('/wallet/history/withdrawals').then(r => setWithdrawals(r.data)).finally(() => setHistoryLoading(false));
    }
  }, [user, tab]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchWallets();
    setRefreshing(false);
  };

  const totalUSD = useMemo(() =>
    wallets.reduce((sum, w) => sum + (w.available + w.locked) * (w.price_usd || 0), 0),
    [wallets]
  );
  const totalKRW = totalUSD * 1350;

  // Portfolio breakdown
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

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) { setPanelMsg('유효한 금액을 입력하세요'); return; }
    setPanelLoading(true);
    setPanelMsg('');
    try {
      await api.post('/wallet/deposit', { coin_symbol: selectedCoin, amount: parseFloat(amount) });
      setPanelMsg('입금이 완료되었습니다');
      setAmount('');
      fetchWallets();
      setTimeout(() => { setPanelMsg(''); }, 2000);
    } catch (err: any) {
      setPanelMsg(err.response?.data?.error || '입금 실패');
    } finally {
      setPanelLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0) { setPanelMsg('유효한 금액을 입력하세요'); return; }
    if (!address) { setPanelMsg('출금 주소를 입력하세요'); return; }
    setPanelLoading(true);
    setPanelMsg('');
    try {
      await api.post('/wallet/withdraw', { coin_symbol: selectedCoin, amount: parseFloat(amount), address });
      setPanelMsg('출금 신청이 완료되었습니다');
      setAmount('');
      setAddress('');
      fetchWallets();
      setTimeout(() => { setPanelMsg(''); }, 2000);
    } catch (err: any) {
      setPanelMsg(err.response?.data?.error || '출금 실패');
    } finally {
      setPanelLoading(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 size={14} className="text-exchange-buy" />;
      case 'pending': return <Clock size={14} className="text-exchange-yellow" />;
      case 'failed': return <XCircle size={14} className="text-exchange-sell" />;
      default: return <AlertCircle size={14} className="text-exchange-text-third" />;
    }
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = { completed: '완료', pending: '처리중', failed: '실패' };
    return map[status] || status;
  };

  const COLORS = ['#F0B90B', '#0ECB81', '#3B82F6', '#8B5CF6', '#F6465D', '#6B7280'];

  if (!user) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <Wallet size={48} className="text-exchange-text-third mb-4" />
        <p className="text-exchange-text-secondary mb-4">로그인이 필요합니다</p>
        <Link to="/login" className="btn-primary px-6 py-2 rounded-lg">{t('nav.login')}</Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Overview Card */}
      <div className="bg-gradient-to-br from-exchange-card to-exchange-bg rounded-2xl border border-exchange-border p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          {/* Left: Balance */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Wallet size={18} className="text-exchange-yellow" />
              <span className="text-sm text-exchange-text-secondary">총 자산 평가</span>
              <button onClick={() => setHideBalance(!hideBalance)} className="text-exchange-text-third hover:text-exchange-text transition-colors">
                {hideBalance ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button onClick={handleRefresh} className={`text-exchange-text-third hover:text-exchange-text transition-colors ml-1 ${refreshing ? 'animate-spin' : ''}`}>
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="text-3xl md:text-4xl font-bold text-exchange-text tabular-nums mb-1">
              {hideBalance ? '••••••••' : `$${formatPrice(totalUSD)}`}
            </div>
            <div className="text-sm text-exchange-text-secondary tabular-nums">
              {hideBalance ? '••••••••' : `≈ ₩${totalKRW.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`}
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setShowPanel('deposit'); setPanelMsg(''); }}
                className="flex items-center gap-1.5 px-4 py-2 bg-exchange-buy/10 text-exchange-buy rounded-lg text-sm font-medium hover:bg-exchange-buy/20 transition-colors"
              >
                <ArrowDownLeft size={16} /> 입금
              </button>
              <button
                onClick={() => { setShowPanel('withdraw'); setPanelMsg(''); }}
                className="flex items-center gap-1.5 px-4 py-2 bg-exchange-sell/10 text-exchange-sell rounded-lg text-sm font-medium hover:bg-exchange-sell/20 transition-colors"
              >
                <ArrowUpRight size={16} /> 출금
              </button>
              <Link
                to="/trade/BTC-USDT"
                className="flex items-center gap-1.5 px-4 py-2 bg-exchange-yellow/10 text-exchange-yellow rounded-lg text-sm font-medium hover:bg-exchange-yellow/20 transition-colors"
              >
                <TrendingUp size={16} /> 거래하기
              </Link>
            </div>
          </div>

          {/* Right: Portfolio Breakdown */}
          <div className="w-full md:w-64 bg-exchange-bg/50 rounded-xl p-4 border border-exchange-border/50">
            <div className="flex items-center gap-1.5 mb-3">
              <PieChart size={14} className="text-exchange-yellow" />
              <span className="text-xs font-medium text-exchange-text-secondary">포트폴리오</span>
            </div>
            {portfolio.length === 0 ? (
              <p className="text-xs text-exchange-text-third text-center py-4">보유 자산 없음</p>
            ) : (
              <div className="space-y-2">
                {/* Bar Chart */}
                <div className="h-3 rounded-full overflow-hidden flex bg-exchange-hover/30">
                  {topAssets.map((a, i) => (
                    <div
                      key={a.symbol}
                      className="h-full transition-all"
                      style={{ width: `${a.pct}%`, backgroundColor: COLORS[i] }}
                      title={`${a.symbol}: ${a.pct.toFixed(1)}%`}
                    />
                  ))}
                  {otherPct > 0 && (
                    <div className="h-full" style={{ width: `${otherPct}%`, backgroundColor: COLORS[5] }} title={`기타: ${otherPct.toFixed(1)}%`} />
                  )}
                </div>
                {/* Legend */}
                <div className="grid grid-cols-2 gap-1">
                  {topAssets.map((a, i) => (
                    <div key={a.symbol} className="flex items-center gap-1.5 text-[11px]">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i] }} />
                      <span className="text-exchange-text-secondary truncate">{a.symbol}</span>
                      <span className="text-exchange-text-third ml-auto tabular-nums">{a.pct.toFixed(1)}%</span>
                    </div>
                  ))}
                  {otherPct > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[5] }} />
                      <span className="text-exchange-text-secondary">기타</span>
                      <span className="text-exchange-text-third ml-auto tabular-nums">{otherPct.toFixed(1)}%</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Deposit/Withdraw Panel */}
      {showPanel && (
        <div className="bg-exchange-card rounded-xl border border-exchange-border p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-exchange-text flex items-center gap-2">
              {showPanel === 'deposit' ? <><ArrowDownLeft size={18} className="text-exchange-buy" /> 입금</> : <><ArrowUpRight size={18} className="text-exchange-sell" /> 출금</>}
            </h3>
            <button onClick={() => setShowPanel(null)} className="text-exchange-text-third hover:text-exchange-text text-sm">닫기</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Coin Select */}
            <div>
              <label className="text-xs text-exchange-text-third mb-1.5 block">코인 선택</label>
              <select
                value={selectedCoin}
                onChange={e => setSelectedCoin(e.target.value)}
                className="input-field w-full text-sm"
              >
                {wallets.map(w => (
                  <option key={w.coin_symbol} value={w.coin_symbol}>{w.coin_symbol} - {w.coin_name}</option>
                ))}
              </select>
              <p className="text-[11px] text-exchange-text-third mt-1.5">
                잔고: {formatPrice(wallets.find(w => w.coin_symbol === selectedCoin)?.available || 0)} {selectedCoin}
              </p>
            </div>

            {/* Amount */}
            <div>
              <label className="text-xs text-exchange-text-third mb-1.5 block">
                {showPanel === 'deposit' ? '입금' : '출금'} 수량
              </label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                step="any"
                className="input-field w-full text-sm tabular-nums"
              />
              {showPanel === 'deposit' && (
                <div className="flex gap-1 mt-1.5">
                  {[100, 1000, 10000].map(v => (
                    <button
                      key={v}
                      onClick={() => setAmount(String(v))}
                      className="text-[10px] px-2 py-0.5 rounded bg-exchange-hover/50 text-exchange-text-secondary hover:text-exchange-text transition-colors"
                    >
                      {v.toLocaleString()}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Address (withdraw only) */}
            {showPanel === 'withdraw' && (
              <div className="md:col-span-2">
                <label className="text-xs text-exchange-text-third mb-1.5 block">출금 주소</label>
                <input
                  type="text"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="0x..."
                  className="input-field w-full text-sm font-mono"
                />
              </div>
            )}
          </div>

          {/* Action */}
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={showPanel === 'deposit' ? handleDeposit : handleWithdraw}
              disabled={panelLoading}
              className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 ${
                showPanel === 'deposit' ? 'btn-buy' : 'btn-sell'
              }`}
            >
              {panelLoading ? '처리중...' : (showPanel === 'deposit' ? '입금하기' : '출금하기')}
            </button>
            {panelMsg && (
              <span className={`text-xs ${panelMsg.includes('완료') ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                {panelMsg}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-exchange-border">
        {([
          { key: 'assets' as Tab, label: '자산 목록', icon: Wallet },
          { key: 'deposits' as Tab, label: '입금 내역', icon: ArrowDownLeft },
          { key: 'withdrawals' as Tab, label: '출금 내역', icon: ArrowUpRight },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-exchange-yellow text-exchange-yellow'
                : 'border-transparent text-exchange-text-secondary hover:text-exchange-text'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'assets' ? (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-exchange-text-third" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="코인 검색..."
                className="input-field pl-9 text-xs h-8"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-exchange-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideZero}
                onChange={e => setHideZero(e.target.checked)}
                className="accent-exchange-yellow w-3.5 h-3.5"
              />
              잔액 0 숨기기
            </label>
          </div>

          {loading ? (
            <div className="bg-exchange-card rounded-xl border border-exchange-border">
              <SkeletonLoader type="table" rows={8} />
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block bg-exchange-card rounded-xl border border-exchange-border overflow-hidden">
                <div className="flex items-center px-4 py-3 text-xs text-exchange-text-third font-medium border-b border-exchange-border bg-exchange-bg/50">
                  <span className="w-[22%]">코인</span>
                  <span className="w-[15%] text-right">보유수량</span>
                  <span className="w-[15%] text-right">동결수량</span>
                  <span className="w-[15%] text-right">현재가 (USD)</span>
                  <button
                    onClick={() => { if (sortField === 'change') setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortField('change'); setSortDir('desc'); }}}
                    className="w-[13%] text-right flex items-center justify-end gap-1 hover:text-exchange-text"
                  >
                    24h 변동 {sortField === 'change' ? (sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />) : null}
                  </button>
                  <button
                    onClick={() => { if (sortField === 'value') setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortField('value'); setSortDir('desc'); }}}
                    className="w-[20%] text-right flex items-center justify-end gap-1 hover:text-exchange-text"
                  >
                    평가금액 {sortField === 'value' ? (sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />) : null}
                  </button>
                </div>

                {filteredWallets.length === 0 ? (
                  <div className="py-12 text-center text-exchange-text-third text-sm">검색 결과 없음</div>
                ) : (
                  filteredWallets.map(w => {
                    const value = (w.available + w.locked) * (w.price_usd || 0);
                    const change = w.change_24h || 0;
                    const isUp = change >= 0;
                    return (
                      <div key={w.coin_symbol} className="flex items-center px-4 py-3 hover:bg-exchange-hover/30 border-b border-exchange-border/30 transition-colors">
                        <div className="w-[22%] flex items-center gap-2.5">
                          <CoinIcon symbol={w.coin_symbol} size={28} />
                          <div>
                            <span className="text-sm font-medium text-exchange-text">{w.coin_symbol}</span>
                            <span className="text-[11px] text-exchange-text-third ml-1.5">{w.coin_name}</span>
                          </div>
                        </div>
                        <span className="w-[15%] text-right text-sm tabular-nums text-exchange-text">
                          {hideBalance ? '••••' : formatAmount(w.available)}
                        </span>
                        <span className="w-[15%] text-right text-sm tabular-nums text-exchange-text-secondary">
                          {hideBalance ? '••••' : (w.locked > 0 ? formatAmount(w.locked) : '-')}
                        </span>
                        <span className="w-[15%] text-right text-sm tabular-nums text-exchange-text">
                          ${formatPrice(w.price_usd || 0)}
                        </span>
                        <span className={`w-[13%] text-right text-xs tabular-nums flex items-center justify-end gap-0.5 ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                          {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                        </span>
                        <span className="w-[20%] text-right text-sm tabular-nums font-medium text-exchange-text">
                          {hideBalance ? '••••' : `$${formatPrice(value)}`}
                        </span>
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
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-exchange-text-third">보유</span>
                          <p className="text-exchange-text tabular-nums font-medium">{hideBalance ? '••••' : formatAmount(w.available)}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-exchange-text-third">평가금액</span>
                          <p className="text-exchange-text tabular-nums font-medium">{hideBalance ? '••••' : `$${formatPrice(value)}`}</p>
                        </div>
                        {w.locked > 0 && (
                          <div>
                            <span className="text-exchange-text-third">동결</span>
                            <p className="text-exchange-text-secondary tabular-nums">{hideBalance ? '••••' : formatAmount(w.locked)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : (
        /* Deposit/Withdrawal History */
        <div className="bg-exchange-card rounded-xl border border-exchange-border overflow-hidden">
          {historyLoading ? (
            <SkeletonLoader type="table" rows={6} />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block">
                <div className="flex items-center px-4 py-3 text-xs text-exchange-text-third font-medium border-b border-exchange-border bg-exchange-bg/50">
                  <span className="w-[15%]">코인</span>
                  <span className="w-[20%] text-right">수량</span>
                  {tab === 'withdrawals' && <span className="w-[15%] text-right">수수료</span>}
                  {tab === 'withdrawals' && <span className="w-[20%]">주소</span>}
                  <span className="w-[15%] text-center">상태</span>
                  <span className="w-[15%] text-right">시간</span>
                </div>

                {(tab === 'deposits' ? deposits : withdrawals).length === 0 ? (
                  <div className="py-16 text-center">
                    <History size={36} className="mx-auto text-exchange-text-third mb-3 opacity-40" />
                    <p className="text-exchange-text-secondary text-sm">{tab === 'deposits' ? '입금' : '출금'} 내역이 없습니다</p>
                  </div>
                ) : (
                  (tab === 'deposits' ? deposits : withdrawals).map((item: any) => (
                    <div key={item.id} className="flex items-center px-4 py-3 text-xs hover:bg-exchange-hover/30 border-b border-exchange-border/30 transition-colors">
                      <span className="w-[15%] flex items-center gap-2">
                        <CoinIcon symbol={item.coin_symbol} size={20} />
                        <span className="text-exchange-text font-medium">{item.coin_symbol}</span>
                      </span>
                      <span className="w-[20%] text-right tabular-nums text-exchange-text">{formatAmount(item.amount)}</span>
                      {tab === 'withdrawals' && (
                        <span className="w-[15%] text-right tabular-nums text-exchange-text-secondary">{item.fee ? formatAmount(item.fee) : '-'}</span>
                      )}
                      {tab === 'withdrawals' && (
                        <span className="w-[20%] font-mono text-[10px] text-exchange-text-third truncate" title={item.address}>
                          {item.address ? `${item.address.slice(0, 8)}...${item.address.slice(-6)}` : '-'}
                        </span>
                      )}
                      <span className="w-[15%] flex justify-center items-center gap-1">
                        {statusIcon(item.status)}
                        <span className="text-exchange-text-secondary">{statusLabel(item.status)}</span>
                      </span>
                      <span className="w-[15%] text-right text-exchange-text-third">{timeAgo(item.created_at)}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Mobile */}
              <div className="md:hidden">
                {(tab === 'deposits' ? deposits : withdrawals).length === 0 ? (
                  <div className="py-12 text-center">
                    <History size={32} className="mx-auto text-exchange-text-third mb-2 opacity-40" />
                    <p className="text-exchange-text-secondary text-sm">{tab === 'deposits' ? '입금' : '출금'} 내역이 없습니다</p>
                  </div>
                ) : (
                  (tab === 'deposits' ? deposits : withdrawals).map((item: any) => (
                    <div key={item.id} className="p-3 border-b border-exchange-border/30">
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
                        <span className="text-exchange-text-third">수량</span>
                        <span className="tabular-nums text-exchange-text">{formatAmount(item.amount)}</span>
                      </div>
                      {tab === 'withdrawals' && item.fee && (
                        <div className="flex justify-between text-xs mt-0.5">
                          <span className="text-exchange-text-third">수수료</span>
                          <span className="tabular-nums text-exchange-text-secondary">{formatAmount(item.fee)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs mt-0.5">
                        <span className="text-exchange-text-third">시간</span>
                        <span className="text-exchange-text-third">{timeAgo(item.created_at)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
