-- Sprint 2: exchange hardening — rate limiting, session revocation, withdraw whitelist

-- Token version for JWT revocation on password change / 2FA events.
ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0;

-- Rate-limit fixed-window counter
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,           -- e.g. 'auth:login:1.2.3.4'
  window_start INTEGER NOT NULL,     -- epoch seconds of window start
  count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- Withdrawal address whitelist
CREATE TABLE IF NOT EXISTS withdraw_whitelist (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  coin_symbol TEXT NOT NULL,
  network TEXT,
  memo TEXT,
  address TEXT NOT NULL,
  label TEXT,
  is_active INTEGER DEFAULT 1,
  cooldown_until DATETIME,           -- NULL or past = usable
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_withdraw_whitelist_user ON withdraw_whitelist(user_id, coin_symbol);
