import { create } from 'zustand';
import api from '../utils/api';
import { showToast } from '../components/common/Toast';
import { loadPrefs, playNotificationSound, showDesktopNotification } from '../utils/notificationPrefs';

export interface Notification {
  id: string;
  type: 'order_filled' | 'deposit' | 'withdraw' | 'system' | 'price' | string;
  title: string;
  message?: string;
  data?: any;
  is_read: number;
  created_at: string;
}

/**
 * Map notification type → Toast type for the in-app popup.
 */
function mapNotifToToast(type: string) {
  const m: Record<string, any> = {
    order_filled: 'trade',
    deposit: 'deposit',
    withdraw: 'withdraw',
    price: 'price',
    system: 'info',
  };
  return m[type] || 'info';
}

/**
 * Determine a relevant href for clicking the notification toast.
 */
function hrefFor(n: Notification): string | undefined {
  if (n.type === 'order_filled' && n.data?.symbol) return `/trade/${n.data.symbol}`;
  if (n.type === 'deposit' || n.type === 'withdraw') return '/wallet';
  if (n.type === 'price' && n.data?.symbol) return `/trade/${n.data.symbol}`;
  return '/notifications';
}

/**
 * Side-effects when a new notification arrives:
 * - in-app Toast
 * - sound
 * - desktop notification
 */
function fireSideEffects(n: Notification) {
  try {
    const prefs = loadPrefs();
    const typeKey = (n.type in prefs.typeFilters ? n.type : 'system') as keyof typeof prefs.typeFilters;
    if (!prefs.typeFilters[typeKey]) return; // type disabled

    // Toast with action button
    showToast(mapNotifToToast(n.type), n.title, n.message, {
      duration: 6000,
      action: { label: 'View', href: hrefFor(n) },
      groupKey: `notif-${n.type}`,
    });

    if (prefs.soundEnabled) playNotificationSound(n.type);
    if (prefs.desktopEnabled && document.visibilityState !== 'visible') {
      showDesktopNotification(n.title, n.message);
    }
  } catch { /* never break store */ }
}

interface NotificationState {
  items: Notification[];
  unread: number;
  connected: boolean;
  eventSource: EventSource | null;

  fetch: () => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  pushLocal: (n: Notification) => void;

  connect: (token: string) => void;
  disconnect: () => void;
}

const useNotifications = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  connected: false,
  eventSource: null,

  fetch: async () => {
    try {
      const res = await api.get('/notifications?limit=50');
      set({
        items: res.data,
        unread: res.data.filter((n: Notification) => !n.is_read).length,
      });
    } catch { /* auth error */ }
  },

  fetchUnreadCount: async () => {
    try {
      const res = await api.get('/notifications/unread-count');
      set({ unread: res.data.count || 0 });
    } catch { /* ignore */ }
  },

  markRead: async (id) => {
    set(state => ({
      items: state.items.map(n => n.id === id ? { ...n, is_read: 1 } : n),
      unread: Math.max(0, state.unread - (state.items.find(n => n.id === id && !n.is_read) ? 1 : 0)),
    }));
    try { await api.post(`/notifications/${id}/read`); } catch { /* ignore */ }
  },

  markAllRead: async () => {
    set(state => ({
      items: state.items.map(n => ({ ...n, is_read: 1 })),
      unread: 0,
    }));
    try { await api.post('/notifications/read-all'); } catch { /* ignore */ }
  },

  remove: async (id) => {
    const wasUnread = get().items.find(n => n.id === id && !n.is_read);
    set(state => ({
      items: state.items.filter(n => n.id !== id),
      unread: wasUnread ? Math.max(0, state.unread - 1) : state.unread,
    }));
    try { await api.delete(`/notifications/${id}`); } catch { /* ignore */ }
  },

  pushLocal: (n) => {
    set(state => ({
      items: [n, ...state.items].slice(0, 100),
      unread: state.unread + (n.is_read ? 0 : 1),
    }));
    // Fire side-effects (toast, sound, desktop notification)
    fireSideEffects(n);
  },

  connect: (token) => {
    const current = get().eventSource;
    if (current) return;

    try {
      const base = ''; // same-origin via vite proxy
      const es = new EventSource(`${base}/api/notifications/stream?token=${encodeURIComponent(token)}`);

      es.addEventListener('ready', () => {
        set({ connected: true });
      });

      es.addEventListener('notification', (event: MessageEvent) => {
        try {
          const data: Notification = JSON.parse(event.data);
          get().pushLocal(data);
        } catch { /* ignore */ }
      });

      es.onerror = () => {
        set({ connected: false });
        // Let EventSource auto-reconnect
      };

      set({ eventSource: es });
    } catch {
      set({ connected: false });
    }
  },

  disconnect: () => {
    const es = get().eventSource;
    if (es) es.close();
    set({ eventSource: null, connected: false });
  },
}));

export default useNotifications;
