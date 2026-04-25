-- ============================================================================
-- 0013_system_markers.sql — generic key/value markers used by the admin
-- dashboard and operational scripts.
--
-- Currently used keys:
--   last_backup_at  → ISO8601 timestamp of the most recent successful daily
--                     D1 → R2 backup (written by cron-worker).
--
-- Designed for tiny payloads only. Do not use for user data.
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_markers (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
