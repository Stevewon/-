import { useEffect, useState } from 'react';
import useStore from '../../store/useStore';
import { useI18n } from '../../i18n';
import api from '../../utils/api';

interface FeeTierInfo {
  tier: number;
  name: string;
  volume_usd_30d: number;
  maker_fee: number;
  taker_fee: number;
  ladder: Array<{
    tier: number;
    name: string;
    min_volume_usd: number;
    maker_fee: number;
    taker_fee: number;
  }>;
}

/**
 * Compact badge that shows the logged-in user's current VIP fee tier, their
 * 30-day USD volume, and the maker/taker rate. Uses /api/profile/fee-tier
 * (S3-5). Silently renders nothing when the user is logged out or the API
 * is unavailable (503 when fee_tiers table isn't migrated yet).
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
  const volumeFmt = info.volume_usd_30d >= 1_000_000
    ? `$${(info.volume_usd_30d / 1_000_000).toFixed(2)}M`
    : info.volume_usd_30d >= 1_000
      ? `$${(info.volume_usd_30d / 1_000).toFixed(1)}K`
      : `$${info.volume_usd_30d.toFixed(0)}`;

  const makerPct = (info.maker_fee * 100).toFixed(3);
  const takerPct = (info.taker_fee * 100).toFixed(3);

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
            className="absolute z-30 right-0 top-full mt-1 w-56 p-3 rounded-lg bg-exchange-card border border-exchange-border shadow-xl text-xs"
            onMouseLeave={() => setOpen(false)}
          >
            <div className="flex justify-between items-center mb-2">
              <span className="font-semibold text-exchange-text">{info.name}</span>
              <span className="text-exchange-yellow font-mono">{makerPct}% / {takerPct}%</span>
            </div>
            <div className="flex justify-between text-exchange-text-third mb-1">
              <span>{t('trade.volume30d')}</span>
              <span className="font-mono text-exchange-text-secondary">{volumeFmt}</span>
            </div>
            {nextTier && (
              <div className="flex justify-between text-exchange-text-third border-t border-exchange-border pt-1 mt-1">
                <span>{t('trade.nextTier')}</span>
                <span className="font-mono text-exchange-text-secondary">
                  ${(nextTier.min_volume_usd / 1_000_000).toFixed(1)}M
                </span>
              </div>
            )}
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
        <span>{t('trade.makerTaker')}</span>
        <span>{makerPct}% / {takerPct}%</span>
      </div>
      <div className="flex justify-between text-exchange-text-third">
        <span>{t('trade.volume30d')}</span>
        <span className="font-mono">{volumeFmt}</span>
      </div>
      {nextTier && (
        <div className="flex justify-between text-exchange-text-third mt-1 pt-1 border-t border-exchange-border">
          <span>{t('trade.nextTier')}</span>
          <span className="font-mono">
            ${(nextTier.min_volume_usd / 1_000_000).toFixed(1)}M
          </span>
        </div>
      )}
    </div>
  );
}
