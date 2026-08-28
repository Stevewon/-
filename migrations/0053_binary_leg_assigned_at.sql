-- 0053 — record WHEN the sponsor assigned a downline member to their Left/Right
-- leg (the one-time binary placement). Powers the placement history / "배치일시"
-- shown on the sponsor's Earn dashboard.
ALTER TABLE users ADD COLUMN binary_leg_assigned_at TEXT;
