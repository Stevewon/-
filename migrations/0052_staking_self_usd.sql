-- ============================================================================
-- 0052_staking_self_usd.sql
-- ----------------------------------------------------------------------------
-- OWNER RULE (2026-08-28): 몸값(self_usd) is EXCLUSIVELY the STAKING SUBSCRIPTION
-- amount — the exact QTA actually DEDUCTED when a member subscribes to staking.
--   • Deposits (ext_deposits / internal deposits) NO LONGER accrue self_usd or
--     binary downline volume. (The old deposit->self_usd roll-up is retired.)
--   • Only staking_positions drive self_usd and binary left/right volume.
--
-- We add a `binary_counted_at` idempotency marker to staking_positions so each
-- subscription's QTA-USD value is rolled into the binary tree exactly once.
-- (The subscribe handler rolls up synchronously and stamps this immediately;
--  the cron sweeper picks up any that were missed, e.g. legacy rows or a failed
--  synchronous roll-up.)
-- ============================================================================

ALTER TABLE staking_positions ADD COLUMN binary_counted_at TEXT;

-- Index to let the cron sweeper find not-yet-counted active positions fast.
CREATE INDEX IF NOT EXISTS idx_staking_binary_uncounted
  ON staking_positions(binary_counted_at);
