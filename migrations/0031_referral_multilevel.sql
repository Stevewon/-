-- ============================================================================
-- 0031_referral_multilevel.sql
-- ----------------------------------------------------------------------------
-- Extend the referral program from 1 level (L1: direct referrer only) to
-- 3 levels:
--   L1 — the person whose referral_code the new user entered  → +50 QX
--   L2 — that person's own referrer (their L1)                → +30 QX
--   L3 — that L2's own referrer                               → +20 QX
--
-- A new column `level INTEGER NOT NULL DEFAULT 1` is added to `referrals`,
-- and the old `referred_id UNIQUE` column constraint is replaced by a
-- composite `UNIQUE(referred_id, level)` so a single new signup can record
-- up to 3 rows (one per upline level) without colliding.
--
-- All existing rows are L1, so backfill is just `level = 1`.
--
-- SQLite cannot drop a column-level UNIQUE via ALTER, so we rebuild the
-- table:
--   1) ALTER TABLE referrals RENAME TO referrals_old
--   2) CREATE TABLE referrals  (new shape)
--   3) INSERT INTO referrals SELECT ..., 1 AS level FROM referrals_old
--   4) DROP TABLE referrals_old
--   5) Recreate indexes
--
-- This migration is idempotent: it skips the rebuild if `level` already
-- exists, and the self-bootstrap in src/server/index.ts gates the whole
-- thing on a system_markers row.
--
-- Reward amounts are also recorded in system_markers so admin UIs can
-- read them without redeploying:
--   referral_reward_l1 = 50
--   referral_reward_l2 = 30
--   referral_reward_l3 = 20
-- ============================================================================

-- 1) Mark policy switch in system_markers
INSERT INTO system_markers (key, value, updated_at)
VALUES ('referral_reward_l1','50',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;

INSERT INTO system_markers (key, value, updated_at)
VALUES ('referral_reward_l2','30',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;

INSERT INTO system_markers (key, value, updated_at)
VALUES ('referral_reward_l3','20',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;

INSERT INTO system_markers (key, value, updated_at)
VALUES ('referral_levels','3',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;

-- 2) Rebuild referrals with composite UNIQUE(referred_id, level).
-- The runtime self-bootstrap (see src/server/index.ts) checks PRAGMA
-- table_info first and only runs the rebuild if `level` column is missing,
-- so this raw SQL file is for fresh-DB bootstrapping (D1 wrangler migrations).
ALTER TABLE referrals RENAME TO referrals_old;

CREATE TABLE referrals (
  id              TEXT PRIMARY KEY,
  referrer_id     TEXT NOT NULL,
  referred_id     TEXT NOT NULL,
  referral_code   TEXT NOT NULL,
  reward_qta      REAL NOT NULL DEFAULT 50,
  reward_paid_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  rewarded_in_qx  INTEGER NOT NULL DEFAULT 1,
  level           INTEGER NOT NULL DEFAULT 1,
  UNIQUE(referred_id, level),
  FOREIGN KEY (referrer_id) REFERENCES users(id),
  FOREIGN KEY (referred_id) REFERENCES users(id)
);

INSERT INTO referrals (
  id, referrer_id, referred_id, referral_code, reward_qta,
  reward_paid_at, created_at, rewarded_in_qx, level
)
SELECT
  id, referrer_id, referred_id, referral_code, reward_qta,
  reward_paid_at, created_at, rewarded_in_qx, 1
FROM referrals_old;

DROP TABLE referrals_old;

CREATE INDEX IF NOT EXISTS idx_referrals_referrer
  ON referrals(referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_referred
  ON referrals(referred_id);
CREATE INDEX IF NOT EXISTS idx_referrals_level
  ON referrals(referrer_id, level, created_at DESC);

-- 3) Mark migration done (used by self-bootstrap)
INSERT INTO system_markers (key, value, updated_at)
VALUES ('migration_0031_referral_multilevel','live',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;
