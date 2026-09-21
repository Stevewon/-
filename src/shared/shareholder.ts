// ============================================================================
// Shareholder flags — 거래소 지분자 / 카지노 지분자 (OWNER_RULES §11, 2026-09-21)
// ----------------------------------------------------------------------------
// The admin decides who is an exchange-shareholder / casino-shareholder by
// toggling two flags on `users` (columns from migration 0051):
//   users.fee_exempt_exchange_holder   거래소 지분자
//   users.fee_exempt_casino_holder     카지노 지분자
//
// What a shareholder flag UNLOCKS (and only this):
//   • Native QTA on-chain DEPOSIT is accepted and credited to the member's
//     QTA wallet (everyone else: QTA remains withdraw-only, owner rule
//     2026-08-28 — native QTA sent by a non-shareholder is NOT credited).
//   • The deposited QTA may then be sold on the market under the standard
//     company buy-back cap: max KRW 50,000 (34.48 USDT) per member per KST
//     day (OWNER_RULES §6 — unchanged, applies to shareholders too).
//
// This module is shared by the Pages API (src/server/**) and copied verbatim
// to cron-worker/src/shareholder.ts (the cron worker has its own bundle).
// ============================================================================

export interface ShareholderFlags {
  exchange: boolean;
  casino: boolean;
}

export interface ShareholderRow {
  fee_exempt_exchange_holder?: number | boolean | null;
  fee_exempt_casino_holder?: number | boolean | null;
}

export function flagsFromRow(row: ShareholderRow | null | undefined): ShareholderFlags {
  return {
    exchange: Boolean(Number(row?.fee_exempt_exchange_holder || 0)),
    casino: Boolean(Number(row?.fee_exempt_casino_holder || 0)),
  };
}

export function isShareholder(flags: ShareholderFlags | ShareholderRow | null | undefined): boolean {
  if (!flags) return false;
  if ('exchange' in flags || 'casino' in flags) {
    const f = flags as ShareholderFlags;
    return Boolean(f.exchange || f.casino);
  }
  const f = flagsFromRow(flags as ShareholderRow);
  return f.exchange || f.casino;
}

/** SQL fragment usable in WHERE clauses against an aliased `users` table. */
export function shareholderSql(alias = 'u'): string {
  return `(COALESCE(${alias}.fee_exempt_exchange_holder,0) = 1 OR COALESCE(${alias}.fee_exempt_casino_holder,0) = 1)`;
}

/**
 * Load the two flags for a user. Tolerates the columns not existing yet
 * (migration 0051 not applied) by returning both-false.
 */
export async function loadShareholderFlags(
  DB: { prepare(sql: string): { bind(...a: unknown[]): { first<T>(): Promise<T | null> } } },
  userId: string,
): Promise<ShareholderFlags> {
  try {
    const row = await DB.prepare(
      `SELECT fee_exempt_exchange_holder, fee_exempt_casino_holder FROM users WHERE id = ?`,
    ).bind(userId).first<ShareholderRow>();
    return flagsFromRow(row);
  } catch {
    return { exchange: false, casino: false };
  }
}
