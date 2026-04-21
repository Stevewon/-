-- System state key-value store for lightweight background task coordination
CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed the last-run marker so the self-scheduling check picks it up immediately
INSERT OR IGNORE INTO system_state (key, value) VALUES ('price_alert_last_run', '0');
