-- Migration 0034: user_consents (GDPR / Seychelles DPA evidence)
--
-- WHY: RegisterPage already forces the visitor to tick "I agree to Terms and
-- Privacy Policy", but the server currently accepts the flag without
-- persisting it anywhere. Under GDPR Art. 7 and equivalent Seychelles DPA
-- provisions, the operator carries the burden of proving that consent was
-- given, when it was given, to which document version, and from which IP.
-- Without a durable record we cannot answer that under audit.
--
-- WHAT: A single append-only table keyed by (user_id, kind). We store the
-- effective document version (matches EFFECTIVE_DATE/VERSION strings on
-- Terms/Privacy pages), the IP and user-agent at time of consent, and
-- withdrew_at for future revocation. Marketing consent is opt-in so a NULL
-- row simply means "not consented".
--
-- The table is intentionally minimal — no PII beyond IP/UA. Any user
-- deletion request MUST cascade delete these rows (see DELETE below) so a
-- valid Right-to-Erasure request cleans up cleanly.

CREATE TABLE IF NOT EXISTS user_consents (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  -- kind: 'terms' | 'privacy' | 'marketing' | 'age_gate'
  kind        TEXT NOT NULL,
  -- document version, e.g. '1.0' (matches TermsPage.VERSION)
  version     TEXT NOT NULL,
  -- effective_date of the doc the user consented to (e.g. '2026-06-22')
  effective_date TEXT,
  agreed      INTEGER NOT NULL DEFAULT 1,     -- 0 when explicitly declined
  ip_address  TEXT,
  user_agent  TEXT,
  agreed_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- non-null when the user later withdrew this consent
  withdrew_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user      ON user_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_consents_user_kind ON user_consents(user_id, kind);
CREATE INDEX IF NOT EXISTS idx_user_consents_agreed_at ON user_consents(agreed_at);

-- Self-bootstrap marker (matches the 0028-0033 pattern)
INSERT OR REPLACE INTO system_markers (key, value)
VALUES ('user_consents_2026_06_22', 'migrated_v1');
