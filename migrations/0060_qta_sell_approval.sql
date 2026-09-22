-- 0060_qta_sell_approval.sql (OWNER_RULES §12, 2026-09-21)
-- "사전 매도가 승인된 회원만 매도가 가능하다." Admin-set flag; exchange/casino
-- shareholders are implicitly approved (see src/shared/shareholder.ts canSellSql).
-- Auto-applied by cron-worker/src/migrate.ts.
ALTER TABLE users ADD COLUMN qta_sell_approved     INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN qta_sell_approved_at  TEXT;
ALTER TABLE users ADD COLUMN qta_sell_approved_by  TEXT;
