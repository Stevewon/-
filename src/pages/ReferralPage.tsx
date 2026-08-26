import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { showToast } from '../components/common/Toast';
import DesktopPageLayout from '../components/common/DesktopPageLayout';
import {
  Gift, Copy, Check, Users, TrendingUp, Share2, ChevronLeft,
  CheckCircle2, Clock, Mail, Scale, Layers, Award,
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

interface BinaryTier { min: number; max: number | null; rate: number; }
interface BinaryData {
  left_usd: number;
  right_usd: number;
  matched_usd: number;
  left_carry_usd: number;
  right_carry_usd: number;
  pending_matchable_usd: number;
  total_bonus_qta: number;
  total_bonus_usd: number;
  payout_count: number;
  tiers: BinaryTier[];
}
interface MatchBonusRow {
  id: string;
  matched_usd: number;
  rate: number;
  bonus_usd: number;
  bonus_qta: number;
  qta_price: number;
  left_total: number;
  right_total: number;
  matched_total: number;
  created_at: string;
}

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
  const [binary, setBinary] = useState<BinaryData | null>(null);
  const [bonuses, setBonuses] = useState<MatchBonusRow[]>([]);
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
    // Binary matching-bonus data (best-effort; silent on error).
    api.get('/auth/referrals/binary').then(r => setBinary(r.data)).catch(() => {});
    api.get('/auth/referrals/match-bonuses').then(r => setBonuses(r.data.bonuses || [])).catch(() => {});
  }, [user]);

  const fmtUsd = (n: number) =>
    `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const fmtQta = (n: number) =>
    Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

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

  // ── Direct vs downline breakdown ──────────────────────────────────────────
  // The `invited` list mixes L1 (people you personally invited) with L2/L3
  // (your downline's invitees, credited via multi-level rewards). Showing the
  // raw total as "friends invited" is misleading — a user who invited 1 person
  // whose downline grew to 30 would appear to have invited 31. So we split it:
  // the headline number is DIRECT (L1) invites; L2/L3 are shown as downline.
  const directCount =
    data?.by_level?.l1.count ??
    (data?.invited.filter((r) => Number(r.level || 1) === 1).length ?? 0);
  const totalCount = data?.invited_count ?? data?.invited.length ?? 0;
  const indirectCount = Math.max(0, totalCount - directCount);

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
                          l1: String(data?.level_rewards?.l1 ?? 100),
                          l2: String(data?.level_rewards?.l2 ?? 50),
                          l3: String(data?.level_rewards?.l3 ?? 30),
                        })}
                      </b><br />
                      {t('referral.howStep3MultiDesc')}
                    </span>
                  </li>
                </ol>

                {/* Level reward chips */}
                <div className="grid grid-cols-3 gap-2 mt-4">
                  {([
                    { lvl: 'L1', amount: data?.level_rewards?.l1 ?? 100, hint: t('referral.l1Hint') },
                    { lvl: 'L2', amount: data?.level_rewards?.l2 ?? 50, hint: t('referral.l2Hint') },
                    { lvl: 'L3', amount: data?.level_rewards?.l3 ?? 30, hint: t('referral.l3Hint') },
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
                  {directCount}
                </div>
                <p className="text-[11px] text-exchange-text-third mt-2 leading-snug">
                  {t('referral.directCountHint')}
                  {indirectCount > 0 && (
                    <>
                      <br />
                      {t('referral.networkTotalHint', {
                        total: String(totalCount),
                        indirect: String(indirectCount),
                      })}
                    </>
                  )}
                </p>
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
                      // Show the ACTUAL average per person implied by the stored
                      // rewards (reward_qx / count), NOT the current fixed rate.
                      // Historical rows may have been credited at older rates, so
                      // the fixed rate would make "count × rate" disagree with the
                      // real total. Rounding keeps the chip clean while the +QX
                      // figure remains the exact source of truth.
                      const perPerson =
                        stat.count > 0
                          ? Math.round(stat.reward_qx / stat.count)
                          : data.level_rewards?.[k] ?? 0;
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
                              (~{perPerson}/{t('referral.perPerson')})
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
              <h3 className="text-sm font-bold text-exchange-text flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="flex items-center gap-2">
                  <Users size={15} className="text-exchange-yellow" />
                  {t('referral.historyTitle')}
                  <span className="text-xs text-exchange-text-third font-normal">
                    ({totalCount})
                  </span>
                </span>
                <span className="text-[11px] font-normal text-exchange-text-third">
                  {t('referral.historyAllLevels', {
                    direct: String(directCount),
                    indirect: String(indirectCount),
                  })}
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
                        <span
                          className={`text-[10px] font-bold rounded-md px-1.5 py-0.5 shrink-0 ${
                            lvl === 1
                              ? 'text-exchange-yellow bg-exchange-yellow/15'
                              : 'text-exchange-text-secondary bg-exchange-hover/60'
                          }`}
                        >
                          {lvl === 1 ? t('referral.directBadge') : `${t('referral.downlineBadge')} L${lvl}`}
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

          {/* ══════════════════════════════════════════════════════════════
              BINARY LEFT/RIGHT MATCHING BONUS — full width
             ══════════════════════════════════════════════════════════════ */}
          <div
            className="bg-exchange-card border border-exchange-border rounded-xl overflow-hidden"
            style={{ marginTop: '4px' }}
          >
            <div
              className="flex items-center gap-2 border-b border-exchange-border bg-exchange-bg/40"
              style={{ padding: '14px 20px' }}
            >
              <Scale size={16} className="text-exchange-yellow" />
              <h3 className="text-sm font-bold text-exchange-text">{t('referral.matchTitle')}</h3>
            </div>

            <div style={{ padding: '20px' }} className="space-y-5">
              <p className="text-xs text-exchange-text-secondary leading-relaxed">
                {t('referral.matchIntro')}
              </p>

              {/* Left / Right leg volumes */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-exchange-bg/40 border border-exchange-border/60 rounded-xl p-4 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-wider text-exchange-text-third mb-1">
                    <Layers size={12} /> {t('referral.leftLeg')}
                  </div>
                  <div className="text-2xl font-bold text-exchange-buy tabular-nums">
                    {fmtUsd(binary?.left_usd || 0)}
                  </div>
                  <div className="text-[10px] text-exchange-text-third mt-1">
                    {t('referral.unmatched')}: {fmtUsd(binary?.left_carry_usd || 0)}
                  </div>
                </div>
                <div className="bg-exchange-bg/40 border border-exchange-border/60 rounded-xl p-4 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-wider text-exchange-text-third mb-1">
                    <Layers size={12} /> {t('referral.rightLeg')}
                  </div>
                  <div className="text-2xl font-bold text-exchange-sell tabular-nums">
                    {fmtUsd(binary?.right_usd || 0)}
                  </div>
                  <div className="text-[10px] text-exchange-text-third mt-1">
                    {t('referral.unmatched')}: {fmtUsd(binary?.right_carry_usd || 0)}
                  </div>
                </div>
              </div>

              {/* Matched + lifetime bonus */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-exchange-bg/40 border border-exchange-border/60 rounded-xl p-4">
                  <div className="text-[11px] uppercase tracking-wider text-exchange-text-third mb-1">
                    {t('referral.matchedTotal')}
                  </div>
                  <div className="text-xl font-bold text-exchange-text tabular-nums">
                    {fmtUsd(binary?.matched_usd || 0)}
                  </div>
                </div>
                <div className="bg-exchange-yellow/10 border border-exchange-yellow/30 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-exchange-yellow mb-1">
                    <Award size={12} /> {t('referral.bonusEarned')}
                  </div>
                  <div className="text-xl font-bold text-exchange-yellow tabular-nums">
                    {fmtQta(binary?.total_bonus_qta || 0)} <span className="text-xs font-medium">QTA</span>
                  </div>
                  <div className="text-[10px] text-exchange-text-third mt-0.5">
                    ≈ {fmtUsd(binary?.total_bonus_usd || 0)} · {binary?.payout_count || 0} {t('referral.payouts')}
                  </div>
                </div>
              </div>

              {/* Bonus rate table */}
              <div>
                <div className="text-[11px] uppercase tracking-wider text-exchange-text-third mb-2">
                  {t('referral.rateTableTitle')}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(binary?.tiers || [
                    { min: 100, max: 999, rate: 0.02 },
                    { min: 1000, max: 4999, rate: 0.03 },
                    { min: 5000, max: 9999, rate: 0.04 },
                    { min: 10000, max: 49999, rate: 0.05 },
                    { min: 50000, max: 99999, rate: 0.06 },
                    { min: 100000, max: null, rate: 0.07 },
                  ]).map((tier, i) => (
                    <div key={i} className="flex items-center justify-between bg-exchange-bg/40 border border-exchange-border/40 rounded-lg px-3 py-2">
                      <span className="text-[11px] text-exchange-text-secondary tabular-nums">
                        {fmtUsd(tier.min)}{tier.max ? `~${fmtUsd(tier.max)}` : '+'}
                      </span>
                      <span className="text-xs font-bold text-exchange-yellow tabular-nums">
                        {(tier.rate * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bonus payout history */}
              <div>
                <div className="text-[11px] uppercase tracking-wider text-exchange-text-third mb-2">
                  {t('referral.bonusHistoryTitle')} ({bonuses.length})
                </div>
                {bonuses.length === 0 ? (
                  <div className="py-8 text-center bg-exchange-bg/30 rounded-lg">
                    <Award size={30} className="mx-auto text-exchange-text-third mb-2 opacity-40" />
                    <p className="text-xs text-exchange-text-secondary">{t('referral.noBonusYet')}</p>
                  </div>
                ) : (
                  <div className="border border-exchange-border/40 rounded-lg overflow-hidden">
                    <div className="hidden sm:flex items-center text-[11px] text-exchange-text-third font-medium border-b border-exchange-border/40 bg-exchange-bg/20 px-3 py-2">
                      <span style={{ width: '28%' }}>{t('referral.colMatched')}</span>
                      <span style={{ width: '14%' }} className="text-center">{t('referral.colRate')}</span>
                      <span style={{ width: '30%' }} className="text-right">{t('referral.colBonus')}</span>
                      <span style={{ width: '28%' }} className="text-right">{t('referral.colDate')}</span>
                    </div>
                    {bonuses.map((b) => (
                      <div key={b.id} className="flex items-center border-b border-exchange-border/20 last:border-0 hover:bg-exchange-hover/20 transition-colors px-3 py-2.5 text-sm">
                        <span style={{ width: '28%' }} className="tabular-nums text-exchange-text">
                          {fmtUsd(b.matched_usd)}
                        </span>
                        <span style={{ width: '14%' }} className="text-center tabular-nums text-exchange-text-secondary">
                          {(b.rate * 100).toFixed(0)}%
                        </span>
                        <span style={{ width: '30%' }} className="text-right tabular-nums font-semibold text-exchange-yellow">
                          +{fmtQta(b.bonus_qta)} QTA
                        </span>
                        <span style={{ width: '28%' }} className="text-right text-xs text-exchange-text-third tabular-nums">
                          {new Date(b.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </DesktopPageLayout>
  );
}
