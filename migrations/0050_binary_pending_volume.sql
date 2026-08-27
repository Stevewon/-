-- ============================================================================
-- 0050_binary_pending_volume.sql
-- ----------------------------------------------------------------------------
-- Fix the matching ORDER-DEPENDENCY defect (owner ruling, 2026-08-27):
--   "상부 몸값이 상승하면 재계산이 당연히 되는게 맞지!"
--
-- Problem before this migration:
--   When a downline deposit rolled up to an ancestor whose self_usd (몸값) was
--   still 0 (or whose 2× cap was already full), the volume over the cap was
--   simply DROPPED and lost forever. Because deposits are marked
--   binary_counted_at, they were never re-rolled once the ancestor later staked
--   and raised their cap. Result: downline that deposited BEFORE the upline
--   staked was permanently missing from matching -> under-payment.
--
-- New policy:
--   Excess (over-cap) roll-up volume is NOT dropped. It is parked in
--   pending_left_usd / pending_right_usd on the ancestor. When the ancestor's
--   self_usd later rises (they stake/deposit), the cron reclaims pending volume
--   into the live left_usd / right_usd up to the new cap and re-runs matching.
--   This makes matching independent of deposit/stake ORDER, while still honoring
--   the owner's two hard rules:
--     • self_usd == 0  -> still NO payout (blocked in runMatchForUser).
--     • downline live volume never exceeds 2 × self_usd (the cap).
-- ============================================================================

-- Parked (over-cap) volume awaiting the ancestor raising their own 몸값.
ALTER TABLE binary_volume ADD COLUMN pending_left_usd  REAL NOT NULL DEFAULT 0;
ALTER TABLE binary_volume ADD COLUMN pending_right_usd REAL NOT NULL DEFAULT 0;
