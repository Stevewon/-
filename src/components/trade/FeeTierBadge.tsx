import { useEffect, useState } from 'react';
import useStore from '../../store/useStore';
import { useI18n } from '../../i18n';
import api from '../../utils/api';

interface LadderRow {
  tier: number;
  name: string;
  min_holding: number;   // QX+QKEY 개수 하한
  trade_fee: number;     // 거래 수수료율
  withdraw_fee: number;  // 출금 수수료율
}

interface FeeTierInfo {
  tier: number;
  name: string;
  holding: number;       // 현재 QX+QKEY 합산 보유량 (개)
  trade_fee: number;     // 거래 수수료율
  withdraw_fee: number;  // 출금 수수료율
  ladder: LadderRow[];
}

const fmtQty = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(n % 1_000 ? 1 : 0)}K`
  : n.toLocaleString();

const pct = (r: number) => `${(r * 100).toFixed(2)}%`;

/**
 * Compact badge that shows the logged-in user's current fee tier based on the
 * combined QX+QKEY they hold inside the exchange (Owner rule 2026-08-28), plus
 * both the trading fee and the withdrawal fee, and the full ladder.
 * Uses /api/profile/fee-tier. Silently renders nothing when logged out.
 */
export default function FeeTierBadge({ compact = false }: { compact?: boolean }) {
  const { user } = useStore();
  const { t } = useI18n();
  const [info, setInfo] = useState<FeeTierInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) { setInfo(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/profile/fee-tier');
        if (!cancelled) setInfo(data);
      } catch {
        if (!cancelled) setInfo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (!user || !info) return null;

  const nextTier = (info.ladder || []).find((l) => l.tier === info.tier + 1);
  const tradePct = pct(info.trade_fee);
  const withdrawPct = pct(info.withdraw_fee);
  const isFree = info.tier >= 5;

  const Ladder = () => (
    <div className="mt-2 border-t border-exchange-border pt-2 space-y-0.5">
      <div className="grid grid-cols-3 gap-1 text-[10px] text-exchange-text-third font-semibold">
        <span>QX+QKEY</span>
        <span className="text-right">{t('fee.trade')}</span>
        <span className="text-right">{t('fee.withdraw')}</span>
      </div>
      {info.ladder.map((l) => (
        <div
          key={l.tier}
          className={`grid grid-cols-3 gap-1 text-[10px] tabular-nums ${
            l.tier === info.tier ? 'text-exchange-yellow font-semibold' : 'text-exchange-text-secondary'
          }`}
        >
          <span>{l.min_holding === 0 ? `< ${fmtQty(10_000)}` : `≥ ${fmtQty(l.min_holding)}`}</span>
          <span className="text-right font-mono">{l.trade_fee === 0 ? t('fee.free') : pct(l.trade_fee)}</span>
          <span className="text-right font-mono">{l.withdraw_fee === 0 ? t('fee.free') : pct(l.withdraw_fee)}</span>
        </div>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div className="relative inline-block">
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] px-2 py-0.5 rounded bg-exchange-yellow/10 text-exchange-yellow border border-exchange-yellow/20 hover:bg-exchange-yellow/20 transition-colors font-semibold"
          title={`${t('trade.feeTier')}: ${info.name}`}
        >
          {info.name}
        </button>
        {open && (
          <div
            className="absolute z-30 right-0 top-full mt-1 w-64 p-3 rounded-lg bg-exchange-card border border-exchange-border shadow-xl text-xs"
            onMouseLeave={() => setOpen(false)}
          >
            <div className="flex justify-between items-center mb-2">
              <span className="font-semibold text-exchange-text">{info.name}</span>
              {isFree
                ? <span className="text-exchange-buy font-semibold">{t('fee.free')}</span>
                : <span className="text-exchange-yellow font-mono">{tradePct} / {withdrawPct}</span>}
            </div>
            <div className="flex justify-between text-exchange-text-third mb-1">
              <span>{t('fee.holding')}</span>
              <span className="font-mono text-exchange-text-secondary">{fmtQty(info.holding)}</span>
            </div>
            {nextTier && (
              <div className="flex justify-between text-exchange-text-third border-t border-exchange-border pt-1 mt-1">
                <span>{t('trade.nextTier')}</span>
                <span className="font-mono text-exchange-text-secondary">≥ {fmtQty(nextTier.min_holding)}</span>
              </div>
            )}
            <Ladder />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-2 rounded-lg bg-exchange-input/50 border border-exchange-border text-[11px]">
      <div className="flex justify-between items-center mb-1">
        <span className="text-exchange-text-third">{t('trade.feeTier')}</span>
        <span className="px-1.5 py-0.5 rounded bg-exchange-yellow/10 text-exchange-yellow font-semibold">
          {info.name}
        </span>
      </div>
      <div className="flex justify-between text-exchange-text-secondary font-mono tabular-nums">
        <span>{t('fee.trade')}</span>
        <span>{info.trade_fee === 0 ? t('fee.free') : tradePct}</span>
      </div>
      <div className="flex justify-between text-exchange-text-secondary font-mono tabular-nums">
        <span>{t('fee.withdraw')}</span>
        <span>{info.withdraw_fee === 0 ? t('fee.free') : withdrawPct}</span>
      </div>
      <div className="flex justify-between text-exchange-text-third">
        <span>{t('fee.holding')}</span>
        <span className="font-mono">{fmtQty(info.holding)} QX+QKEY</span>
      </div>
      {nextTier && (
        <div className="flex justify-between text-exchange-text-third mt-1 pt-1 border-t border-exchange-border">
          <span>{t('trade.nextTier')}</span>
          <span className="font-mono">≥ {fmtQty(nextTier.min_holding)}</span>
        </div>
      )}
    </div>
  );
}
