-- ============================================================================
-- 0056 — Admin-granted staking with a BONUS (인정) principal.
-- ----------------------------------------------------------------------------
-- Owner rule (2026-08-29): the admin can open a staking position on a member's
-- behalf where the principal is INFLATED by a bonus that is NOT returned at
-- the end. Example:
--   • real (실입금)   = 1,000 USDT  → returned to the user at maturity
--   • bonus (인정)    = 1,000 USDT  → NEVER returned (evaporates on redeem)
--   • principal_usd  = 2,000 USDT  → used for ALL dividend + matching-bonus math
--
-- Daily dividend and binary matching read principal_usd, so they automatically
-- run on the full 2,000. Only the PRINCIPAL RETURN path is special:
--   • Matured  → return real_principal_usd (1,000) worth of QTA, bonus lost.
--   • Early    → 30% penalty on the WHOLE inflated base (principal + accrued
--                dividend, i.e. 2,000-based), then return the remainder.
--
-- New nullable columns keep every existing (user-subscribed) position working
-- exactly as before: when real_principal_usd IS NULL the code falls back to the
-- full principal_usd (legacy behaviour = real == principal, no bonus).
-- ============================================================================

-- The portion of principal_usd that is REAL money to be returned at maturity.
-- NULL / absent ⇒ legacy position ⇒ treat the whole principal_usd as real.
ALTER TABLE staking_positions ADD COLUMN real_principal_usd REAL;

-- The inflated (인정) bonus portion. Informational / audit. 0 for legacy rows.
ALTER TABLE staking_positions ADD COLUMN bonus_principal_usd REAL DEFAULT 0;

-- Who granted it (admin id) — audit trail for admin-created positions. NULL for
-- ordinary user self-subscriptions.
ALTER TABLE staking_positions ADD COLUMN granted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_staking_granted ON staking_positions(granted_by);
