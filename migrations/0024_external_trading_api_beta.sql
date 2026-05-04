-- Sprint 5 Phase C1 — External Trading API beta rollout.
--
-- Goal:
--   Move the /api/v1/* gate from the indefinite phase-i1-stub label to
--   phase-c1-beta. The middleware (api-key-auth.ts) recognizes that
--   exact phase string and requires every API key to declare a
--   non-empty ip_whitelist before letting a request through. This
--   provides three independent layers of defense during the beta:
--     1) the global enable marker (still 'off' here — sysop must flip
--        it on explicitly when ready)
--     2) a non-empty per-key ip_whitelist
--     3) the existing signature verification (HMAC / Dilithium2 / Hybrid)
--
-- Backward compatibility:
--   - Existing HMAC API keys are unaffected as long as they have an
--     ip_whitelist set when the gate is flipped on. Keys with empty
--     whitelists will receive 403 BETA_REQUIRES_IP_WHITELIST during
--     the beta phase, until either the whitelist is filled or the
--     phase moves to 'phase-prod'.
--   - All Phase S5-2 PQ markers (pq_api_keys_enabled, _wasm_ready,
--     _required, _integration) stay untouched.
--
-- Rollback:
--   To exit beta and return to the previous phase label, run:
--     UPDATE system_markers
--        SET value='phase-i1-stub', updated_at=datetime('now')
--      WHERE key='external_trading_api_integration';
--   To advance to general availability:
--     UPDATE system_markers
--        SET value='phase-prod',    updated_at=datetime('now')
--      WHERE key='external_trading_api_integration';

UPDATE system_markers
   SET value = 'phase-c1-beta',
       updated_at = datetime('now')
 WHERE key = 'external_trading_api_integration';

-- Defensive: keep the master switch off after applying this migration.
-- The sysop turns it on with a separate, deliberate UPDATE once a
-- beta key has been provisioned.
UPDATE system_markers
   SET value = 'off',
       updated_at = datetime('now')
 WHERE key = 'external_trading_api_enabled';
