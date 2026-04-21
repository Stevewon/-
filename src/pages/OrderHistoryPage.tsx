import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import { formatPrice, formatAmount, timeAgo } from '../utils/format';
import CoinIcon from '../components/common/CoinIcon';
import SkeletonLoader from '../components/common/SkeletonLoader';
import {
  ClipboardList, ArrowLeftRight, Filter, ChevronDown, ChevronUp,
  Clock, CheckCircle2, XCircle, AlertCircle, ArrowUpDown, Search,
} from 'lucide-react';

type Tab = 'orders' | 'trades';
type StatusFilter = 'all' | 'open' | 'filled' | 'cancelled' | 'partial';

export default function OrderHistoryPage() {
  const { t } = useI18n();
  const { user, openOrders, orderHistory, tradeHistory, fetchOpenOrders, fetchOrderHistory, fetchTradeHistory } = useStore();
  const [tab, setTab] = useState<Tab>('orders');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<string>('time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      fetchOpenOrders(),
      fetchOrderHistory(),
      fetchTradeHistory(),
    ]).finally(() => setLoading(false));
  }, [user]);

  if (!user) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <ClipboardList size={48} className="text-exchange-text-third mb-4" />
        <p className="text-exchange-text-secondary mb-4">{t('trade.loginToView')}</p>
        <Link to="/login" className="btn-primary px-6 py-2 rounded-lg">{t('nav.login')}</Link>
      </div>
    );
  }

  const allOrders = [...openOrders, ...orderHistory];

  const filteredOrders = allOrders
    .filter(o => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'open') return o.status === 'open' || o.status === 'partial';
      return o.status === statusFilter;
    })
    .filter(o => {
      if (!search) return true;
      const s = search.toUpperCase();
      return o.base_coin?.includes(s) || o.quote_coin?.includes(s);
    })
    .sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortField === 'time') return dir * (new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      if (sortField === 'price') return dir * (a.price - b.price);
      if (sortField === 'amount') return dir * (a.amount - b.amount);
      return 0;
    });

  const filteredTrades = (tradeHistory as any[])
    .filter(tr => {
      if (!search) return true;
      const s = search.toUpperCase();
      return (tr.base_coin || '').includes(s) || (tr.market_symbol || '').toUpperCase().includes(s);
    })
    .sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      return dir * (new Date(b.created_at || b.time || 0).getTime() - new Date(a.created_at || a.time || 0).getTime());
    });

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'open': return <Clock size={14} className="text-exchange-yellow" />;
      case 'partial': return <AlertCircle size={14} className="text-blue-400" />;
      case 'filled': return <CheckCircle2 size={14} className="text-exchange-buy" />;
      case 'cancelled': return <XCircle size={14} className="text-exchange-text-third" />;
      default: return <Clock size={14} className="text-exchange-text-third" />;
    }
  };

  const statusLabel = (status: string) => {
    const labels: Record<string, string> = {
      open: t('status.open'),
      partial: t('status.partial'),
      filled: t('status.filled'),
      cancelled: t('status.cancelled'),
    };
    return labels[status] || status;
  };

  const statusColors: Record<string, string> = {
    all: 'text-exchange-yellow border-exchange-yellow',
    open: 'text-exchange-yellow border-exchange-yellow',
    filled: 'text-exchange-buy border-exchange-buy',
    cancelled: 'text-exchange-text-third border-exchange-text-third',
    partial: 'text-blue-400 border-blue-400',
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-exchange-yellow/10 rounded-xl flex items-center justify-center">
            <ClipboardList size={22} className="text-exchange-yellow" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-exchange-text">
              {tab === 'orders' ? t('orderHistory.title') : t('orderHistory.tradeTitle')}
            </h1>
            <p className="text-xs text-exchange-text-secondary">
              {tab === 'orders'
                ? t('orderHistory.total', { count: String(filteredOrders.length) })
                : t('orderHistory.totalTrades', { count: String(filteredTrades.length) })}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-exchange-border">
        <button
          onClick={() => setTab('orders')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'orders'
              ? 'border-exchange-yellow text-exchange-yellow'
              : 'border-transparent text-exchange-text-secondary hover:text-exchange-text'
          }`}
        >
          <ClipboardList size={16} />
          {t('orderHistory.title')}
          <span className="text-[10px] bg-exchange-hover/60 px-1.5 py-0.5 rounded-full">
            {allOrders.length}
          </span>
        </button>
        <button
          onClick={() => setTab('trades')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'trades'
              ? 'border-exchange-yellow text-exchange-yellow'
              : 'border-transparent text-exchange-text-secondary hover:text-exchange-text'
          }`}
        >
          <ArrowLeftRight size={16} />
          {t('orderHistory.tradeTitle')}
          <span className="text-[10px] bg-exchange-hover/60 px-1.5 py-0.5 rounded-full">
            {(tradeHistory as any[]).length}
          </span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {tab === 'orders' && (
          <div className="flex items-center gap-1 bg-exchange-card rounded-lg border border-exchange-border p-1">
            {(['all', 'open', 'filled', 'cancelled', 'partial'] as StatusFilter[]).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  statusFilter === s
                    ? 'bg-exchange-hover text-exchange-yellow'
                    : 'text-exchange-text-secondary hover:text-exchange-text'
                }`}
              >
                {s === 'all' ? t('common.all') : statusLabel(s)}
              </button>
            ))}
          </div>
        )}

        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-exchange-text-third" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('market.searchCoin')}
            className="input-field pl-9 text-xs h-8"
          />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-exchange-card rounded-xl border border-exchange-border">
          <SkeletonLoader type="table" rows={8} />
        </div>
      ) : tab === 'orders' ? (
        <div className="bg-exchange-card rounded-xl border border-exchange-border overflow-hidden">
          {/* Table Header */}
          <div className="flex items-center px-4 py-3 text-xs text-exchange-text-third font-medium border-b border-exchange-border bg-exchange-bg/50">
            <span className="w-[4%]"></span>
            <span className="w-[14%]">{t('trade.pair')}</span>
            <span className="w-[8%]">{t('trade.side')}</span>
            <span className="w-[8%]">{t('trade.type')}</span>
            <button onClick={() => toggleSort('price')} className="w-[14%] text-right flex items-center justify-end gap-1 hover:text-exchange-text">
              {t('trade.price')} <ArrowUpDown size={10} />
            </button>
            <button onClick={() => toggleSort('amount')} className="w-[14%] text-right flex items-center justify-end gap-1 hover:text-exchange-text">
              {t('trade.amount')} <ArrowUpDown size={10} />
            </button>
            <span className="w-[10%] text-right">{t('trade.filled')}</span>
            <span className="w-[10%] text-center">{t('admin.status')}</span>
            <button onClick={() => toggleSort('time')} className="w-[14%] text-right flex items-center justify-end gap-1 hover:text-exchange-text">
              {t('trade.time')} <ArrowUpDown size={10} />
            </button>
            <span className="w-[4%]"></span>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="py-16 text-center">
              <ClipboardList size={40} className="mx-auto text-exchange-text-third mb-3 opacity-40" />
              <p className="text-exchange-text-secondary text-sm">{t('orderHistory.noOrders')}</p>
            </div>
          ) : (
            filteredOrders.map((order) => {
              const filledPct = order.amount > 0 ? (order.filled / order.amount) * 100 : 0;
              const isExpanded = expandedOrder === order.id;

              return (
                <div key={order.id}>
                  <div
                    onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                    className="flex items-center px-4 py-2.5 text-xs hover:bg-exchange-hover/30 border-b border-exchange-border/30 cursor-pointer transition-colors"
                  >
                    <span className="w-[4%]">
                      {isExpanded ? <ChevronUp size={12} className="text-exchange-text-third" /> : <ChevronDown size={12} className="text-exchange-text-third" />}
                    </span>
                    <span className="w-[14%] flex items-center gap-1.5">
                      <CoinIcon symbol={order.base_coin} size={18} />
                      <span className="text-exchange-text font-medium">{order.base_coin}/{order.quote_coin}</span>
                    </span>
                    <span className={`w-[8%] font-semibold ${order.side === 'buy' ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                      {order.side === 'buy' ? t('trade.buy') : t('trade.sell')}
                    </span>
                    <span className="w-[8%] text-exchange-text-secondary">
                      {order.type === 'limit' ? t('trade.limit') : t('trade.market')}
                    </span>
                    <span className="w-[14%] text-right tabular-nums text-exchange-text">
                      {order.price ? formatPrice(order.price) : '-'}
                    </span>
                    <span className="w-[14%] text-right tabular-nums text-exchange-text">
                      {formatAmount(order.amount)}
                    </span>
                    <span className="w-[10%] text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <div className="w-12 h-1.5 bg-exchange-hover/60 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${filledPct === 100 ? 'bg-exchange-buy' : filledPct > 0 ? 'bg-blue-400' : 'bg-exchange-text-third'}`}
                            style={{ width: `${filledPct}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-exchange-text-secondary">{filledPct.toFixed(1)}%</span>
                      </div>
                    </span>
                    <span className="w-[10%] flex justify-center">
                      <span className="inline-flex items-center gap-1">
                        {statusIcon(order.status)}
                        <span className="text-exchange-text-secondary">{statusLabel(order.status)}</span>
                      </span>
                    </span>
                    <span className="w-[14%] text-right text-exchange-text-third">{timeAgo(order.created_at, t)}</span>
                    <span className="w-[4%]"></span>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-8 py-3 bg-exchange-bg/50 border-b border-exchange-border/30 text-xs">
                      <div className="grid grid-cols-4 gap-4">
                        <div>
                          <span className="text-exchange-text-third">{t('orderHistory.orderId')}</span>
                          <p className="text-exchange-text font-mono text-[10px] mt-0.5">{order.id.slice(0, 16)}...</p>
                        </div>
                        <div>
                          <span className="text-exchange-text-third">{t('orderHistory.totalAmount')}</span>
                          <p className="text-exchange-text tabular-nums mt-0.5">{formatPrice(order.total || order.price * order.amount)}</p>
                        </div>
                        <div>
                          <span className="text-exchange-text-third">{t('orderHistory.filledQty')}</span>
                          <p className="text-exchange-text tabular-nums mt-0.5">{formatAmount(order.filled)} / {formatAmount(order.amount)}</p>
                        </div>
                        <div>
                          <span className="text-exchange-text-third">{t('orderHistory.remainingQty')}</span>
                          <p className="text-exchange-text tabular-nums mt-0.5">{formatAmount(order.remaining || order.amount - order.filled)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Trade History Tab */
        <div className="bg-exchange-card rounded-xl border border-exchange-border overflow-hidden">
          <div className="flex items-center px-4 py-3 text-xs text-exchange-text-third font-medium border-b border-exchange-border bg-exchange-bg/50">
            <span className="w-[15%]">{t('trade.pair')}</span>
            <span className="w-[10%]">{t('trade.side')}</span>
            <span className="w-[18%] text-right">{t('trade.price')}</span>
            <span className="w-[15%] text-right">{t('trade.amount')}</span>
            <span className="w-[18%] text-right">{t('orderHistory.totalAmount')}</span>
            <span className="w-[12%] text-right">{t('trade.fee')}</span>
            <span className="w-[12%] text-right">{t('trade.time')}</span>
          </div>

          {filteredTrades.length === 0 ? (
            <div className="py-16 text-center">
              <ArrowLeftRight size={40} className="mx-auto text-exchange-text-third mb-3 opacity-40" />
              <p className="text-exchange-text-secondary text-sm">{t('orderHistory.noTrades')}</p>
            </div>
          ) : (
            filteredTrades.map((trade: any, i: number) => (
              <div key={trade.id || i} className="flex items-center px-4 py-2.5 text-xs hover:bg-exchange-hover/30 border-b border-exchange-border/30 transition-colors">
                <span className="w-[15%] flex items-center gap-1.5">
                  <CoinIcon symbol={trade.base_coin || 'BTC'} size={18} />
                  <span className="text-exchange-text font-medium">
                    {trade.base_coin || trade.market_symbol || '-'}/{trade.quote_coin || 'USDT'}
                  </span>
                </span>
                <span className={`w-[10%] font-semibold ${trade.side === 'buy' ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                  {trade.side === 'buy' ? t('trade.buy') : t('trade.sell')}
                </span>
                <span className="w-[18%] text-right tabular-nums text-exchange-text">{formatPrice(trade.price)}</span>
                <span className="w-[15%] text-right tabular-nums text-exchange-text">{formatAmount(trade.amount)}</span>
                <span className="w-[18%] text-right tabular-nums text-exchange-text">{formatPrice(trade.total || trade.price * trade.amount)}</span>
                <span className="w-[12%] text-right tabular-nums text-exchange-text-third">{trade.fee ? formatAmount(trade.fee) : '-'}</span>
                <span className="w-[12%] text-right text-exchange-text-third">{timeAgo(trade.created_at || trade.time, t)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
