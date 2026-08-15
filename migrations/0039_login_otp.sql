-- Sprint 6: Email OTP login (Bybit-style passwordless one-time code)
-- ----------------------------------------------------------------------------
-- Users can log in with a 6-digit code emailed to them instead of a password.
-- Codes are short-lived (10 min), single-use, and stored only as SHA-256
-- hashes (never plaintext) so a DB leak alone cannot be replayed.
--
-- NOTE: The deploy workflow only auto-applies 0007/0008. This table is also
-- created lazily at runtime via `CREATE TABLE IF NOT EXISTS` inside the
-- /login-otp/* endpoints, so this file is primarily for documentation and
-- manual application:
--   npx wrangler d1 execute quantaex-production --remote --file=./migrations/0039_login_otp.sql
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS login_otps (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,           -- SHA-256 hex of the 6-digit code
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  attempts INTEGER NOT NULL DEFAULT 0, -- wrong-code guesses (lock after 5)
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_otps_email ON login_otps(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_otps_hash ON login_otps(code_hash);
