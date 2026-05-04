-- ============================================================================
-- Sprint 5 Phase S5-2 PQ-Live A: activate Dilithium2 verifier
-- ----------------------------------------------------------------------------
-- Flips the `pq_api_keys_wasm_ready` system marker to 'on' now that
-- @noble/post-quantum's ml_dsa44 (NIST FIPS 204 = standardized Dilithium2)
-- is bundled into the worker. Also bumps the integration phase label so
-- the Admin UI shows the correct stage in the API Keys (PQ) card.
--
-- Backward compatibility (CRITICAL — no breakage allowed):
--   * `pq_api_keys_required` stays 'off'. Existing HMAC-SHA256 keys keep
--     authenticating exactly as before. Nothing about the HMAC code path
--     changes in this phase.
--   * The marker name `pq_api_keys_wasm_ready` is preserved even though
--     the new verifier is pure JS, not WASM, so admin tooling and the
--     Admin UI continue to work without code changes.
--   * Algorithm distribution counters (HMAC vs Dilithium2 vs Hybrid) on
--     the API Keys (PQ) card already query api_keys.signature_alg, no
--     schema change is required.
--
-- Rollback:
--   To disable the live verifier without redeploying code, run:
--     UPDATE system_markers
--        SET value = 'off', updated_at = datetime('now')
--      WHERE key = 'pq_api_keys_wasm_ready';
--   Existing HMAC keys are unaffected; any in-flight Dilithium2 requests
--   will receive 503 PQ_NOT_READY until the marker flips back.
--
-- Idempotent: safe to re-run; UPDATE is a no-op when value already matches.
-- ============================================================================

-- 1) Flip the verifier-ready flag.
UPDATE system_markers
   SET value = 'on',
       updated_at = datetime('now')
 WHERE key = 'pq_api_keys_wasm_ready';

-- 2) Advance the integration phase label so admins see the new stage.
UPDATE system_markers
   SET value = 'phase-s5-2-live',
       updated_at = datetime('now')
 WHERE key = 'pq_api_keys_integration';

-- 3) Insert the markers if (and only if) prior migrations didn't seed them.
--    The OR IGNORE clauses keep this migration idempotent on databases
--    that already have the rows from migration 0019.
--    NOTE: system_markers schema is (key TEXT PK, value TEXT, updated_at TEXT)
--    — no description column. Comments live here in the migration file
--    instead of the table.
INSERT OR IGNORE INTO system_markers (key, value, updated_at)
VALUES
  ('pq_api_keys_wasm_ready', 'on', datetime('now')),
  ('pq_api_keys_integration', 'phase-s5-2-live', datetime('now'));
