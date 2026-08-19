-- ---------------------------------------------------------------------------
-- 0045_staking_tier_seed.sql  (SEED DATA — fully re-runnable)
--
-- Seeds the 5 official staking tiers. This file is idempotent: it clears the
-- product table and re-inserts the exact tier set every time, so it is safe to
-- run on every deploy (and it does NOT depend on 0044's ADD COLUMNs having run
-- in the same pass — 0044 always runs first by filename order).
--
--   id             band            term        daily   total
--   tier_1k_180    $1,000-1,900    180d (6mo)  0.2%    36%
--   tier_1k_360    $1,000-1,900    360d (12mo) 0.2%    72%
--   tier_2k_360    $2,000-4,900    360d (12mo) 0.3%    108%
--   tier_5k_180    $5,000-10,000   180d (6mo)  0.3%    54%
--   tier_5k_360    $5,000-10,000   360d (12mo) 0.5%    180%
-- ---------------------------------------------------------------------------

DELETE FROM staking_products;

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
