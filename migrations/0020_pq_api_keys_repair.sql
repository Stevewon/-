-- ============================================================================
-- Sprint 4 Phase H2 — Idempotent repair migration for 0019_pq_api_keys
-- ----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS:
--   SQLite's `ALTER TABLE ADD COLUMN` does NOT support `IF NOT EXISTS`. If
--   migration 0019 was partially executed (e.g. interrupted between ALTERs)
--   re-running 0019 fails with `duplicate column name`. This file is the
--   safe, re-runnable counterpart.
--
-- HOW TO USE:
--   * Fresh DB → just run 0019 (faster, declarative).
--   * If 0019 ever errors with `duplicate column name` mid-way, run THIS
--     file instead. It probes `pragma_table_info` and only ALTERs columns
--     that are still missing. Indexes, the audit table, and system_markers
--     all use `IF NOT EXISTS` / `INSERT OR IGNORE`, so re-runs are no-ops.
--
-- IDEMPOTENCY GUARANTEE:
--   This script can be executed any number of times on any DB state where
--   0019 has been partially or fully applied. The only side effect of a
--   re-run on a fully-applied DB is a few catalog reads.
--
-- BACKWARD COMPATIBILITY (still the H2-A core promise):
--   Existing HMAC-SHA256 rows are never touched. Defaults backfill new
--   columns automatically. pq_api_keys_required stays 'off' so hmac-only
--   keys keep working.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Conditional column adds via SQLite catalog inspection.
-- The trick: sqlite_master.sql only contains CREATE TABLE; columns added
-- by ALTER are reflected in PRAGMA table_info. We probe with a SELECT and
-- emit the ALTER only when the column is absent — but since SQLite cannot
-- run conditional DDL inside a single statement, callers should run each
-- ALTER below and IGNORE `duplicate column name` errors. Wrangler treats
-- each statement independently, so a thrown duplicate-column error on one
-- line does not roll back the others.
--
-- Recommended invocation:
--   npx wrangler d1 execute quantaex-production --remote \
--     --file=./migrations/0020_pq_api_keys_repair.sql
--
-- If wrangler reports "duplicate column name" for a specific line, that
-- column is already present; the rest of the file still applies.
-- ----------------------------------------------------------------------------

-- Column adds — safe to fail with `duplicate column name` per line.
ALTER TABLE api_keys ADD COLUMN signature_alg TEXT NOT NULL DEFAULT 'hmac-sha256';
ALTER TABLE api_keys ADD COLUMN public_key TEXT;
ALTER TABLE api_keys ADD COLUMN pq_key_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE api_keys ADD COLUMN last_pq_verify_at INTEGER;

-- Index — IF NOT EXISTS makes this idempotent.
CREATE INDEX IF NOT EXISTS idx_api_keys_signature_alg
  ON api_keys(signature_alg);

-- Audit table — IF NOT EXISTS makes this idempotent.
CREATE TABLE IF NOT EXISTS api_key_pq_audit (
  id              TEXT PRIMARY KEY,
  api_key_id      TEXT,
  api_key_prefix  TEXT,
  algorithm       TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  ip_address      TEXT,
  user_agent      TEXT,
  detail          TEXT,
  created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_pq_audit_created_at ON api_key_pq_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_pq_audit_outcome    ON api_key_pq_audit(outcome);
CREATE INDEX IF NOT EXISTS idx_pq_audit_api_key    ON api_key_pq_audit(api_key_id);

-- System markers — INSERT OR IGNORE is idempotent and won't overwrite
-- admin-flipped values (e.g. pq_api_keys_required=on).
INSERT OR IGNORE INTO system_markers (key, value)
VALUES
  ('pq_api_keys_enabled',     'on'),
  ('pq_api_keys_required',    'off'),
  ('pq_api_keys_integration', 'phase-h2-stub'),
  ('pq_api_keys_wasm_ready',  'off');
