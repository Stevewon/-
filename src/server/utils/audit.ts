// ============================================================================
// Admin audit logger (Sprint 3 — S3-2)
// ----------------------------------------------------------------------------
// Call logAdminAction() from any admin-protected endpoint that mutates state.
// The call is best-effort: failures here NEVER throw back to the caller so a
// broken audit table cannot take down the API. Persisted rows are append-only
// — there is no update/delete path exposed in the admin routes.
// ============================================================================

import type { Context } from 'hono';

export type AuditTargetType =
  | 'user'
  | 'withdrawal'
  | 'deposit'
  | 'coin'
  | 'system'
  | 'broadcast'
  | 'kyc';

export interface AuditOpts {
  action: string;                 // dotted, e.g. 'user.toggle_active', 'kyc.approve'
  targetType?: AuditTargetType | null;
  targetId?: string | null;
  payload?: Record<string, unknown> | null;
}

function uuid() {
  return crypto.randomUUID();
}

/**
 * Record an admin action. `c` must already have been through adminMiddleware
 * so that `c.get('user')` returns the acting admin. If we cannot identify
 * the admin we refuse to write a row (better no audit than a bogus one).
 */
export async function logAdminAction(c: Context<any>, opts: AuditOpts): Promise<void> {
  try {
    const admin = c.get('user') as { id?: string; email?: string } | undefined;
    if (!admin?.id) {
      console.warn('[audit] no admin on context for action', opts.action);
      return;
    }

    const ip =
      c.req.header('CF-Connecting-IP') ||
      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
      '';
    const ua = c.req.header('User-Agent') || '';

    const payloadJson =
      opts.payload === undefined || opts.payload === null
        ? null
        : JSON.stringify(opts.payload);

    await c.env.DB.prepare(
      `INSERT INTO admin_audit_logs
         (id, admin_id, admin_email, action, target_type, target_id, payload, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        uuid(),
        admin.id,
        admin.email ?? null,
        opts.action,
        opts.targetType ?? null,
        opts.targetId ?? null,
        payloadJson,
        ip,
        ua,
      )
      .run();
  } catch (e) {
    // Audit table might not be migrated yet, or DB hiccup. Do not propagate.
    console.warn('[audit] log failed for', opts.action, e);
  }
}
