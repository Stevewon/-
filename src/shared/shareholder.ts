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

// ============================================================================
// ★ OWNER_RULES §12 (2026-09-21) — QTA SELL PRE-APPROVAL.
// "사전 매도가 승인된 회원만 매도가 가능하다." Only members the admin approved
// may place / get filled on QTA sell orders. Shareholders (exchange / casino)
// are AUTOMATICALLY approved ("지분자는 자동으로 매도 승인된 걸로 포함").
//   users.qta_sell_approved  INTEGER DEFAULT 0   (migration 0060)
// ============================================================================
export interface SellApprovalRow extends ShareholderRow {
  qta_sell_approved?: number | boolean | null;
}

export interface SellApproval {
  approved: boolean;                       // effective (flag OR shareholder)
  explicit: boolean;                       // users.qta_sell_approved = 1
  via_shareholder: boolean;                // implied by exchange/casino flag
  exchange: boolean;
  casino: boolean;
}

export function sellApprovalFromRow(row: SellApprovalRow | null | undefined): SellApproval {
  const f = flagsFromRow(row);
  const explicit = Boolean(Number(row?.qta_sell_approved || 0));
  const via = f.exchange || f.casino;
  return { approved: explicit || via, explicit, via_shareholder: via && !explicit, exchange: f.exchange, casino: f.casino };
}

/** SQL boolean fragment: member may sell QTA (explicit approval OR shareholder). */
export function canSellSql(alias = 'u'): string {
  return `(COALESCE(${alias}.qta_sell_approved,0) = 1 OR ${shareholderSql(alias)})`;
}

export async function loadSellApproval(
  DB: { prepare(sql: string): { bind(...a: unknown[]): { first<T>(): Promise<T | null> } } },
  userId: string,
): Promise<SellApproval> {
  try {
    const row = await DB.prepare(
      `SELECT qta_sell_approved, fee_exempt_exchange_holder, fee_exempt_casino_holder FROM users WHERE id = ?`,
    ).bind(userId).first<SellApprovalRow>();
    return sellApprovalFromRow(row);
  } catch {
    // Column missing (migration 0060 not applied) → fall back to shareholder-only.
    const f = await loadShareholderFlags(DB, userId);
    const via = f.exchange || f.casino;
    return { approved: via, explicit: false, via_shareholder: via, exchange: f.exchange, casino: f.casino };
  }
}
