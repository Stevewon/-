// ============================================================================
// Fee-tier resolution + fee_ledger recording  (Sprint 3 — S3-5)
// ----------------------------------------------------------------------------
// Responsibilities:
//   1. getUserFeeTier(DB, userId) — compute the user's 30-day USD trading
//      volume and return the matching fee_tiers row. Falls back gracefully
//      to the per-market maker/taker defaults if fee_tiers isn't migrated
//      yet (prod safety — matching engine must never throw because of fees).
//   2. recordFeeLedger(...) — append a row per (trade, side) after a trade
//      is persisted. Best-effort: ledger failures never break the trade.
// ============================================================================

export interface FeeTier {
  tier: number;
  name: string;
  maker_fee: number;
  taker_fee: number;
  volume_usd_30d: number;
  exempt?: boolean;          // trading fee fully waived
  exempt_reason?: string;    // why (exchange_holder / casino_holder / qx_trade / qx_all)
}

function uuid() { return crypto.randomUUID(); }

// ============================================================================
// Fee-exemption resolution (Owner request 2026-08-27)
// ----------------------------------------------------------------------------
// Four independent conditions decide whether a user is exempt from the
// trading fee and/or the withdrawal fee:
//   1. fee_exempt_exchange_holder  거래소 지분권자 → trade + withdrawal exempt
//   2. fee_exempt_casino_holder    카지노 지분권자 → trade + withdrawal exempt
//   3. QX holding 100,000 ~ 499,999 → trade fee exempt only  (auto by balance)
//   4. QX holding >= 500,000        → trade + withdrawal exempt (auto by balance)
//
// The admin-set flags (1 & 2) are unconditional. The QX flags are AUTOMATIC —
// evaluated live from the user's QX wallet (available + locked). We also honour
// the persisted fee_exempt_qx_trade / fee_exempt_qx_all columns as a manual
// override in case an admin wants to grant them explicitly, but the primary
// path is the live QX-balance check so it self-adjusts as balances change.
// ============================================================================

export const QX_TRADE_EXEMPT_MIN = 100_000;   // 10만개 이상 → 거래수수료 면제
export const QX_ALL_EXEMPT_MIN   = 500_000;    // 50만개 이상 → 거래+출금 면제

export interface FeeExemption {
  tradeExempt: boolean;       // trading (maker/taker) fee waived
  withdrawExempt: boolean;    // withdrawal fee waived
  reason: string | null;      // dominant reason (for logs/UI)
  qxBalance: number;          // live QX holding used for the decision
}

/**
 * Resolve a user's fee-exemption status. Combines the two admin-set
 * shareholder flags with the automatic QX-holding thresholds.
 * Never throws — returns "no exemption" on any DB error (fail-closed for
 * fees, i.e. the user is charged normally).
 */
export async function getFeeExemption(
  DB: D1Database,
  userId: string,
): Promise<FeeExemption> {
  const none: FeeExemption = { tradeExempt: false, withdrawExempt: false, reason: null, qxBalance: 0 };
  try {
    const u = await DB.prepare(
      `SELECT COALESCE(fee_exempt_exchange_holder, 0) AS ex,
              COALESCE(fee_exempt_casino_holder, 0)   AS ca,
              COALESCE(fee_exempt_qx_trade, 0)        AS qt,
              COALESCE(fee_exempt_qx_all, 0)          AS qa
         FROM users WHERE id = ?`
    ).bind(userId).first<{ ex: number; ca: number; qt: number; qa: number }>();
    if (!u) return none;

    // Live QX holding (available + locked across the QX wallet).
    const w = await DB.prepare(
      `SELECT COALESCE(SUM(available + locked), 0) AS qx
         FROM wallets WHERE user_id = ? AND coin_symbol = 'QX'`
    ).bind(userId).first<{ qx: number }>().catch(() => ({ qx: 0 } as any));
    const qxBalance = Number(w?.qx || 0);

    // Priority: full (trade+withdraw) exemptions first.
    if (u.ex) return { tradeExempt: true, withdrawExempt: true, reason: 'exchange_holder', qxBalance };
    if (u.ca) return { tradeExempt: true, withdrawExempt: true, reason: 'casino_holder', qxBalance };
    // QX >= 500k → trade + withdraw (auto, or manual override flag).
    if (u.qa || qxBalance >= QX_ALL_EXEMPT_MIN) {
      return { tradeExempt: true, withdrawExempt: true, reason: 'qx_all', qxBalance };
    }
    // QX 100k ~ 499,999 → trade only (auto, or manual override flag).
    if (u.qt || qxBalance >= QX_TRADE_EXEMPT_MIN) {
      return { tradeExempt: true, withdrawExempt: false, reason: 'qx_trade', qxBalance };
    }
    return { ...none, qxBalance };
  } catch (e) {
    console.warn('[fees] getFeeExemption failed, no exemption applied:', e);
    return none;
  }
}

/**
 * Fetch (or fall back to) the fee tier for a given user based on their
 * 30-day USD notional volume. Returns market-default fees if the
 * fee_tiers table is missing — ensures backward compat with pre-0011 DBs.
 *
 * The result is memoisable per (userId, market) for the duration of a
 * single order placement; we keep it simple and look up on each call since
 * the matching engine only calls this once per taker order.
 */
export async function getUserFeeTier(
  DB: D1Database,
  userId: string,
  fallback: { maker_fee: number; taker_fee: number },
): Promise<FeeTier> {
  // 0. Fee-exemption short-circuit (Owner request 2026-08-27). If the user is
  //    a designated shareholder (exchange/casino) or holds enough QX, waive the
  //    trading fee entirely. This snapshots into taker_fee_locked/maker_fee_locked
  //    at order placement, so refunds/charges stay symmetric at 0.
  try {
    const exempt = await getFeeExemption(DB, userId);
    if (exempt.tradeExempt) {
      return {
        tier: 0,
        name: `EXEMPT (${exempt.reason})`,
        maker_fee: 0,
        taker_fee: 0,
        volume_usd_30d: 0,
        exempt: true,
        exempt_reason: exempt.reason || undefined,
      };
    }
  } catch (e) {
    console.warn('[fees] exemption check failed, charging normal fee:', e);
  }

  // 1. 30-day volume (USD notional) — sum(trade.total * quote.price_usd).
  //    `total` on trades is in the quote coin; we multiply by the coin's
  //    current price_usd as a practical approximation. A future hardening
  //    pass could snapshot the USD rate per trade.
  let volumeUsd = 0;
  try {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const row = await DB.prepare(`
      SELECT COALESCE(SUM(t.total * COALESCE(c.price_usd, 0)), 0) AS v
        FROM trades t
        JOIN markets m ON m.id = t.market_id
        LEFT JOIN coins c ON c.symbol = m.quote_coin
       WHERE t.created_at >= ?
         AND (t.buyer_id = ? OR t.seller_id = ?)
    `).bind(since, userId, userId).first<{ v: number }>();
    volumeUsd = Number(row?.v || 0);
  } catch (e) {
    console.warn('[fees] volume query failed, defaulting to 0:', e);
  }

  // 2. Best matching tier (highest min_volume_usd <= volumeUsd).
  try {
    const tier = await DB.prepare(`
      SELECT tier, name, maker_fee, taker_fee
        FROM fee_tiers
       WHERE min_volume_usd <= ?
       ORDER BY min_volume_usd DESC
       LIMIT 1
    `).bind(volumeUsd).first<{
      tier: number; name: string; maker_fee: number; taker_fee: number;
    }>();
    if (tier) {
      return {
        tier: tier.tier,
        name: tier.name,
        maker_fee: tier.maker_fee,
        taker_fee: tier.taker_fee,
        volume_usd_30d: volumeUsd,
      };
    }
  } catch (e) {
    // Table not migrated yet — quietly fall back.
    console.warn('[fees] fee_tiers unavailable, using market defaults:', e);
  }

  return {
    tier: 0,
    name: 'VIP 0',
    maker_fee: fallback.maker_fee,
    taker_fee: fallback.taker_fee,
    volume_usd_30d: volumeUsd,
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
