-- 0059_qta_auto_return.sql (OWNER_RULES §11, 2026-09-21)
-- Auto-return queue for native QTA sent by non-shareholders:
--   status 'return_pending' → cron sends amount back to from_address from the
--   hot wallet → 'returned' (return_tx_hash / return_to).
-- Auto-applied by cron-worker/src/migrate.ts.
ALTER TABLE qta_deposits ADD COLUMN return_to        TEXT;
ALTER TABLE qta_deposits ADD COLUMN return_attempts  INTEGER DEFAULT 0;
ALTER TABLE qta_deposits ADD COLUMN return_error     TEXT;
INSERT OR IGNORE INTO system_state (key, value) VALUES ('qta_auto_return', 'on');
