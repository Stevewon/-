// ============================================================================
// Fee-tier resolution + fee_ledger recording
// ----------------------------------------------------------------------------
// OWNER RULE (2026-08-28, supersedes ALL previous fee logic):
//   Trading fee AND withdrawal fee are decided SOLELY by the combined amount of
//   QX + QKEY the user is holding inside the exchange wallet (available + locked).
//   The OLD tier-exemption system (ROYAL/DIAMOND/GOLD/SILVER, exchange/casino
//   shareholder flags, 30-day volume ladder) is COMPLETELY REMOVED / IGNORED.
//
//   QX+QKEY holding (개)      거래 수수료   출금 수수료
//   ------------------------- ----------- -----------
//   < 10,000       (기본)      0.10%        5.0%
//   >= 10,000                  0.09%        4.5%
//   >= 50,000                  0.08%        4.0%
//   >= 100,000                 0.07%        3.5%
//   >= 500,000                 0.06%        3.0%
//   >= 1,000,000  (백만 이상)   0.00% (무료)  0.0% (무료)
//
// Responsibilities:
//   1. getFeeTierByHolding(qxQkey)   — pure resolver (holding → rates).
//   2. getUserHolding(DB, userId)    — live QX+QKEY balance (available+locked).
//   3. getFeeExemption(DB, userId)   — kept for backward-compat callers; now
//      returns the QX+QKEY-derived withdrawal fee rate (0 only at 백만 이상).
//   4. getUserFeeTier(DB, userId)    — kept for callers (order.ts/profile.ts);
//      returns maker/taker = the holding-based trading fee rate.
//   5. recordFeeLedger(...)          — unchanged.
// ============================================================================

export interface FeeTier {
  tier: number;
  name: string;
  maker_fee: number;
  taker_fee: number;
  volume_usd_30d: number;    // kept for API back-compat; now = holding (개)
  exempt?: boolean;          // trading fee fully waived (백만 이상)
  exempt_reason?: string;    // 'qx_qkey_1m'
}

function uuid() { return crypto.randomUUID(); }

// ============================================================================
// QX + QKEY holding-based fee schedule (single source of truth).
// ============================================================================

/** Fee schedule row. min = inclusive lower bound of QX+QKEY holding (개). */
export interface HoldingFeeRow {
  tier: number;
  name: string;
  min: number;         // QX+QKEY holding threshold (개), inclusive
  trade_fee: number;   // maker == taker trading fee rate (fraction, e.g. 0.001)
  withdraw_fee: number;// withdrawal fee rate (fraction, e.g. 0.05)
}

// Ordered LOW → HIGH. Resolver picks the highest `min` that <= holding.
export const HOLDING_FEE_SCHEDULE: HoldingFeeRow[] = [
  { tier: 0, name: 'BASIC',   min: 0,         trade_fee: 0.0010, withdraw_fee: 0.050 }, // 0.10% / 5.0%
  { tier: 1, name: 'BRONZE',  min: 10_000,    trade_fee: 0.0009, withdraw_fee: 0.045 }, // 0.09% / 4.5%
  { tier: 2, name: 'SILVER',  min: 50_000,    trade_fee: 0.0008, withdraw_fee: 0.040 }, // 0.08% / 4.0%
  { tier: 3, name: 'GOLD',    min: 100_000,   trade_fee: 0.0007, withdraw_fee: 0.035 }, // 0.07% / 3.5%
  { tier: 4, name: 'PLATINUM',min: 500_000,   trade_fee: 0.0006, withdraw_fee: 0.030 }, // 0.06% / 3.0%
  { tier: 5, name: 'FREE',    min: 1_000_000, trade_fee: 0.0000, withdraw_fee: 0.000 }, // 무료 / 무료
];

/**
 * Pure resolver: given a QX+QKEY holding (개), return the matching fee row.
 * Never throws.
 */
export function getFeeTierByHolding(holding: number): HoldingFeeRow {
  const h = Number.isFinite(holding) ? Math.max(0, holding) : 0;
  let match = HOLDING_FEE_SCHEDULE[0];
  for (const row of HOLDING_FEE_SCHEDULE) {
    if (h >= row.min) match = row; // schedule is ascending, so last hit wins
  }
  return match;
}

/**
 * Live combined QX + QKEY holding inside the exchange (available + locked).
 * Fail-closed to 0 (→ BASIC tier, i.e. highest fees) on any DB error.
 */
export async function getUserHolding(DB: D1Database, userId: string): Promise<number> {
  try {
    const w = await DB.prepare(
      `SELECT COALESCE(SUM(available + locked), 0) AS h
         FROM wallets
        WHERE user_id = ? AND coin_symbol IN ('QX', 'QKEY')`
    ).bind(userId).first<{ h: number }>();
    return Number(w?.h || 0);
  } catch (e) {
    console.warn('[fees] getUserHolding failed, treating as 0:', e);
    return 0;
  }
}

// ============================================================================
// Backward-compat wrapper: getFeeExemption
// ----------------------------------------------------------------------------
// Kept so wallet.ts (withdrawal) keeps working without a signature change.
// Now driven purely by QX+QKEY holding. `withdrawExempt` is true ONLY at the
// 백만-이상 (free) tier; otherwise the caller applies `withdrawFeeRate`.
// ============================================================================
export interface FeeExemption {
  tradeExempt: boolean;        // true only at FREE tier (백만 이상)
  withdrawExempt: boolean;     // true only at FREE tier (백만 이상)
  withdrawFeeRate: number;     // holding-based withdrawal fee rate (fraction)
  tradeFeeRate: number;        // holding-based trading fee rate (fraction)
  reason: string | null;       // fee-tier name (BASIC/BRONZE/…/FREE)
  holding: number;             // combined QX+QKEY used for the decision
  qxBalance: number;           // alias of holding (legacy field name)
}

/**
 * Resolve a user's fee status purely from their QX+QKEY holding.
 * Never throws — returns BASIC (full fees) on any DB error.
 */
export async function getFeeExemption(
  DB: D1Database,
  userId: string,
): Promise<FeeExemption> {
  const holding = await getUserHolding(DB, userId);
  const row = getFeeTierByHolding(holding);
  const free = row.tier === 5; // 백만 이상 → 무료
  return {
    tradeExempt: free,
    withdrawExempt: free,
    withdrawFeeRate: row.withdraw_fee,
    tradeFeeRate: row.trade_fee,
    reason: row.name,
    holding,
    qxBalance: holding,
  };
}

/**
 * Trading-fee tier for a user, driven by QX+QKEY holding. The `fallback`
 * argument (old market maker/taker defaults) is now IGNORED — the holding
 * schedule is authoritative — but the parameter is kept so existing callers
 * (order.ts, profile.ts) don't need signature changes.
 */
export async function getUserFeeTier(
  DB: D1Database,
  userId: string,
  _fallback: { maker_fee: number; taker_fee: number },
): Promise<FeeTier> {
  const holding = await getUserHolding(DB, userId);
  const row = getFeeTierByHolding(holding);
  return {
    tier: row.tier,
    name: row.name,
    maker_fee: row.trade_fee,
    taker_fee: row.trade_fee,
    volume_usd_30d: holding,          // now carries the holding (개) for the API
    exempt: row.tier === 5,
    exempt_reason: row.tier === 5 ? 'qx_qkey_1m' : undefined,
  };
}

export interface LedgerRow {
  trade_id: string;
  user_id: string;
  role: 'maker' | 'taker';
  side: 'buy' | 'sell';
  market_id: string;
  fee_coin: string;
  fee_amount: number;
  fee_rate: number;
  fee_usd?: number | null;
  tier?: number | null;
}

/**
 * Write up to N ledger rows for a single trade. Caller should pass both
 * sides (buyer/seller). Failures swallow-log — trades must never be
 * rolled back because of ledger issues.
 */
export async function recordFeeLedger(DB: D1Database, rows: LedgerRow[]): Promise<void> {
  if (!rows.length) return;
  try {
    const stmts = rows.map((r) =>
      DB.prepare(
        `INSERT INTO fee_ledger
           (id, trade_id, user_id, role, side, market_id,
            fee_coin, fee_amount, fee_rate, fee_usd, tier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        uuid(),
        r.trade_id,
        r.user_id,
        r.role,
        r.side,
        r.market_id,
        r.fee_coin,
        r.fee_amount,
        r.fee_rate,
        r.fee_usd ?? null,
        r.tier ?? null,
      ),
    );
    await DB.batch(stmts);
  } catch (e) {
    console.warn('[fees] ledger insert failed (non-fatal):', e);
  }
}
