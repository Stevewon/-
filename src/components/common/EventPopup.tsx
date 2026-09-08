import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Gift, ArrowRight, Clock } from 'lucide-react';
import api from '../../utils/api';
import { useI18n } from '../../i18n';

/**
 * Site-wide EVENT popup — QKEY → QTA 2× swap promotion (2026-09-08).
 *
 * Behaviour:
 *   • Fetches the authoritative event window from
 *     `/wallet/swap/qkey-qta/status`. Renders ONLY while `open === true`, so it
 *     disappears by itself once the deadline (2026-09-23 23:59 KST) passes.
 *   • "Don't show again today" persists a per-day dismissal in localStorage so
 *     the user isn't nagged on every navigation.
 *   • "Swap now" routes to the wallet where the swap card lives.
 */
const DISMISS_KEY = 'qx_event_qkey_swap_dismiss'; // value = YYYY-MM-DD (KST)

function todayKst(): string {
  // KST = UTC+9. Build a YYYY-MM-DD string for the KST calendar day.
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

interface SwapStatus {
  open: boolean;
  rate: number;
  deadline_ms: number;
}

export default function EventPopup() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SwapStatus | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Respect a same-day dismissal before we even fetch.
    let dismissedToday = false;
    try {
      dismissedToday = localStorage.getItem(DISMISS_KEY) === todayKst();
    } catch { /* ignore */ }
    if (dismissedToday) return;

    api.get('/wallet/swap/qkey-qta/status')
      .then((r) => {
        setStatus(r.data);
        if (r.data?.open) setVisible(true);
      })
      .catch(() => { /* silent — no popup if status unavailable */ });
  }, []);

  const deadlineLabel = useMemo(() => {
    if (!status?.deadline_ms) return '';
    // Show the KST calendar date (event ends 2026-09-23 23:59 KST).
    const kst = new Date(status.deadline_ms + 9 * 3600 * 1000);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kst.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d} 23:59 (KST)`;
  }, [status]);

  if (!visible || !status?.open) return null;

  const rate = status.rate || 2;

  const close = () => setVisible(false);
  const dismissToday = () => {
    try { localStorage.setItem(DISMISS_KEY, todayKst()); } catch { /* ignore */ }
    setVisible(false);
  };
  const goSwap = () => {
    setVisible(false);
    navigate('/wallet');
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-exchange-yellow/40 shadow-2xl"
        style={{
          background:
            'linear-gradient(160deg, rgba(240,185,11,0.20), rgba(20,23,28,0.98) 55%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-exchange-text-secondary hover:text-exchange-text hover:bg-black/50 transition-colors"
        >
          <X size={18} />
        </button>

        {/* Hero */}
        <div className="px-6 pt-8 pb-5 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-exchange-yellow/15">
            <Gift size={32} className="text-exchange-yellow" />
          </div>
          <h2 className="text-[20px] font-extrabold text-exchange-text">
            {t('swap.title')}
          </h2>

          {/* Rate chip */}
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-exchange-yellow/15 px-4 py-2 text-[16px] font-bold text-exchange-yellow">
            1 QKEY <ArrowRight size={16} /> {rate} QTA
          </div>

          <p className="mt-4 text-[13.5px] leading-relaxed text-exchange-text-secondary">
            {t('swap.popupBody')}
          </p>

          {/* Deadline */}
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-black/30 px-3 py-1.5 text-[12.5px] text-exchange-text">
            <Clock size={14} className="text-exchange-yellow" />
            <span>{t('swap.endsAt')}: </span>
            <span className="font-semibold tabular-nums">{deadlineLabel}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2.5 px-6 pb-6">
          <button
            type="button"
            onClick={goSwap}
            className="w-full rounded-xl bg-exchange-yellow py-3 text-[15px] font-bold text-black hover:opacity-90 transition-opacity"
          >
            {t('swap.popupCta')}
          </button>
          <button
            type="button"
            onClick={dismissToday}
            className="w-full py-2 text-[13px] font-medium text-exchange-text-third hover:text-exchange-text transition-colors"
          >
            {t('swap.dontShowToday')}
          </button>
        </div>
      </div>
    </div>
  );
}
