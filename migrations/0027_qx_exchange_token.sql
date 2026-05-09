-- ============================================================================
-- 0027_qx_exchange_token.sql
-- QX = QuantaEX exchange-only token (issued on Quantarium mainnet, but
-- circulates exclusively on the QuantaEX exchange).
-- Distinct from QTA (Quantarium L1 mainnet coin).
-- ----------------------------------------------------------------------------
-- 1) Insert QX coin row
-- 2) Insert QX/USDT and QX/USDC market pairs (exchange listings)
-- 3) Backfill QX wallet (0/0) for every existing user so the new pair shows
--    up in their portfolio immediately.
-- ============================================================================

INSERT OR IGNORE INTO coins (
  id, symbol, name, icon, decimals, price_usd, change_24h,
  volume_24h, high_24h, low_24h, market_cap, is_active, sort_order
) VALUES (
  'c-qx',
  'QX',
  'QuantaEX Token',
  NULL,
  8,
  0.01,        -- starting USD reference price
  0,
  0,
  0.01,
  0.01,
  0,
  1,
  11           -- right after QTA (sort_order 10)
);

INSERT OR IGNORE INTO markets (
  id, base_coin, quote_coin,
  min_order_amount, min_order_total,
  price_decimals, amount_decimals,
  maker_fee, taker_fee, is_active
) VALUES
  ('m-qx-usdt', 'QX', 'USDT', 0.0001, 1, 6, 6, 0.001, 0.001, 1),
  ('m-qx-usdc', 'QX', 'USDC', 0.0001, 1, 6, 6, 0.001, 0.001, 1);

-- Backfill QX wallet for every existing user (0/0). Uses random hex id
-- via lower(hex(randomblob(16))) so D1 doesn't need an extension.
INSERT OR IGNORE INTO wallets (id, user_id, coin_symbol, available, locked)
SELECT
  lower(hex(randomblob(16))),
  u.id,
  'QX',
  0,
  0
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM wallets w
  WHERE w.user_id = u.id AND w.coin_symbol = 'QX'
);
