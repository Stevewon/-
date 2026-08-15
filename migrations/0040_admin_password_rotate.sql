-- ============================================================================
-- Soft-launch hardening (2026-08-15): rotate the default admin password.
-- ----------------------------------------------------------------------------
-- The admin credential shipped in 0002_seed.sql / 0022_admin_password_reset.sql
-- had its PLAINTEXT written into the migration comments, which is committed to
-- the git repo. Anyone reading the repo could log in to the admin panel.
--
-- This migration rotates admin-001's password to a fresh, strong RANDOM value.
-- The plaintext is DELIBERATELY NOT stored anywhere in the repo — only the
-- bcrypt hash appears below (a hash cannot be reversed to the password). The
-- one-time plaintext was delivered to the operator out-of-band (chat).
--
-- Operators MUST change this password again from the account settings UI after
-- first login, and register an authenticator (TOTP) 2FA device. That way the
-- live credential never exists in source control at all.
--
-- Safety:
--   * Targets ONLY id='admin-001' AND email='admin@quantaex.io'.
--   * Touches no other user, balance, or table.
--   * Idempotent — re-running leaves the row in the same state.
-- ============================================================================

UPDATE users
SET password = '$2a$10$pTYwOe9fZIYaXawzj/DJk.EMJ/MA9uJ5/sHVPrJxNR9hrhI2uuFha'
WHERE id = 'admin-001'
  AND email = 'admin@quantaex.io';
