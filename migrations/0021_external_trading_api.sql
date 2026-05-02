-- ============================================================================
-- Sprint 5 Phase I1: External trading API gate (HMAC) — schema
-- ----------------------------------------------------------------------------
-- Adds the persistent state needed by src/server/middleware/api-key-auth.ts:
--
--   * api_key_nonces : replay-defense ledger. Every signed request carries
--                      a unique nonce; the middleware refuses any nonce
--                      that has already been used by the same key inside
--                      the validity window.
--
--   * system_markers : feature flags so admins can flip the external
--                      trading surface on/off without a code deploy.
--
-- The api_keys table itself is untouched: H2-A already added
--   signature_alg / public_key / pq_key_version / last_pq_verify_at.
--
-- Stub-first design (consistent with B/G/H1/H2):
--   external_trading_api_enabled is seeded 'off'. The /api/v1/* routes
--   read this marker on every call and return 503 SERVICE_DISABLED until
--   an admin explicitly toggles it 'on'. This keeps the public API
--   surface dark while we soak the gate in staging.
--
-- Backward compatibility:
--   - All existing JWT routes (/api/orders, /api/profile/*, etc.) are
--     untouched. v1.ts is a brand-new namespace.
--   - All existing HMAC keys keep working unchanged on the stats endpoint
--     and (once the gate is enabled) on /api/v1/*.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- api_key_nonces : per-key nonce ledger.
--
-- Why a table and not just KV? D1 is the source of truth that the worker
-- already binds to (KV is optional in this project), and the nonce window
-- is short enough that a tiny indexed table is cheap. The middleware
-- inserts on first sight, sweeps nonces older than the validity window
-- on a cron (Phase I2), and uses a UNIQUE(api_key_id, nonce) constraint
-- so a replay simply fails the INSERT.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_key_nonces (
  api_key_id   TEXT    NOT NULL,
  nonce        TEXT    NOT NULL,
  -- Unix seconds of the request, captured so cron sweeps can drop rows
  -- whose timestamp is older than the configured skew window.
  ts           INTEGER NOT NULL,
  -- IP that submitted this nonce. Pure forensic field; not used for
  -- equality checks (a key may be used from a load balancer fleet).
  ip_address   TEXT,
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (api_key_id, nonce)
);

-- Sweep helper: lets the cron job 'DELETE FROM api_key_nonces WHERE ts < ?'
-- run as an index seek instead of a full scan.
CREATE INDEX IF NOT EXISTS idx_api_key_nonces_ts
  ON api_key_nonces(ts);

-- ----------------------------------------------------------------------------
-- system_markers : Phase I1 feature flags
--
-- external_trading_api_enabled
--   master switch for /api/v1/*. Seeded 'off' so the gate is dark until
--   explicitly turned on by an admin. Read on every request — there is
--   no per-route override in this phase.
--
-- external_trading_api_integration
--   introspection marker, surfaced in the admin "PQ + Trading API" tab.
--
-- external_trading_api_max_skew_sec
--   numeric override for the timestamp skew window (default 60s if absent
--   or unparseable). Stored as text because system_markers.value is TEXT.
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO system_markers (key, value)
VALUES
  ('external_trading_api_enabled',     'off'),
  ('external_trading_api_integration', 'phase-i1-stub'),
  ('external_trading_api_max_skew_sec','60');
