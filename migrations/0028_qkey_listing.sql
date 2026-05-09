-- ============================================================================
-- 0028_qkey_listing.sql
-- QKEY ("Cookie") — new listing.
-- Same Quantarium L1 mainnet as QTA / QX (post-quantum, CRYSTALS-Dilithium3).
-- QKEY shares the QTA chain infrastructure (addresses, hot wallet, confs).
-- ----------------------------------------------------------------------------
-- 1) Insert QKEY coin row
-- 2) Insert QKEY/USDT and QKEY/USDC market pairs
-- 3) Backfill QKEY wallet (0/0) for every existing user so the new pair
--    shows up in their portfolio immediately.
-- 4) Mark in system_markers that QKEY rides the QTA mainnet.
-- ============================================================================

INSERT OR IGNORE INTO coins (
  id, symbol, name, icon, decimals, price_usd, change_24h,
  volume_24h, high_24h, low_24h, market_cap, is_active, sort_order
) VALUES (
  'c-qkey',
  'QKEY',
  'Cookie',
  NULL,
  8,
  0.01,        -- starting USD reference price
  0,
  0,
  0.01,
  0.01,
  0,
  1,
  12           -- right after QX (sort_order 11)
);

INSERT OR IGNORE INTO markets (
  id, base_coin, quote_coin,
  min_order_amount, min_order_total,
  price_decimals, amount_decimals,
  maker_fee, taker_fee, is_active
) VALUES
  ('m-qkey-usdt', 'QKEY', 'USDT', 0.0001, 1, 6, 6, 0.001, 0.001, 1),
  ('m-qkey-usdc', 'QKEY', 'USDC', 0.0001, 1, 6, 6, 0.001, 0.001, 1);

-- Backfill QKEY wallet for every existing user (0/0). Uses random hex id
-- via lower(hex(randomblob(16))) so D1 doesn't need an extension.
INSERT OR IGNORE INTO wallets (id, user_id, coin_symbol, available, locked)
SELECT
  lower(hex(randomblob(16))),
  u.id,
  'QKEY',
  0,
  0
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM wallets w
  WHERE w.user_id = u.id AND w.coin_symbol = 'QKEY'
);

-- QKEY shares the same Quantarium L1 mainnet as QTA / QX.
INSERT OR IGNORE INTO system_markers (key, value, updated_at) VALUES
  ('qkey_listing',     'live',         CURRENT_TIMESTAMP),
  ('qkey_chain',       'qta-mainnet',  CURRENT_TIMESTAMP);
