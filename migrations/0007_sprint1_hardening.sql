-- Sprint 1: Exchange hardening (2FA, email verification, password reset, audit log)
-- Apply with:
--   npx wrangler d1 execute quantaex-db --remote --file=./migrations/0007_sprint1_hardening.sql

-- 2FA pending secret (holds secret between /2fa/setup and /2fa/enable)
ALTER TABLE users ADD COLUMN two_factor_pending_secret TEXT;

-- Email verification state
ALTER TABLE users ADD COLUMN email_verified_at DATETIME;

-- Email verification tokens (also used for resend)
CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,          -- SHA-256 hex of the raw token
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_hash ON email_verifications(token_hash);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,          -- SHA-256 hex of the raw token
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_hash ON password_resets(token_hash);

-- Admin audit log (used by /api/wallet/admin-credit and future admin actions)
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  payload TEXT,                      -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_logs(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_logs(target_type, target_id);

-- user_meta table (for referral codes and misc key-value user data)
CREATE TABLE IF NOT EXISTS user_meta (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, key)
);
