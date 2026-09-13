/**
 * QTA FIXED PEG SCHEDULE — single source of truth for the "고정 원화 단가" that
 * staking dividends / match bonuses / dividend withdrawals / wallet conversions
 * use INSTEAD of the live market price.
 *
 *   • 2026-09-01 ~ 2026-09-11 (KST): 6원  (owner rule 2026-09-01, ext. 09-03)
 *   • 2026-09-14 (KST) ~ open-ended:   10원 (owner rule 2026-09-13:
 *       "내일부터는 당분간 수당은 6원에서 10원으로 계산해서 나가게 해줘라")
 *   • gaps (e.g. 09-12 ~ 09-13): no peg → live price.
 *
 * USDT is always pegged at 1,450원 = $1 while a QTA peg is active.
 *
 * Used by BOTH the Pages server (src/server/**) and the React client, so it
 * must stay dependency-free. The cron worker keeps its own copy in
 * cron-worker/src/qta-peg.ts (separate bundle) — keep the two in sync.
 */

export const PEG_USDT_KRW = 1450;

export interface PegWindow {
  /** inclusive, epoch ms */
  startMs: number;
  /** exclusive, epoch ms; Infinity = open-ended */
  endMs: number;
  krw: number;
  label: string;
}

export const PEG_WINDOWS: PegWindow[] = [
  {
    startMs: Date.parse('2026-09-01T00:00:00+09:00'),
    endMs: Date.parse('2026-09-12T00:00:00+09:00'),
    krw: 6,
    label: 'owner-2026-09-01 6won',
  },
  {
    startMs: Date.parse('2026-09-14T00:00:00+09:00'),
    endMs: Number.POSITIVE_INFINITY,
    krw: 10,
    label: 'owner-2026-09-13 10won (당분간)',
  },
];

/** The active peg window at `nowMs`, or null when the live price applies. */
export function activePeg(nowMs: number = Date.now()): PegWindow | null {
  for (const w of PEG_WINDOWS) if (nowMs >= w.startMs && nowMs < w.endMs) return w;
  return null;
}

/** True when a fixed QTA peg is in force. */
export function inFixedWindow(nowMs: number = Date.now()): boolean {
  return activePeg(nowMs) !== null;
}

/** Pegged QTA price in USD (krw / 1450), or null when no peg is active. */
export function pegQtaUsd(nowMs: number = Date.now()): number | null {
  const w = activePeg(nowMs);
  return w ? w.krw / PEG_USDT_KRW : null;
}

/** Pegged QTA price in KRW, or null. */
export function pegQtaKrw(nowMs: number = Date.now()): number | null {
  return activePeg(nowMs)?.krw ?? null;
}

/**
 * Effective USD unit price for a coin under the peg: QTA → pegged, USDT → $1,
 * anything else → the live price. Outside a peg window → live price.
 */
export function effPriceUsd(symbol: string, livePriceUsd: number, nowMs: number = Date.now()): number {
  const peg = pegQtaUsd(nowMs);
  if (peg == null) return livePriceUsd;
  const s = String(symbol).toUpperCase();
  if (s === 'QTA') return peg;
  if (s === 'USDT') return 1;
  return livePriceUsd;
}
