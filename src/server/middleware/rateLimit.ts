// ============================================================================
// Rate limiting for Cloudflare Workers / D1.
// ----------------------------------------------------------------------------
// Uses a small rate_limits table (see migration 0008) as a fixed-window
// counter. Not perfect (no sliding window, no distributed clock sync), but
// plenty good enough to block brute-force / scraping.
// Preferred long-term: Cloudflare Rate Limiting Rules at the edge.
// ============================================================================

import type { Context, Next } from 'hono';
import type { AppEnv } from '../index';

type Opts = {
  /** Unique key prefix — e.g. 'login', 'register', 'forgot-pw'. */
  key: string;
  /** Max requests per window. */
  max: number;
  /** Window length in seconds. */
  windowSec: number;
  /** Key selector — defaults to CF-Connecting-IP. */
  selector?: (c: Context<AppEnv>) => string;
};

function clientIp(c: Context<AppEnv>): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function rateLimit(opts: Opts) {
  const selector = opts.selector || clientIp;

  return async function rateLimitMw(c: Context<AppEnv>, next: Next) {
    const subject = selector(c);
    const bucket = `${opts.key}:${subject}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % opts.windowSec);

    try {
      // Atomic upsert: insert or bump count
      const existing = await c.env.DB.prepare(
        `SELECT count, window_start FROM rate_limits WHERE bucket = ?`
      ).bind(bucket).first<{ count: number; window_start: number }>();

      if (!existing || existing.window_start !== windowStart) {
        // New window
        await c.env.DB.prepare(
          `INSERT INTO rate_limits (bucket, window_start, count)
           VALUES (?, ?, 1)
           ON CONFLICT(bucket) DO UPDATE SET window_start = excluded.window_start, count = 1`
        ).bind(bucket, windowStart).run();
      } else {
        if (existing.count >= opts.max) {
          const retryAfter = opts.windowSec - (now - windowStart);
          c.header('Retry-After', String(Math.max(1, retryAfter)));
          return c.json(
            { error: 'Too many requests. Please try again later.', retry_after_sec: retryAfter },
            429,
          );
        }
        await c.env.DB.prepare(
          `UPDATE rate_limits SET count = count + 1 WHERE bucket = ?`
        ).bind(bucket).run();
      }
    } catch (e) {
      // If the table doesn't exist yet (pre-migration), fail open so we don't
      // accidentally block real users during rollout.
      console.warn('[rateLimit] fallback (no table?):', e);
    }

    await next();
  };
}
