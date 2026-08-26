-- ============================================================================
-- 0048_binary_matching_bonus.sql
-- ----------------------------------------------------------------------------
-- Binary (left/right) matching-bonus program.
--
-- Policy (owner, 2026-08-26):
--   • Every user has a binary tree position under their sponsor (the person
--     whose referral_code they used). New members are AUTO-PLACED into the
--     sponsor's SMALLER leg (balanced binary spillover is not used — direct
--     children only sit on the sponsor's two legs; deeper members roll their
--     VOLUME up the ancestry).
--   • DEPOSIT amount (USD value at credit time) is the matching volume. When a
--     member deposits, that USD rolls up EVERY binary ancestor's correct leg
--     (left or right, decided by which side of the ancestor the member sits).
--   • Matching pays on min(left, right) accumulated volume, in $100 units, at
--     the tiered rate:
--        $100–$999      2%
--        $1,000–$4,999  3%
--        $5,000–$9,999  4%
--        $10,000–$49,999 5%
--        $50,000–$99,999 6%
--        $100,000+      7%
--   • Matched volume is carried over (never double-paid). Bonus is paid in QTA
--     at the live QTA price.
--   • Users can view their matching-bonus history separately.
-- ============================================================================

-- 1) Binary tree position on users.
--    binary_parent_id : the ancestor whose leg this user occupies (their sponsor)
--    binary_leg       : 'L' or 'R' — which leg of the parent this user sits on
ALTER TABLE users ADD COLUMN binary_parent_id TEXT;
ALTER TABLE users ADD COLUMN binary_leg TEXT;   -- 'L' | 'R'

CREATE INDEX IF NOT EXISTS idx_users_binary_parent ON users(binary_parent_id);

-- 2) Per-user accumulated binary volume + carry-over state.
--    left_usd / right_usd  : lifetime accumulated deposit USD on each leg.
--    matched_usd           : lifetime volume already matched & paid (carry base).
--    (left_usd - matched_usd) and (right_usd - matched_usd) are the UNMATCHED
--    balances available for the next match cycle.
CREATE TABLE IF NOT EXISTS binary_volume (
  user_id      TEXT PRIMARY KEY,
  left_usd     REAL NOT NULL DEFAULT 0,
  right_usd    REAL NOT NULL DEFAULT 0,
  matched_usd  REAL NOT NULL DEFAULT 0,
  updated_at   TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 3) Matching-bonus payout ledger (what the user sees).
CREATE TABLE IF NOT EXISTS binary_match_bonuses (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  matched_usd   REAL NOT NULL,           -- newly matched USD this event ($100 multiple)
  rate          REAL NOT NULL,           -- bonus rate applied (0.02 .. 0.07)
  bonus_usd     REAL NOT NULL,           -- matched_usd * rate
  bonus_qta     REAL NOT NULL,           -- bonus_usd / qta_price (paid amount)
  qta_price     REAL NOT NULL,           -- QTA price used
  left_total    REAL NOT NULL DEFAULT 0, -- left_usd snapshot after this match
  right_total   REAL NOT NULL DEFAULT 0, -- right_usd snapshot after this match
  matched_total REAL NOT NULL DEFAULT 0, -- cumulative matched_usd after this match
  created_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_binary_match_user ON binary_match_bonuses(user_id, created_at DESC);

-- 4) Idempotency markers: a deposit's USD is rolled into binary volume exactly
--    once. NULL = not yet counted.
ALTER TABLE ext_deposits ADD COLUMN binary_counted_at TEXT;
ALTER TABLE deposits ADD COLUMN binary_counted_at TEXT;
