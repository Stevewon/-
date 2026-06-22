-- ============================================================================
-- 0032_company_issued_lock.sql  (2026-06-22)
-- ============================================================================
-- Boss's permanent rule (★★★★★★★):
--   "회사 지급분 (가입 보너스, 추천 보상, 일일 리워드, 어드민 수동 지급 등)
--    은 절대 외부로 출금될 수 없다."
--
-- Current bug (pre-launch audit):
--   wallets.available is a single REAL column that mixes:
--     (A) 회사 지급분 (company-issued, MUST NOT leave the exchange)
--     (B) 사용자 입금/거래 잔액 (user-owned, withdrawable)
--   The withdrawal endpoint (POST /api/wallet/withdraw) currently checks
--   `available >= amount` and lets any portion leave — including (A).
--
-- Fix (option A — schema separation):
--   Add `available_initial` REAL DEFAULT 0
--     → cumulative company-issued amount that is LOCKED from external
--       withdrawal but can still be used for internal trading.
--   Withdrawable amount = `available - available_initial`.
--
-- Backfill policy:
--   Pre-launch — no real customer deposits yet. Set ALL existing balances'
--   `available_initial = available` so nothing currently in the system can
--   leave until proven to be from a legitimate deposit/trade. This is the
--   safer side. Internal trading still works (orders use `available` for
--   balance checks, not `available_initial`).
--
--   For test users (admin / test accounts) the boss can manually reset
--   `available_initial = 0` via the diagnostic SQL bundle.
-- ============================================================================

ALTER TABLE wallets ADD COLUMN available_initial REAL DEFAULT 0;

-- ----------------------------------------------------------------------------
-- Pre-launch backfill: lock the entirety of every existing balance as
-- "company-issued" so nothing accidentally leaves before the new flow is
-- fully verified. The boss can selectively unlock test accounts via the
-- diagnostic SQL bundle.
-- ----------------------------------------------------------------------------
UPDATE wallets SET available_initial = available WHERE available_initial = 0 OR available_initial IS NULL;

-- ----------------------------------------------------------------------------
-- Audit marker — proves the migration actually ran in production.
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO system_markers (key, value)
VALUES ('company_issued_lock_2026_06_22', 'migrated_v1');

-- ----------------------------------------------------------------------------
-- Index for withdraw-time lookups (UNIQUE(user_id, coin_symbol) already
-- exists, so this is mainly to keep parity if we ever drop the unique).
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wallets_user_coin ON wallets(user_id, coin_symbol);
