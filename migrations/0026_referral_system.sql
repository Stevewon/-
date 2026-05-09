-- ============================================================================
-- 0026_referral_system.sql
-- ----------------------------------------------------------------------------
-- Referral program — every user gets a unique referral_code on signup.
-- New users who enter someone else's code at registration get the standard
-- 1,000 QTA welcome bonus (unchanged), and the referrer who owns that code
-- receives 500 QTA credited DIRECTLY to `available` (no email-verify lock —
-- referrer is presumed already verified).
--
--   referrer_id  —> the existing user whose code was entered
--   referred_id  —> the new user that just signed up
--   reward_qta   —> amount given to the referrer (500 by default)
--   created_at   —> when the relationship was recorded
--
-- One referred user can have at most one referrer (UNIQUE referred_id).
-- ============================================================================

-- 1) Add referral_code column to users (8-char unique code per user)
ALTER TABLE users ADD COLUMN referral_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code
  ON users(referral_code) WHERE referral_code IS NOT NULL;

-- 2) Referral ledger
CREATE TABLE IF NOT EXISTS referrals (
  id              TEXT PRIMARY KEY,
  referrer_id     TEXT NOT NULL,
  referred_id     TEXT NOT NULL UNIQUE,
  referral_code   TEXT NOT NULL,
  reward_qta      REAL NOT NULL DEFAULT 500,
  reward_paid_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (referrer_id) REFERENCES users(id),
  FOREIGN KEY (referred_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id);
