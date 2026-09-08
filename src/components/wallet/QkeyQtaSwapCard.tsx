import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Gift, Clock } from 'lucide-react';
import api from '../../utils/api';
import { useI18n } from '../../i18n';
import { showToast } from '../common/Toast';
import useStore from '../../store/useStore';

/**
 * QKEY → QTA 2× swap promotion card (event, 2026-09-08).
 *
 * Owner directive: 1 QKEY → 2 QTA, no caps, window closes 2026-09-23 23:59 KST.
 * The server (`/wallet/swap/qkey-qta`) is the authoritative gate — this card
 * only renders while the event is open and mirrors the server rate/deadline
 * returned by `/wallet/swap/qkey-qta/status`.
 */
interface SwapStatus {
  open: boolean;
  rate: number;
  from_coin: string;
  to_coin: string;
  deadline_ms: number;
  deadline_iso: string;
}

function useCountdown(deadlineMs: number | null): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadlineMs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineMs]);
  if (!deadlineMs) return '';
  const ms = Math.max(0, deadlineMs - now);
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function QkeyQtaSwapCard() {
  const { t } = useI18n();
  const { wallets, fetchWallets } = useStore();
  const [status, setStatus] = useState<SwapStatus | null>(null);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get('/wallet/swap/qkey-qta/status')
      .then(r => setStatus(r.data))
      .catch(() => setStatus(null));
  }, []);

  const countdown = useCountdown(status?.deadline_ms ?? null);

  const qkeyAvail = useMemo(() => {
    const w = wallets.find(w => w.coin_symbol === 'QKEY');
    return Number(w?.available || 0);
  }, [wallets]);

  // Only render while the event is open (server-driven).
  if (!status || !status.open) return null;

  const rate = status.rate || 2;
  const amt = Number(amount);
  const validAmt = Number.isFinite(amt) && amt > 0 && amt <= qkeyAvail + 1e-9;
  const qtaOut = validAmt ? amt * rate : 0;

  const setMax = () => setAmount(qkeyAvail > 0 ? String(qkeyAvail) : '');

  const doSwap = async () => {
    if (!validAmt || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.post('/wallet/swap/qkey-qta', { amount: amt });
      showToast(
        'success',
        t('swap.doneTitle'),
        t('swap.doneBody', {
          qkey: String(res.data.qkey_swapped),
          qta: String(res.data.qta_received),
        }),
      );
      setAmount('');
      fetchWallets();
    } catch (err: any) {
      const code = err?.response?.data?.code;
      const map: Record<string, string> = {
        SWAP_EVENT_ENDED: t('swap.errEnded'),
        SWAP_BAD_AMOUNT: t('swap.errAmount'),
        SWAP_NO_QKEY: t('swap.errNoQkey'),
        SWAP_INSUFFICIENT: t('swap.errInsufficient'),
        SWAP_FAILED: t('swap.errFailed'),
      };
      showToast('error', t('swap.errTitle'), map[code] || t('swap.errFailed'));
      if (code === 'SWAP_EVENT_ENDED') setStatus({ ...status, open: false });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="rounded-2xl border border-exchange-yellow/40 overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, rgba(240,185,11,0.14), rgba(20,23,28,0.6) 55%)',
        marginBottom: '16px',
      }}
    >
      <div className="p-4 sm:p-5">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-exchange-yellow/15 flex items-center justify-center">
              <Gift size={17} className="text-exchange-yellow" />
            </div>
            <h3 className="text-[15px] sm:text-base font-bold text-exchange-text">
              {t('swap.title')}
            </h3>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-exchange-yellow/15 text-exchange-yellow text-[12px] font-bold px-2.5 py-1">
            1 QKEY <ArrowRight size={12} /> {rate} QTA
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-exchange-text-third ml-auto">
            <Clock size={12} />
            <span className="tabular-nums">{countdown}</span>
          </span>
        </div>

        <p className="text-[12.5px] leading-relaxed text-exchange-text-secondary mb-3">
          {t('swap.desc')}
        </p>

        {/* Input row */}
        <div className="flex flex-col sm:flex-row gap-2.5 sm:items-end">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-exchange-text-third uppercase tracking-wider">
                {t('swap.youPay')} (QKEY)
              </label>
              <button
                type="button"
                onClick={setMax}
                className="text-[11px] text-exchange-yellow hover:underline"
              >
                {t('swap.balance')}: {qkeyAvail.toLocaleString()} · MAX
              </button>
            </div>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="auth-input-plain w-full tabular-nums"
            />
          </div>

          <div className="hidden sm:flex items-center justify-center pb-3 text-exchange-text-third">
            <ArrowRight size={18} />
          </div>

          <div className="flex-1 min-w-0">
            <label className="text-[11px] text-exchange-text-third uppercase tracking-wider mb-1 block">
              {t('swap.youGet')} (QTA)
            </label>
            <div className="auth-input-plain w-full tabular-nums flex items-center text-exchange-yellow font-semibold">
              {qtaOut.toLocaleString()}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={doSwap}
          disabled={!validAmt || submitting}
          className="mt-3 w-full rounded-xl bg-exchange-yellow py-3 text-[15px] font-bold text-black hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {submitting ? t('swap.processing') : t('swap.cta')}
        </button>

        {qkeyAvail <= 0 && (
          <p className="mt-2 text-[11.5px] text-exchange-text-third text-center">
            {t('swap.noQkeyHint')}
          </p>
        )}
      </div>
    </div>
  );
}
