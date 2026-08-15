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
 *
 * @param opts.skipWhen  Optional async predicate. When it returns true for a
 *   request, Turnstile verification is skipped entirely. This is used for the
 *   SECOND stage of a multi-step login: the first `/login` submit (password
 *   only) already consumed a one-time Turnstile token and passed the bot
 *   check. The follow-up submit that carries the emailed OTP code
 *   (`email_otp`) or an authenticator code (`totp_code`) is proven-human by
 *   that code itself, and would otherwise fail because Turnstile tokens are
 *   single-use — re-sending the stale token yields TURNSTILE_INVALID.
 */
export function requireTurnstile(opts?: {
  skipWhen?: (c: Context<AppEnv>) => boolean | Promise<boolean>;
}) {
  return async function turnstileMw(c: Context<AppEnv>, next: Next) {
    if (opts?.skipWhen) {
      try {
        if (await opts.skipWhen(c)) return next();
      } catch {
        /* predicate error — fall through to normal verification */
      }
    }
    const secret = (c.env as any).TURNSTILE_SECRET as string | undefined;
    // Only BLOCK the request when enforcement is explicitly 'strict'. In any
    // other mode we still VERIFY a token if one is present, but never reject
    // the request for a missing/invalid token — this prevents a full auth
    // lockout when the widget can't render (e.g. the site key's allowed
    // hostname list doesn't yet include the live domain → Turnstile 400020).
    const enforce =
      String((c.env as any).TURNSTILE_ENFORCE || '').toLowerCase() === 'strict';

    // Fail-open when unconfigured — never break preview / local dev.
    if (!secret) {
      return next();
    }

    const token = await extractToken(c);
    if (!token) {
      // No token: only block in strict mode, otherwise let the request pass.
      if (enforce) {
        return c.json(
          {
            error: 'Bot verification required',
            code: 'TURNSTILE_TOKEN_MISSING',
            hint: 'Complete the Turnstile challenge and re-submit.',
          },
          400,
        );
      }
      return next();
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
        // Invalid token: only block in strict mode.
        if (enforce) {
          return c.json(
            {
              error: 'Bot verification failed',
              code: 'TURNSTILE_INVALID',
              details: data['error-codes'] || [],
            },
            403,
          );
        }
        console.warn(
          '[turnstile] token invalid (non-strict, allowing):',
          (data['error-codes'] || []).join(','),
        );
      }
    } catch (e) {
      // Verification service error — only fail closed in strict mode.
      console.warn('[turnstile] verify error:', (e as Error).message);
      if (enforce) {
        return c.json(
          { error: 'Bot verification unavailable', code: 'TURNSTILE_UNREACHABLE' },
          503,
        );
      }
    }

    return next();
  };
}
