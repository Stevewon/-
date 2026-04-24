-- Sprint 3 — S3-5 Fee Tiers + fee_ledger
-- -----------------------------------------------------------------------------
-- Introduces VIP-style tiered trading fees based on the user's 30-day USD
-- trading volume. Each executed trade writes a row into fee_ledger capturing
-- the exact fee paid, its USD equivalent and the tier the user was in at
-- trade time. This lets us:
--   • Answer "what did I pay in fees?" in <50 ms for accounting.
--   • Produce regulatory / tax exports later without re-deriving from trades.
--   • Show real-time fee-tier badges on the UI.

-- 1. Tier definitions -----------------------------------------------------------
-- Market-standard "VIP 0-5" ladder with declining maker/taker fees.
-- Numbers are conservative defaults (similar to Binance Tier 0-5 Retail).
CREATE TABLE IF NOT EXISTS fee_tiers (
  tier           INTEGER PRIMARY KEY,   -- 0..N (VIP level)
  name           TEXT    NOT NULL,      -- 'VIP 0', 'VIP 1', ...
  min_volume_usd REAL    NOT NULL,      -- inclusive lower bound, 30-day USD
  maker_fee      REAL    NOT NULL,      -- e.g. 0.001  = 0.10 %
  taker_fee      REAL    NOT NULL,
  created_at     TEXT    DEFAULT (datetime('now'))
);

-- Seed default tiers. These can be tuned by admins later; the matching
-- engine always reads from the table, never hardcoded constants.
INSERT OR IGNORE INTO fee_tiers (tier, name, min_volume_usd, maker_fee, taker_fee) VALUES
  (0, 'VIP 0',            0, 0.0010, 0.0010),
  (1, 'VIP 1',       50000, 0.0009, 0.0009),
  (2, 'VIP 2',      250000, 0.0008, 0.0008),
  (3, 'VIP 3',     1000000, 0.0007, 0.0008),
  (4, 'VIP 4',     5000000, 0.0006, 0.0007),
  (5, 'VIP 5',    20000000, 0.0005, 0.0006);

-- 2. Fee ledger ------------------------------------------------------------------
-- One row per (trade, side). Append-only.
CREATE TABLE IF NOT EXISTS fee_ledger (
  id             TEXT PRIMARY KEY,
  trade_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  role           TEXT NOT NULL,         -- 'maker' | 'taker'
  side           TEXT NOT NULL,         -- 'buy'   | 'sell'
  market_id      TEXT NOT NULL,
  fee_coin       TEXT NOT NULL,         -- coin in which the fee was charged
  fee_amount     REAL NOT NULL,         -- fee quantity in fee_coin
  fee_rate       REAL NOT NULL,         -- snapshot of the rate that was applied
  fee_usd        REAL,                  -- USD equivalent at trade time (best-effort)
  tier           INTEGER,               -- user's tier snapshot (fee_tiers.tier)
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fee_ledger_user    ON fee_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_fee_ledger_trade   ON fee_ledger(trade_id);
CREATE INDEX IF NOT EXISTS idx_fee_ledger_created ON fee_ledger(created_at DESC);

-- 3. Snapshot fee rates on each order so the cancel/refund path can reverse
--    the exact lock that was taken, even if the user's tier has changed
--    since placement. NULL for pre-migration rows is treated as the market
--    default in application code.
ALTER TABLE orders ADD COLUMN taker_fee_locked REAL;
ALTER TABLE orders ADD COLUMN maker_fee_locked REAL;
