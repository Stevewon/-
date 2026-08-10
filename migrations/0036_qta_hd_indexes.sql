-- Migration 0036: HD wallet index table for Quantarium user deposit addresses.
--
-- WHY: Per boss's 2026-08-10 decision (Option 2 — no @quantarium_bot, server
-- owns HD wallet), each QuantaEX user gets a stable BIP-44 derived address
-- at path m/44'/60'/0'/0/<address_index>. We need a monotonic, non-reusable
-- source of `address_index` so a deleted user's index is never re-assigned
-- to a different user (which would map incoming deposits to the wrong
-- account).
--
-- WHAT: One row per user_id. Once allocated, address_index is immutable and
-- unique. Address deletion is not supported through this table — even after
-- a user requests account deletion, the row stays so the on-chain address
-- can never be re-derived for someone else. GDPR right-to-erasure applies
-- to the user's PII in `users`, not to the derivation index.
--
-- The optional `address` column caches the derived checksum address so
-- admin queries can grep by address without recomputing the HD tree.
--
-- Marker key: qta_hd_indexes_2026_08_10 = migrated_v1

CREATE TABLE IF NOT EXISTS qta_hd_indexes (
  user_id        TEXT PRIMARY KEY,
  address_index  INTEGER NOT NULL UNIQUE,
  address        TEXT,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS idx_qta_hd_indexes_index   ON qta_hd_indexes(address_index);
CREATE INDEX IF NOT EXISTS idx_qta_hd_indexes_address ON qta_hd_indexes(address);

-- Marker.
INSERT OR REPLACE INTO system_state (key, value, updated_at)
VALUES (
  'qta_hd_indexes_2026_08_10',
  'migrated_v1',
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
