-- Sprint 4 Phase A — Globalization
--
-- QuantaEX is repositioning as a global, USD‑denominated exchange.
-- This migration:
--   1. Removes all KRW markets and KRW wallet rows
--   2. Adds USDC as a first‑class quote/asset alongside USDT
--   3. Seeds USDC markets for the major pairs
--   4. Cancels any open orders that reference a KRW market (safety)
--
-- It is intentionally idempotent — running twice is safe.

-- 1. Cancel any still‑open orders against KRW markets so we don't strand
--    user funds when the markets disappear.
UPDATE orders
   SET status = 'cancelled'
 WHERE status IN ('open', 'pending')
   AND market_id IN (SELECT id FROM markets WHERE quote_coin = 'KRW');

-- 2. Drop KRW markets entirely.
DELETE FROM markets WHERE quote_coin = 'KRW';

-- 3. Drop KRW wallet rows. Balances were synthetic seed data only — no
--    real fiat ever touched the platform.
DELETE FROM wallets WHERE coin_symbol = 'KRW';

-- 4. Drop the KRW coin entry.
DELETE FROM coins WHERE symbol = 'KRW';

-- 5. Add USDC as a coin (idempotent).
INSERT OR IGNORE INTO coins (id, symbol, name, icon, price_usd, sort_order)
VALUES ('c-usdc', 'USDC', 'USD Coin', 'usdc', 1.00, 12);

-- 6. Seed USDC markets mirroring the existing USDT pairs.
INSERT OR IGNORE INTO markets (id, base_coin, quote_coin, price_decimals, amount_decimals) VALUES
  ('m-btc-usdc',  'BTC',  'USDC', 2, 6),
  ('m-eth-usdc',  'ETH',  'USDC', 2, 6),
  ('m-bnb-usdc',  'BNB',  'USDC', 2, 6),
  ('m-sol-usdc',  'SOL',  'USDC', 2, 6),
  ('m-xrp-usdc',  'XRP',  'USDC', 4, 6),
  ('m-ada-usdc',  'ADA',  'USDC', 4, 6),
  ('m-doge-usdc', 'DOGE', 'USDC', 6, 6),
  ('m-dot-usdc',  'DOT',  'USDC', 4, 6),
  ('m-avax-usdc', 'AVAX', 'USDC', 2, 6),
  ('m-matic-usdc','MATIC','USDC', 4, 6),
  ('m-qta-usdc',  'QTA',  'USDC', 6, 6);

-- 7. Give existing users an empty USDC wallet row so the UI doesn't
--    have to special‑case missing assets. Skip if one already exists.
INSERT OR IGNORE INTO wallets (id, user_id, coin_symbol, available, locked)
SELECT
  'w-' || u.id || '-usdc' AS id,
  u.id                    AS user_id,
  'USDC'                  AS coin_symbol,
  0                       AS available,
  0                       AS locked
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM wallets w
   WHERE w.user_id = u.id AND w.coin_symbol = 'USDC'
);
