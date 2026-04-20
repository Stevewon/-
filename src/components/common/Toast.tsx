import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

// Global state & event emitter
let toastListeners: ((toasts: ToastItem[]) => void)[] = [];
let toasts: ToastItem[] = [];

function setToasts(next: ToastItem[]) {
  toasts = next;
  toastListeners.forEach(fn => fn(toasts));
}

export function showToast(type: ToastType, title: string, message?: string, duration = 4000) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const toast: ToastItem = { id, type, title, message, duration };
  setToasts([...toasts, toast]);

  if (duration > 0) {
    setTimeout(() => {
      setToasts(toasts.filter(t => t.id !== id));
    }, duration);
  }
}

export function dismissToast(id: string) {
  setToasts(toasts.filter(t => t.id !== id));
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
};

const colors: Record<ToastType, { bg: string; icon: string; border: string }> = {
  success: { bg: 'bg-exchange-buy/10', icon: 'text-exchange-buy', border: 'border-exchange-buy/20' },
  error: { bg: 'bg-exchange-sell/10', icon: 'text-exchange-sell', border: 'border-exchange-sell/20' },
  warning: { bg: 'bg-exchange-yellow/10', icon: 'text-exchange-yellow', border: 'border-exchange-yellow/20' },
  info: { bg: 'bg-blue-500/10', icon: 'text-blue-400', border: 'border-blue-400/20' },
};

export default function ToastContainer() {
  const items = useToasts();

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {items.map(toast => {
        const Icon = icons[toast.type];
        const color = colors[toast.type];
        return (
          <div
            key={toast.id}
            className={`${color.bg} ${color.border} border backdrop-blur-sm rounded-xl px-4 py-3 shadow-lg pointer-events-auto animate-slide-in flex items-start gap-3`}
          >
            <Icon size={18} className={`${color.icon} shrink-0 mt-0.5`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-exchange-text">{toast.title}</p>
              {toast.message && <p className="text-xs text-exchange-text-secondary mt-0.5">{toast.message}</p>}
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-exchange-text-third hover:text-exchange-text p-0.5 shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
