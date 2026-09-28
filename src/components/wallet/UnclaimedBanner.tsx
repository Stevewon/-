// ============================================================================
// UnclaimedBanner — "You have N QTA of dividends not yet claimed"
// ----------------------------------------------------------------------------
// Owner 2026-09-27 (option ①): members saw accrued dividends on Earn but 0 QTA
// in Convert / Wallet, because dividends only enter the wallet when CLAIMED
// by the member. This banner closes that gap:
//   • shows unclaimed dividend + match QTA (from GET /earn/unclaimed)
//   • "Claim now" button (POST /earn/claim-all) — claiming is open anytime
//     since 2026-09-28 (option ②); only WITHDRAWALS keep the Friday window
//   • next Friday withdrawal window (KST) + link to Earn
// Member-facing → English only (OWNER_RULES §0).
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Gift, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { useI18n } from '../../i18n';
import { formatAmount } from '../../utils/format';
import { showToast } from '../common/Toast';

type Unclaimed = {
  active_positions: number; accrued_qta: number; claimed_qta: number;
  unclaimed_dividend_qta: number; unclaimed_match_qta: number; unclaimed_total_qta: number;
  window_open: boolean; withdraw_window_open?: boolean; next_window_opens_at: string; next_window_closes_at: string;
};

export default function UnclaimedBanner({ onClaimed, compact = false }: { onClaimed?: () => void; compact?: boolean }) {
  const { t } = useI18n();
  const [data, setData] = useState<Unclaimed | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get('/earn/unclaimed'); setData(r.data); } catch { /* not a staker / ignore */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data || data.active_positions === 0 || data.unclaimed_total_qta < 1) return null;

  const fmtKst = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Seoul', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

  const claim = async () => {
    setBusy(true);
    try {
      const r = await api.post('/earn/claim-all', {});
      const got = Number(r.data?.credited_qta ?? r.data?.total_qta ?? 0);
      showToast('success', t('unclaimed.claimedTitle'), `+${formatAmount(got)} QTA`);
      await load();
      onClaimed?.();
    } catch (e: any) {
      const code = e?.response?.data?.error;
      showToast('error', t('unclaimed.claimFailed'), code === 'CLAIM_WINDOW_CLOSED' ? t('unclaimed.windowClosed') : (e?.response?.data?.message || code || ''));
    } finally { setBusy(false); }
  };

  return (
    <div className={`rounded-xl border border-exchange-yellow/50 bg-exchange-yellow/10 ${compact ? 'p-3' : 'p-4'} text-sm space-y-1.5`}>
      <div className="flex items-start gap-2">
        <Gift size={16} className="text-exchange-yellow mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-exchange-text">
            {t('unclaimed.title').replace('{n}', formatAmount(Math.floor(data.unclaimed_total_qta)))}
          </div>
          <div className="text-xs text-exchange-text-secondary leading-relaxed">
            {t('unclaimed.body')}
            {data.unclaimed_match_qta >= 1 ? ` (${t('unclaimed.dividend')} ${formatAmount(Math.floor(data.unclaimed_dividend_qta))} + ${t('unclaimed.match')} ${formatAmount(Math.floor(data.unclaimed_match_qta))})` : ''}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={claim} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-exchange-yellow text-black text-xs font-semibold hover:brightness-110 disabled:opacity-50">
              {busy ? <RefreshCw size={12} className="animate-spin" /> : <Gift size={12} />} {t('unclaimed.claimNow')}
            </button>
            {!data.withdraw_window_open && data.next_window_opens_at && (
              <span className="inline-flex items-center gap-1 text-xs text-exchange-text-secondary"><Clock size={12} /> {t('unclaimed.nextWindow')}: <span className="text-exchange-text font-medium tabular-nums">{fmtKst(data.next_window_opens_at)}–{new Date(data.next_window_closes_at).toLocaleTimeString('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })} KST</span></span>
            )}
            <Link to="/earn" className="text-xs text-exchange-yellow hover:underline">{t('nav.earn')} ›</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
