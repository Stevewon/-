import type { Context, Next } from 'hono';
import type { AppEnv } from '../index';
import { getRiskState, getClientIp, isIpBlocked } from '../lib/risk';

// Simple JWT (HMAC-SHA256) for Cloudflare Workers
//
// ★ OWNER RULE (2026-09-08): a logged-in session must stay logged in until the
//   user presses the Logout button themselves. Previously the token expired
//   after 7 days, which silently kicked users back to /login. We now issue a
//   very long-lived token (10 years) so the session effectively never expires
//   on its own. Security is preserved: the HMAC signature is still verified on
//   every request, and forced revocation / bans still work instantly through
//   the `token_version` (tv) and `is_active` checks in authMiddleware below —
//   so we can still invalidate any session server-side when we need to.
const TOKEN_TTL_SEC = 10 * 365 * 86400; // ~10 years — effectively "until logout"
async function sign(payload: any, secret: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC })).replace(/=/g, '');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${sigStr}`;
}

async function verify(token: string, secret: string): Promise<any> {
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) throw new Error('Invalid token');

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBuf = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBuf, new TextEncoder().encode(`${header}.${body}`));
  if (!valid) throw new Error('Invalid signature');

  const payload = JSON.parse(atob(body));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

export async function generateToken(
  user: { id: string; email: string; role: string; token_version?: number },
  secret: string,
): Promise<string> {
  return sign({
    id: user.id,
    email: user.email,
    role: user.role,
    tv: user.token_version || 0,
  }, secret);
}

export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  // Phase F: IP blocklist enforcement. Run before token parsing so that a
  // banned host can't even probe with a fresh token. Cached for 30 s per
  // worker isolate (see lib/risk.ts), so the cost on the hot path is one
  // map lookup most of the time.
  const risk = await getRiskState(c);
  if (risk.ip_blocklist.length > 0) {
    const ip = getClientIp(c);
    const matched = isIpBlocked(ip, risk.ip_blocklist);
    if (matched) {
      return c.json({ error: 'Access denied (IP blocked)', matched }, 403);
    }
  }

  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  // No token at all — a plain "you need to log in" signal. This is NOT a
  // "your session died" event, so the client must not treat it as a forced
  // logout (the api.ts interceptor keys off code === 'AUTH_REQUIRED' + whether
  // a token is even stored locally).
  if (!token) return c.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, 401);

  try {
    const payload = await verify(token, c.env.JWT_SECRET);
    // Check token_version for forced-logout / revocation, and is_active for
    // bans. ★ SECURITY FIX (2026-08-30): this now FAILS CLOSED. Previously a
    // DB hiccup on this lookup was swallowed and the request was allowed
    // through (fail-open), which would let a revoked/banned session slip past
    // during a transient outage. The token_version column has been live in
    // production for a long time, so a genuine query failure is a real error,
    // not a "migration pending" state — we reject rather than trust the token.
    try {
      const row = await c.env.DB.prepare(
        'SELECT token_version, is_active FROM users WHERE id = ?'
      ).bind(payload.id).first<{ token_version: number; is_active: number }>();
      if (!row) return c.json({ error: 'User not found', code: 'TOKEN_INVALID' }, 401);
      if (!row.is_active) return c.json({ error: 'Account disabled', code: 'ACCOUNT_DISABLED' }, 403);
      if ((row.token_version || 0) !== (payload.tv || 0)) {
        // Session was explicitly revoked/rotated server-side (forced logout,
        // password change, ban lift, etc.) — the client SHOULD drop it.
        return c.json({ error: 'Session expired — please login again', code: 'SESSION_REVOKED' }, 401);
      }
    } catch (e) {
      // Fail CLOSED: if we cannot confirm the session is still valid, do not
      // trust the bearer token. This blocks a revoked session from being
      // accepted during a DB outage.
      console.error('[auth] token_version/is_active check failed — denying:', e);
      return c.json({ error: 'Authentication temporarily unavailable' }, 503);
    }
    c.set('user', payload);
    await next();
  } catch {
    // Signature/format failure or (with the 10-year TTL, practically never)
    // an expired token — this token can never work again, so tell the client
    // to drop it.
    return c.json({ error: 'Invalid token', code: 'TOKEN_INVALID' }, 401);
  }
}

export async function adminMiddleware(c: Context<AppEnv>, next: Next) {
  const user = c.get('user');
  if (user?.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);
  await next();
}
