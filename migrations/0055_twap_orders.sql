-- ============================================================================
-- 0055 — Company-only TWAP (Time-Weighted Average Price) split-sell engine.
-- ----------------------------------------------------------------------------
-- Purpose: when the COMPANY (admin@quantaex.io) needs to liquidate a large
-- treasury position, dumping it as a single market order crashes the displayed
-- price (matchOrder does `UPDATE coins SET price_usd=<last trade>`). A TWAP
-- order lets the operator enter "total amount + duration" and the system
-- auto-slices it into many small child orders spread evenly over time, so the
-- price impact of each slice is tiny (급락 방지).
--
-- The cron worker ticks every 5 minutes: it finds active TWAP parents whose
-- next_run_at <= now, fires ONE slice (via the server's internal endpoint that
-- reuses the real matching engine), then advances next_run_at. When
-- remaining_amount hits ~0 the parent flips to 'completed'.
--
-- COMPANY-ONLY: the admin API guards creation to role='admin' /
-- admin@quantaex.io, and the company account is already exempt from the QTA
-- daily sell cap.
-- ============================================================================

CREATE TABLE IF NOT EXISTS twap_orders (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,               -- company account id
  market_symbol   TEXT NOT NULL,               -- e.g. 'QTA-USDT'
  side            TEXT NOT NULL DEFAULT 'sell', -- treasury sell only (future-proof)
  order_type      TEXT NOT NULL DEFAULT 'limit',-- 'limit' | 'market'
  limit_price     REAL,                         -- floor price for limit slices (nullable for market)
  total_amount    REAL NOT NULL,                -- total base qty to sell
  remaining_amount REAL NOT NULL,               -- qty still to be sold
  slice_count     INTEGER NOT NULL,             -- number of slices
  slice_amount    REAL NOT NULL,                -- qty per slice (total/count)
  slices_done     INTEGER NOT NULL DEFAULT 0,   -- how many slices executed
  interval_sec    INTEGER NOT NULL,             -- seconds between slices
  next_run_at     TEXT NOT NULL,                -- when the next slice is due (UTC)
  end_at          TEXT,                         -- planned finish time (informational)
  status          TEXT NOT NULL DEFAULT 'active', -- 'active'|'completed'|'cancelled'
  note            TEXT,                          -- optional operator memo
  last_error      TEXT,                          -- last slice error (if any)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_twap_active ON twap_orders(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_twap_user   ON twap_orders(user_id, created_at DESC);
