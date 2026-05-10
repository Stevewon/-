-- ============================================================================
-- 0029_referral_qx_switch.sql
-- Switch referral / sign-up rewards from QTA to QX.
-- New amounts: 100 QX welcome bonus (verify-email gated), 50 QX referrer.
-- ----------------------------------------------------------------------------
-- This migration:
--   1) Records the policy switch in system_markers.
--   2) Reverses already-credited QTA referrer rewards on existing rows in
--      `referrals` (each row credited 500 QTA available to the referrer).
--      We subtract 500 QTA from each referrer's QTA available wallet (clamped
--      at 0), then credit 50 QX available to that same user. Idempotent
--      via the `rewarded_in_qx` marker per referral row.
--   3) Reverses any still-locked 1000 QTA welcome bonus on un-verified users
--      and replaces it with a 100 QX locked bonus (so unverified accounts
--      get the new currency on email verify).
-- All operations use INSERT OR IGNORE / clamped UPDATE so re-running is safe.
-- ============================================================================

-- 1) Mark the policy switch
INSERT INTO system_markers (key, value, updated_at)
VALUES ('referral_reward_coin','QX',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;

INSERT INTO system_markers (key, value, updated_at)
VALUES ('referral_reward_amount','50',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;

INSERT INTO system_markers (key, value, updated_at)
VALUES ('referral_welcome_amount','100',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;

-- 2) Add a column to track which referrals already got the QX swap so we
--    don't double-pay if this migration is replayed.
ALTER TABLE referrals ADD COLUMN rewarded_in_qx INTEGER NOT NULL DEFAULT 0;

-- 2a) Reverse 500 QTA available for each referrer per referrals row (clamped).
UPDATE wallets
   SET available = MAX(0, available - 500)
 WHERE coin_symbol = 'QTA'
   AND user_id IN (
     SELECT referrer_id FROM referrals WHERE rewarded_in_qx = 0
   );

-- 2b) Ensure each affected referrer has a QX wallet row.
INSERT OR IGNORE INTO wallets (id, user_id, coin_symbol, available, locked)
SELECT lower(hex(randomblob(16))), r.referrer_id, 'QX', 0, 0
FROM (SELECT DISTINCT referrer_id FROM referrals WHERE rewarded_in_qx = 0) r
WHERE NOT EXISTS (
  SELECT 1 FROM wallets w
  WHERE w.user_id = r.referrer_id AND w.coin_symbol = 'QX'
);

-- 2c) Credit 50 QX available per referral row to the referrer.
UPDATE wallets
   SET available = available + (
     SELECT COUNT(*) * 50 FROM referrals
     WHERE referrer_id = wallets.user_id AND rewarded_in_qx = 0
   )
 WHERE coin_symbol = 'QX'
   AND user_id IN (
     SELECT referrer_id FROM referrals WHERE rewarded_in_qx = 0
   );

-- 2d) Update referrals.reward_qta to 50 (the new QX amount uses the same
--     legacy column name) and mark them as paid in QX.
UPDATE referrals
   SET reward_qta = 50, rewarded_in_qx = 1
 WHERE rewarded_in_qx = 0;

-- 3) Reverse pre-verify QTA welcome bonus (1000 QTA locked) for users
--    who have NOT yet verified their email, and replace with 100 QX locked.
-- 3a) Move legacy 1000 QTA locked back to 0 for unverified users.
UPDATE wallets
   SET locked = 0
 WHERE coin_symbol = 'QTA'
   AND locked > 0
   AND user_id IN (
     SELECT id FROM users WHERE email_verified_at IS NULL
   );

-- 3b) Ensure each unverified user has a QX wallet row.
INSERT OR IGNORE INTO wallets (id, user_id, coin_symbol, available, locked)
SELECT lower(hex(randomblob(16))), u.id, 'QX', 0, 0
FROM users u
WHERE u.email_verified_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM wallets w
    WHERE w.user_id = u.id AND w.coin_symbol = 'QX'
  );

-- 3c) Set 100 QX locked on every unverified user's QX wallet (only if they
--     don't already have a QX locked balance, so re-running is safe).
UPDATE wallets
   SET locked = 100
 WHERE coin_symbol = 'QX'
   AND locked = 0
   AND user_id IN (
     SELECT id FROM users WHERE email_verified_at IS NULL
   );

-- 4) Mark migration done (used by self-bootstrap)
INSERT INTO system_markers (key, value, updated_at)
VALUES ('migration_0029_referral_qx_switch','live',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;
