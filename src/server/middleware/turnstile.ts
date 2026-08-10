// ============================================================================
// Cloudflare Turnstile verification middleware.
// ----------------------------------------------------------------------------
// Blocks bots on auth-critical endpoints (register / login / forgot-pw /
// resend-verify). Fails OPEN when TURNSTILE_SECRET is not configured so
// preview / local dev works without a widget site key.
//
// Client contract:
//   The Turnstile widget renders a hidden input named "cf-turnstile-response".
//   We also accept `turnstile_token` in JSON body / `X-Turnstile-Token` header
//   for flexibility.
//
// Environment:
//   TURNSTILE_SECRET  — secret key from Cloudflare dashboard (server-side).
//                       When absent, middleware is a no-op (fail-open).
//   TURNSTILE_ENFORCE — 'strict' to reject when secret is set but Cloudflare
//                       returns non-success. Defaults to strict already.
// ============================================================================

import type { Context, Next } from 'hono';
import type { AppEnv } from '../index';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function clientIp(c: Context<AppEnv>): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    ''
  );
}

/**
 * Extract the Turnstile response token from (in priority order):
 *   1. JSON body field `turnstile_token` or `cf-turnstile-response`
 *   2. Header `X-Turnstile-Token`
 *   3. Form field `cf-turnstile-response` (for non-JSON forms)
 *
 * We clone the JSON body so downstream handlers can still read it via
 * c.req.json() — Hono caches parsed JSON per request.
 */
async function extractToken(c: Context<AppEnv>): Promise<string | null> {
  // Header takes lowest cost first (no body parse).
  const header = c.req.header('X-Turnstile-Token');
  if (header) return header;

  const ct = c.req.header('Content-Type') || '';
  try {
    if (ct.includes('application/json')) {
      const body = await c.req.json();
      // Hono caches parsed json — reading twice is safe.
      const t = body?.turnstile_token || body?.['cf-turnstile-response'];
      return t ? String(t) : null;
    }
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const form = await c.req.formData();
      const t = form.get('cf-turnstile-response') || form.get('turnstile_token');
      return t ? String(t) : null;
    }
  } catch {
    // fall through — no token found
  }
  return null;
}

/**
 * requireTurnstile — verify Cloudflare Turnstile token, or fail-open when
 * TURNSTILE_SECRET is not configured (dev / preview convenience).
 */
export function requireTurnstile() {
  return async function turnstileMw(c: Context<AppEnv>, next: Next) {
    const secret = (c.env as any).TURNSTILE_SECRET as string | undefined;

    // Fail-open when unconfigured — never break preview / local dev.
    if (!secret) {
      return next();
    }

    const token = await extractToken(c);
    if (!token) {
      return c.json(
        {
          error: 'Bot verification required',
          code: 'TURNSTILE_TOKEN_MISSING',
          hint: 'Complete the Turnstile challenge and re-submit.',
        },
        400,
      );
    }

    try {
      const form = new FormData();
      form.append('secret', secret);
      form.append('response', token);
      const ip = clientIp(c);
      if (ip) form.append('remoteip', ip);

      const resp = await fetch(VERIFY_URL, { method: 'POST', body: form });
      const data = (await resp.json()) as {
        success?: boolean;
        'error-codes'?: string[];
        action?: string;
        hostname?: string;
      };

      if (!data.success) {
        return c.json(
          {
            error: 'Bot verification failed',
            code: 'TURNSTILE_INVALID',
            details: data['error-codes'] || [],
          },
          403,
        );
      }
    } catch (e) {
      // Verification service error — fail closed on production (secret set
      // implies boss wants strict enforcement).
      console.warn('[turnstile] verify error:', (e as Error).message);
      return c.json(
        { error: 'Bot verification unavailable', code: 'TURNSTILE_UNREACHABLE' },
        503,
      );
    }

    return next();
  };
}
