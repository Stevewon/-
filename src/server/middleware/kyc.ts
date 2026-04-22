// ============================================================================
// KYC tier gate.
// ----------------------------------------------------------------------------
// Tier semantics (kyc_status column):
//   'none'     → read-only (browse, cancel own orders, deposit view)
//   'pending'  → submitted but not yet reviewed — treated as 'none'
//   'approved' → full access (trade, withdraw)
//   'rejected' → treated as 'none'; user must resubmit
//
// Typical use:
//   app.post('/', authMiddleware, requireKyc('approved'), handler)
// ============================================================================

import type { Context, Next } from 'hono';
import type { AppEnv } from '../index';

export type KycTier = 'none' | 'basic' | 'verified' | 'approved';

/** Require at least this KYC tier. `'approved'` alias for `'verified'`. */
export function requireKyc(minTier: KycTier = 'approved') {
  return async function kycMw(c: Context<AppEnv>, next: Next) {
    const u = c.get('user');
    if (!u) return c.json({ error: 'Authentication required' }, 401);

    // Admins bypass KYC
    if (u.role === 'admin') return next();

    const row = await c.env.DB.prepare(
      'SELECT kyc_status, email_verified_at FROM users WHERE id = ?'
    ).bind(u.id).first<{ kyc_status: string; email_verified_at: string | null }>();
    if (!row) return c.json({ error: 'User not found' }, 404);

    const status = (row.kyc_status || 'none').toLowerCase();

    // Simple gate: anything below 'approved' blocks 'approved'/'verified' tiers.
    const needsApproved = minTier === 'approved' || minTier === 'verified';
    if (needsApproved && status !== 'approved') {
      return c.json(
        {
          error: 'KYC verification required for this action',
          code: 'KYC_REQUIRED',
          kyc_status: status,
        },
        403,
      );
    }

    // 'basic' tier: we currently treat email-verified as the bar for basic.
    if (minTier === 'basic' && !row.email_verified_at) {
      return c.json(
        {
          error: 'Email verification required for this action',
          code: 'EMAIL_VERIFICATION_REQUIRED',
        },
        403,
      );
    }

    await next();
  };
}
