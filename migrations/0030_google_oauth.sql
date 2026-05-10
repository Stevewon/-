-- ============================================================================
-- 0030_google_oauth.sql
-- Add Google OAuth (sign-in / sign-up / link-existing-account) support.
-- ----------------------------------------------------------------------------
-- This migration:
--   1) Records the policy switch in system_markers.
--   2) Adds 5 nullable columns to users for OAuth metadata:
--        provider       TEXT DEFAULT 'email'    -- 'email' | 'google' | ...
--        google_id      TEXT                    -- Google account sub (unique)
--        profile_image  TEXT                    -- avatar URL from provider
--        auth_type      TEXT DEFAULT 'password' -- 'password' | 'social'
--        last_login_at  TEXT                    -- ISO timestamp of last login
--   3) Creates a UNIQUE INDEX on google_id (NULL allowed for non-Google users).
--   4) Marks migration done.
--
-- Notes on the existing schema:
--   * users.password is NOT NULL (created in 0001), so Google-only sign-ups
--     store a sentinel value '__google_oauth__' in that column. The password
--     login route MUST refuse this sentinel and direct the user to Google.
--   * SQLite cannot drop NOT NULL via ALTER, so we keep the column NOT NULL
--     and rely on the sentinel approach.
--
-- All ALTER TABLE statements may already have run (partial prior run), so the
-- self-bootstrap block in src/server/index.ts wraps each ADD COLUMN in its
-- own try/catch. This .sql file remains the canonical reference for the
-- schema change and is safe to run via `wrangler d1 execute` if any column
-- doesn't already exist.
-- ============================================================================

-- 1) Record the OAuth feature switch
INSERT INTO system_markers (key, value, updated_at)
VALUES ('google_oauth_enabled','true',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;

-- 2) Add OAuth metadata columns (each protected by self-bootstrap try/catch
--    in code; running here is also safe via D1 if the columns don't exist).
ALTER TABLE users ADD COLUMN provider TEXT DEFAULT 'email';
ALTER TABLE users ADD COLUMN google_id TEXT;
ALTER TABLE users ADD COLUMN profile_image TEXT;
ALTER TABLE users ADD COLUMN auth_type TEXT DEFAULT 'password';
ALTER TABLE users ADD COLUMN last_login_at TEXT;

-- 3) Unique index on google_id so the same Google account cannot link to
--    two different users. Partial-index syntax keeps NULLs unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
  ON users(google_id)
  WHERE google_id IS NOT NULL;

-- 4) Mark migration done (used by self-bootstrap)
INSERT INTO system_markers (key, value, updated_at)
VALUES ('migration_0030_google_oauth','live',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;
