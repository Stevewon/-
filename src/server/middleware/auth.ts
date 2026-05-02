import type { Context, Next } from 'hono';
import type { AppEnv } from '../index';
import { getRiskState, getClientIp, isIpBlocked } from '../lib/risk';

// Simple JWT (HMAC-SHA256) for Cloudflare Workers
async function sign(payload: any, secret: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7 * 86400 })).replace(/=/g, '');
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
  if (!token) return c.json({ error: 'Authentication required' }, 401);

  try {
    const payload = await verify(token, c.env.JWT_SECRET);
    // Check token_version for forced-logout / revocation. Best-effort:
    // if the column doesn't exist yet (pre-migration), skip the check.
    try {
      const row = await c.env.DB.prepare(
        'SELECT token_version, is_active FROM users WHERE id = ?'
      ).bind(payload.id).first<{ token_version: number; is_active: number }>();
      if (!row) return c.json({ error: 'User not found' }, 401);
      if (!row.is_active) return c.json({ error: 'Account disabled' }, 403);
      if ((row.token_version || 0) !== (payload.tv || 0)) {
        return c.json({ error: 'Session expired — please login again' }, 401);
      }
    } catch { /* migration pending — fail open */ }
    c.set('user', payload);
    await next();
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
}

export async function adminMiddleware(c: Context<AppEnv>, next: Next) {
  const user = c.get('user');
  if (user?.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);
  await next();
}
