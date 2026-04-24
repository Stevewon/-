-- Sprint 3 — S3-4 Time-In-Force (TIF) options for orders
-- Adds a `time_in_force` column so users can place IOC / FOK / Post-Only
-- orders alongside the existing GTC (Good-Till-Cancelled) limit orders.
--
--   GTC        — default, existing behaviour
--   IOC        — Immediate-Or-Cancel: fill whatever's available, cancel rest
--   FOK        — Fill-Or-Kill: entire qty must fill atomically or cancel all
--   POST_ONLY  — Maker-only limit: reject (cancel) if it would cross the book
--
-- SQLite `ALTER TABLE ... ADD COLUMN` with a non-constant DEFAULT is not
-- supported, so we use a literal default and leave existing rows NULL.
-- Application code treats NULL as GTC for backward-compat.

ALTER TABLE orders ADD COLUMN time_in_force TEXT DEFAULT 'GTC';

-- Index for admin/analytics queries that filter by TIF (cheap, small table).
CREATE INDEX IF NOT EXISTS idx_orders_tif ON orders(time_in_force);
