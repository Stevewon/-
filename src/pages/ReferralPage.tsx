import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { showToast } from '../components/common/Toast';
import DesktopPageLayout from '../components/common/DesktopPageLayout';
import {
  Gift, Copy, Check, Users, TrendingUp, Share2, ChevronLeft,
  CheckCircle2, Clock, Mail,
} from 'lucide-react';

interface InvitedRow {
  referred_id: string;
  referred_nickname: string;
  // Server still returns reward_qta as the column name; the value is the
  // QX reward amount (post QTA->QX migration).
  reward_qta: number;
  created_at: string;
  email_verified_at: string | null;
  level?: number; // 1=direct, 2/3=indirect uplines (post 0031 migration)
}

interface LevelStat { count: number; reward_qx: number; }

interface ReferralData {
  code: string | null;
  // Legacy QTA-suffixed keys retained on the wire for back-compat; values
  // are QX amounts. New QX-suffixed keys preferred when available.
  reward_per_referral_qta: number;
  welcome_bonus_qta: number;
  reward_per_referral_qx?: number;
  welcome_bonus_qx?: number;
  reward_coin?: string;
  invited_count: number;
  total_reward_qta: number;
  total_reward_qx?: number;
  invited: InvitedRow[];
  referred_by: { nickname: string; code: string } | null;
  // 0031: 3-level breakdown
  levels?: number;
  level_rewards?: { l1: number; l2: number; l3: number };
  by_level?: { l1: LevelStat; l2: LevelStat; l3: LevelStat };
}

export default function ReferralPage() {
  const { t } = useI18n();
  const { user } = useStore();
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    api.get('/auth/referrals')
      .then(r => setData(r.data))
      .catch(() => showToast('error', t('common.error'), t('referral.loadFailed')))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) {
    return (
      <DesktopPageLayout>
        <div className="min-h-[60vh] flex flex-col items-center justify-center">
          <Gift size={48} className="text-exchange-text-third mb-4" />
          <p className="text-exchange-text-secondary mb-4">{t('wallet.loginRequired')}</p>
          <Link to="/login" className="btn-primary px-6 py-2 rounded-lg">{t('nav.login')}</Link>
        </div>
      </DesktopPageLayout>
    );
  }

  const code = data?.code || '';
  const shareLink = code
    ? `${window.location.origin}/register?ref=${code}`
    : '';

  const copyCode = () => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    showToast('success', t('referral.codeCopied'), code);
    setTimeout(() => setCopiedCode(false), 1500);
  };

  const copyLink = () => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink);
    setCopiedLink(true);
    showToast('success', t('referral.linkCopied'), shareLink);
    setTimeout(() => setCopiedLink(false), 1500);
  };

  const shareNative = async () => {
    if (!shareLink) return;
    if ((navigator as any).share) {
      try {
        await (navigator as any).share({
          title: 'QuantaEX',
          text: t('referral.shareText', { code }),
          url: shareLink,
        });
      } catch { /* user cancelled */ }
    } else {
      copyLink();
    }
  };

  return (
    <DesktopPageLayout>
      {/* Header */}
      <div className="qx-page-title flex items-center gap-3">
        <Link
          to="/profile"
          className="p-2 rounded-lg hover:bg-exchange-hover/40 text-exchange-text-secondary hover:text-exchange-text transition-colors"
          aria-label="Back"
        >
          <ChevronLeft size={20} />
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-exchange-yellow/10 rounded-xl flex items-center justify-center">
            <Gift size={22} className="text-exchange-yellow" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-exchange-text">{t('referral.title')}</h1>
            <p className="text-xs text-exchange-text-secondary">{t('referral.subtitle')}</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-exchange-card rounded-xl border border-exchange-border p-8 text-center text-exchange-text-secondary">
          …
        </div>
      ) : (
        <div
          className="grid"
          style={{
            gap: '20px',
            gridTemplateColumns: '1fr',
          }}
        >
          <style>{`
            @media (min-width: 1024px) {
              .qx-referral-grid {
                grid-template-columns: minmax(0, 1fr) minmax(320px, 420px) !important;
              }
            }
          `}</style>

          <div
            className="qx-referral-grid grid"
            style={{
              gap: '20px',
              gridTemplateColumns: '1fr',
              alignItems: 'start',
            }}
          >
            {/* LEFT — Code + Share */}
            <div className="space-y-5">
              {/* Hero card with the code */}
              <div
                className="bg-gradient-to-br from-exchange-yellow/15 via-exchange-card to-exchange-bg border border-exchange-yellow/30 rounded-2xl"
                style={{ padding: '24px' }}
              >
                <div className="flex items-center gap-2 text-exchange-yellow mb-3">
                  <Gift size={16} />
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    {t('referral.yourCode')}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 mb-5">
                  <div
                    className="font-mono font-bold text-exchange-text tabular-nums select-all bg-exchange-bg border border-exchange-border rounded-xl"
                    style={{
                      fontSize: '32px',
                      letterSpacing: '0.15em',
                      padding: '14px 20px',
                    }}
                  >
                    {code || '------'}
                  </div>
                  <button
                    onClick={copyCode}
                    disabled={!code}
                    className="inline-flex items-center gap-1.5 bg-exchange-yellow text-black hover:bg-exchange-yellow/90 disabled:opacity-50 transition-colors font-semibold"
                    style={{ padding: '10px 16px', borderRadius: '10px', fontSize: '14px' }}
                  >
                    {copiedCode ? <Check size={16} /> : <Copy size={16} />}
                    {copiedCode ? t('referral.copied') : t('referral.copyCode')}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className="flex-1 min-w-[200px] font-mono text-exchange-text-secondary truncate bg-exchange-bg/60 border border-exchange-border/60 rounded-lg"
                    style={{ fontSize: '13px', padding: '10px 14px' }}
                  >
                    {shareLink || ' '}
                  </div>
                  <button
                    onClick={copyLink}
                    disabled={!code}
                    className="inline-flex items-center gap-1.5 bg-exchange-hover/60 hover:bg-exchange-hover text-exchange-text disabled:opacity-50 transition-colors"
                    style={{ padding: '10px 14px', borderRadius: '10px', fontSize: '13px' }}
                  >
                    {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                    {copiedLink ? t('referral.copied') : t('referral.copyLink')}
                  </button>
                  <button
                    onClick={shareNative}
                    disabled={!code}
                    className="inline-flex items-center gap-1.5 bg-exchange-buy/15 text-exchange-buy hover:bg-exchange-buy/25 disabled:opacity-50 transition-colors"
                    style={{ padding: '10px 14px', borderRadius: '10px', fontSize: '13px' }}
                  >
                    <Share2 size={14} />
                    {t('referral.share')}
                  </button>
                </div>
              </div>

              {/* How it works */}
              <div
                className="bg-exchange-card border border-exchange-border rounded-xl"
                style={{ padding: '20px' }}
              >
                <h3 className="text-sm font-bold text-exchange-text mb-3 flex items-center gap-2">
                  <TrendingUp size={16} className="text-exchange-yellow" />
                  {t('referral.howTitle')}
                </h3>
                <ol className="space-y-2.5 text-sm text-exchange-text-secondary leading-relaxed">
                  <li className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-exchange-yellow/20 text-exchange-yellow text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                    <span>
                      <b className="text-exchange-text">{t('referral.howStep1Title')}</b><br />
                      {t('referral.howStep1Desc')}
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-exchange-yellow/20 text-exchange-yellow text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                    <span>
                      <b className="text-exchange-text">
                        {t('referral.howStep2Title', { amount: String(data?.welcome_bonus_qx ?? data?.welcome_bonus_qta ?? 100) })}
                      </b><br />
                      {t('referral.howStep2Desc')}
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-exchange-yellow/20 text-exchange-yellow text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
                    <span>
                      <b className="text-exchange-text">
                        {t('referral.howStep3MultiTitle', {
                          l1: String(data?.level_rewards?.l1 ?? 50),
                          l2: String(data?.level_rewards?.l2 ?? 30),
                          l3: String(data?.level_rewards?.l3 ?? 20),
                        })}
                      </b><br />
                      {t('referral.howStep3MultiDesc')}
                    </span>
                  </li>
                </ol>

                {/* Level reward chips */}
                <div className="grid grid-cols-3 gap-2 mt-4">
                  {([
                    { lvl: 'L1', amount: data?.level_rewards?.l1 ?? 50, hint: t('referral.l1Hint') },
                    { lvl: 'L2', amount: data?.level_rewards?.l2 ?? 30, hint: t('referral.l2Hint') },
                    { lvl: 'L3', amount: data?.level_rewards?.l3 ?? 20, hint: t('referral.l3Hint') },
                  ] as const).map((row) => (
                    <div
                      key={row.lvl}
                      className="bg-exchange-bg/40 border border-exchange-border/60 rounded-lg text-center"
                      style={{ padding: '10px 8px' }}
                    >
                      <div className="text-[10px] uppercase tracking-wider text-exchange-text-third mb-0.5">
                        {row.lvl}
                      </div>
                      <div className="text-base font-bold text-exchange-yellow tabular-nums">
                        +{row.amount} <span className="text-[11px] text-exchange-text-secondary font-medium">QX</span>
                      </div>
                      <div className="text-[10px] text-exchange-text-third mt-0.5 leading-tight">
                        {row.hint}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {data?.referred_by && (
                <div
                  className="bg-exchange-buy/5 border border-exchange-buy/20 rounded-xl flex items-center gap-3"
                  style={{ padding: '14px 16px' }}
                >
                  <CheckCircle2 size={16} className="text-exchange-buy shrink-0" />
                  <p className="text-sm text-exchange-text-secondary">
                    {t('referral.referredByPre')}{' '}
                    <b className="text-exchange-text">{data.referred_by.nickname}</b>
                    {' '}({data.referred_by.code})
                  </p>
                </div>
              )}
            </div>

            {/* RIGHT — Stats */}
            <aside className="space-y-4">
              <div
                className="bg-exchange-card border border-exchange-border rounded-xl"
                style={{ padding: '20px' }}
              >
                <div className="flex items-center gap-2 text-exchange-text-secondary mb-2">
                  <Users size={14} />
                  <span className="text-xs uppercase tracking-wider">{t('referral.invitedCount')}</span>
                </div>
                <div
                  className="font-bold text-exchange-text tabular-nums"
                  style={{ fontSize: '32px', lineHeight: 1.1 }}
                >
                  {data?.invited_count ?? 0}
                </div>
              </div>

              <div
                className="bg-exchange-card border border-exchange-border rounded-xl"
                style={{ padding: '20px' }}
              >
                <div className="flex items-center gap-2 text-exchange-text-secondary mb-2">
                  <Gift size={14} className="text-exchange-yellow" />
                  <span className="text-xs uppercase tracking-wider">{t('referral.totalEarned')}</span>
                </div>
                <div
                  className="font-bold text-exchange-yellow tabular-nums"
                  style={{ fontSize: '32px', lineHeight: 1.1 }}
                >
                  {(data?.total_reward_qx ?? data?.total_reward_qta ?? 0).toLocaleString()}
                  <span className="text-base text-exchange-text-secondary ml-1.5 font-medium">QX</span>
                </div>
                <p className="text-[11px] text-exchange-text-third mt-2">
                  {t('referral.perInviteHint', {
                    amount: String(data?.reward_per_referral_qx ?? data?.reward_per_referral_qta ?? 100),
                  })}
                </p>
              </div>

              {/* Per-level breakdown */}
              {data?.by_level && (
                <div
                  className="bg-exchange-card border border-exchange-border rounded-xl"
                  style={{ padding: '20px' }}
                >
                  <div className="flex items-center gap-2 text-exchange-text-secondary mb-3">
                    <TrendingUp size={14} className="text-exchange-yellow" />
                    <span className="text-xs uppercase tracking-wider">{t('referral.byLevelTitle')}</span>
                  </div>
                  <div className="space-y-2">
                    {(['l1', 'l2', 'l3'] as const).map((k) => {
                      const stat = data.by_level![k];
                      const reward = data.level_rewards?.[k] ?? 0;
                      const lvlNum = k === 'l1' ? 1 : k === 'l2' ? 2 : 3;
                      return (
                        <div
                          key={k}
                          className="flex items-center justify-between bg-exchange-bg/40 border border-exchange-border/40 rounded-lg"
                          style={{ padding: '10px 12px' }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-exchange-yellow bg-exchange-yellow/15 rounded-md px-1.5 py-0.5">
                              L{lvlNum}
                            </span>
                            <span className="text-xs text-exchange-text-secondary">
                              {stat.count} {t('referral.peopleUnit')}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-semibold text-exchange-yellow tabular-nums">
                              +{stat.reward_qx.toLocaleString()} QX
                            </span>
                            <span className="text-[10px] text-exchange-text-third ml-1.5">
                              ({reward}/{t('referral.perPerson')})
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </aside>
          </div>

          {/* Invitee table — full width */}
          <div
            className="bg-exchange-card border border-exchange-border rounded-xl overflow-hidden"
            style={{ marginTop: '4px' }}
          >
            <div
              className="flex items-center border-b border-exchange-border bg-exchange-bg/40"
              style={{ padding: '14px 20px' }}
            >
              <h3 className="text-sm font-bold text-exchange-text flex items-center gap-2">
                <Users size={15} className="text-exchange-yellow" />
                {t('referral.historyTitle')}
                <span className="text-xs text-exchange-text-third font-normal">
                  ({data?.invited_count ?? 0})
                </span>
              </h3>
            </div>

            {!data || data.invited.length === 0 ? (
              <div className="py-16 text-center">
                <Mail size={36} className="mx-auto text-exchange-text-third mb-3 opacity-40" />
                <p className="text-exchange-text-secondary text-sm">{t('referral.empty')}</p>
                <p className="text-exchange-text-third text-xs mt-1">{t('referral.emptyHint')}</p>
              </div>
            ) : (
              <div className="qx-page-main-scroll">
                <div
                  className="hidden md:flex items-center text-xs text-exchange-text-third font-medium border-b border-exchange-border/40 bg-exchange-bg/20"
                  style={{ padding: '12px 20px' }}
                >
                  <span style={{ width: '40%' }}>{t('referral.colUser')}</span>
                  <span style={{ width: '25%' }} className="text-center">{t('referral.colStatus')}</span>
                  <span style={{ width: '20%' }} className="text-right">{t('referral.colReward')}</span>
                  <span style={{ width: '15%' }} className="text-right">{t('referral.colDate')}</span>
                </div>
                {data.invited.map((row, idx) => {
                  const lvl = Number(row.level || 1);
                  return (
                    <div
                      key={`${row.referred_id}-${lvl}-${idx}`}
                      className="flex items-center border-b border-exchange-border/30 last:border-0 hover:bg-exchange-hover/20 transition-colors text-sm"
                      style={{ padding: '14px 20px' }}
                    >
                      <span style={{ width: '40%' }} className="font-medium text-exchange-text truncate flex items-center gap-2">
                        <span className="text-[10px] font-bold text-exchange-yellow bg-exchange-yellow/15 rounded-md px-1.5 py-0.5 shrink-0">
                          L{lvl}
                        </span>
                        <span className="truncate">{row.referred_nickname}</span>
                      </span>
                      <span style={{ width: '25%' }} className="flex justify-center">
                        {row.email_verified_at ? (
                          <span className="inline-flex items-center gap-1 text-[11px] bg-exchange-buy/10 text-exchange-buy rounded-md px-2 py-0.5">
                            <CheckCircle2 size={11} />
                            {t('referral.verified')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] bg-exchange-yellow/10 text-exchange-yellow rounded-md px-2 py-0.5">
                            <Clock size={11} />
                            {t('referral.pending')}
                          </span>
                        )}
                      </span>
                      <span style={{ width: '20%' }} className="text-right font-semibold text-exchange-yellow tabular-nums">
                        +{Number(row.reward_qta).toLocaleString()} QX
                      </span>
                      <span style={{ width: '15%' }} className="text-right text-xs text-exchange-text-third tabular-nums">
                        {new Date(row.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </DesktopPageLayout>
  );
}
