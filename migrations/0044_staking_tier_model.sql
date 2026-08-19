-- ---------------------------------------------------------------------------
-- 0044_staking_tier_model.sql  (SCHEMA ONLY — column additions)
--
-- Adds the columns needed by the official tier plan. This file only runs
-- ALTER TABLE ADD COLUMN + CREATE TABLE/INDEX IF NOT EXISTS statements.
--
-- IMPORTANT (re-run safety): D1 has no "ADD COLUMN IF NOT EXISTS". If this file
-- is executed a second time the first ADD COLUMN raises "duplicate column" and
-- D1 stops the batch. That is fine here because:
--   * the CI applies migrations with continue-on-error, and
--   * the tier SEED DATA lives in 0045 (a separate, fully re-runnable file),
--     so a duplicate-column error here never blocks the seed.
--
-- Tiers (see 0045 for the seed rows):
--   $1,000-1,900  / 180d(6mo) : 0.002  (36%)
--   $1,000-1,900  / 360d(12mo): 0.002  (72%)
--   $2,000-4,900  / 360d(12mo): 0.003  (108%)
--   $5,000-10,000 / 180d(6mo) : 0.003  (54%)
--   $5,000-10,000 / 360d(12mo): 0.005  (180%)
-- ---------------------------------------------------------------------------

-- staking_products: USD band + term + daily-rate + payout-coin columns.
ALTER TABLE staking_products ADD COLUMN min_usd REAL DEFAULT 0;
ALTER TABLE staking_products ADD COLUMN max_usd REAL;
ALTER TABLE staking_products ADD COLUMN term_days INTEGER DEFAULT 0;
ALTER TABLE staking_products ADD COLUMN daily_rate REAL DEFAULT 0;
ALTER TABLE staking_products ADD COLUMN payout_coin TEXT DEFAULT 'QTA';

-- staking_positions: USD/QTA-dividend model columns.
ALTER TABLE staking_positions ADD COLUMN principal_usd REAL DEFAULT 0;
ALTER TABLE staking_positions ADD COLUMN daily_rate REAL DEFAULT 0;
ALTER TABLE staking_positions ADD COLUMN term_days INTEGER DEFAULT 0;
ALTER TABLE staking_positions ADD COLUMN accrued_dividend_usd REAL DEFAULT 0;
ALTER TABLE staking_positions ADD COLUMN paid_dividend_qta REAL DEFAULT 0;
ALTER TABLE staking_positions ADD COLUMN payout_coin TEXT DEFAULT 'QTA';
ALTER TABLE staking_positions ADD COLUMN lock_end_at TEXT;
ALTER TABLE staking_positions ADD COLUMN term_end_at TEXT;

-- Ledger of dividend payouts + referral match bonuses (audit trail).
CREATE TABLE IF NOT EXISTS staking_dividends (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'dividend',   -- 'dividend' | 'match_l1' | 'match_l2'
  usd_amount REAL NOT NULL DEFAULT 0,
  qta_amount REAL NOT NULL DEFAULT 0,
  qta_price REAL NOT NULL DEFAULT 0,
  source_user_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staking_dividends_user
  ON staking_dividends (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staking_dividends_pos
  ON staking_dividends (position_id);
