import { useEffect, useState } from 'react';
import {
  X, Gift, Users, ArrowDownLeft, ArrowUpRight, ShieldCheck,
  Lock, Wallet, Info,
} from 'lucide-react';
import { useI18n } from '../../i18n';
import CoinIcon from '../common/CoinIcon';
import { formatAmount } from '../../utils/format';

// ---------------------------------------------------------------------------
// Shape returned by GET /wallet/breakdown/:symbol   (user)
//                and GET /admin/users/:id/balance/:coin (admin, under .breakdown)
// Mirrors src/server/lib/balance-breakdown.ts
// ---------------------------------------------------------------------------
export interface BalanceSourceRow {
  kind: 'welcome_bonus' | 'referral' | 'deposit' | 'admin_credit' | 'withdrawal';
  amount: number;
  label: string;
  ts?: string | null;
  meta?: Record<string, unknown>;
}
export interface BalanceBreakdown {
  coin: string;
  total: number;
  available: number;
  locked: number;
  companyIssued: number;
  withdrawable: number;
  parts: {
    referral: number;
    welcomeAndOther: number;
    externalNet: number;
    lockedPending: number;
  };
  sources: BalanceSourceRow[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  coin: string;
  /** Loader — returns the breakdown. Injected so the same modal serves
   *  the member wallet (/wallet/breakdown) and the admin console
   *  (/admin/users/:id/balance). */
  load: (coin: string) => Promise<BalanceBreakdown>;
  /** Optional heading suffix, e.g. a user's email in the admin view. */
  subtitle?: string;
}

const KIND_META: Record<
  BalanceSourceRow['kind'],
  { icon: any; color: string; bg: string }
> = {
  welcome_bonus: { icon: Gift, color: '#F0B90B', bg: 'rgba(240,185,11,0.12)' },
  referral: { icon: Users, color: '#0ECB81', bg: 'rgba(14,203,129,0.12)' },
  deposit: { icon: ArrowDownLeft, color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
  admin_credit: { icon: ShieldCheck, color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)' },
  withdrawal: { icon: ArrowUpRight, color: '#F6465D', bg: 'rgba(246,70,93,0.12)' },
};

export default function BalanceBreakdownModal({
  open, onClose, coin, load, subtitle,
}: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<BalanceBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    load(coin)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(t('wallet.breakdownError')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, coin]);

  if (!open) return null;

  const kindLabel = (k: BalanceSourceRow['kind']) => {
    switch (k) {
      case 'welcome_bonus': return t('wallet.srcWelcome');
      case 'referral': return t('wallet.srcReferral');
      case 'deposit': return t('wallet.srcDeposit');
      case 'admin_credit': return t('wallet.srcAdmin');
      case 'withdrawal': return t('wallet.srcWithdrawal');
      default: return k;
    }
  };

  const fmtDate = (s?: string | null) => {
    if (!s) return '';
    try {
      const d = new Date(s);
      return d.toLocaleString();
    } catch { return s; }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-exchange-card border border-exchange-border w-full md:max-w-lg max-h-[90vh] overflow-y-auto"
        style={{ borderRadius: '16px 16px 0 0' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b border-exchange-border sticky top-0 bg-exchange-card z-10"
          style={{ padding: '16px 20px' }}
        >
          <div className="flex items-center" style={{ gap: '10px' }}>
            <CoinIcon symbol={coin} size={26} />
            <div>
              <div className="font-semibold text-exchange-text" style={{ fontSize: '15px' }}>
                {coin} · {t('wallet.balanceDetail')}
              </div>
              {subtitle && (
                <div className="text-exchange-text-third" style={{ fontSize: '11px' }}>
                  {subtitle}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-exchange-text-third hover:text-exchange-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '20px' }}>
          {loading && (
            <div className="text-center text-exchange-text-third" style={{ padding: '32px 0', fontSize: '14px' }}>
              {t('common.loading')}
            </div>
          )}
          {error && !loading && (
            <div className="text-center text-exchange-sell" style={{ padding: '32px 0', fontSize: '14px' }}>
              {error}
            </div>
          )}

          {data && !loading && (
            <>
              {/* Total received */}
              <div
                className="bg-gradient-to-br from-exchange-bg to-exchange-card border border-exchange-border"
                style={{ borderRadius: '12px', padding: '16px', marginBottom: '16px' }}
              >
                <div className="flex items-center" style={{ gap: '6px', marginBottom: '6px' }}>
                  <Wallet size={14} className="text-exchange-yellow" />
                  <span className="text-exchange-text-secondary" style={{ fontSize: '12px' }}>
                    {t('wallet.totalReceived')}
                  </span>
                </div>
                <div
                  className="font-bold text-exchange-text tabular-nums"
                  style={{ fontSize: '28px', lineHeight: 1.1 }}
                >
                  {formatAmount(data.total)} <span style={{ fontSize: '15px' }}>{data.coin}</span>
                </div>
                <div
                  className="flex flex-wrap text-exchange-text-third tabular-nums"
                  style={{ gap: '12px', fontSize: '11px', marginTop: '8px' }}
                >
                  <span>{t('wallet.availableBalance')}: {formatAmount(data.available)}</span>
                  {data.locked > 0 && <span>{t('wallet.frozenQty')}: {formatAmount(data.locked)}</span>}
                </div>
              </div>

              {/* Composition rows */}
              <div className="space-y-2" style={{ marginBottom: '16px' }}>
                <PartRow
                  icon={Users}
                  color="#0ECB81"
                  label={t('wallet.srcReferral')}
                  value={data.parts.referral}
                  coin={data.coin}
                />
                <PartRow
                  icon={Gift}
                  color="#F0B90B"
                  label={t('wallet.srcWelcome')}
                  value={data.parts.welcomeAndOther}
                  coin={data.coin}
                />
                <PartRow
                  icon={ArrowDownLeft}
                  color="#3B82F6"
                  label={t('wallet.srcExternalNet')}
                  value={data.parts.externalNet}
                  coin={data.coin}
                  allowNegative
                />
                {data.parts.lockedPending > 0 && (
                  <PartRow
                    icon={Lock}
                    color="#848E9C"
                    label={t('wallet.srcLockedPending')}
                    value={data.parts.lockedPending}
                    coin={data.coin}
                  />
                )}
              </div>

              {/* Withdrawable hint */}
              <div
                className="flex items-start bg-exchange-bg/60 border border-exchange-border"
                style={{ gap: '8px', borderRadius: '10px', padding: '10px 12px', marginBottom: '16px' }}
              >
                <Info size={14} className="text-exchange-text-third shrink-0" style={{ marginTop: '1px' }} />
                <div style={{ fontSize: '11px', lineHeight: 1.5 }}>
                  <div className="text-exchange-text-secondary">
                    {t('wallet.companyIssued')}:{' '}
                    <span className="text-exchange-text tabular-nums">{formatAmount(data.companyIssued)} {data.coin}</span>
                    <span className="text-exchange-text-third"> ({t('wallet.nonWithdrawable')})</span>
                  </div>
                  <div className="text-exchange-text-secondary" style={{ marginTop: '2px' }}>
                    {t('wallet.withdrawableAmt')}:{' '}
                    <span className="text-exchange-buy tabular-nums">{formatAmount(data.withdrawable)} {data.coin}</span>
                  </div>
                </div>
              </div>

              {/* Source history */}
              {data.sources.length > 0 && (
                <>
                  <div
                    className="text-exchange-text-secondary font-medium"
                    style={{ fontSize: '12px', marginBottom: '8px' }}
                  >
                    {t('wallet.sourceHistory')}
                  </div>
                  <div className="space-y-1.5">
                    {data.sources.map((s, i) => {
                      const meta = KIND_META[s.kind];
                      const Icon = meta.icon;
                      const positive = s.amount >= 0;
                      return (
                        <div
                          key={i}
                          className="flex items-center border border-exchange-border/40"
                          style={{ gap: '10px', padding: '10px 12px', borderRadius: '10px' }}
                        >
                          <div
                            className="rounded-full flex items-center justify-center shrink-0"
                            style={{ width: '30px', height: '30px', background: meta.bg }}
                          >
                            <Icon size={15} style={{ color: meta.color }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-exchange-text truncate" style={{ fontSize: '13px' }}>
                              {s.label || kindLabel(s.kind)}
                            </div>
                            {s.ts && (
                              <div className="text-exchange-text-third" style={{ fontSize: '10px' }}>
                                {fmtDate(s.ts)}
                              </div>
                            )}
                          </div>
                          <div
                            className="tabular-nums font-medium shrink-0"
                            style={{ fontSize: '13px', color: positive ? '#0ECB81' : '#F6465D' }}
                          >
                            {positive ? '+' : ''}{formatAmount(s.amount)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PartRow({
  icon: Icon, color, label, value, coin, allowNegative,
}: {
  icon: any; color: string; label: string; value: number; coin: string; allowNegative?: boolean;
}) {
  if (!allowNegative && value <= 0) return null;
  return (
    <div
      className="flex items-center border border-exchange-border/40"
      style={{ gap: '10px', padding: '10px 12px', borderRadius: '10px' }}
    >
      <div
        className="rounded-lg flex items-center justify-center shrink-0"
        style={{ width: '30px', height: '30px', background: `${color}20` }}
      >
        <Icon size={15} style={{ color }} />
      </div>
      <span className="text-exchange-text-secondary flex-1" style={{ fontSize: '13px' }}>
        {label}
      </span>
      <span className="tabular-nums font-medium text-exchange-text" style={{ fontSize: '14px' }}>
        {formatAmount(value)} {coin}
      </span>
    </div>
  );
}
