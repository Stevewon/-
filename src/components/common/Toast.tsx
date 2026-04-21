import { useEffect, useState } from 'react';
import {
  CheckCircle2, XCircle, AlertCircle, Info, X, TrendingUp,
  ArrowDownLeft, ArrowUpRight, Bell, DollarSign,
} from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'trade' | 'deposit' | 'withdraw' | 'price';

export interface ToastAction {
  label: string;
  href?: string;       // react-router path for link
  onClick?: () => void;
}

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: ToastAction;
  groupKey?: string;   // for auto-dedupe (latest replaces oldest with same key)
}

// Global state & event emitter
let toastListeners: ((toasts: ToastItem[]) => void)[] = [];
let toasts: ToastItem[] = [];
const MAX_TOASTS = 5;

function setToasts(next: ToastItem[]) {
  toasts = next.slice(-MAX_TOASTS);
  toastListeners.forEach(fn => fn(toasts));
}

interface ShowToastOptions {
  duration?: number;
  action?: ToastAction;
  groupKey?: string;
}

export function showToast(
  type: ToastType,
  title: string,
  message?: string,
  durationOrOpts: number | ShowToastOptions = 4000,
) {
  const opts: ShowToastOptions = typeof durationOrOpts === 'number'
    ? { duration: durationOrOpts }
    : durationOrOpts;
  const duration = opts.duration ?? 4000;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const toast: ToastItem = {
    id, type, title, message,
    duration,
    action: opts.action,
    groupKey: opts.groupKey,
  };

  // Dedupe by groupKey (keep latest)
  const next = opts.groupKey
    ? toasts.filter(t => t.groupKey !== opts.groupKey)
    : [...toasts];
  next.push(toast);
  setToasts(next);

  if (duration > 0) {
    setTimeout(() => {
      setToasts(toasts.filter(t => t.id !== id));
    }, duration);
  }
  return id;
}

export function dismissToast(id: string) {
  setToasts(toasts.filter(t => t.id !== id));
}

export function dismissAllToasts() {
  setToasts([]);
}

// Hook to consume toasts
function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener = (next: ToastItem[]) => setItems([...next]);
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter(l => l !== listener);
    };
  }, []);

  return items;
}

const icons: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
  trade: TrendingUp,
  deposit: ArrowDownLeft,
  withdraw: ArrowUpRight,
  price: DollarSign,
};

const colors: Record<ToastType, { bg: string; icon: string; border: string }> = {
  success: { bg: 'bg-exchange-buy/10',    icon: 'text-exchange-buy',    border: 'border-exchange-buy/30' },
  error:   { bg: 'bg-exchange-sell/10',   icon: 'text-exchange-sell',   border: 'border-exchange-sell/30' },
  warning: { bg: 'bg-exchange-yellow/10', icon: 'text-exchange-yellow', border: 'border-exchange-yellow/30' },
  info:    { bg: 'bg-blue-500/10',        icon: 'text-blue-400',        border: 'border-blue-400/30' },
  trade:   { bg: 'bg-exchange-yellow/10', icon: 'text-exchange-yellow', border: 'border-exchange-yellow/40' },
  deposit: { bg: 'bg-exchange-buy/10',    icon: 'text-exchange-buy',    border: 'border-exchange-buy/30' },
  withdraw:{ bg: 'bg-exchange-sell/10',   icon: 'text-exchange-sell',   border: 'border-exchange-sell/30' },
  price:   { bg: 'bg-purple-500/10',      icon: 'text-purple-400',      border: 'border-purple-400/30' },
};

export default function ToastContainer() {
  const items = useToasts();

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-[92vw] sm:w-full pointer-events-none">
      {items.map(toast => {
        const Icon = icons[toast.type] || Bell;
        const color = colors[toast.type] || colors.info;
        return (
          <div
            key={toast.id}
            className={`${color.bg} ${color.border} border backdrop-blur-md rounded-xl px-4 py-3 shadow-xl pointer-events-auto animate-slide-in flex items-start gap-3`}
          >
            <Icon size={18} className={`${color.icon} shrink-0 mt-0.5`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-exchange-text">{toast.title}</p>
              {toast.message && <p className="text-xs text-exchange-text-secondary mt-0.5 break-words">{toast.message}</p>}
              {toast.action && (
                <div className="mt-2">
                  {toast.action.href ? (
                    <a
                      href={toast.action.href}
                      onClick={(e) => {
                        e.preventDefault();
                        // Use history API to avoid full reload
                        window.history.pushState({}, '', toast.action!.href);
                        window.dispatchEvent(new PopStateEvent('popstate'));
                        dismissToast(toast.id);
                      }}
                      className={`inline-block text-xs font-semibold ${color.icon} hover:underline`}
                    >
                      {toast.action.label} →
                    </a>
                  ) : (
                    <button
                      onClick={() => {
                        toast.action!.onClick?.();
                        dismissToast(toast.id);
                      }}
                      className={`text-xs font-semibold ${color.icon} hover:underline`}
                    >
                      {toast.action.label} →
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-exchange-text-third hover:text-exchange-text p-0.5 shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
