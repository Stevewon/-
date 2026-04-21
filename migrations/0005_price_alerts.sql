-- Price alerts: trigger a notification when market price crosses a threshold.
-- Direction 'above': trigger when price >= target_price
-- Direction 'below': trigger when price <= target_price

CREATE TABLE IF NOT EXISTS price_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,              -- e.g. BTC, ETH
  quote_coin TEXT NOT NULL DEFAULT 'USDT',
  direction TEXT NOT NULL,           -- 'above' | 'below'
  target_price REAL NOT NULL,
  base_price REAL,                   -- price at time of creation (for reference)
  is_active INTEGER DEFAULT 1,       -- 1 = armed, 0 = triggered/disarmed
  triggered_at DATETIME,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user   ON price_alerts(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(is_active, symbol);
