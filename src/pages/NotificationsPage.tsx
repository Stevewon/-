import { useEffect, useState, useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Bell, Filter, CheckCircle2, Trash2, ArrowDownLeft, ArrowUpRight, TrendingUp, Info, Check } from 'lucide-react';
import useStore from '../store/useStore';
import useNotifications, { type Notification } from '../store/notifications';
import { useI18n } from '../i18n';
import { timeAgo } from '../utils/format';

type Filter = 'all' | 'unread' | 'order_filled' | 'deposit' | 'withdraw' | 'system';

const typeIcons: Record<string, any> = {
  order_filled: TrendingUp,
  deposit: ArrowDownLeft,
  withdraw: ArrowUpRight,
  system: Info,
};

const typeColors: Record<string, string> = {
  order_filled: 'text-exchange-yellow bg-exchange-yellow/10',
  deposit: 'text-exchange-buy bg-exchange-buy/10',
  withdraw: 'text-exchange-sell bg-exchange-sell/10',
  system: 'text-blue-400 bg-blue-400/10',
};

export default function NotificationsPage() {
  const { t } = useI18n();
  const { user } = useStore();
  const { items, unread, fetch, markRead, markAllRead, remove } = useNotifications();
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetch().finally(() => setLoading(false));
  }, [user]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'unread') return items.filter(n => !n.is_read);
    return items.filter(n => n.type === filter);
  }, [items, filter]);

  if (!user) return <Navigate to="/login" replace />;

  const tabs: { key: Filter; label: string; count?: number }[] = [
    { key: 'all', label: t('notif.filterAll'), count: items.length },
    { key: 'unread', label: t('notif.filterUnread'), count: unread },
    { key: 'order_filled', label: t('notif.filterOrders'), count: items.filter(n => n.type === 'order_filled').length },
    { key: 'deposit', label: t('wallet.deposit'), count: items.filter(n => n.type === 'deposit').length },
    { key: 'withdraw', label: t('wallet.withdraw'), count: items.filter(n => n.type === 'withdraw').length },
    { key: 'system', label: t('notif.filterSystem'), count: items.filter(n => n.type === 'system').length },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-exchange-yellow/10 rounded-xl flex items-center justify-center">
            <Bell size={20} className="text-exchange-yellow" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-exchange-text">{t('notif.title')}</h1>
            <p className="text-xs text-exchange-text-third mt-0.5">
              {items.length} {t('notif.totalItems')} · {unread} {t('notif.new')}
            </p>
          </div>
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1.5 text-xs text-exchange-yellow bg-exchange-yellow/10 hover:bg-exchange-yellow/20 px-3 py-2 rounded-lg transition-colors"
          >
            <CheckCircle2 size={14} />
            {t('notif.markAllRead')}
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 mb-5 overflow-x-auto border-b border-exchange-border scrollbar-hide">
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              filter === key
                ? 'border-exchange-yellow text-exchange-yellow'
                : 'border-transparent text-exchange-text-secondary hover:text-exchange-text'
            }`}
          >
            {label}
            {typeof count === 'number' && count > 0 && (
              <span className="text-[10px] bg-exchange-hover/50 px-1.5 py-0.5 rounded-full tabular-nums">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-exchange-card rounded-xl border border-exchange-border animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-exchange-card rounded-xl border border-exchange-border py-16 text-center">
          <Bell size={36} className="mx-auto text-exchange-text-third mb-3 opacity-30" />
          <p className="text-sm text-exchange-text-secondary">{t('notif.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(n => (
            <NotifCard
              key={n.id}
              notif={n}
              t={t}
              onRead={() => markRead(n.id)}
              onRemove={() => remove(n.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NotifCard({
  notif, t, onRead, onRemove,
}: {
  notif: Notification;
  t: (k: string, v?: any) => string;
  onRead: () => void;
  onRemove: () => void;
}) {
  const Icon = typeIcons[notif.type] || Info;
  const colorClass = typeColors[notif.type] || 'text-exchange-text-secondary bg-exchange-hover/30';

  // Try to extract trade link
  const tradeLink = notif.type === 'order_filled' && notif.data?.symbol
    ? `/trade/${notif.data.symbol.replace('/', '-')}`
    : notif.type === 'deposit' || notif.type === 'withdraw'
    ? '/wallet'
    : null;

  const content = (
    <div className={`group flex gap-3 p-4 bg-exchange-card rounded-xl border transition-all hover:border-exchange-yellow/30 ${
      !notif.is_read ? 'border-exchange-yellow/30 bg-exchange-yellow/[0.02]' : 'border-exchange-border'
    }`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${colorClass}`}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold text-exchange-text leading-snug">
            {notif.title}
          </div>
          {!notif.is_read && (
            <span className="text-[9px] bg-exchange-yellow text-exchange-bg font-bold rounded-full px-1.5 py-0.5 shrink-0">
              NEW
            </span>
          )}
        </div>
        {notif.message && (
          <div className="text-xs text-exchange-text-secondary mt-1 break-words">
            {notif.message}
          </div>
        )}
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] text-exchange-text-third">{timeAgo(notif.created_at, t)}</span>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
            {!notif.is_read && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRead(); }}
                className="text-[11px] text-exchange-text-third hover:text-exchange-buy flex items-center gap-1"
              >
                <Check size={11} /> {t('notif.read')}
              </button>
            )}
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
              className="text-[11px] text-exchange-text-third hover:text-exchange-sell flex items-center gap-1"
            >
              <Trash2 size={11} /> {t('common.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (tradeLink) {
    return (
      <Link to={tradeLink} onClick={() => !notif.is_read && onRead()}>
        {content}
      </Link>
    );
  }

  return content;
}
