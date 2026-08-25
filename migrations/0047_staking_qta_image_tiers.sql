-- ---------------------------------------------------------------------------
-- 0047_staking_qta_image_tiers.sql
--
-- Re-model QTA "ADVANCED EARN" staking to the owner-provided card design:
--   PLATINUM 1  $100 - $4,999   180d   0.2%/day  (36%)
--   PLATINUM 2  $100 - $4,999   360d   0.3%/day  (108%)
--   VIP 1       $5,000+         180d   0.3%/day  (54%)
--   VIP 2       $5,000+         360d   0.5%/day  (180%)
--
-- Staking is now denominated in QTA (the user stakes QTA they bought on the
-- exchange). Each tier still carries a USD target band; the number of QTA
-- required is computed at stake time from the LIVE QTA price:
--     required_qta = target_usd / qta_price_usd
-- So the QTA quantity floats with the market price, but the tier band and the
-- dividend math stay USD-denominated (principal_usd = qta_qty * price_at_stake).
--
-- Also sets the QTA reference price to 5 KRW (= $0.00357142857 at 1$=1400 KRW),
-- the launch price for the earn conversion.
--
-- NOTE: The runtime applier is cron-worker/src/migrate.ts (this .sql is the
-- source-of-truth mirror). Statements here are idempotent / re-runnable.
-- ---------------------------------------------------------------------------

-- 1) Track the QTA principal + the price it was staked at (per position).
ALTER TABLE staking_positions ADD COLUMN principal_qta REAL DEFAULT 0;
ALTER TABLE staking_positions ADD COLUMN qta_price_at_stake REAL DEFAULT 0;

-- 2) Set the launch QTA price = 5 KRW = $0.00357142857 (1 USD = 1400 KRW).
UPDATE coins SET price_usd = 0.00357142857 WHERE symbol = 'QTA';

-- 3) Reseed the 4 image tiers (idempotent: clear + insert).
--    tier: platinum $100-4999, vip $5000-1,000,000 (display "$5,000+").
DELETE FROM staking_products;

INSERT INTO staking_products
  (id, coin_symbol, kind, apr, lock_days, min_amount, max_amount,
   min_usd, max_usd, term_days, daily_rate, payout_coin, sort_order, is_active)
VALUES
  ('platinum_1', 'QTA', 'fixed', 0.36, 180,  100, 4999,  100,  4999,    180, 0.002, 'QTA', 1, 1),
  ('platinum_2', 'QTA', 'fixed', 1.08, 360,  100, 4999,  100,  4999,    360, 0.003, 'QTA', 2, 1),
  ('vip_1',      'QTA', 'fixed', 0.54, 180, 5000, 1000000, 5000, 1000000, 180, 0.003, 'QTA', 3, 1),
  ('vip_2',      'QTA', 'fixed', 1.80, 360, 5000, 1000000, 5000, 1000000, 360, 0.005, 'QTA', 4, 1);
