-- ============================================================================
-- Sprint 5 Phase X: Admin password reset for admin@quantaex.io
-- ----------------------------------------------------------------------------
-- Resets the admin user's bcrypt password hash to match the new credential
-- 'QuantaEX2026!Admin'. Required because the previously seeded hash in
-- 0002_seed.sql no longer corresponds to the credential we ship to operators.
--
-- Safety:
--   * Targets ONLY the user with id='admin-001' AND email='admin@quantaex.io'.
--   * Does NOT touch any other user, balance, or transactional table.
--   * Idempotent — re-running this migration leaves the row in the same state.
--
-- Operator note:
--   New plaintext credential (sealed envelope, do NOT log):
--     email    = admin@quantaex.io
--     password = QuantaEX2026!Admin
--   Hash below was generated locally with bcryptjs cost=10 and verified
--   against the same library used by src/server/routes/auth.ts.
-- ============================================================================

UPDATE users
SET password = '$2a$10$xCy3LYQ3wXn/lvTvv08Wl.A5iltNQ3CaI/PJOjWxYU2clU2CpUhSS'
WHERE id = 'admin-001'
  AND email = 'admin@quantaex.io';
