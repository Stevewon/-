-- ============================================================================
-- 0049_binary_downline_cap.sql
-- ----------------------------------------------------------------------------
-- Binary downline 2x cap ("몸값" / self-value cap).
--
-- Policy (owner, 2026-08-26):
--   • A user's own accumulated DEPOSIT total is their "self value" (몸값).
--   • Their downline (left_usd + right_usd) can accumulate at most 2 × self
--     value. Deposit volume rolling up an ancestor is CAPPED so that ancestor's
--     total downline never exceeds 2 × self_usd. Excess spillover is dropped.
--   • When the ancestor raises their OWN deposit (self value), their cap rises
--     again and further downline volume can accumulate.
--   • Signup placement is flagged when the sponsor's downline is already full
--     (>= 2 × self value) so the UI can warn.
-- ============================================================================

-- Track each user's own accumulated deposit USD ("몸값" / self value). The
-- downline cap for a user is 2 * self_usd.
ALTER TABLE binary_volume ADD COLUMN self_usd REAL NOT NULL DEFAULT 0;

-- Backfill self_usd from already-counted deposits so existing depositors keep a
-- non-zero cap. We sum the USD value of every deposit whose binary_counted_at is
-- already set (i.e. rolled up under 0048) — real user deposits only.
--
-- (1) External on-chain deposits (credited/swept), valued at the coin's price.
INSERT INTO binary_volume (user_id, left_usd, right_usd, matched_usd, self_usd, updated_at)
SELECT d.user_id, 0, 0, 0,
       COALESCE(SUM(CAST(d.amount AS REAL) * COALESCE(c.price_usd, 1)), 0),
       datetime('now')
  FROM ext_deposits d
  LEFT JOIN coins c ON c.symbol = d.coin_symbol
 WHERE d.status IN ('credited','swept') AND d.binary_counted_at IS NOT NULL
 GROUP BY d.user_id
ON CONFLICT(user_id) DO UPDATE SET
  self_usd = binary_volume.self_usd + excluded.self_usd,
  updated_at = datetime('now');

-- (2) Internal completed deposits (excluding admin-* compensation credits).
INSERT INTO binary_volume (user_id, left_usd, right_usd, matched_usd, self_usd, updated_at)
SELECT d.user_id, 0, 0, 0,
       COALESCE(SUM(d.amount * COALESCE(c.price_usd, 1)), 0),
       datetime('now')
  FROM deposits d
  LEFT JOIN coins c ON c.symbol = d.coin_symbol
 WHERE d.status = 'completed' AND d.binary_counted_at IS NOT NULL
   AND COALESCE(d.tx_hash, '') NOT LIKE 'admin-%'
 GROUP BY d.user_id
ON CONFLICT(user_id) DO UPDATE SET
  self_usd = binary_volume.self_usd + excluded.self_usd,
  updated_at = datetime('now');
