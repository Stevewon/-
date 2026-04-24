// ============================================================================
// Observability helpers (Sprint 3+ #3)
// ----------------------------------------------------------------------------
// Lightweight error + event reporting for a Cloudflare Pages Worker.
// Two sinks are supported, both optional (all fire-and-forget):
//
//   1. Sentry   — set SENTRY_DSN as a secret; uses the public "envelope" API
//                 so no SDK is needed (SDKs pull in ~200kB of deps).
//   2. Logflare — set LOGFLARE_API_KEY + LOGFLARE_SOURCE as secrets.
//
// When neither is configured, reports log to console with a [obs] prefix so
// they still show up in `wrangler tail`.
//
// Usage:
//   import { captureError, logEvent } from '../utils/observability';
//   try { ... } catch (e) { captureError(c, e, { where: 'auth.login' }); }
//   logEvent(c, 'order.fok_rejected', { market: 'BTC-USDT', user_id });
// ============================================================================

import type { Context } from 'hono';

export interface ObsEnv {
  SENTRY_DSN?: string;
  LOGFLARE_API_KEY?: string;
  LOGFLARE_SOURCE?: string;
  ENVIRONMENT?: string; // 'production' | 'preview' | 'development'
}

type CtxLike = { env: any; executionCtx?: any; req?: { header: (k: string) => string | undefined; path?: string; url?: string } };

function envFrom(c: CtxLike): ObsEnv {
  return (c?.env as ObsEnv) || {};
}

function waitUntil(c: CtxLike, p: Promise<unknown>) {
  const ctx = c?.executionCtx as any;
  if (ctx && typeof ctx.waitUntil === 'function') {
    try { ctx.waitUntil(p); return; } catch { /* fall through */ }
  }
  // Otherwise detach the promise; we don't await so the response ships fast.
  p.catch(() => { /* already logged below */ });
}

function pathFrom(c: CtxLike): string {
  try {
    if (c?.req?.path) return String(c.req.path);
    if (c?.req?.url) return new URL(String(c.req.url)).pathname;
  } catch { /* ignore */ }
  return '';
}

function requestHeaders(c: CtxLike): Record<string, string> {
  const h: Record<string, string> = {};
  try {
    const ua = c?.req?.header?.('User-Agent');
    const ip =
      c?.req?.header?.('CF-Connecting-IP') ||
      c?.req?.header?.('X-Forwarded-For')?.split(',')[0]?.trim();
    if (ua) h['user-agent'] = ua;
    if (ip) h['x-forwarded-for'] = ip;
  } catch { /* ignore */ }
  return h;
}

// --------------------------------------------------------------------------- Sentry
// Sentry envelope: POST https://<host>/api/<project>/envelope/?sentry_key=<key>
// DSN format: https://<key>@<host>/<project>
function parseDsn(dsn: string): { url: string; key: string } | null {
  try {
    const u = new URL(dsn);
    const key = u.username;
    const project = u.pathname.replace(/^\//, '');
    if (!key || !project) return null;
    return {
      url: `${u.protocol}//${u.host}/api/${project}/envelope/?sentry_key=${key}&sentry_version=7`,
      key,
    };
  } catch { return null; }
}

async function sendToSentry(dsn: string, payload: {
  event_id: string;
  level: 'error' | 'warning' | 'info';
  message: string;
  exception?: { type: string; value: string; stacktrace?: { frames: Array<{ filename?: string; function?: string; lineno?: number }> } };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  environment?: string;
  request?: { url?: string; headers?: Record<string, string> };
}): Promise<void> {
  const p = parseDsn(dsn);
  if (!p) return;
  const header = JSON.stringify({ event_id: payload.event_id, sent_at: new Date().toISOString(), dsn });
  const itemHeader = JSON.stringify({ type: 'event' });
  const body = `${header}\n${itemHeader}\n${JSON.stringify(payload)}\n`;
  try {
    await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body,
    });
  } catch (e) {
    console.warn('[obs] sentry send failed:', e);
  }
}

// --------------------------------------------------------------------------- Logflare
async function sendToLogflare(apiKey: string, source: string, metadata: Record<string, unknown>, message: string): Promise<void> {
  try {
    await fetch(`https://api.logflare.app/logs?source=${encodeURIComponent(source)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({ message, metadata, timestamp: new Date().toISOString() }),
    });
  } catch (e) {
    console.warn('[obs] logflare send failed:', e);
  }
}

// --------------------------------------------------------------------------- Public API

/** Report a caught error. Never throws. */
export function captureError(c: CtxLike, err: unknown, context?: Record<string, unknown>): void {
  const env = envFrom(c);
  const e = err instanceof Error ? err : new Error(String(err));
  const path = pathFrom(c);
  const user = (c as any)?.var?.user || (c as any)?.get?.('user');
  const userId = user?.id;

  // Always console.error so `wrangler tail` shows it.
  try {
    console.error(`[obs] ${path} ${e.name}: ${e.message}`, context || {}, e.stack?.split('\n')?.slice(0, 5).join('\n'));
  } catch { /* ignore */ }

  const eventId = crypto.randomUUID().replace(/-/g, '');

  if (env.SENTRY_DSN) {
    waitUntil(c, sendToSentry(env.SENTRY_DSN, {
      event_id: eventId,
      level: 'error',
      message: e.message,
      exception: {
        type: e.name || 'Error',
        value: e.message,
        stacktrace: e.stack
          ? { frames: e.stack.split('\n').slice(1, 20).map((l) => ({ function: l.trim() })) }
          : undefined,
      },
      tags: { path, ...(userId ? { user_id: userId } : {}) },
      extra: { ...(context || {}) },
      environment: env.ENVIRONMENT || 'production',
      request: { url: path, headers: requestHeaders(c) },
    }));
  }

  if (env.LOGFLARE_API_KEY && env.LOGFLARE_SOURCE) {
    waitUntil(c, sendToLogflare(env.LOGFLARE_API_KEY, env.LOGFLARE_SOURCE, {
      level: 'error', path, user_id: userId, stack: e.stack, ...(context || {}),
    }, `${e.name}: ${e.message}`));
  }
}

/** Report a structured event (not an error). Use sparingly for business KPIs. */
export function logEvent(c: CtxLike, name: string, data?: Record<string, unknown>): void {
  const env = envFrom(c);
  const path = pathFrom(c);
  try {
    console.log(`[obs] event=${name} path=${path}`, data || {});
  } catch { /* ignore */ }

  if (env.LOGFLARE_API_KEY && env.LOGFLARE_SOURCE) {
    waitUntil(c, sendToLogflare(env.LOGFLARE_API_KEY, env.LOGFLARE_SOURCE, {
      level: 'info', event: name, path, ...(data || {}),
    }, name));
  }
}

/**
 * Install a global error handler on the Hono app. Call once from src/server/index.ts.
 * Turns unhandled exceptions into a JSON 500 response AND ships them to Sentry/Logflare.
 */
export function installObservability<E extends { onError: Function; notFound: Function; use: Function }>(app: E): void {
  // 500 handler — last line of defence.
  (app.onError as any)((err: unknown, c: Context<any>) => {
    captureError(c as any, err);
    const isProd = ((c.env as any)?.ENVIRONMENT || 'production') === 'production';
    return c.json(
      {
        error: 'Internal server error',
        ...(isProd ? {} : { detail: err instanceof Error ? err.message : String(err) }),
      },
      500,
    );
  });

  // 404 handler — structured JSON for API paths, default HTML otherwise.
  (app.notFound as any)((c: Context<any>) => {
    const p = pathFrom(c as any);
    if (p.startsWith('/api/')) {
      return c.json({ error: 'Not Found', path: p }, 404);
    }
    // Let the SPA handle non-API 404s.
    return c.notFound();
  });
}
