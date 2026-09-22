-- 0061_kyc_dual_verification.sql (OWNER_RULES §13, 2026-09-22)
-- Telegram-style dual verification for KYC: 6-digit code to EMAIL and to SMS.
-- Auto-applied by cron-worker/src/migrate.ts and self-bootstrapped by
-- src/server/lib/kyc-verify.ts (ensureKycVerifySchema).
CREATE TABLE IF NOT EXISTS kyc_verifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  channel       TEXT NOT NULL,            -- email | sms
  target        TEXT NOT NULL,            -- email address or E.164 phone
  code_hash     TEXT NOT NULL,            -- sha256(user_id:channel:code)
  expires_at    TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  delivered     INTEGER NOT NULL DEFAULT 0,
  provider      TEXT,                     -- resend | twilio | dev
  provider_ref  TEXT,
  error         TEXT,
  used_at       TEXT,
  ip_address    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kyc_verif_user ON kyc_verifications(user_id, channel, created_at DESC);
ALTER TABLE users ADD COLUMN kyc_email_verified_at TEXT;
ALTER TABLE users ADD COLUMN kyc_phone_verified_at TEXT;
ALTER TABLE users ADD COLUMN kyc_phone_e164 TEXT;
