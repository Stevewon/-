-- ---------------------------------------------------------------------------
-- 0043_staking.sql — Earn / Staking feature (flexible + fixed products)
--
-- staking_products : catalog of earn products (admin-curated). APR is stored
--   as a fraction (0.12 = 12%). lock_days = 0 means Flexible (redeem anytime).
-- staking_positions: a user's active or closed subscription to a product.
--   principal is held out of the wallet (moved to locked accounting via a
--   dedicated 'staked' bucket tracked here, NOT in wallets.locked, to keep
--   trading/withdraw locks separate). accrued_interest grows daily.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staking_products (
  id TEXT PRIMARY KEY,
  coin_symbol TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'flexible',      -- 'flexible' | 'fixed'
  apr REAL NOT NULL DEFAULT 0,                 -- fraction, e.g. 0.12 = 12%
  lock_days INTEGER NOT NULL DEFAULT 0,        -- 0 = flexible
  min_amount REAL NOT NULL DEFAULT 0,
  max_amount REAL,                             -- null = no cap
  total_cap REAL,                              -- null = unlimited pool
  total_staked REAL NOT NULL DEFAULT 0,        -- running sum of active principal
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_staking_products_active
  ON staking_products (is_active, sort_order);

CREATE TABLE IF NOT EXISTS staking_positions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  coin_symbol TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'flexible',
  apr REAL NOT NULL DEFAULT 0,
  principal REAL NOT NULL DEFAULT 0,
  accrued_interest REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',        -- 'active' | 'redeemed'
  lock_days INTEGER NOT NULL DEFAULT 0,
  unlock_at TEXT,                                -- for fixed products
  last_accrued_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  redeemed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_staking_positions_user
  ON staking_positions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_staking_positions_product
  ON staking_positions (product_id, status);

-- ---------------------------------------------------------------------------
-- Seed products. QTA / QX get the headline rates (this is the QTA staking
-- product the boss wants). Others are marketing/display products.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO staking_products
  (id, coin_symbol, kind, apr, lock_days, min_amount, max_amount, sort_order, is_active)
VALUES
  ('stk_qta_flex',  'QTA',  'flexible', 0.1500, 0,  1,     NULL, 1,  1),
  ('stk_qta_30',    'QTA',  'fixed',    0.2200, 30, 10,    NULL, 2,  1),
  ('stk_qta_90',    'QTA',  'fixed',    0.3000, 90, 10,    NULL, 3,  1),
  ('stk_qx_flex',   'QX',   'flexible', 0.1200, 0,  1,     NULL, 4,  1),
  ('stk_usdt_flex', 'USDT', 'flexible', 0.0682, 0,  1,     NULL, 5,  1),
  ('stk_usdt_30',   'USDT', 'fixed',    0.0900, 30, 10,    NULL, 6,  1),
  ('stk_btc_flex',  'BTC',  'flexible', 0.0120, 0,  0.001, NULL, 7,  1),
  ('stk_eth_flex',  'ETH',  'flexible', 0.0235, 0,  0.01,  NULL, 8,  1);
