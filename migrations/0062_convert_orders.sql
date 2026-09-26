-- ============================================================================
-- 0062_convert_orders.sql  (2026-09-26)  — OWNER_RULES §14  Bybit-style Convert
-- ============================================================================
-- Owner: "바이빗처럼 우리도 데일리로 얻은 QTA를 바로 USDT로 스왑할 수 있게"
--
-- Convert = off-book OTC swap against the company treasury. Just like Bybit
-- Convert it does NOT go through the spot order book, does NOT create a row in
-- `trades`, and therefore does NOT paint a candle / print on the tape.
-- Price = live QTA/USDT reference (best company bid) with a small spread.
--
-- It still counts against the member's KRW 50,000 / day company buy-back cap
-- (shared with spot sells — see src/shared/sell-cap.ts) and honours §12
-- sell pre-approval (approved OR shareholder only).
--
-- Life-cycle: quoted → filled | expired | cancelled | failed
--   quoted   : quote issued, funds NOT yet locked, valid quote_ttl seconds
--   filled   : member accepted in time; QTA debited, USDT credited, QTA moved
--              to the company treasury (admin) wallet
-- ============================================================================
CREATE TABLE IF NOT EXISTS convert_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  from_coin TEXT NOT NULL,
  to_coin TEXT NOT NULL,
  from_amount REAL NOT NULL,
  to_amount REAL NOT NULL,
  price REAL NOT NULL,                 -- to_coin per 1 from_coin (USDT per QTA)
  ref_price REAL,                      -- market reference at quote time
  spread_bps INTEGER NOT NULL DEFAULT 0,
  fee_amount REAL NOT NULL DEFAULT 0,  -- always 0 (Bybit Convert = zero fee)
  status TEXT NOT NULL DEFAULT 'quoted',
  quote_expires_at TEXT NOT NULL,
  filled_at TEXT,
  treasury_user_id TEXT,
  source TEXT NOT NULL DEFAULT 'convert',
  error TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_convert_user_status ON convert_orders(user_id, status, filled_at);
CREATE INDEX IF NOT EXISTS idx_convert_created ON convert_orders(created_at DESC);

-- Feature switch (admin can pause Convert without a deploy)
INSERT OR IGNORE INTO system_state (key, value) VALUES ('convert_enabled', 'on');
-- Spread in basis points applied under the reference price (Bybit: MM quote ≠ spot)
INSERT OR IGNORE INTO system_state (key, value) VALUES ('convert_spread_bps', '30');
