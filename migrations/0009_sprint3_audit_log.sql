-- Sprint 3 — S3-2 Admin audit log
-- Every mutating admin action (user toggle, role change, KYC decision,
-- withdrawal approve/reject, manual deposit, coin edit, broadcast, …)
-- writes one immutable row here. Required for regulatory audits.

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id           TEXT PRIMARY KEY,
  admin_id     TEXT NOT NULL,          -- users.id of the acting admin
  admin_email  TEXT,                   -- denormalized for faster reads / forensics
  action       TEXT NOT NULL,          -- e.g. 'user.toggle_active', 'kyc.approve'
  target_type  TEXT,                   -- 'user' | 'withdrawal' | 'coin' | 'deposit' | 'system' | null
  target_id    TEXT,                   -- id of the affected row (if applicable)
  payload      TEXT,                   -- JSON string of relevant context (old/new, reason)
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin   ON admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action  ON admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target  ON admin_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);
