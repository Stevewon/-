-- Migration 0025: Make api_secret_hash nullable for Dilithium2-only keys
-- Root cause: Sprint 5 Phase S5-2 PQ-Live introduced dilithium2 keys that have
-- no HMAC secret, but the original 0003_wallet_network.sql declared
-- api_secret_hash as NOT NULL. INSERTs from /profile/api-keys (Dilithium2)
-- failed with "NOT NULL constraint failed: api_keys.api_secret_hash" → 500.
--
-- SQLite cannot ALTER a NOT NULL constraint, so this migration recreates
-- the table preserving every existing column, default, and index.
--
-- Safety:
--   • PRAGMA foreign_keys is OFF inside Cloudflare D1 by default.
--   • Cloudflare D1 forbids SQL BEGIN/COMMIT (DO transaction API only); wrangler
--     auto-rolls-back the file on any statement failure, which is sufficient.
--   • All existing rows are copied verbatim (api_secret_hash values preserved).
--   • idx_api_keys_user index is recreated with the same definition.
--   • No data loss expected; verify with row counts before/after.

-- 1. Rename the existing table out of the way
ALTER TABLE api_keys RENAME TO api_keys_old_0025;

-- 2. Recreate the table with api_secret_hash nullable
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  api_secret_hash TEXT,                  -- now nullable (was NOT NULL)
  permissions TEXT DEFAULT 'read',
  ip_whitelist TEXT,
  is_active INTEGER DEFAULT 1,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  signature_alg TEXT DEFAULT 'hmac-sha256',
  public_key TEXT,
  pq_key_version INTEGER DEFAULT 1,
  last_pq_verify_at INTEGER
);

-- 3. Copy every existing row across (column order matches schema above)
INSERT INTO api_keys (
  id, user_id, label, api_key, api_secret_hash, permissions, ip_whitelist,
  is_active, last_used_at, created_at, expires_at,
  signature_alg, public_key, pq_key_version, last_pq_verify_at
)
SELECT
  id, user_id, label, api_key, api_secret_hash, permissions, ip_whitelist,
  is_active, last_used_at, created_at, expires_at,
  signature_alg, public_key, pq_key_version, last_pq_verify_at
FROM api_keys_old_0025;

-- 4. Drop the old table
DROP TABLE api_keys_old_0025;

-- 5. Recreate the index
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, is_active);
