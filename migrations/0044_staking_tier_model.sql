-- ---------------------------------------------------------------------------
-- 0044_staking_tier_model.sql
--
-- Redesign QTA Staking to the official tier plan:
--   * User stakes USDT in $100 increments.
--   * Tier (daily rate) is decided by USDT amount band + term length.
--   * Dividends are DENOMINATED IN USD (principal_usd * daily_rate * days),
--     paid out AS QTA (quantity = usd_dividend / qta_price_at_payout).
--     Simple interest, no compounding.
--   * Lock: dividends accrue daily; principal is locked for the full term.
--   * Early exit (< 90 days): forfeit all accrued dividend AND 30% principal
--     penalty; 70% principal returned.
--   * After 90 days but before term end: allowed to exit, keep accrued
--     dividend, full principal returned (no penalty). At/after term end: same.
--   * Referral match: when a dividend is credited to a staker, the 1st-level
--     referrer gets 10% and the 2nd-level referrer gets 5% of that dividend,
--     paid as QTA (company-issued).
--
-- Tiers (daily_rate as fraction):
--   $1,000-1,900  / 180d : 0.002  (36%)
--   $1,000-1,900  / 360d : 0.002  (72%)
--   $2,000-4,900  / 360d : 0.003  (108%)
--   $5,000-10,000 / 180d : 0.003  (54%)
--   $5,000-10,000 / 360d : 0.005  (180%)
-- ---------------------------------------------------------------------------

-- Fresh tier catalog. Drop the old seed products (keep the table).
DELETE FROM staking_products;

-- Extend staking_products with the tier bands (reuse existing columns:
-- apr now holds the DAILY rate; lock_days holds the TERM in days).
-- Add USD band columns.
ALTER TABLE staking_products ADD COLUMN min_usd REAL DEFAULT 0;
ALTER TABLE staking_products ADD COLUMN max_usd REAL;      -- inclusive upper bound
ALTER TABLE staking_products ADD COLUMN term_days INTEGER DEFAULT 0;
ALTER TABLE staking_products ADD COLUMN daily_rate REAL DEFAULT 0;
ALTER TABLE staking_products ADD COLUMN payout_coin TEXT DEFAULT 'QTA';

INSERT INTO staking_products
  (id, coin_symbol, kind, apr, lock_days, min_amount, max_amount,
   min_usd, max_usd, term_days, daily_rate, payout_coin,
   sort_order, is_active)
VALUES
  ('tier_1k_180',  'USDT', 'fixed', 0.36, 180, 1000, 1900,  1000,  1900,  180, 0.002, 'QTA', 1, 1),
  ('tier_1k_360',  'USDT', 'fixed', 0.72, 360, 1000, 1900,  1000,  1900,  360, 0.002, 'QTA', 2, 1),
  ('tier_2k_360',  'USDT', 'fixed', 1.08, 360, 2000, 4900,  2000,  4900,  360, 0.003, 'QTA', 3, 1),
  ('tier_5k_180',  'USDT', 'fixed', 0.54, 180, 5000, 10000, 5000,  10000, 180, 0.003, 'QTA', 4, 1),
  ('tier_5k_360',  'USDT', 'fixed', 1.80, 360, 5000, 10000, 5000,  10000, 360, 0.005, 'QTA', 5, 1);

-- Extend staking_positions for the USD/QTA-dividend model.
ALTER TABLE staking_positions ADD COLUMN principal_usd REAL DEFAULT 0;
ALTER TABLE staking_positions ADD COLUMN daily_rate REAL DEFAULT 0;
ALTER TABLE staking_positions ADD COLUMN term_days INTEGER DEFAULT 0;
ALTER TABLE staking_positions ADD COLUMN accrued_dividend_usd REAL DEFAULT 0; -- USD value accrued
ALTER TABLE staking_positions ADD COLUMN paid_dividend_qta REAL DEFAULT 0;    -- QTA already credited
ALTER TABLE staking_positions ADD COLUMN payout_coin TEXT DEFAULT 'QTA';
ALTER TABLE staking_positions ADD COLUMN lock_end_at TEXT;                    -- min 90d hard lock
ALTER TABLE staking_positions ADD COLUMN term_end_at TEXT;                    -- full term end

-- Ledger of dividend payouts + referral match bonuses (audit trail).
CREATE TABLE IF NOT EXISTS staking_dividends (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'dividend',   -- 'dividend' | 'match_l1' | 'match_l2'
  usd_amount REAL NOT NULL DEFAULT 0,
  qta_amount REAL NOT NULL DEFAULT 0,
  qta_price REAL NOT NULL DEFAULT 0,
  source_user_id TEXT,                      -- for match bonuses: the downline staker
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staking_dividends_user
  ON staking_dividends (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staking_dividends_pos
  ON staking_dividends (position_id);
