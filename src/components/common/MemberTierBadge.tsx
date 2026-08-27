// ============================================================================
// MemberTierBadge — fee-exemption tier mark shown in front of a member's ID.
// ----------------------------------------------------------------------------
// Owner request (2026-08-27): 4 exemption levels, ranked (highest first):
//   1. ROYAL   👑  카지노 지분권자      (casino shareholder)     — top
//   2. DIAMOND 💎  거래소 지분권자      (exchange shareholder)
//   3. GOLD    🥇  QX 500,000+          (trade + withdrawal exempt)
//   4. SILVER  🥈  QX 100,000~499,999   (trading fee exempt)
//
// A member may qualify for several at once; we show ONLY the highest tier.
// The QX tiers are OR-combined with the live exchange QX balance so external-
// wallet holders (manual flag) and on-exchange holders both light up.
// ============================================================================

export type MemberTierKey = 'royal' | 'diamond' | 'gold' | 'silver';

export interface MemberTierInfo {
  key: MemberTierKey;
  emoji: string;
  /** i18n key for the level name (e.g. 'admin.tierRoyal'). */
  labelKey: string;
  /** Fallback English label if no translator is passed. */
  labelFallback: string;
  /** Tailwind classes for the badge chip. */
  className: string;
}

const QX_TRADE_MIN = 100_000;
const QX_ALL_MIN = 500_000;

export const MEMBER_TIERS: Record<MemberTierKey, MemberTierInfo> = {
  royal: {
    key: 'royal',
    emoji: '👑',
    labelKey: 'admin.tierRoyal',
    labelFallback: 'ROYAL',
    className: 'bg-gradient-to-r from-purple-500/25 to-amber-400/25 text-purple-300 ring-1 ring-purple-400/40',
  },
  diamond: {
    key: 'diamond',
    emoji: '💎',
    labelKey: 'admin.tierDiamond',
    labelFallback: 'DIAMOND',
    className: 'bg-cyan-400/20 text-cyan-300 ring-1 ring-cyan-400/40',
  },
  gold: {
    key: 'gold',
    emoji: '🥇',
    labelKey: 'admin.tierGold',
    labelFallback: 'GOLD',
    className: 'bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/40',
  },
  silver: {
    key: 'silver',
    emoji: '🥈',
    labelKey: 'admin.tierSilver',
    labelFallback: 'SILVER',
    className: 'bg-slate-300/20 text-slate-200 ring-1 ring-slate-300/40',
  },
};

export interface TierSource {
  fee_exempt_exchange_holder?: number | boolean;
  fee_exempt_casino_holder?: number | boolean;
  fee_exempt_qx_trade?: number | boolean;
  fee_exempt_qx_all?: number | boolean;
  qx_balance?: number;
}

/**
 * Resolve the single highest tier a member qualifies for, or null.
 * Ranking: casino(ROYAL) > exchange(DIAMOND) > qx500k(GOLD) > qx100k(SILVER).
 */
export function resolveMemberTier(u: TierSource): MemberTierInfo | null {
  const qx = Number(u.qx_balance || 0);
  if (u.fee_exempt_casino_holder) return MEMBER_TIERS.royal;
  if (u.fee_exempt_exchange_holder) return MEMBER_TIERS.diamond;
  if (u.fee_exempt_qx_all || qx >= QX_ALL_MIN) return MEMBER_TIERS.gold;
  if (u.fee_exempt_qx_trade || qx >= QX_TRADE_MIN) return MEMBER_TIERS.silver;
  return null;
}

interface Props {
  user: TierSource;
  /** Optional i18n translator; falls back to English level names. */
  t?: (k: string) => string;
  /** 'icon' = emoji only (compact), 'full' = emoji + level name. */
  variant?: 'icon' | 'full';
  className?: string;
}

/**
 * Renders the member's highest fee-exemption tier mark. Returns null if the
 * member has no exemption tier (so it can be dropped in front of any ID safely).
 */
export default function MemberTierBadge({ user, t, variant = 'full', className = '' }: Props) {
  const tier = resolveMemberTier(user);
  if (!tier) return null;
  const label = t ? t(tier.labelKey) : tier.labelFallback;

  if (variant === 'icon') {
    return (
      <span
        title={label}
        className={`inline-flex items-center justify-center text-[11px] leading-none align-middle ${className}`}
      >
        {tier.emoji}
      </span>
    );
  }

  return (
    <span
      title={label}
      className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded align-middle ${tier.className} ${className}`}
    >
      <span className="leading-none">{tier.emoji}</span>
      <span className="leading-none tracking-wide">{label}</span>
    </span>
  );
}
