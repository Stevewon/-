-- ============================================================================
-- 0054 — External (on-chain) deposit ADMIN-APPROVAL workflow.
-- ----------------------------------------------------------------------------
-- Owner rule (2026-08-29): a user's on-chain USDT deposit must NOT be usable
-- for trading (buy) the moment it confirms on-chain. Instead, once a deposit
-- reaches its required confirmations the watcher parks it in a NEW status
-- 'awaiting_approval' (NO wallet credit yet). An admin reviews the main-wallet
-- receipt in the admin panel and clicks Approve → only then is the amount
-- credited to the user's available balance and the row flips to 'credited'.
-- Company/admin accounts are EXEMPT (auto-credit) so exchange liquidity is
-- unaffected.
--
-- ext_deposits.status lifecycle after this migration:
--   detected → confirming → awaiting_approval → credited   (regular users)
--   detected → confirming → credited                       (company/admin, auto)
--   awaiting_approval → rejected                            (admin rejects)
--
-- New audit columns (nullable, so re-running is safe on existing rows).
-- ============================================================================

ALTER TABLE ext_deposits ADD COLUMN approved_by TEXT;
ALTER TABLE ext_deposits ADD COLUMN approved_at TEXT;
ALTER TABLE ext_deposits ADD COLUMN rejected_reason TEXT;

-- Fast lookup of the admin work queue (deposits waiting for approval).
CREATE INDEX IF NOT EXISTS idx_ext_deposits_awaiting
  ON ext_deposits(status, created_at);
