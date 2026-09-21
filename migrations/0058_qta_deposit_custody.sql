-- ============================================================================
-- 0058_qta_deposit_custody.sql  (OWNER_RULES §11, 2026-09-21)
-- ----------------------------------------------------------------------------
-- "일단 다 받고 보자. 단, 언제든 돌려줄 수 있게 누가 언제 몇개를 보냈는지
--  관리자에 다 떠야 한다."
-- Native QTA sent by ANY member is received + recorded. Shareholders are
-- credited; everyone else's QTA is 'held' (company custody). These columns
-- carry the sender / timestamp / sweep / resolution trail for exact returns.
-- Auto-applied by cron-worker/src/migrate.ts (same statements).
-- ============================================================================
ALTER TABLE qta_deposits ADD COLUMN from_address    TEXT;   -- sender wallet
ALTER TABLE qta_deposits ADD COLUMN chain_ts        TEXT;   -- on-chain block timestamp
ALTER TABLE qta_deposits ADD COLUMN held_at         TEXT;   -- when status became 'held'
ALTER TABLE qta_deposits ADD COLUMN sweep_tx_hash   TEXT;   -- tx moving coins to main wallet
ALTER TABLE qta_deposits ADD COLUMN swept_at        TEXT;
ALTER TABLE qta_deposits ADD COLUMN resolution      TEXT;   -- admin_credit | returned
ALTER TABLE qta_deposits ADD COLUMN resolved_at     TEXT;
ALTER TABLE qta_deposits ADD COLUMN resolved_by     TEXT;   -- admin user id
ALTER TABLE qta_deposits ADD COLUMN resolution_note TEXT;
ALTER TABLE qta_deposits ADD COLUMN return_tx_hash  TEXT;   -- on-chain tx of the return
CREATE INDEX IF NOT EXISTS idx_qta_deposits_asset_status ON qta_deposits(asset, status, created_at DESC);
