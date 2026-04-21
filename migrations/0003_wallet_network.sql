-- Add network & memo columns to deposits/withdrawals
-- SQLite doesn't support IF NOT EXISTS on ADD COLUMN, so wrap with safe fallback pattern.
-- If re-running, these will fail with "duplicate column" — that's acceptable for migrations.

ALTER TABLE deposits ADD COLUMN network TEXT;
ALTER TABLE deposits ADD COLUMN memo TEXT;
ALTER TABLE deposits ADD COLUMN from_address TEXT;

ALTER TABLE withdrawals ADD COLUMN network TEXT;
ALTER TABLE withdrawals ADD COLUMN memo TEXT;

-- Notifications table (for Phase A.3 - notification system)
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'order_filled', 'deposit', 'withdraw', 'system', etc.
  title TEXT NOT NULL,
  message TEXT,
  data TEXT,                    -- JSON payload
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- API Keys table (for Phase A.2 - API key management)
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  api_secret_hash TEXT NOT NULL,
  permissions TEXT DEFAULT 'read',  -- 'read', 'trade', 'withdraw' (comma separated)
  ip_whitelist TEXT,                -- comma separated
  is_active INTEGER DEFAULT 1,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, is_active);
