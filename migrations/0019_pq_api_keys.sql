-- ============================================================================
-- Sprint 4 Phase H2: Post-Quantum (Dilithium2) API Keys — schema + stub
-- ----------------------------------------------------------------------------
-- Adds quantum-resistant signature support to the existing api_keys table
-- without breaking any existing HMAC-SHA256 keys.
--
-- Design (PQ-Only stub, consistent with Phase B/G/H1 stub-first approach):
--   * api_keys gets three new columns:
--       - signature_alg   : 'hmac-sha256' (default, legacy) | 'dilithium2' | 'hybrid'
--       - public_key      : base64 Dilithium2 public key (NULL for hmac-only keys)
--       - pq_key_version  : integer, future-proofing for key rotation
--       - last_pq_verify_at : last successful PQ verification timestamp
--   * api_key_pq_audit : append-only log of PQ verification failures
--                        (used by Admin "API key stats" card in Phase H2-B).
--   * system_markers   : feature flags so the actual verify path can stay
--                        dormant until WASM Dilithium2 is wired in next sprint.
--
-- Backward compatibility (CRITICAL):
--   - Existing rows are backfilled with signature_alg='hmac-sha256' and
--     public_key=NULL. Every existing key keeps working unchanged.
--   - pq_api_keys_required=off means clients may still use HMAC-only keys.
--   - Switching pq_api_keys_required=on is an explicit admin action and
--     is NOT performed by this migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Column additions on api_keys
-- (SQLite ALTER TABLE ADD COLUMN is non-destructive; defaults backfill rows.)
-- ----------------------------------------------------------------------------
ALTER TABLE api_keys ADD COLUMN signature_alg TEXT NOT NULL DEFAULT 'hmac-sha256';
ALTER TABLE api_keys ADD COLUMN public_key TEXT;
ALTER TABLE api_keys ADD COLUMN pq_key_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE api_keys ADD COLUMN last_pq_verify_at INTEGER;

-- Index for Admin stats grouping (algorithm distribution).
CREATE INDEX IF NOT EXISTS idx_api_keys_signature_alg
  ON api_keys(signature_alg);

-- ----------------------------------------------------------------------------
-- api_key_pq_audit : PQ verification attempt log
-- Append-only. Used by Admin to detect anomalous PQ verify failures
-- (e.g. attempted forgery, malformed signature, replayed nonce).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_key_pq_audit (
  id              TEXT PRIMARY KEY,
  api_key_id      TEXT,                   -- nullable: failures may not match a key
  api_key_prefix  TEXT,                   -- first 12 chars of presented key, for tracing
  algorithm       TEXT NOT NULL,          -- 'dilithium2' | 'hybrid'
  outcome         TEXT NOT NULL,          -- 'ok' | 'bad_signature' | 'expired' | 'replay' | 'unsupported' | 'wasm_unavailable'
  ip_address      TEXT,
  user_agent      TEXT,
  detail          TEXT,                   -- short reason string, no PII
  created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_pq_audit_created_at
  ON api_key_pq_audit(created_at);

CREATE INDEX IF NOT EXISTS idx_pq_audit_outcome
  ON api_key_pq_audit(outcome);

CREATE INDEX IF NOT EXISTS idx_pq_audit_api_key
  ON api_key_pq_audit(api_key_id);

-- ----------------------------------------------------------------------------
-- system_markers : Phase H2 feature flags
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO system_markers (key, value)
VALUES
  ('pq_api_keys_enabled',  'on'),           -- master switch for the PQ pipeline
  ('pq_api_keys_required', 'off'),          -- when 'on', hmac-only keys are refused on signed routes
  ('pq_api_keys_integration', 'phase-h2-stub'),  -- introspection marker
  ('pq_api_keys_wasm_ready', 'off');        -- flips to 'on' when Dilithium2 WASM is loaded
