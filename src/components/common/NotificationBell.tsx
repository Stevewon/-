import { useEffect, useRef, useState } from 'react';
import { Bell, Check, Trash2, CheckCircle2, ArrowDownLeft, ArrowUpRight, TrendingUp, Info, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import useStore from '../../store/useStore';
import useNotifications, { type Notification } from '../../store/notifications';
import { useI18n } from '../../i18n';
import { timeAgo } from '../../utils/format';

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

export default function NotificationBell() {
  const { t } = useI18n();
  const { user, token } = useStore();
  const { items, unread, fetch, fetchUnreadCount, markRead, markAllRead, remove, connect, disconnect } = useNotifications();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Connect SSE when user logs in
  useEffect(() => {
    if (!user || !token) {
      disconnect();
      return;
    }
    fetch();
    connect(token);
    return () => {
      disconnect();
    };
  }, [user, token]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  // Refresh unread count when dropdown closes (and when visibility changes)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && user) fetchUnreadCount();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [user]);

  if (!user) return null;

  const recent = items.slice(0, 10);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => { setOpen(!open); if (!open) fetch(); }}
        className="relative p-1.5 rounded-md text-exchange-text-secondary hover:text-exchange-text hover:bg-exchange-hover/50 transition-colors"
        aria-label={t('notif.title')}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-exchange-sell text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center tabular-nums animate-pulse">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[350px] max-w-[90vw] bg-exchange-card border border-exchange-border rounded-xl shadow-2xl z-50 overflow-hidden animate-slide-down">
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b border-exchange-border">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-exchange-yellow" />
              <span className="text-sm font-semibold text-exchange-text">{t('notif.title')}</span>
              {unread > 0 && (
                <span className="text-[10px] bg-exchange-sell/10 text-exchange-sell px-1.5 py-0.5 rounded-full font-medium">
                  {unread} {t('notif.new')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] text-exchange-text-third hover:text-exchange-yellow flex items-center gap-1"
                  title={t('notif.markAllRead')}
                >
                  <CheckCircle2 size={12} />
                  <span className="hidden sm:inline">{t('notif.markAllRead')}</span>
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 text-exchange-text-third hover:text-exchange-text rounded">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto">
            {recent.length === 0 ? (
              <div className="py-10 text-center text-xs text-exchange-text-third">
                <Bell size={28} className="mx-auto mb-2 opacity-30" />
                {t('notif.empty')}
              </div>
            ) : (
              recent.map(n => (
                <NotificationRow
                  key={n.id}
                  notif={n}
                  t={t}
                  onRead={() => markRead(n.id)}
                  onRemove={() => remove(n.id)}
                />
              ))
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="block text-center text-[11px] text-exchange-text-secondary hover:text-exchange-yellow py-2.5 border-t border-exchange-border bg-exchange-bg/30 transition-colors"
            >
              {t('notif.viewAll')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notif, t, onRead, onRemove,
}: {
  notif: Notification;
  t: (k: string, v?: any) => string;
  onRead: () => void;
  onRemove: () => void;
}) {
  const Icon = typeIcons[notif.type] || Info;
  const colorClass = typeColors[notif.type] || 'text-exchange-text-secondary bg-exchange-hover/30';

  return (
    <div
      className={`group flex gap-2.5 p-3 border-b border-exchange-border/50 hover:bg-exchange-hover/20 transition-colors ${
        !notif.is_read ? 'bg-exchange-yellow/[0.02]' : ''
      }`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-medium text-exchange-text leading-snug">
            {notif.title}
          </div>
          {!notif.is_read && (
            <span className="w-1.5 h-1.5 rounded-full bg-exchange-yellow mt-1.5 shrink-0" />
          )}
        </div>
        {notif.message && (
          <div className="text-[11px] text-exchange-text-secondary mt-0.5 leading-snug break-words">
            {notif.message}
          </div>
        )}
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-exchange-text-third">{timeAgo(notif.created_at, t)}</span>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
            {!notif.is_read && (
              <button
                onClick={onRead}
                className="text-[10px] text-exchange-text-third hover:text-exchange-buy flex items-center gap-0.5"
              >
                <Check size={10} /> {t('notif.read')}
              </button>
            )}
            <button
              onClick={onRemove}
              className="text-[10px] text-exchange-text-third hover:text-exchange-sell flex items-center gap-0.5"
            >
              <Trash2 size={10} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
