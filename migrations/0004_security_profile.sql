-- Profile & Security enhancements

-- Add 2FA columns to users
ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN kyc_address TEXT;
ALTER TABLE users ADD COLUMN kyc_id_document_url TEXT;
ALTER TABLE users ADD COLUMN kyc_address_document_url TEXT;
ALTER TABLE users ADD COLUMN kyc_submitted_at DATETIME;
ALTER TABLE users ADD COLUMN kyc_reviewed_at DATETIME;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- Login history (security audit trail)
CREATE TABLE IF NOT EXISTS login_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  device TEXT,
  location TEXT,
  status TEXT DEFAULT 'success', -- success | failed
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id, created_at DESC);

-- Active sessions / devices (optional lightweight tracking)
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_id TEXT UNIQUE NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  device TEXT,
  last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, last_active_at DESC);
