-- ============================================================================
-- Sprint 4 Phase H1: Futures + Margin Trading
-- ----------------------------------------------------------------------------
-- Adds tables for:
--   * Perpetual futures contracts (BTC-PERP, ETH-PERP, QTA-PERP, ...)
--   * User futures positions (long/short, leverage, isolated/cross margin)
--   * Funding rate history (paid every 8h)
--   * Margin accounts (per-user, per-asset borrowed balances)
--   * Margin loans (individual borrow records)
--   * Liquidations (futures + margin combined ledger)
--
-- Stub-first design (consistent with Phase B/G):
--   - DB-only state machine here; mark price feed + auto-liquidator land in
--     a follow-up cron-worker driver (Phase H1+).
--   - Risk integration: hooks into Phase F system_markers
--     (futures_paused, margin_paused, liquidation_engine_enabled).
--
-- Position state flow (futures):
--   open -> closed (user-initiated) | liquidated (engine-initiated)
--
-- Margin account state flow:
--   active -> margin_call (level < 1.2) -> liquidating (level < 1.0) -> active
-- ============================================================================

-- ----------------------------------------------------------------------------
-- futures_contracts : market definitions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS futures_contracts (
  symbol                  TEXT PRIMARY KEY,             -- BTC-PERP, ETH-PERP
  base_asset              TEXT NOT NULL,                -- BTC, ETH, QTA
  quote_asset             TEXT NOT NULL DEFAULT 'USDT', -- settlement asset
  contract_size           TEXT NOT NULL DEFAULT '1',    -- string-decimal
  tick_size               TEXT NOT NULL DEFAULT '0.01',
  max_leverage            INTEGER NOT NULL DEFAULT 100, -- 1..100x
  maintenance_margin_bps  INTEGER NOT NULL DEFAULT 50,  -- 0.50%
  initial_margin_bps      INTEGER NOT NULL DEFAULT 100, -- 1.00%
  funding_interval_sec    INTEGER NOT NULL DEFAULT 28800, -- 8h
  taker_fee_bps           INTEGER NOT NULL DEFAULT 6,
  maker_fee_bps           INTEGER NOT NULL DEFAULT 2,
  is_active               INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_futures_contracts_active
  ON futures_contracts(is_active);

-- ----------------------------------------------------------------------------
-- futures_positions : per-user open positions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS futures_positions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  symbol              TEXT NOT NULL,
  side                TEXT NOT NULL CHECK(side IN ('long','short')),
  size                TEXT NOT NULL,                -- string-decimal contracts
  entry_price         TEXT NOT NULL,
  mark_price          TEXT NOT NULL DEFAULT '0',
  leverage            INTEGER NOT NULL DEFAULT 1,
  margin_mode         TEXT NOT NULL DEFAULT 'cross'
                        CHECK(margin_mode IN ('cross','isolated')),
  isolated_margin     TEXT NOT NULL DEFAULT '0',    -- only used when isolated
  unrealized_pnl      TEXT NOT NULL DEFAULT '0',
  realized_pnl        TEXT NOT NULL DEFAULT '0',
  liquidation_price   TEXT,                          -- nullable until first calc
  status              TEXT NOT NULL DEFAULT 'open'
                        CHECK(status IN ('open','closed','liquidated')),
  opened_at           TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at           TEXT,
  closed_price        TEXT,
  closed_reason       TEXT  -- 'user' | 'liquidation' | 'admin'
);

CREATE INDEX IF NOT EXISTS idx_futures_positions_user
  ON futures_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_futures_positions_symbol_status
  ON futures_positions(symbol, status);
CREATE INDEX IF NOT EXISTS idx_futures_positions_status
  ON futures_positions(status);
CREATE INDEX IF NOT EXISTS idx_futures_positions_user_status
  ON futures_positions(user_id, status);

-- ----------------------------------------------------------------------------
-- futures_funding_rates : 8-hour funding ledger
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS futures_funding_rates (
  id              TEXT PRIMARY KEY,
  symbol          TEXT NOT NULL,
  funding_rate    TEXT NOT NULL,         -- string-decimal e.g. '0.0001' = 0.01%
  mark_price      TEXT NOT NULL,
  index_price     TEXT NOT NULL,
  paid_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_futures_funding_symbol_time
  ON futures_funding_rates(symbol, paid_at DESC);

-- ----------------------------------------------------------------------------
-- margin_accounts : aggregated per-user, per-asset balances
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS margin_accounts (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  asset               TEXT NOT NULL,
  balance             TEXT NOT NULL DEFAULT '0',
  borrowed            TEXT NOT NULL DEFAULT '0',
  interest_accrued    TEXT NOT NULL DEFAULT '0',
  margin_level        TEXT NOT NULL DEFAULT '0',     -- equity / debt
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active','margin_call','liquidating')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, asset)
);

CREATE INDEX IF NOT EXISTS idx_margin_accounts_user
  ON margin_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_margin_accounts_status
  ON margin_accounts(status);

-- ----------------------------------------------------------------------------
-- margin_loans : individual borrow records
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS margin_loans (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  asset               TEXT NOT NULL,
  principal           TEXT NOT NULL,
  interest_rate_bps   INTEGER NOT NULL DEFAULT 10,   -- 0.10% / day default
  accrued_interest    TEXT NOT NULL DEFAULT '0',
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active','repaid','liquidated')),
  borrowed_at         TEXT NOT NULL DEFAULT (datetime('now')),
  repaid_at           TEXT,
  liquidated_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_margin_loans_user_status
  ON margin_loans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_margin_loans_status
  ON margin_loans(status);

-- ----------------------------------------------------------------------------
-- liquidations : combined ledger (futures + margin)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS liquidations (
  id                            TEXT PRIMARY KEY,
  user_id                       TEXT NOT NULL,
  type                          TEXT NOT NULL CHECK(type IN ('futures','margin')),
  position_id                   TEXT,    -- futures_positions.id when futures
  account_id                    TEXT,    -- margin_accounts.id when margin
  symbol                        TEXT,    -- contract symbol or asset code
  side                          TEXT,    -- long/short for futures
  size                          TEXT NOT NULL,
  liquidation_price             TEXT NOT NULL,
  fee                           TEXT NOT NULL DEFAULT '0',
  insurance_fund_contribution   TEXT NOT NULL DEFAULT '0',
  reason                        TEXT,    -- 'maintenance_margin' | 'margin_call' | 'admin'
  liquidated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_liquidations_user_time
  ON liquidations(user_id, liquidated_at DESC);
CREATE INDEX IF NOT EXISTS idx_liquidations_type_time
  ON liquidations(type, liquidated_at DESC);

-- ----------------------------------------------------------------------------
-- Seed: 3 perpetual contracts (BTC, ETH, QTA)
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO futures_contracts
  (symbol, base_asset, quote_asset, max_leverage, maintenance_margin_bps, initial_margin_bps)
VALUES
  ('BTC-PERP', 'BTC', 'USDT', 100, 50, 100),
  ('ETH-PERP', 'ETH', 'USDT', 100, 50, 100),
  ('QTA-PERP', 'QTA', 'USDT', 50,  100, 200);

-- ----------------------------------------------------------------------------
-- Seed: Phase F-style risk markers
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO system_markers (key, value, updated_at) VALUES
  ('futures_paused',              'off',                        datetime('now')),
  ('margin_paused',                'off',                        datetime('now')),
  ('liquidation_engine_enabled',   'on',                         datetime('now')),
  ('futures_integration',          'phase-h1-stub',              datetime('now')),
  ('margin_integration',           'phase-h1-stub',              datetime('now'));
