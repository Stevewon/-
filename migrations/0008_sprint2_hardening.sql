-- Sprint 2: exchange hardening — rate limiting, session revocation, withdraw whitelist

-- ============================================================================
-- ONE-OFF (2026-08): purge the ENTIRE referral downline under nickname
-- 'sally1992' (all levels), freeing their nickname+email for re-registration.
-- Placed at the very TOP of this file on purpose: the deploy workflow runs
-- this file via `wrangler d1 execute --remote --file=...`, and the ALTER
-- statements below fail with "duplicate column" on every re-run (harmless,
-- workflow uses continue-on-error). By running the purge FIRST, it completes
-- before any such error can halt statement execution.
--   * sally1992 herself is NEVER deleted (root excluded).
--   * upline / unrelated users untouched.
--   * hard-deletes target rows across every user_id table + referrals + users.
-- Idempotent: staging table dropped+rebuilt; re-runs affect 0 rows once gone.
-- ============================================================================
DROP TABLE IF EXISTS _purge_targets;
CREATE TABLE _purge_targets AS
WITH RECURSIVE root(id) AS (
  SELECT id FROM users WHERE nickname = 'sally1992'
),
downline(id) AS (
  SELECT r.referred_id FROM referrals r JOIN root ON r.referrer_id = root.id
  UNION
  SELECT r.referred_id FROM referrals r JOIN downline d ON r.referrer_id = d.id
)
SELECT DISTINCT id FROM downline
WHERE id IS NOT NULL
  AND id NOT IN (SELECT id FROM users WHERE nickname = 'sally1992');

DELETE FROM api_keys           WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM bridge_transfers   WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM deposits           WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM email_verifications WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM fee_ledger         WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM futures_positions  WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM kyc_documents      WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM liquidations       WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM login_history      WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM login_otps         WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM margin_accounts    WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM margin_loans       WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM notifications      WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM orders             WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM password_resets    WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM price_alerts       WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM qta_addresses      WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM qta_deposits       WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM qta_hd_indexes     WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM qta_withdrawals    WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM staking_dividends  WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM staking_positions  WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM user_consents      WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM user_meta          WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM user_sessions      WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM wallets            WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM withdraw_whitelist WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM withdrawals        WHERE user_id IN (SELECT id FROM _purge_targets);
DELETE FROM referrals WHERE referred_id IN (SELECT id FROM _purge_targets);
DELETE FROM referrals WHERE referrer_id IN (SELECT id FROM _purge_targets);
DELETE FROM users WHERE id IN (SELECT id FROM _purge_targets);
DROP TABLE IF EXISTS _purge_targets;

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
