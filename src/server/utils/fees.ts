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
}

function uuid() { return crypto.randomUUID(); }

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
